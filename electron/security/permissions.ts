/**
 * Default-deny policy for everything Chromium can be asked to hand out
 * (OWASP A01 / A02).
 *
 * Camera, microphone, geolocation, notifications, MIDI, USB, serial, HID and
 * clipboard reads are all denied. The allowlist below is deliberately empty:
 * a feature that needs a permission has to add itself here explicitly, and the
 * reviewer sees that in the diff.
 */
import { app, session, shell, type WebContents } from 'electron';

import { createLogger } from '../../shared/logger';

import { APP_ORIGIN, originOf, trustedRendererOrigin } from './origins';

const log = createLogger('security.permissions');

/** No permission is granted today. Adding one is a reviewed, deliberate act. */
const GRANTED_PERMISSIONS: readonly string[] = [];

/**
 * External links open in the user's browser — web URLs only. Anything else
 * (`file:`, `javascript:`, custom schemes) is refused: the browser is the
 * right place to judge a web page, but nothing else should be launched from
 * text a stranger wrote in a post (A01).
 */
const EXTERNAL_LINK_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'http:']);

function isGranted(permission: string): boolean {
  return GRANTED_PERMISSIONS.includes(permission);
}

export function applyPermissionPolicy(): void {
  const { defaultSession } = session;

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const granted = isGranted(permission);
    if (!granted) {
      log.warn('permission_request_denied', { permission });
    }
    callback(granted);
  });

  defaultSession.setPermissionCheckHandler((_webContents, permission) => isGranted(permission));

  defaultSession.setDevicePermissionHandler(() => false);

  defaultSession.setBluetoothPairingHandler((_details, callback) => {
    callback({ confirmed: false });
  });
}

/**
 * Locks navigation down for every WebContents the app creates: the renderer may
 * only ever sit on its own origin, popups are refused, and <webview> can never
 * attach.
 */
export function applyNavigationPolicy(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      const target = originOf(navigationUrl);
      if (target !== trustedRendererOrigin() && target !== APP_ORIGIN) {
        event.preventDefault();
        log.warn('navigation_blocked', { target: target ?? 'unparsable' });
      }
    });

    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      log.warn('webview_attach_blocked', {});
    });

    contents.setWindowOpenHandler(({ url }) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        log.warn('window_open_blocked', { reason: 'unparsable_url' });
        return { action: 'deny' };
      }

      if (EXTERNAL_LINK_PROTOCOLS.has(parsed.protocol)) {
        void shell.openExternal(parsed.toString());
        log.info('external_link_opened', { host: parsed.host });
      } else {
        log.warn('window_open_blocked', { protocol: parsed.protocol });
      }

      // No renderer-opened windows, ever: a popup would inherit the preload.
      return { action: 'deny' };
    });
  });
}
