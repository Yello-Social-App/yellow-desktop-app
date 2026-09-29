/**
 * Content-Security-Policy, applied as a response header on every document the
 * app loads (OWASP A02 / A07 — defence in depth behind React's escaping).
 *
 * Production is the strict policy the spec calls for: no 'unsafe-inline', no
 * 'unsafe-eval', `default-src 'none'`, and no remote hosts beyond the listed
 * media ones — fonts are self-hosted and mock data is bundled. The one remote
 * `connect-src` is call media: a call's audio and video need WebRTC, which only
 * the renderer has, so it reaches the LiveKit hosts in call-hosts.ts itself.
 *
 * Development adds exactly what Vite's dev server needs to function (inline
 * style injection, eval for HMR, and a websocket back to the dev server) and
 * nothing more. The relaxations are keyed off the dev server URL, which no
 * packaged build ever has.
 */
import { session } from 'electron';

import { appImageOrigins } from './image-hosts';
import { callMediaConnectSources, isCallMediaUrl } from './call-hosts';
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
  // Chat attachments and group photos: presigned links on the private bucket's
  // host, which is not the public CDN (see media-hosts.ts).
  return [...appImageOrigins(), chatMediaSources()].filter((value) => value !== '').join(' ');
}

/**
 * Voice messages stream from presigned links on the chat-media host, so only
 * that allowlist may feed an `<audio>`; with no hosts configured, nothing may.
 */
function mediaSources(): string {
  const sources = chatMediaSources();
  return sources === '' ? "'none'" : sources;
}

function productionPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${imageHosts()}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${callMediaConnectSources()}`.trim(),
    `media-src ${mediaSources()}`,
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
    `connect-src 'self' ${devUrl} ${wsUrl} ${callMediaConnectSources()}`.trim(),
    `media-src ${mediaSources()}`,
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
        // permission-handler level. The microphone (voice messages, calls),
        // the camera and screen capture (calls) are our own page's only; no
        // frame or other origin may ask for them.
        'Permissions-Policy': [
          'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), midi=(), serial=(), hid=()',
        ],
      },
    });
  });

  if (isDevRuntime()) {
    return;
  }

  // Belt and braces for OWASP A04: a packaged build may talk to the bundle,
  // to devtools, or to an HTTPS API — never to a cleartext or exotic scheme.
  // A secure socket is let through to a call's media server alone.
  const allowedPrefixes = ['app://', 'devtools://', 'https://'];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      allowedPrefixes.some((prefix) => details.url.startsWith(prefix)) ||
      (details.url.startsWith('wss://') && isCallMediaUrl(details.url));
    callback({ cancel: !allowed });
  });
}
