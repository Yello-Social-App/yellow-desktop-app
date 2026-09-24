/**
 * Default-deny policy for everything Chromium can be asked to hand out
 * (OWASP A01 / A02).
 *
 * Camera, geolocation, notifications, MIDI, USB, serial, HID and clipboard
 * reads are all denied. The allowlist below is deliberately empty: a feature
 * that needs a permission has to add itself here explicitly, and the reviewer
 * sees that in the diff.
 *
 * The one exception is the microphone, for voice messages — and only the
 * microphone: a `media` request is granted when it asks for audio alone, from
 * the app's own renderer, in its main frame. A request that also wants the
 * camera, or comes from anywhere else, is denied like everything else.
 */
import { app, session, shell, systemPreferences, type WebContents } from 'electron';

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

function isTrustedOrigin(url: string | undefined): boolean {
  return url !== undefined && originOf(url) === trustedRendererOrigin();
}

/** A `getUserMedia({ audio: true })` from our own page, and nothing broader. */
function isMicrophoneRequest(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: string[] },
): boolean {
  const { mediaTypes = [] } = details;
  return (
    permission === 'media' &&
    details.isMainFrame === true &&
    isTrustedOrigin(details.requestingUrl) &&
    mediaTypes.length > 0 &&
    mediaTypes.every((type) => type === 'audio')
  );
}

/**
 * On macOS the OS asks the user too, once, and remembers the answer. Elsewhere
 * the OS setting is outside the app's reach, and a refusal there surfaces as
 * the recorder failing to start, which the renderer explains.
 */
async function osAllowsMicrophone(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') {
    return true;
  }
  return systemPreferences.askForMediaAccess('microphone');
}

export function applyPermissionPolicy(): void {
  const { defaultSession } = session;

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (isMicrophoneRequest(permission, details)) {
      void osAllowsMicrophone().then(
        (allowed) => {
          if (!allowed) {
            log.info('microphone_denied_by_os', {});
          }
          callback(allowed);
        },
        () => {
          callback(false);
        },
      );
      return;
    }
    const granted = isGranted(permission);
    if (!granted) {
      log.warn('permission_request_denied', { permission });
    }
    callback(granted);
  });

  defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      if (
        permission === 'media' &&
        details.mediaType === 'audio' &&
        details.isMainFrame &&
        originOf(requestingOrigin) === trustedRendererOrigin()
      ) {
        return true;
      }
      return isGranted(permission);
    },
  );

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
