/**
 * Screen sharing in a call: which screen or window a `getDisplayMedia` gets.
 *
 * Chromium in Electron has no picker of its own, so the choice is made in
 * three steps: the renderer asks for the sources (`list`), the user picks one
 * in the app's own dialog (`choose`), and then the renderer's LiveKit asks for
 * the stream, which the display-media handler answers with that pick.
 *
 * The handler hands out a source only when the user just picked it — a choice
 * is spent on first use and lapses after `CHOICE_TTL_MS` — and only to our
 * own page's main frame; the renderer can name only an id this process
 * offered (OWASP A01).
 *
 * The computer's sound goes with the screen only when the user turned it on
 * for this pick, and only where Electron can capture it: system loopback is
 * Windows-only in Electron 44 (`audio: 'loopback'`). Elsewhere the page is
 * told `canShareAudio: false` and never asks.
 *
 * Shape: module state behind a few functions. One choice at a time and no
 * variants, so nothing more.
 */
import { desktopCapturer, session, type DesktopCapturerSource } from 'electron';

import { createLogger } from '../../shared/logger';
import type { ScreenSource } from '../../shared/ipc-types';
import { originOf, trustedRendererOrigin } from '../security/origins';

const log = createLogger('calls.screen');

const CHOICE_TTL_MS = 30_000;
const THUMBNAIL_SIZE = { width: 320, height: 180 };
const THUMBNAIL_JPEG_QUALITY = 70;
const MAX_SOURCES = 100;
const NAME_MAX = 300;

/** The ids the last listing offered; a choice must be one of them. */
let offered: ReadonlySet<string> = new Set();
let choice: { sourceId: string; withAudio: boolean; expiresAt: number } | null = null;

/** Whether this platform can capture the computer's sound along with a screen. */
export function canShareScreenAudio(): boolean {
  return process.platform === 'win32';
}

function kindOf(source: DesktopCapturerSource): ScreenSource['kind'] {
  return source.id.startsWith('screen:') ? 'screen' : 'window';
}

function thumbnailOf(source: DesktopCapturerSource): string {
  if (source.thumbnail.isEmpty()) {
    return '';
  }
  const jpeg = source.thumbnail.toJPEG(THUMBNAIL_JPEG_QUALITY);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Every screen and window the user may share, with a small preview of each. */
export async function listScreenSources(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: THUMBNAIL_SIZE,
    fetchWindowIcons: false,
  });
  const listed = sources.slice(0, MAX_SOURCES);
  offered = new Set(listed.map((source) => source.id));
  choice = null;
  return listed.map((source) => ({
    id: source.id,
    name: source.name.slice(0, NAME_MAX),
    kind: kindOf(source),
    thumbnailDataUrl: thumbnailOf(source),
  }));
}

/** Records the user's pick for the next request. False for an id never offered. */
export function chooseScreenSource(sourceId: string, withAudio: boolean): boolean {
  if (!offered.has(sourceId)) {
    return false;
  }
  choice = {
    sourceId,
    withAudio: withAudio && canShareScreenAudio(),
    expiresAt: Date.now() + CHOICE_TTL_MS,
  };
  return true;
}

function takeChoice(): { sourceId: string; withAudio: boolean } | null {
  const taken = choice;
  choice = null;
  if (taken === null || taken.expiresAt < Date.now()) {
    return null;
  }
  return { sourceId: taken.sourceId, withAudio: taken.withAudio };
}

export function applyScreenCapturePolicy(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const picked = takeChoice();
    const fromOurPage =
      request.frame !== null &&
      request.frame.parent === null &&
      originOf(request.frame.url) === trustedRendererOrigin();
    if (!fromOurPage || picked === null || !request.videoRequested) {
      log.warn('screen_capture_refused', { fromOurPage, chosen: picked !== null });
      // No stream named: the page's getDisplayMedia rejects.
      callback({});
      return;
    }

    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then(
      (sources) => {
        const source = sources.find((candidate) => candidate.id === picked.sourceId);
        if (source === undefined) {
          // Closed between the pick and now.
          log.info('screen_capture_source_gone', {});
          callback({});
          return;
        }
        const withAudio = picked.withAudio && request.audioRequested;
        log.info('screen_capture_granted', { kind: kindOf(source), withAudio });
        callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
      },
      (error: unknown) => {
        log.error('screen_capture_list_failed', { error });
        callback({});
      },
    );
  });
}
