/**
 * Default-deny policy for everything Chromium can be asked to hand out
 * (OWASP A01 / A02).
 *
 * Geolocation, notifications, MIDI, USB, serial, HID and clipboard reads are
 * all denied. The allowlist below is deliberately empty: a feature that needs
 * a permission has to add itself here explicitly, and the reviewer sees that
 * in the diff.
 *
 * The exceptions are capture devices, for voice messages and calls: a `media`
 * request for the microphone and/or the camera, and a `display-capture`
 * request for screen sharing, are granted when they come from the app's own
 * renderer, in its main frame. Which screen is shared is still the user's
 * pick (screen-capture.ts); anything from anywhere else is denied like
 * everything else.
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

type CaptureDevice = 'microphone' | 'camera';

const DEVICE_OF_MEDIA_TYPE: Readonly<Record<string, CaptureDevice>> = {
  audio: 'microphone',
  video: 'camera',
};

/**
 * The devices a `getUserMedia` from our own page's main frame asks for, or
 * null when the request is anything else — another origin, a subframe, or a
 * media type other than audio and video.
 */
function captureDevicesOf(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: string[] },
): CaptureDevice[] | null {
  const { mediaTypes = [] } = details;
  if (
    permission !== 'media' ||
    details.isMainFrame !== true ||
    !isTrustedOrigin(details.requestingUrl) ||
    mediaTypes.length === 0
  ) {
    return null;
  }
  const devices = mediaTypes.map((type) => DEVICE_OF_MEDIA_TYPE[type]);
  return devices.every((device) => device !== undefined) ? [...new Set(devices)] : null;
}

/** A screen-share from our own page's main frame; the source is picked elsewhere. */
function isScreenCaptureRequest(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean },
): boolean {
  return (
    permission === 'display-capture' &&
    details.isMainFrame === true &&
    isTrustedOrigin(details.requestingUrl)
  );
}

/**
 * On macOS the OS asks the user too, once per device, and remembers the
 * answer. Elsewhere the OS setting is outside the app's reach, and a refusal
 * there surfaces as the recorder or the call failing to start, which the
 * renderer explains.
 */
async function osAllows(devices: readonly CaptureDevice[]): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  for (const device of devices) {
    if (systemPreferences.getMediaAccessStatus(device) === 'granted') {
      continue;
    }
    if (!(await systemPreferences.askForMediaAccess(device))) {
      return false;
    }
  }
  return true;
}

export function applyPermissionPolicy(): void {
  const { defaultSession } = session;

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const devices = captureDevicesOf(permission, details);
    if (devices !== null) {
      void osAllows(devices).then(
        (allowed) => {
          if (!allowed) {
            log.info('capture_denied_by_os', { devices: devices.join(',') });
          }
          callback(allowed);
        },
        () => {
          callback(false);
        },
      );
      return;
    }
    if (isScreenCaptureRequest(permission, details)) {
      callback(true);
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
        (details.mediaType === 'audio' || details.mediaType === 'video') &&
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
