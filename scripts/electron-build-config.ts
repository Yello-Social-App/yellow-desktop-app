/**
 * esbuild settings for the main-process bundles.
 *
 * Both entry points build in a single context: two contexts would each fire
 * their own `onEnd`, and the dev runner would spawn Electron twice on every
 * rebuild.
 *
 * Output is CommonJS because a sandboxed preload is only given a limited
 * `require`, so it has to be a single self-contained CJS file with `electron`
 * left external.
 */
import type { BuildOptions } from 'esbuild';

export const ELECTRON_OUT_DIR = 'dist-electron';

/** Electron 44 ships Node 22. */
const NODE_TARGET = 'node22';

function bakedApiTarget(isDev: boolean): Record<string, string> {
  const target = process.env.YELLO_API_TARGET;
  if (isDev || target === undefined || target === '') {
    return {};
  }
  return { 'process.env.YELLO_API_TARGET': JSON.stringify(target) };
}

export function electronBuildOptions(isDev: boolean): BuildOptions {
  return {
    entryPoints: ['electron/main.ts', 'electron/preload.ts'],
    outdir: ELECTRON_OUT_DIR,
    bundle: true,
    platform: 'node',
    target: NODE_TARGET,
    format: 'cjs',
    // electron is supplied by the runtime; electron-updater is loaded lazily and
    // only exists in a packaged build with a publish provider configured.
    external: ['electron', 'electron-updater'],
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev,
    // A packaged app has no shell environment to read, so a target chosen at
    // build time (`npm run package:prod`) is baked into the bundle. Dev builds
    // leave it alone so the runner's environment stays the source of truth.
    define: bakedApiTarget(isDev),
    logLevel: 'warning',
  };
}
