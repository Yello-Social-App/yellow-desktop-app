/**
 * An origin allowlist read from configuration: each entry is `scheme://host`,
 * optionally with one leading `*.` wildcard label. Shared by every list of
 * outside hosts the app trusts (chat media, call media), so they all parse
 * the same way and refuse the same malformed entries.
 */

export interface HostPattern {
  protocol: string;
  /** The exact host, or the suffix after `*.` for a wildcard entry. */
  host: string;
  wildcard: boolean;
  /** The entry as CSP spells it. */
  source: string;
}

const WILDCARD_PREFIX = '*.';

export function parseHostPattern(entry: string): HostPattern | null {
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

export function parseHostPatterns(entries: readonly string[]): HostPattern[] {
  return entries
    .map(parseHostPattern)
    .filter((pattern): pattern is HostPattern => pattern !== null);
}

/** Whether a lower-cased hostname is the pattern's host, or under it for a wildcard. */
export function hostMatches(pattern: HostPattern, hostname: string): boolean {
  const host = hostname.toLowerCase();
  return pattern.wildcard ? host.endsWith(`.${pattern.host}`) : host === pattern.host;
}
