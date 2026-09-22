/**
 * `yello-desktop-app update`: upgrades an installed Linux build from the
 * terminal, in place. The distro's package manager replaces the old version
 * with the new one, so nothing is uninstalled first and settings and saved
 * sign-ins stay where they are.
 *
 * The download is electron-updater's, and so is its integrity check: the file
 * must match the sha512 that the release's latest-linux.yml lists for it,
 * fetched over HTTPS from the same GitHub release (OWASP A08). The install is
 * not: electron-updater elevates with pkexec and no internal agent, which only
 * works where a graphical polkit agent is running. Here the distro's command
 * runs under sudo with the terminal attached, so the password is asked for
 * where the user typed the command. Every command goes to spawnSync as an
 * argument array, never through a shell (A05).
 *
 * Which command runs is chosen by how the app was installed, and which
 * package-manager commands install it, by updates/linux-install.ts — shared
 * with the Settings button, which elevates with pkexec instead of sudo. A
 * build that is neither (an unpacked tarball, a dev run) is told how to
 * update instead.
 */
import { spawnSync } from 'node:child_process';

import { app } from 'electron';

import { installPackage, linuxInstallation } from '../updates/linux-install';
import { loadUpdaterModule } from '../updater-module';

const RELEASES_URL = 'https://github.com/Yello-Social-App/yellow-desktop-app/releases/latest';

/** True when this launch is `yello-desktop-app update` on an installed Linux build. */
export function isUpdateCommand(): boolean {
  // A packaged app's arguments start after the executable; a dev run's start
  // after `electron .`, and a dev run has nothing to update anyway.
  return process.platform === 'linux' && app.isPackaged && process.argv[1] === 'update';
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function printError(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Runs a package-manager command as root: directly when already root,
 * otherwise under sudo, which prompts on this terminal. Throws on a non-zero
 * exit, so the caller reports a failed install instead of a finished one.
 */
function runAsRoot(command: string[]): void {
  const argv = process.getuid?.() === 0 ? command : ['sudo', ...command];
  const [file, ...args] = argv;
  if (file === undefined) {
    throw new Error('empty command');
  }
  print(`→ ${argv.join(' ')}`);
  const result = spawnSync(file, args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command[0] ?? file} exited with status ${String(result.status)}`);
  }
}

/** electron-updater narrates in detail; the terminal only needs its problems. */
const quietLogger = {
  info: () => undefined,
  warn: (message?: unknown) => {
    printError(`warning: ${String(message)}`);
  },
  error: (message?: unknown) => {
    printError(`error: ${String(message)}`);
  },
};

/** Checks, downloads and installs; resolves to the process exit code. */
export async function runUpdateCommand(): Promise<number> {
  const installation = linuxInstallation();
  if (installation === null) {
    printError('This copy of Yello was not installed from a package, so it cannot update itself.');
    printError(`Download the latest release from ${RELEASES_URL}`);
    return 1;
  }

  const { autoUpdater } = await loadUpdaterModule();
  autoUpdater.logger = quietLogger;
  autoUpdater.autoDownload = false;
  // The install below is explicit; nothing should run again on the way out.
  autoUpdater.autoInstallOnAppQuit = false;
  // Also what an AppImage install reports failure through; an 'error' with no
  // listener would throw from inside the updater instead.
  const outcome: { failure: Error | null } = { failure: null };
  autoUpdater.on('error', (error: Error) => {
    outcome.failure = error;
  });

  print(`Yello ${app.getVersion()} — checking for updates…`);
  const check = await autoUpdater.checkForUpdates();
  if (!check?.isUpdateAvailable) {
    print('Yello is up to date.');
    return 0;
  }

  const next = check.updateInfo.version;
  let shownPercent = -1;
  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    const percent = Math.floor(progress.percent);
    if (percent !== shownPercent && process.stdout.isTTY) {
      shownPercent = percent;
      process.stdout.write(`\rDownloading Yello ${next}… ${String(percent)}%`);
    }
  });

  print(`Downloading Yello ${next}…`);
  const [installer] = await autoUpdater.downloadUpdate();
  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }
  if (installer === undefined) {
    printError('The download finished without a file to install.');
    return 1;
  }

  if (installation === 'appimage') {
    // Replaces the AppImage file in place; the user owns it, so no sudo.
    autoUpdater.quitAndInstall(true, false);
  } else {
    await installPackage(installation, installer, runAsRoot);
  }

  if (outcome.failure !== null) {
    printError(`The update could not be installed: ${String(outcome.failure)}`);
    return 1;
  }

  print(`Updated to Yello ${next}. Restart Yello if it is open to use the new version.`);
  return 0;
}
