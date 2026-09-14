/**
 * Link previews: reads a page's Open Graph tags (or a provider's oEmbed) and
 * fetches its image, from the main process.
 *
 * This is the one place the app fetches a URL that came from user content, so
 * it is treated as the server-side-request risk it is (OWASP A01, SSRF):
 *   - only http(s), and only to hosts that resolve to public addresses — a
 *     link to `localhost`, a LAN address or a link-local range is refused
 *     before any connection, and every redirect hop is re-checked;
 *   - bodies are read through a cap, with a timeout, and never executed —
 *     the HTML is scanned with a tag regex, never parsed by a browser;
 *   - the image is decoded and re-encoded by nativeImage before it reaches
 *     the renderer, so what is shown is a JPEG this process produced, not
 *     the bytes the site served (A08).
 *
 * Privacy note: unfurling from the client means the page host sees the
 * reader's IP, as a browser visit would. No cookies or credentials are ever
 * sent, and the user agent names the app.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { nativeImage } from 'electron';

import { createLogger } from '../../shared/logger';
import type { LinkPreview } from '../../shared/ipc-types';

const log = createLogger('links.unfurl');

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PREVIEW_IMAGE_WIDTH = 640;
const JPEG_QUALITY = 80;
const USER_AGENT = 'YelloDesktop/0.2 (+link preview)';
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_BAD_REQUEST = 400;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
]);
const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'www.github.com']);

interface CacheEntry {
  expiresAt: number;
  preview: LinkPreview | null;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<LinkPreview | null>>();

/* ------------------------------------------------------------------ *
 * Address checks
 * ------------------------------------------------------------------ */

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') {
    return true;
  }
  // IPv4-mapped: judge the embedded address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1] !== undefined) {
    return isPrivateIpv4(mapped[1]);
  }
  return (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('ff')
  );
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

/** Refuses anything that is not a web URL to a publicly routable host. */
async function assertPublicWebUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error('protocol');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('credentials_in_url');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('local_host');
  }
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw new Error('private_address');
    }
    return url;
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('private_address');
  }
  return url;
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

interface Fetched {
  finalUrl: URL;
  contentType: string;
  bytes: Buffer;
}

/** Reads a body through a byte cap; anything past it is dropped, not buffered. */
async function readCapped(response: Response, cap: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** GET with manual, re-validated redirects, a timeout and a body cap. */
async function fetchPublic(raw: string, accept: string, cap: number): Promise<Fetched> {
  let url = await assertPublicWebUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { Accept: accept, 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= HTTP_MULTIPLE_CHOICES && response.status < HTTP_BAD_REQUEST) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (location === null) {
        throw new Error('redirect_without_location');
      }
      url = await assertPublicWebUrl(new URL(location, url).toString());
      continue;
    }

    if (response.status !== HTTP_OK) {
      await response.body?.cancel();
      throw new Error(`status_${String(response.status)}`);
    }

    return {
      finalUrl: url,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      bytes: await readCapped(response, cap),
    };
  }

  throw new Error('too_many_redirects');
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      }
      if (lower.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      }
      return ENTITIES[lower] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The `content` of the first <meta> whose property or name matches. */
function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
      'i',
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1] !== undefined && match[1] !== '') {
      return decodeEntities(match[1]);
    }
  }
  return undefined;
}

function titleTag(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]) || undefined;
}

function providerOf(url: URL): LinkPreview['provider'] {
  if (YOUTUBE_HOSTS.has(url.hostname)) {
    return 'youtube';
  }
  if (GITHUB_HOSTS.has(url.hostname)) {
    return 'github';
  }
  return 'generic';
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Fetches, decodes and downscales the preview image. Re-encoding through
 * nativeImage is what makes the bytes trustworthy: an image that does not
 * decode yields nothing rather than reaching the renderer as-is.
 */
async function fetchPreviewImage(raw: string): Promise<string | undefined> {
  try {
    const { contentType, bytes } = await fetchPublic(raw, 'image/*', MAX_IMAGE_BYTES);
    if (!contentType.startsWith('image/') || bytes.byteLength === 0) {
      return undefined;
    }
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) {
      return undefined;
    }
    const { width } = image.getSize();
    const scaled = width > PREVIEW_IMAGE_WIDTH ? image.resize({ width: PREVIEW_IMAGE_WIDTH }) : image;
    return `data:image/jpeg;base64,${scaled.toJPEG(JPEG_QUALITY).toString('base64')}`;
  } catch (error) {
    log.info('preview_image_skipped', { reason: error instanceof Error ? error.message : 'unknown' });
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/** YouTube publishes oEmbed, which is cleaner and cheaper than its HTML. */
async function unfurlYouTube(url: URL): Promise<LinkPreview | null> {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', url.toString());
  endpoint.searchParams.set('format', 'json');

  const { bytes } = await fetchPublic(endpoint.toString(), 'application/json', MAX_HTML_BYTES);
  const data = JSON.parse(bytes.toString('utf8')) as OEmbed;
  const title = typeof data.title === 'string' ? data.title : undefined;
  if (title === undefined) {
    return null;
  }

  return {
    url: url.toString(),
    host: url.hostname,
    siteName: 'YouTube',
    title,
    description: typeof data.author_name === 'string' ? data.author_name : undefined,
    imageDataUrl:
      typeof data.thumbnail_url === 'string' ? await fetchPreviewImage(data.thumbnail_url) : undefined,
    provider: 'youtube',
  };
}

async function unfurlOpenGraph(url: URL): Promise<LinkPreview | null> {
  const { finalUrl, contentType, bytes } = await fetchPublic(
    url.toString(),
    'text/html,application/xhtml+xml',
    MAX_HTML_BYTES,
  );
  if (!contentType.includes('html')) {
    return null;
  }

  const html = bytes.toString('utf8');
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? titleTag(html);
  const description =
    metaContent(html, 'og:description') ??
    metaContent(html, 'twitter:description') ??
    metaContent(html, 'description');
  const image =
    metaContent(html, 'og:image:secure_url') ??
    metaContent(html, 'og:image') ??
    metaContent(html, 'twitter:image');
  const siteName = metaContent(html, 'og:site_name');

  if (title === undefined && description === undefined && image === undefined) {
    return null;
  }

  return {
    url: url.toString(),
    host: finalUrl.hostname,
    siteName,
    title,
    description,
    imageDataUrl:
      image === undefined ? undefined : await fetchPreviewImage(new URL(image, finalUrl).toString()),
    provider: providerOf(finalUrl),
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function remember(key: string, preview: LinkPreview | null): LinkPreview | null {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, preview });
  return preview;
}

/**
 * The preview for a link, or null when there is nothing to show. Never
 * throws: a page that cannot be read is simply a link without a card (A10).
 * Answers are cached for an hour and concurrent asks share one fetch.
 */
export function unfurl(raw: string): Promise<LinkPreview | null> {
  const cached = cache.get(raw);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.preview);
  }

  const pending = inFlight.get(raw);
  if (pending !== undefined) {
    return pending;
  }

  const work = (async (): Promise<LinkPreview | null> => {
    try {
      const url = await assertPublicWebUrl(raw);
      const preview =
        providerOf(url) === 'youtube' ? await unfurlYouTube(url) : await unfurlOpenGraph(url);
      log.info('link_unfurled', { host: url.hostname, hasImage: preview?.imageDataUrl !== undefined });
      return remember(raw, preview);
    } catch (error) {
      // The reason is a short code we produced, or the fetch's own message — a host name at most, never page content.
      log.info('link_unfurl_skipped', { reason: error instanceof Error ? error.message : 'unknown' });
      return remember(raw, null);
    } finally {
      inFlight.delete(raw);
    }
  })();

  inFlight.set(raw, work);
  return work;
}
