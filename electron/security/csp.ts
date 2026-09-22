/**
 * Content-Security-Policy, applied as a response header on every document the
 * app loads (OWASP A02 / A07 — defence in depth behind React's escaping).
 *
 * Production is the strict policy the spec calls for: no 'unsafe-inline', no
 * 'unsafe-eval', `default-src 'none'`, and no remote hosts at all — fonts are
 * self-hosted and mock data is bundled.
 *
 * Development adds exactly what Vite's dev server needs to function (inline
 * style injection, eval for HMR, and a websocket back to the dev server) and
 * nothing more. The relaxations are keyed off the dev server URL, which no
 * packaged build ever has.
 */
import { session } from 'electron';

import { apiBaseUrlFromEnvironment, imageBaseUrlsFromEnvironment } from '../config';

import { chatMediaSources } from './media-hosts';
import { devServerUrl, isDevRuntime } from './origins';

/**
 * The renderer performs no HTTP of its own — all API traffic goes through the
 * main process — so these hosts are allowed for images only (avatars and post
 * attachments), never for script or connect.
 *
 * Both the API origin and the media CDN (R2) are included: the API may serve
 * some images inline, but uploaded media is served from a separate bucket
 * origin, so leaving it out silently blanks every avatar to its initials. Chat
 * media is a third origin again, from its own allowlist.
 */
function imageHosts(): string {
  const origins = new Set<string>();

  for (const url of [apiBaseUrlFromEnvironment(), ...imageBaseUrlsFromEnvironment()]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A malformed entry is dropped rather than poisoning the whole policy.
    }
  }

  // Chat attachments and group photos: presigned links on the private bucket's
  // host, which is not the public CDN above (see media-hosts.ts).
  return [...origins, chatMediaSources()].filter((value) => value !== '').join(' ');
}

function productionPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${imageHosts()}`.trim(),
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function developmentPolicy(devUrl: string): string {
  const wsUrl = devUrl.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    // Vite's HMR client and React Refresh need eval in development only.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${devUrl}`,
    `style-src 'self' 'unsafe-inline' ${devUrl}`,
    `img-src 'self' data: ${devUrl} ${imageHosts()}`.trim(),
    `font-src 'self' data: ${devUrl}`,
    `connect-src 'self' ${devUrl} ${wsUrl}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function contentSecurityPolicy(): string {
  const devUrl = devServerUrl();
  return devUrl === undefined ? productionPolicy() : developmentPolicy(devUrl);
}

export function applyContentSecurityPolicy(): void {
  const policy = contentSecurityPolicy();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'X-Content-Type-Options': ['nosniff'],
        // Opt every document out of the powerful features we also deny at the
        // permission-handler level.
        'Permissions-Policy': [
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), serial=(), hid=()',
        ],
      },
    });
  });

  if (isDevRuntime()) {
    return;
  }

  // Belt and braces for OWASP A04: a packaged build may talk to the bundle,
  // to devtools, or to an HTTPS API — never to a cleartext or exotic scheme.
  const allowedPrefixes = ['app://', 'devtools://', 'https://'];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedPrefixes.some((prefix) => details.url.startsWith(prefix)) });
  });
}
