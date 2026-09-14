/**
 * Finding web links in user text.
 *
 * Only `http(s)://` is recognised: bare domains are left as text, so a stray
 * "yello.app" in a sentence does not turn into a link the security layer
 * would then refuse to open. Trailing punctuation that is almost never part
 * of a URL — the full stop ending the sentence, a closing bracket — is left
 * outside the link.
 */
import { LINK_URL_MAX } from '@shared/ipc-types';

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

export type TextSegment = { kind: 'text'; value: string } | { kind: 'link'; value: string };

/** Splits text into plain runs and links, in order, nothing dropped. */
export function segmentLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    let url = match[0].replace(TRAILING_PUNCTUATION, '');
    // A balanced ")" belongs to the URL (Wikipedia-style); an unbalanced one does not.
    const opens = (url.match(/\(/g) ?? []).length;
    const closes = (url.match(/\)/g) ?? []).length;
    if (match[0].endsWith(')') && opens > closes) {
      url = `${url})`;
    }
    if (url.length > LINK_URL_MAX || !isWebUrl(url)) {
      continue;
    }
    if (start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, start) });
    }
    segments.push({ kind: 'link', value: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/** The links in a text, first to last, without duplicates. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const segment of segmentLinks(text)) {
    if (segment.kind === 'link') {
      seen.add(segment.value);
    }
  }
  return [...seen];
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** A link as it reads on screen: no scheme, no trailing slash, capped. */
export function displayLink(url: string, max = 60): string {
  const stripped = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}
