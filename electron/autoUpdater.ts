/**
 * App updates, owned by the main process.
 *
 * How an install can be updated depends on how it was installed, so the
 * service has a mode (see `UPDATE_MODES` in shared/ipc-types.ts):
 *
 *   - `installer` (Windows .exe, Linux AppImage, Linux deb/rpm/pacman):
 *     electron-updater checks the GitHub release feed, downloads on request,
 *     and verifies the download against the sha512 in the release's
 *     latest*.yml — and the publisher signature too on Windows once builds are
 *     signed — before anything is applied (OWASP A08). Windows and AppImage
 *     then restart into it through electron-updater. A Linux package is
 *     installed over the current version by its package manager as root,
 *     through pkexec — the desktop's own password prompt — with argument
 *     arrays, never a shell (A05; see updates/linux-install.ts), then the app
 *     relaunches. Nothing is uninstalled first, so settings and sign-ins stay;
 *   - `store` (Microsoft Store): the Store owns the package and its files are
 *     read-only, so the app cannot replace itself — and a Store build steering
 *     users to an off-Store installer would put a second, separately-stored
 *     copy on their machine behind a SmartScreen warning. So it only *says* a
 *     newer version is out and will arrive through the Store after review;
 *   - `notify` (macOS, an unpacked Linux tarball): told, not updated, here;
 *   - `unavailable`: development and unpackaged runs never check.
 *
 * `store` and `notify` read GitHub's "latest release" directly: a fixed URL
 * on a fixed host, never one taken from a response or the renderer (A01).
 * The latest-release endpoint skips drafts and pre-releases, and the release
 * workflow keeps a release a draft until every platform's build is attached,
 * so a half-published release is never announced.
 *
 * Downloads stay opt-in: an update is never fetched or applied without the
 * user asking. "Check automatically" only looks — at launch, then every few
 * hours — and is stored here rather than in the renderer because the launch
 * check runs before any page exists.
 *
 * Shape: one plain class with a mode and a status, like the inbox watcher.
 * The modes share the state, the schedule and the Settings UI, and differ only
 * in how a check is made and whether Download/Install exist — one branch, not
 * a Strategy hierarchy.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, shell } from 'electron';
import { z } from 'zod';

import { createLogger } from '../shared/logger';
import {
  updateStateSchema,
  type UpdateEvent,
  type UpdateMode,
  type UpdateState,
} from '../shared/ipc-types';
import { IPC_CHANNELS } from './ipc/channels';
import { isDevRuntime } from './security/origins';
import {
  ElevationCancelled,
  findCommand,
  installPackage,
  linuxInstallation,
} from './updates/linux-install';
import { loadUpdaterModule } from './updater-module';

const log = createLogger('updater');

/** Where releases live — the same repository electron-builder.yml publishes to. */
const RELEASE_OWNER = 'Yello-Social-App';
const RELEASE_REPO = 'yellow-desktop-app';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;

/** The first automatic check waits for the app to settle. */
const FIRST_CHECK_DELAY_MS = 15_000;
/** Then it looks again this often while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASE_FETCH_TIMEOUT_MS = 15_000;

const PREFERENCES_FILE = 'update-preferences.json';
const preferencesSchema = z.object({ autoCheck: z.boolean() });

/** Only the fields used; anything else in GitHub's answer is ignored. */
const latestReleaseSchema = z.object({
  tag_name: z.string().max(64),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

const VERSION_PATTERN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

/** `[major, minor, patch]`, or null for anything that is not a plain release. */
function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (next === null || now === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

function detectMode(): UpdateMode {
  if (isDevRuntime() || !app.isPackaged) {
    return 'unavailable';
  }
  if (process.windowsStore) {
    return 'store';
  }
  if (process.platform === 'win32') {
    return 'installer';
  }
  // A Linux copy installed from a package or run as an AppImage can replace
  // itself; an unpacked tarball cannot, and is told instead.
  return linuxInstallation() === null ? 'notify' : 'installer';
}

/** pkexec's exit code when the user dismisses or fails the password prompt. */
const PKEXEC_DISMISSED = 126;

/** What the Settings row says when the in-app install cannot elevate. */
const TERMINAL_FALLBACK =
  'Yello could not get permission to install. Run "yello-desktop-app update" in a terminal instead.';

/**
 * Runs one package-manager command as root through pkexec, asynchronously, so
 * the window stays responsive while the password prompt is up. The program is
 * resolved to an absolute path first (pkexec resets PATH), and the arguments
 * go as an array — no shell ever sees them (A05).
 */
function runWithPkexec(command: string[]): Promise<void> {
  const pkexec = findCommand('pkexec');
  const [name, ...args] = command;
  const program = name === undefined ? null : findCommand(name);
  if (pkexec === null || program === null) {
    return Promise.reject(
      new Error(pkexec === null ? 'pkexec not found' : `${String(name)} not found`),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(pkexec, [program, ...args], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else if (code === PKEXEC_DISMISSED) {
        reject(new ElevationCancelled());
      } else {
        // 127 also covers "no authentication agent" — a desktop without one.
        reject(new Error(`${String(name)} exited with status ${String(code)}`));
      }
    });
  });
}

/** The subset of electron-updater this service drives. */
interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

class UpdateService {
  private state: UpdateState = updateStateSchema.parse({
    mode: 'unavailable',
    status: 'idle',
    currentVersion: '0.0.0',
    latestVersion: null,
    progress: null,
    error: null,
    asksForPassword: false,
    autoCheck: true,
    checkedAt: null,
  });
  private updater: Updater | null = null;
  /** The verified download, once electron-updater has it. */
  private downloadedFile: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  snapshot(): UpdateState {
    return this.state;
  }

  /** Once per app, after the window is up. Safe to call again. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    const mode = detectMode();
    const autoCheck = await this.readAutoCheck();
    const installation = linuxInstallation();
    this.set({
      mode,
      currentVersion: app.getVersion(),
      autoCheck,
      asksForPassword: mode === 'installer' && installation !== null && installation !== 'appimage',
    });
    log.info('updater_started', { mode, autoCheck });

    if (mode === 'unavailable') {
      return;
    }
    if (mode === 'installer') {
      await this.attachUpdater();
    }
    this.schedule(FIRST_CHECK_DELAY_MS);
  }

  /** A check, whether the user asked or the schedule did. Never downloads. */
  async check(): Promise<UpdateState> {
    const { mode, status } = this.state;
    if (
      mode === 'unavailable' ||
      status === 'checking' ||
      status === 'downloading' ||
      status === 'installing'
    ) {
      return this.state;
    }
    // A downloaded update is already the newest thing there is to find.
    if (status === 'ready') {
      return this.state;
    }
    this.set({ status: 'checking', error: null });

    if (mode === 'installer') {
      if (this.updater === null) {
        this.fail('Updates are not available in this build.');
        return this.state;
      }
      try {
        // The outcome arrives through the updater's own events.
        await this.updater.checkForUpdates();
      } catch (error) {
        log.warn('update_check_failed', { error });
        this.fail('Could not check for updates. Try again later.');
      }
      return this.state;
    }

    await this.checkLatestRelease();
    return this.state;
  }

  /**
   * "Update now": download, verify, install and restart, in one go — the one
   * click the user asked for. Stops at `ready` only if the install cannot go
   * on by itself (a dismissed password prompt), where Install picks it up.
   */
  async updateNow(): Promise<UpdateState> {
    if (this.state.mode !== 'installer' || this.updater === null) {
      return this.state;
    }
    if (this.state.status === 'ready') {
      return this.install();
    }
    if (this.state.status !== 'available') {
      return this.state;
    }
    this.set({ status: 'downloading', progress: 0, error: null });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      log.warn('update_download_failed', { error });
      this.fail('The update could not be downloaded. Try again later.');
      return this.state;
    }
    // 'update-downloaded' has moved the state to ready by the time the
    // download resolves; anything else means it failed on the way.
    return this.statusNow() === 'ready' ? this.install() : this.state;
  }

  /** Read through a call so a change made by an event across an `await` is not narrowed away. */
  private statusNow(): UpdateState['status'] {
    return this.state.status;
  }

  /**
   * Installs the downloaded update and restarts into it. Resolves only if the
   * app is still running afterwards: a dismissed password prompt (back to
   * `ready`) or a failure (`error`).
   */
  async install(): Promise<UpdateState> {
    if (this.state.mode !== 'installer' || this.updater === null) {
      return this.state;
    }
    if (this.state.status !== 'ready') {
      return this.state;
    }
    log.info('update_installing', { version: this.state.latestVersion });

    const installation = linuxInstallation();
    if (installation === null || installation === 'appimage') {
      // Windows: the installer's own progress shows (not silent), then the
      // app runs again. AppImage: the file is swapped in place, then relaunched.
      this.updater.quitAndInstall(installation === 'appimage', true);
      return this.state;
    }

    const installer = this.downloadedFile;
    if (installer === null) {
      this.fail('The downloaded update is missing. Check for updates again.');
      return this.state;
    }
    this.set({ status: 'installing', error: null });
    try {
      await installPackage(installation, installer, runWithPkexec);
    } catch (error) {
      if (error instanceof ElevationCancelled) {
        log.info('update_install_dismissed', {});
        this.set({ status: 'ready' });
        return this.state;
      }
      log.warn('update_install_failed', { error });
      this.fail(TERMINAL_FALLBACK);
      return this.state;
    }

    // The package manager has replaced the files under the running app; start
    // the new version. quit(), not exit(), so the socket and watcher close
    // cleanly on the way out.
    log.info('update_installed', { version: this.state.latestVersion });
    app.relaunch();
    app.quit();
    return this.state;
  }

  async setAutoCheck(enabled: boolean): Promise<UpdateState> {
    this.set({ autoCheck: enabled });
    await this.writeAutoCheck(enabled);
    if (enabled) {
      this.schedule(FIRST_CHECK_DELAY_MS);
    } else {
      this.clearTimer();
    }
    return this.state;
  }

  /**
   * Opens the release notes for the newer version. The URL is built from a
   * version that already matched a strict x.y.z pattern and a fixed
   * repository — nothing from a response is opened as-is (A01).
   */
  async openReleaseNotes(): Promise<boolean> {
    const version = this.state.latestVersion;
    if (version === null || parseVersion(version) === null) {
      return false;
    }
    const url = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/v${version}`;
    await shell.openExternal(url);
    return true;
  }

  private async attachUpdater(): Promise<void> {
    try {
      const { autoUpdater } = await loadUpdaterModule();
      const updater = autoUpdater as unknown as Updater;
      updater.autoDownload = false;
      // Windows applies a downloaded update on the next quit even if the user
      // never presses Restart; it was already verified when it landed. Never
      // on Linux: electron-updater's Linux install elevates through a
      // `bash -c` string, and a password prompt at quit is not something the
      // user asked for — the Install button is the only way in.
      updater.autoInstallOnAppQuit = process.platform === 'win32';
      updater.logger = null;

      updater.on('update-available', (info: { version: string }) => {
        log.info('update_available', { version: info.version });
        this.set({ status: 'available', latestVersion: info.version, checkedAt: Date.now() });
      });
      updater.on('update-not-available', () => {
        this.set({ status: 'up-to-date', checkedAt: Date.now() });
      });
      updater.on('download-progress', (progress: { percent: number }) => {
        this.set({ progress: Math.max(0, Math.min(100, Math.round(progress.percent))) });
      });
      updater.on('update-downloaded', (info: { version: string; downloadedFile?: string }) => {
        log.info('update_downloaded', { version: info.version });
        this.downloadedFile = info.downloadedFile ?? null;
        this.set({ status: 'ready', latestVersion: info.version, progress: 100 });
      });
      updater.on('error', (error: Error) => {
        log.warn('updater_error', { error });
        this.fail(
          this.state.status === 'downloading'
            ? 'The update could not be downloaded. Try again later.'
            : 'Could not check for updates. Try again later.',
        );
      });
      this.updater = updater;
    } catch (error) {
      // No feed configured in this build: checking falls back to reporting it.
      log.info('updater_unavailable', { error });
    }
  }

  /** `store` and `notify`: compare against GitHub's latest published release. */
  private async checkLatestRelease(): Promise<void> {
    let body: unknown;
    try {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(RELEASE_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        log.warn('latest_release_refused', { status: response.status });
        this.fail('Could not check for updates. Try again later.');
        return;
      }
      body = await response.json();
    } catch (error) {
      log.warn('latest_release_unreachable', { error });
      this.fail('Could not check for updates. Try again later.');
      return;
    }

    const release = latestReleaseSchema.safeParse(body);
    if (!release.success || release.data.draft === true || release.data.prerelease === true) {
      this.fail('Could not read the latest release.');
      return;
    }
    const parsed = parseVersion(release.data.tag_name);
    if (parsed === null) {
      this.fail('Could not read the latest release.');
      return;
    }
    const latest = parsed.join('.');
    if (isNewer(latest, this.state.currentVersion)) {
      log.info('update_available', { version: latest, mode: this.state.mode });
      this.set({ status: 'available', latestVersion: latest, checkedAt: Date.now() });
    } else {
      this.set({ status: 'up-to-date', latestVersion: null, checkedAt: Date.now() });
    }
  }

  private schedule(delay: number): void {
    this.clearTimer();
    if (!this.state.autoCheck || this.state.mode === 'unavailable') {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check().finally(() => {
        this.schedule(CHECK_INTERVAL_MS);
      });
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private fail(message: string): void {
    this.set({ status: 'error', error: message, progress: null, checkedAt: Date.now() });
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = updateStateSchema.parse({ ...this.state, ...patch });
    const event: UpdateEvent = { event: 'state', data: this.state };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.UPDATES_EVENT, event);
      }
    }
  }

  private preferencesPath(): string {
    return path.join(app.getPath('userData'), PREFERENCES_FILE);
  }

  /** On by default; a missing or unreadable file keeps the default (A10). */
  private async readAutoCheck(): Promise<boolean> {
    try {
      const parsed = preferencesSchema.safeParse(
        JSON.parse(await readFile(this.preferencesPath(), 'utf8')),
      );
      return parsed.success ? parsed.data.autoCheck : true;
    } catch {
      return true;
    }
  }

  private async writeAutoCheck(autoCheck: boolean): Promise<void> {
    try {
      await writeFile(this.preferencesPath(), JSON.stringify({ autoCheck }), 'utf8');
    } catch (error) {
      // The session still honours the choice; it just will not survive a restart.
      log.warn('update_preferences_write_failed', { error });
    }
  }
}

/** One per app: a container-scoped single instance, not a static global. */
export const updateService = new UpdateService();
