/**
 * The sticker picker's state: the viewer's library, what they sent lately,
 * and the packs everyone has.
 *
 * One store because three readers share it — the picker draws it, the thread
 * asks it whether a sticker is already yours, and an expired picture on a
 * message is re-signed from it — and because the `sticker.*` frames land here
 * whichever screen is open.
 *
 * Loaded on first open of the picker, not at sign-in: most sessions never open
 * it. Every picture in it is presigned for about an hour, so a load older than
 * `STALE_AFTER_MS` is done again on the next open rather than trusted.
 *
 * The service sends `sticker.*` to every one of the owner's sockets, this
 * device's included, so each change is applied by id — the call's own answer
 * and the echo of it land as the same thing.
 */
import type { ChatEvent, Sticker, StickerImage, StickerPack } from '@shared/ipc-types';
import { create } from 'zustand';

import { createLogger } from '@/lib/logger';
import { fail, ok, type Result } from '@/lib/result';

import {
  deleteSticker,
  fetchMyStickers,
  fetchRecentStickers,
  fetchStickerPacks,
  keepMessageSticker,
  renameSticker,
} from './api';
import { isImageExpired, stickerErrorMessage, uniqueById, withFirst } from './types';

const log = createLogger('stickers.store');

export type StickersStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Signed links last about an hour; reload well before that. */
const STALE_AFTER_MS = 45 * 60 * 1000;
/** A full library is 200 at 100 a page; one more guards a miscount. */
const MY_STICKERS_MAX_PAGES = 3;
/** What the Recent tab shows; the service keeps up to 50. */
const RECENT_SHOWN = 24;

/** How keeping someone else's sticker ended. */
export type KeepOutcome = 'added' | 'already';

interface StickersState {
  status: StickersStatus;
  error: string | null;
  mine: Sticker[];
  recent: Sticker[];
  packs: StickerPack[];
  loadedAt: number | null;

  /** Loads everything the picker shows, unless a fresh copy is already held. */
  ensureLoaded: () => Promise<void>;
  /** A sticker just saved into the library: first in My stickers. */
  adopt: (sticker: Sticker) => void;
  /** A sticker just sent: first in Recent, as the service will also have it. */
  noteSent: (sticker: Sticker) => void;
  rename: (stickerId: string, name: string) => Promise<Result<Sticker, string>>;
  remove: (stickerId: string) => Promise<Result<true, string>>;
  keepFromMessage: (
    conversationId: string,
    messageId: string,
  ) => Promise<Result<KeepOutcome, string>>;
  /** A fresh picture for a sticker this store holds, or null. */
  freshImage: (stickerId: string) => StickerImage | null;
  isInLibrary: (stickerId: string) => boolean;
  handleEvent: (event: ChatEvent) => void;
  reset: () => void;
}

const INITIAL = {
  status: 'idle' as StickersStatus,
  error: null,
  mine: [],
  recent: [],
  packs: [],
  loadedAt: null,
};

/** Every page of the library, newest first. */
async function fetchWholeLibrary(): Promise<Result<Sticker[], string>> {
  const all: Sticker[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MY_STICKERS_MAX_PAGES; page += 1) {
    const result = await fetchMyStickers(cursor);
    if (!result.ok) {
      return fail(stickerErrorMessage(result.error));
    }
    all.push(...result.data.items);
    if (result.data.nextCursor === null) {
      break;
    }
    cursor = result.data.nextCursor;
  }
  return ok(uniqueById(all));
}

/** One sticker replaced wherever it appears, by id. */
function replaced(list: readonly Sticker[], sticker: Sticker): Sticker[] {
  return list.map((item) => (item.id === sticker.id ? sticker : item));
}

let loadInFlight: Promise<void> | null = null;

export const useStickersStore = create<StickersState>((set, get) => {
  /** Leaves the library: gone from My stickers and Recent, as the service drops it. */
  function forget(stickerId: string): void {
    set((state) => ({
      mine: state.mine.filter((item) => item.id !== stickerId),
      recent: state.recent.filter((item) => item.id !== stickerId),
    }));
  }

  async function load(): Promise<void> {
    set({ status: 'loading', error: null });
    const [mine, recent, packs] = await Promise.all([
      fetchWholeLibrary(),
      fetchRecentStickers(),
      fetchStickerPacks(),
    ]);
    // Recent and packs are extras; the library is what the picker is for.
    if (!mine.ok) {
      set({ status: 'error', error: mine.error });
      return;
    }
    if (!recent.ok || !packs.ok) {
      log.warn('stickers_partial_load', { recent: recent.ok, packs: packs.ok });
    }
    set((state) => ({
      status: 'ready',
      error: null,
      mine: mine.data,
      recent: recent.ok ? recent.data.slice(0, RECENT_SHOWN) : state.recent,
      packs: packs.ok ? packs.data : state.packs,
      loadedAt: Date.now(),
    }));
  }

  return {
    ...INITIAL,

    ensureLoaded: async () => {
      const { status, loadedAt } = get();
      const isFresh =
        status === 'ready' && loadedAt !== null && Date.now() - loadedAt < STALE_AFTER_MS;
      if (isFresh) {
        return;
      }
      // Two opens in a row share one load.
      loadInFlight ??= load().finally(() => {
        loadInFlight = null;
      });
      await loadInFlight;
    },

    adopt: (sticker) => {
      set((state) => ({ mine: withFirst(state.mine, { ...sticker, isMine: true }) }));
    },

    noteSent: (sticker) => {
      set((state) => ({ recent: withFirst(state.recent, sticker).slice(0, RECENT_SHOWN) }));
    },

    rename: async (stickerId, name) => {
      const result = await renameSticker(stickerId, name);
      if (!result.ok) {
        return fail(stickerErrorMessage(result.error));
      }
      set((state) => ({
        mine: replaced(state.mine, result.data),
        recent: replaced(state.recent, result.data),
      }));
      return ok(result.data);
    },

    remove: async (stickerId) => {
      const result = await deleteSticker(stickerId);
      if (!result.ok) {
        // Already gone is what was asked for.
        if (result.error.apiReason === 'STICKER_NOT_FOUND') {
          forget(stickerId);
          return ok(true);
        }
        return fail(stickerErrorMessage(result.error));
      }
      forget(stickerId);
      return ok(true);
    },

    keepFromMessage: async (conversationId, messageId) => {
      const result = await keepMessageSticker(conversationId, messageId);
      if (!result.ok) {
        return fail(stickerErrorMessage(result.error));
      }
      get().adopt(result.data.sticker);
      return ok(result.data.alreadyMine ? 'already' : 'added');
    },

    freshImage: (stickerId) => {
      const { mine, recent, packs } = get();
      const candidates = [...mine, ...recent, ...packs.flatMap((pack) => pack.stickers)];
      const found = candidates.find((item) => item.id === stickerId && !isImageExpired(item.image));
      return found?.image ?? null;
    },

    isInLibrary: (stickerId) => get().mine.some((item) => item.id === stickerId),

    handleEvent: (event) => {
      switch (event.event) {
        case 'sticker.added':
          get().adopt(event.data.sticker);
          return;
        case 'sticker.updated':
          set((state) => ({
            mine: replaced(state.mine, event.data.sticker),
            recent: replaced(state.recent, event.data.sticker),
          }));
          return;
        case 'sticker.removed':
          forget(event.data.stickerId);
          return;
        default:
          return;
      }
    },

    reset: () => {
      set(INITIAL);
    },
  };
});
