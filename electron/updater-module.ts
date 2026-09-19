/**
 * Loads electron-updater on first use, so launches that never check for an
 * update never pay for it.
 *
 * Through the module's default export, not its named ones: this bundle is
 * CommonJS and electron-updater stays external, so `import()` goes through
 * Node's ESM loader, which only sees the named exports it can detect
 * statically. `autoUpdater` is a lazy getter it cannot detect, so the named
 * import is undefined; the default export is `module.exports` itself, getter
 * included.
 */
import type * as ElectronUpdater from 'electron-updater';

type UpdaterModule = typeof ElectronUpdater;

export async function loadUpdaterModule(): Promise<UpdaterModule> {
  const loaded = (await import('electron-updater')) as UpdaterModule & { default?: UpdaterModule };
  return loaded.default ?? loaded;
}
