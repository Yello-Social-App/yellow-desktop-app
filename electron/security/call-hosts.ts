/**
 * The hosts a call's media server may be on: one list, read by three
 * consumers, like chat media's (media-hosts.ts).
 *
 * - The CSP names them in `connect-src`, as `wss:` for LiveKit's signalling
 *   socket and `https:` for the region list LiveKit Cloud serves first;
 * - the packaged build's request filter lets `wss:` through to them alone;
 * - the join-token handler checks a `serverUrl` against them before the
 *   renderer is told to connect there (OWASP A01).
 *
 * An `https://` entry derives `wss:`, an `http://` one `ws:` (development
 * only — the packaged build's request filter passes `wss:` alone).
 */
import { callMediaHostsFromEnvironment } from '../config';

import { hostMatches, parseHostPatterns, type HostPattern } from './host-allowlist';

const SOCKET_PROTOCOL: Readonly<Record<string, string>> = { 'https:': 'wss:', 'http:': 'ws:' };

function patterns(): HostPattern[] {
  return parseHostPatterns(callMediaHostsFromEnvironment());
}

/** The allowlist as CSP host-sources — both the HTTP and the socket form — space-joined. */
export function callMediaConnectSources(): string {
  return patterns()
    .flatMap((pattern) => {
      const socket = SOCKET_PROTOCOL[pattern.protocol] ?? 'wss:';
      return [pattern.source, pattern.source.replace(pattern.protocol, socket)];
    })
    .join(' ');
}

/**
 * Whether a URL is on a listed call host: `wss:`/`https:` for an `https://`
 * entry (`ws:`/`http:` for an `http://` one), no credentials in it.
 */
export function isCallMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') {
    return false;
  }
  return patterns().some(
    (pattern) =>
      (url.protocol === pattern.protocol || url.protocol === SOCKET_PROTOCOL[pattern.protocol]) &&
      hostMatches(pattern, url.hostname),
  );
}

/** The one kind of `serverUrl` a join may be handed: a socket URL on a listed host. */
export function isCallServerUrl(value: string): boolean {
  return /^wss?:\/\//i.test(value) && isCallMediaUrl(value);
}
