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

import { hostMatches, parseHostPatterns, type HostPattern } from './host-allowlist';

function patterns(): HostPattern[] {
  return parseHostPatterns(chatMediaHostsFromEnvironment());
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
  return patterns().some(
    (pattern) => pattern.protocol === url.protocol && hostMatches(pattern, url.hostname),
  );
}
