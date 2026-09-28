/**
 * The origins app images are served from — the API itself and the public
 * media CDN — read by two consumers: the CSP, which allows them as `img-src`,
 * and saving or copying an image, which may fetch only from them (or from the
 * chat-media allowlist). One list, so what the window may show and what the
 * main process may download can never disagree (OWASP A01, the SSRF case).
 */
import { apiBaseUrlFromEnvironment, imageBaseUrlsFromEnvironment } from '../config';

import { isChatMediaUrl } from './media-hosts';

/** The configured image origins, each once; a malformed entry is dropped. */
export function appImageOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of [apiBaseUrlFromEnvironment(), ...imageBaseUrlsFromEnvironment()]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Dropped rather than poisoning the whole list.
    }
  }
  return [...origins];
}

/**
 * Whether a URL may be fetched to save or copy an image: exactly one of the
 * configured image origins, or a presigned chat-media link. No credentials in
 * the URL either way. The origins are the app's own configuration, which is
 * why a loopback `http:` API base in development passes here as it does in
 * the CSP.
 */
export function isAppImageUrl(value: string): boolean {
  if (isChatMediaUrl(value)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }
  return appImageOrigins().includes(url.origin);
}
