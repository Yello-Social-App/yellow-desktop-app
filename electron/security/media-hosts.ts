/**
 * The hosts chat media and story photos may come from: one list, read by two
 * consumers. Both are presigned links on the private bucket's S3 API host.
 *
 * The CSP uses it as `img-src` host-sources, so a presigned image renders
 * inline; the attachment download uses it as an allowlist before the main
 * process fetches anything, so a URL in a server response can never turn this
 * app into a fetcher of arbitrary addresses (OWASP A01, the SSRF case). Keeping
 * both on one parser means the two can never disagree about what is allowed.
 */
import { chatMediaHostsFromEnvironment } from '../config';

interface HostPattern {
  protocol: string;
  /** The exact host, or the suffix after `*.` for a wildcard entry. */
  host: string;
  wildcard: boolean;
  /** The entry as CSP spells it. */
  source: string;
}

const WILDCARD_PREFIX = '*.';

function parsePattern(entry: string): HostPattern | null {
  const match = /^(https?):\/\/([^/?#]+)$/i.exec(entry.replace(/\/$/, ''));
  if (match === null) {
    return null;
  }
  const [, scheme = '', rawHost = ''] = match;
  const wildcard = rawHost.startsWith(WILDCARD_PREFIX);
  const host = (wildcard ? rawHost.slice(WILDCARD_PREFIX.length) : rawHost).toLowerCase();
  // A bare `*.` or a wildcard anywhere else is refused rather than read loosely.
  if (host === '' || host.includes('*') || !host.includes('.')) {
    return null;
  }
  const protocol = `${scheme.toLowerCase()}:`;
  return {
    protocol,
    host,
    wildcard,
    source: `${protocol}//${wildcard ? WILDCARD_PREFIX : ''}${host}`,
  };
}

function patterns(): HostPattern[] {
  return chatMediaHostsFromEnvironment()
    .map(parsePattern)
    .filter((pattern): pattern is HostPattern => pattern !== null);
}

/** The allowlist as CSP host-sources, space-joined. */
export function chatMediaSources(): string {
  return patterns()
    .map((pattern) => pattern.source)
    .join(' ');
}

/** Whether a URL may be fetched as chat media: https, on a listed host, default port. */
export function isChatMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return patterns().some((pattern) => {
    if (pattern.protocol !== url.protocol) {
      return false;
    }
    return pattern.wildcard ? host.endsWith(`.${pattern.host}`) : host === pattern.host;
  });
}
