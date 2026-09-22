/**
 * Installing a downloaded Linux update, in place.
 *
 * Shared by the terminal command (`yello-desktop-app update`, which elevates
 * with sudo on the terminal it was typed in) and the Settings button (which
 * elevates with pkexec, the desktop's graphical password prompt). What differs
 * between them is only *how a command runs as root*, so that is a function the
 * caller passes in; which commands run is decided here, once.
 *
 * The package manager replaces the installed version with the new one, so
 * nothing is uninstalled first and settings and saved sign-ins stay put. The
 * download itself is electron-updater's and is checked against the sha512 in
 * the release's latest-linux.yml before it gets here (OWASP A08). Commands are
 * argument arrays, never shell strings (A05) — electron-updater's own Linux
 * install wraps them in `bash -c '<joined string>'`, which this avoids.
 */
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';

export type LinuxInstallation = 'deb' | 'rpm' | 'pacman' | 'appimage';

/**
 * How this copy was installed. electron-builder writes `resources/package-type`
 * into the deb, rpm and pacman packages; an AppImage is known by the APPIMAGE
 * variable its runtime sets. Anything else (an unpacked tarball) is null.
 */
export function linuxInstallation(): LinuxInstallation | null {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const type = readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim();
    if (type === 'deb' || type === 'rpm' || type === 'pacman') {
      return type;
    }
  } catch {
    // No marker: not installed from a package.
  }
  return process.env.APPIMAGE === undefined ? null : 'appimage';
}

/** The absolute path of an executable on PATH, or null; no shell is involved. */
export function findCommand(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') {
      continue;
    }
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/**
 * The root commands that install `installer` over the current version, in
 * order: `primary`, and `recovery` to run only if primary fails. Mirrors
 * electron-updater's own choices per package manager, except for pacman —
 * its runner retries after `pacman -Sy`, a database sync without an upgrade,
 * which Arch warns leaves a partially upgraded system.
 */
export function installCommands(
  installation: Exclude<LinuxInstallation, 'appimage'>,
  installer: string,
): { primary: string[]; recovery?: string[] } {
  switch (installation) {
    case 'deb':
      if (findCommand('dpkg') !== null) {
        // dpkg first; if it stops on missing dependencies, apt resolves them.
        return {
          primary: ['dpkg', '-i', installer],
          recovery: ['apt-get', 'install', '-f', '-y'],
        };
      }
      return {
        primary: [
          'apt',
          'install',
          '-y',
          '--allow-unauthenticated',
          '--allow-downgrades',
          '--allow-change-held-packages',
          installer,
        ],
      };
    case 'rpm':
      if (findCommand('zypper') !== null) {
        return {
          primary: [
            'zypper',
            '--non-interactive',
            '--no-refresh',
            'install',
            '--allow-unsigned-rpm',
            '-f',
            installer,
          ],
        };
      }
      if (findCommand('dnf') !== null) {
        return { primary: ['dnf', 'install', '--nogpgcheck', '-y', installer] };
      }
      if (findCommand('yum') !== null) {
        return { primary: ['yum', 'install', '--nogpgcheck', '-y', installer] };
      }
      return {
        primary: ['rpm', '-Uvh', '--replacepkgs', '--replacefiles', '--nodeps', installer],
      };
    case 'pacman':
      return { primary: ['pacman', '-U', '--noconfirm', installer] };
  }
}

/**
 * The user declined the password prompt. Not a failure to report — and never
 * a reason to try the recovery command, which would only prompt again.
 */
export class ElevationCancelled extends Error {
  constructor() {
    super('The password prompt was dismissed.');
    this.name = 'ElevationCancelled';
  }
}

/** Runs one command as root; rejects on failure. Sync or async, the caller's choice. */
export type RootRunner = (command: string[]) => void | Promise<void>;

/** Installs a downloaded package with the caller's way of becoming root. */
export async function installPackage(
  installation: Exclude<LinuxInstallation, 'appimage'>,
  installer: string,
  runAsRoot: RootRunner,
): Promise<void> {
  const { primary, recovery } = installCommands(installation, installer);
  try {
    await runAsRoot(primary);
  } catch (error) {
    if (recovery === undefined || error instanceof ElevationCancelled) {
      throw error;
    }
    await runAsRoot(recovery);
  }
}
