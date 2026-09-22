/**
 * Main process entry point.
 *
 * Security posture, all set before any renderer exists:
 *   - sandbox: true, contextIsolation: true, nodeIntegration: false on every
 *     BrowserWindow, plus app.enableSandbox() so the flags cannot be forgotten;
 *   - the renderer is served over a custom `app://` scheme rather than file://,
 *     which gives it a real, checkable origin and keeps path resolution inside
 *     the bundle directory (OWASP A01);
 *   - CSP, permission and navigation policies are installed before the first
 *     load, never after.
 *
 * The process also stays thin: no synchronous filesystem work on the main
 * thread beyond reading bundle assets, and non-critical IPC handlers are
 * registered only once the window is on screen.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, protocol } from 'electron';

import { configureHttpClient } from './api/http-client';
import { apiBaseUrlFromEnvironment, chatBaseUrlFromEnvironment } from './config';
import { registerAuthHandlers } from './ipc/handlers/auth.handler';
import { registerChatHandlers } from './ipc/handlers/chat.handler';
import { registerCommentHandlers } from './ipc/handlers/comments.handler';
import { registerCommunityHandlers } from './ipc/handlers/communities.handler';
import { registerFeedHandlers } from './ipc/handlers/feed.handler';
import { registerFriendHandlers } from './ipc/handlers/friends.handler';
import { registerFsHandlers } from './ipc/handlers/fs.handler';
import { registerLinkHandlers } from './ipc/handlers/links.handler';
import { registerNotificationHandlers } from './ipc/handlers/notifications.handler';
import { registerPostHandlers } from './ipc/handlers/posts.handler';
import { registerProfileHandlers } from './ipc/handlers/profile.handler';
import { registerReactionHandlers } from './ipc/handlers/reactions.handler';
import { registerShowcaseHandlers } from './ipc/handlers/showcase.handler';
import { registerWindowHandlers } from './ipc/handlers/window.handler';
import { chatAlerts } from './chat/alerts';
import { chatSocket } from './chat/socket';
import { notificationWatcher } from './notifications/watcher';
import { createLogger } from '../shared/logger';
import { buildApplicationMenu } from './menu';
import { initialiseAutoUpdater } from './autoUpdater';
import { isUpdateCommand, runUpdateCommand } from './cli/update-command';
import { applyContentSecurityPolicy } from './security/csp';
import { applyNavigationPolicy, applyPermissionPolicy } from './security/permissions';
import {
  APP_ENTRY_URL,
  APP_PROTOCOL,
  APP_PROTOCOL_HOST,
  devServerUrl,
  isDevRuntime,
} from './security/origins';

const log = createLogger('main');

const WINDOW_DEFAULT_WIDTH = 1280;
const WINDOW_DEFAULT_HEIGHT = 832;
const WINDOW_MIN_WIDTH = 960;
const WINDOW_MIN_HEIGHT = 640;
/** Matches the dark --color-background so the frame never flashes white. */
const WINDOW_BACKGROUND_COLOUR = '#0b0d10';

const RENDERER_DIR = path.join(__dirname, '..', 'dist');
const INDEX_FILE = 'index.html';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

let mainWindow: BrowserWindow | null = null;

/**
 * `app://` is registered as a standard, secure scheme so the renderer gets a
 * stable origin (app://bundle) that sender validation and CSP can rely on.
 * This must run before the app is ready.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Serves the built renderer, refusing anything that escapes the bundle directory. */
function registerAppProtocol(): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);

    if (url.host !== APP_PROTOCOL_HOST) {
      return new Response('Not found', { status: HTTP_NOT_FOUND });
    }

    const requestedPath = decodeURIComponent(url.pathname);
    const relativePath = requestedPath === '/' ? `/${INDEX_FILE}` : requestedPath;
    const resolved = path.normalize(path.join(RENDERER_DIR, relativePath));

    // Path traversal guard: the resolved file must sit inside the bundle.
    if (resolved !== RENDERER_DIR && !resolved.startsWith(RENDERER_DIR + path.sep)) {
      log.warn('protocol_traversal_blocked', {});
      return new Response('Forbidden', { status: HTTP_FORBIDDEN });
    }

    try {
      const body = await readFile(resolved);
      return new Response(body, {
        status: HTTP_OK,
        headers: { 'Content-Type': contentTypeFor(resolved) },
      });
    } catch {
      return new Response('Not found', { status: HTTP_NOT_FOUND });
    }
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: WINDOW_BACKGROUND_COLOUR,
    // The renderer draws its own 56px title bar.
    frame: false,
    // Nothing is painted until React has rendered its first frame.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
      devTools: isDevRuntime(),
    },
  });

  window.once('ready-to-show', () => {
    window.show();
    log.info('window_shown', {});

    // Deferred until the window is interactive: none are needed to first paint.
    registerFsHandlers();
    registerLinkHandlers();
    initialiseAutoUpdater();
  });

  // The inbox watcher paces itself by whether anyone is looking: often while
  // the window has focus, rarely once it does not, and at once when it returns.
  window.on('focus', () => {
    notificationWatcher.handleFocusChange(true);
  });
  window.on('blur', () => {
    notificationWatcher.handleFocusChange(false);
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devUrl = devServerUrl();
  if (devUrl !== undefined) {
    // DevTools stay closed until asked for (View menu / the usual shortcut).
    await window.loadURL(devUrl);
    return;
  }
  await window.loadURL(APP_ENTRY_URL);
}

/**
 * Electron only auto-selects a real secret-store backend for GNOME and KDE; on
 * any other Linux desktop (Hyprland, sway, …) it falls back to `basic_text`,
 * where safeStorage reports encryption unavailable and the remembered session
 * is silently never written. A freedesktop Secret Service (gnome-keyring) is
 * present on those desktops too, so steer Electron to the libsecret backend and
 * keep the refresh token encrypted by the OS keyring rather than dropped
 * (OWASP A04). KDE is left alone: Electron already picks kwallet there.
 *
 * Harmless where a keyring is absent — safeStorage still reports unavailable and
 * the token-store falls back to not persisting, exactly as before.
 */
function preferSecretServiceBackend(): void {
  if (process.platform !== 'linux') {
    return;
  }
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
  if (desktop.includes('kde')) {
    return;
  }
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

function bootstrap(): void {
  // `yello-desktop-app update` is a terminal command, not a launch: no window,
  // and ahead of the single-instance lock so it works while Yello is open.
  if (isUpdateCommand()) {
    void app
      .whenReady()
      .then(runUpdateCommand)
      .catch((error: unknown) => {
        process.stderr.write(`Update failed: ${String(error)}\n`);
        return 1;
      })
      .then((code) => {
        app.exit(code);
      });
    return;
  }

  // Must run before the app is ready so safeStorage picks the backend up.
  preferSecretServiceBackend();

  // Belt and braces: sandbox every renderer regardless of per-window options.
  app.enableSandbox();

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow === null) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  applyNavigationPolicy();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    // A clean close beats the server waiting out a heartbeat.
    chatSocket.disconnect();
    notificationWatcher.stop();
    chatAlerts.reset();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void loadRenderer(mainWindow);
    }
  });

  app
    .whenReady()
    .then(async () => {
      // The HTTP client lives in this process, so it is ready before any
      // renderer can ask for data.
      configureHttpClient(apiBaseUrlFromEnvironment(), chatBaseUrlFromEnvironment());
      // Chat alerts listen to the socket for the life of the app; each session
      // end clears what they hold.
      chatAlerts.attach();

      applyContentSecurityPolicy();
      applyPermissionPolicy();
      registerAppProtocol();

      // Registered before the first load: the renderer calls these on mount.
      registerAuthHandlers();
      registerFeedHandlers();
      registerPostHandlers();
      registerCommentHandlers();
      registerReactionHandlers();
      registerFriendHandlers();
      registerChatHandlers();
      registerNotificationHandlers();
      registerCommunityHandlers();
      registerShowcaseHandlers();
      registerProfileHandlers();
      registerWindowHandlers();

      mainWindow = createMainWindow();
      buildApplicationMenu(mainWindow);

      log.info('app_ready', { dev: isDevRuntime() });

      await loadRenderer(mainWindow);
    })
    .catch((error: unknown) => {
      log.error('bootstrap_failed', { error });
      app.quit();
    });
}

bootstrap();
