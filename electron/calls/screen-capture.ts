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
 * offered (OWASP A01). Screen audio is never captured: the call's LiveKit
 * token does not grant it, and asking would only fail later.
 *
 * Shape: module state behind three functions. One choice at a time and no
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
let choice: { sourceId: string; expiresAt: number } | null = null;

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
export function chooseScreenSource(sourceId: string): boolean {
  if (!offered.has(sourceId)) {
    return false;
  }
  choice = { sourceId, expiresAt: Date.now() + CHOICE_TTL_MS };
  return true;
}

function takeChoice(): string | null {
  const taken = choice;
  choice = null;
  if (taken === null || taken.expiresAt < Date.now()) {
    return null;
  }
  return taken.sourceId;
}

export function applyScreenCapturePolicy(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const sourceId = takeChoice();
    const fromOurPage =
      request.frame !== null &&
      request.frame.parent === null &&
      originOf(request.frame.url) === trustedRendererOrigin();
    if (!fromOurPage || sourceId === null || !request.videoRequested) {
      log.warn('screen_capture_refused', { fromOurPage, chosen: sourceId !== null });
      // No stream named: the page's getDisplayMedia rejects.
      callback({});
      return;
    }

    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then(
      (sources) => {
        const source = sources.find((candidate) => candidate.id === sourceId);
        if (source === undefined) {
          // Closed between the pick and now.
          log.info('screen_capture_source_gone', {});
          callback({});
          return;
        }
        log.info('screen_capture_granted', { kind: kindOf(source) });
        callback({ video: source });
      },
      (error: unknown) => {
        log.error('screen_capture_list_failed', { error });
        callback({});
      },
    );
  });
}
