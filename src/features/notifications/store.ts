/**
 * The notification inbox: two keyset-paged lists and the badge count.
 *
 * Both lists are held rather than one filtered list, because the topbar panel
 * and the full page are on screen at different moments and switching the page's
 * tab must not throw away the panel's rows or spend a fetch re-reading them.
 * They are the friends store's `lists` record in a smaller key space.
 *
 * Two things the service does shape the bookkeeping here:
 *
 *   - marking a row read deliberately does *not* bump `updatedAt`, so
 *     acknowledging never reshuffles the list under the user. Aggregation does
 *     bump it, which means a row can jump to the top between two page fetches —
 *     hence the deduplication by id when a page is appended;
 *   - `nextCursor === null` is the last page, not an empty `items` array.
 *
 * Acknowledgements are applied optimistically and rolled back on failure. The
 * alternative — waiting on the round trip before the row stops looking unread —
 * makes a list that is mostly acknowledgements feel broken.
 */
import type { Notification } from '@shared/ipc-types';
import { create } from 'zustand';

import { createLogger } from '@/lib/logger';

import {
  dismissNotification,
  fetchNotificationPreferences,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationPreferences,
} from './api';
import { NOTIFICATIONS_PAGE_SIZE, type NotificationFilter } from './types';

const log = createLogger('notifications.store');

export type ListStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NotificationListSlice {
  items: Notification[];
  status: ListStatus;
  /** `null` means there is no further page — not that the last one was empty. */
  nextCursor: string | null;
  isLoadingMore: boolean;
}

const EMPTY_SLICE: NotificationListSlice = {
  items: [],
  status: 'idle',
  nextCursor: null,
  isLoadingMore: false,
};

const FILTERS: readonly NotificationFilter[] = ['all', 'unread'];

export interface PreferencesSlice {
  pushEnabled: boolean;
  mutedTypes: string[];
  status: ListStatus;
  isSaving: boolean;
}

const EMPTY_PREFERENCES: PreferencesSlice = {
  pushEnabled: true,
  mutedTypes: [],
  status: 'idle',
  isSaving: false,
};

interface NotificationsState {
  lists: Record<NotificationFilter, NotificationListSlice>;
  unreadCount: number;
  preferences: PreferencesSlice;
  /** Row ids with an acknowledgement in flight, so a double click is one call. */
  pendingIds: ReadonlySet<string>;
  error: string | null;

  loadCount: () => Promise<void>;
  load: (filter: NotificationFilter) => Promise<void>;
  loadMore: (filter: NotificationFilter) => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
  /** Rows the watcher saw arrive; merged newest-first without a refetch. */
  receive: (items: readonly Notification[]) => void;
  setUnreadCount: (count: number) => void;
  loadPreferences: () => Promise<void>;
  savePreferences: (update: { pushEnabled: boolean; mutedTypes: string[] }) => Promise<boolean>;
  reset: () => void;
  clearError: () => void;
}

function withPending(pending: ReadonlySet<string>, id: string, present: boolean): Set<string> {
  const next = new Set(pending);
  if (present) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

/** Appends a page, dropping rows an aggregation already moved into view. */
function appended(
  existing: readonly Notification[],
  page: readonly Notification[],
): Notification[] {
  const known = new Set(existing.map((row) => row.id));
  return [...existing, ...page.filter((row) => !known.has(row.id))];
}

/**
 * Finds a row in whichever list holds it.
 *
 * Which list that is depends on what the user has opened: the panel loads
 * `all`, the page's Unread tab loads `unread`, and either can be the only one
 * populated. Looking in just one would silently mis-read a row acknowledged
 * from the other — the unread count in particular would stop decrementing.
 */
function findRow(
  lists: Record<NotificationFilter, NotificationListSlice>,
  id: string,
): Notification | undefined {
  for (const filter of FILTERS) {
    const found = lists[filter].items.find((row) => row.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Applies a change to every list at once; a row lives in as many as match it. */
function mapLists(
  lists: Record<NotificationFilter, NotificationListSlice>,
  change: (items: Notification[]) => Notification[],
): Record<NotificationFilter, NotificationListSlice> {
  const next = { ...lists };
  for (const filter of FILTERS) {
    next[filter] = { ...lists[filter], items: change([...lists[filter].items]) };
  }
  return next;
}

/** Marks one row read wherever it appears. It keeps its place: `updatedAt` is untouched. */
function readLocally(lists: Record<NotificationFilter, NotificationListSlice>, id: string) {
  return mapLists(lists, (items) =>
    items.map((row) =>
      row.id === id ? { ...row, read: true, readAt: row.readAt ?? new Date().toISOString() } : row,
    ),
  );
}

function unreadLocally(
  lists: Record<NotificationFilter, NotificationListSlice>,
  id: string,
  readAt: string | undefined,
) {
  return mapLists(lists, (items) =>
    items.map((row) => (row.id === id ? { ...row, read: readAt !== undefined, readAt } : row)),
  );
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  lists: { all: EMPTY_SLICE, unread: EMPTY_SLICE },
  unreadCount: 0,
  preferences: EMPTY_PREFERENCES,
  pendingIds: new Set(),
  error: null,

  loadCount: async () => {
    const result = await fetchUnreadCount();
    if (result.ok) {
      set({ unreadCount: result.data });
    }
  },

  load: async (filter) => {
    set((state) => ({
      lists: { ...state.lists, [filter]: { ...state.lists[filter], status: 'loading' } },
    }));

    const result = await fetchNotifications({ unreadOnly: filter === 'unread' });

    if (!result.ok) {
      set((state) => ({
        lists: { ...state.lists, [filter]: { ...state.lists[filter], status: 'error' } },
        error: result.error.message,
      }));
      return;
    }

    set((state) => ({
      lists: {
        ...state.lists,
        [filter]: {
          items: result.data.items,
          status: 'ready',
          nextCursor: result.data.nextCursor,
          isLoadingMore: false,
        },
      },
      error: null,
    }));
  },

  loadMore: async (filter) => {
    const slice = get().lists[filter];
    if (slice.nextCursor === null || slice.isLoadingMore) {
      return;
    }

    set((state) => ({
      lists: { ...state.lists, [filter]: { ...state.lists[filter], isLoadingMore: true } },
    }));

    // `unread` and `size` are held constant across a cursor walk, as the
    // service requires; only the cursor moves.
    const result = await fetchNotifications({
      cursor: slice.nextCursor,
      size: NOTIFICATIONS_PAGE_SIZE,
      unreadOnly: filter === 'unread',
    });

    if (!result.ok) {
      set((state) => ({
        lists: { ...state.lists, [filter]: { ...state.lists[filter], isLoadingMore: false } },
        error: result.error.message,
      }));
      return;
    }

    set((state) => ({
      lists: {
        ...state.lists,
        [filter]: {
          ...state.lists[filter],
          items: appended(state.lists[filter].items, result.data.items),
          nextCursor: result.data.nextCursor,
          isLoadingMore: false,
        },
      },
    }));
  },

  markRead: async (notificationId) => {
    const state = get();
    if (state.pendingIds.has(notificationId)) {
      return;
    }

    const current = findRow(state.lists, notificationId);
    if (current?.read === true) {
      return;
    }
    const previousReadAt = current?.readAt;

    set((prev) => ({
      lists: readLocally(prev.lists, notificationId),
      unreadCount: Math.max(0, prev.unreadCount - 1),
      pendingIds: withPending(prev.pendingIds, notificationId, true),
    }));

    const result = await markNotificationRead(notificationId);

    if (!result.ok) {
      // Put the row back the way it was rather than leaving a read badge over
      // a row the server still considers unread (A10).
      set((prev) => ({
        lists: unreadLocally(prev.lists, notificationId, previousReadAt),
        unreadCount: prev.unreadCount + 1,
        pendingIds: withPending(prev.pendingIds, notificationId, false),
        error: result.error.message,
      }));
      return;
    }

    set((prev) => ({
      lists: mapLists(prev.lists, (items) =>
        items.map((row) => (row.id === notificationId ? result.data : row)),
      ),
      pendingIds: withPending(prev.pendingIds, notificationId, false),
    }));
  },

  markAllRead: async () => {
    const snapshot = get().lists;
    const previousCount = get().unreadCount;

    set((prev) => ({
      lists: mapLists(prev.lists, (items) =>
        items.map((row) =>
          row.read ? row : { ...row, read: true, readAt: new Date().toISOString() },
        ),
      ),
      unreadCount: 0,
    }));

    const result = await markAllNotificationsRead();

    if (!result.ok) {
      set({ lists: snapshot, unreadCount: previousCount, error: result.error.message });
      return;
    }

    // The badge is already 0 and the response confirms how many rows moved;
    // re-reading the count would only spend a request to learn 0 again.
    log.info('notifications_all_read', { updated: result.data });
  },

  dismiss: async (notificationId) => {
    const state = get();
    if (state.pendingIds.has(notificationId)) {
      return;
    }

    const snapshot = state.lists;
    const removed = findRow(state.lists, notificationId);
    const wasUnread = removed !== undefined && !removed.read;

    set((prev) => ({
      lists: mapLists(prev.lists, (items) => items.filter((row) => row.id !== notificationId)),
      unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
      pendingIds: withPending(prev.pendingIds, notificationId, true),
    }));

    const result = await dismissNotification(notificationId);

    set((prev) => ({
      pendingIds: withPending(prev.pendingIds, notificationId, false),
    }));

    if (!result.ok) {
      // A delete is not idempotent here — a repeat is a genuine 404 — so a
      // failure means the row really is still there. Put it back.
      set((prev) => ({
        lists: snapshot,
        unreadCount: wasUnread ? prev.unreadCount + 1 : prev.unreadCount,
        error: result.error.message,
      }));
      return;
    }

    log.info('notification_dismissed', {});
  },

  receive: (items) => {
    if (items.length === 0) {
      return;
    }
    set((prev) => {
      const arriving = [...items].reverse();
      const lists = { ...prev.lists };
      for (const filter of FILTERS) {
        const slice = prev.lists[filter];
        // An untouched list has nothing to merge into: leave it idle so its
        // first load reads a whole page rather than showing these rows alone.
        if (slice.status === 'idle') {
          continue;
        }
        let next = slice.items;
        for (const row of arriving) {
          if (filter === 'unread' && row.read) {
            continue;
          }
          next = [row, ...next.filter((existing) => existing.id !== row.id)];
        }
        lists[filter] = { ...slice, items: next };
      }
      return { lists };
    });
  },

  setUnreadCount: (count) => {
    set({ unreadCount: count });
  },

  loadPreferences: async () => {
    set((prev) => ({ preferences: { ...prev.preferences, status: 'loading' } }));

    const result = await fetchNotificationPreferences();
    if (!result.ok) {
      set((prev) => ({
        preferences: { ...prev.preferences, status: 'error' },
        error: result.error.message,
      }));
      return;
    }

    set((prev) => ({
      preferences: {
        ...prev.preferences,
        pushEnabled: result.data.pushEnabled,
        mutedTypes: result.data.mutedTypes,
        status: 'ready',
      },
    }));
  },

  savePreferences: async ({ pushEnabled, mutedTypes }) => {
    set((prev) => ({ preferences: { ...prev.preferences, isSaving: true }, error: null }));

    const result = await saveNotificationPreferences({ pushEnabled, mutedTypes });

    if (!result.ok) {
      set((prev) => ({
        preferences: { ...prev.preferences, isSaving: false },
        error: result.error.message,
      }));
      return false;
    }

    // The stored state is what the server sorted and deduplicated, not what we
    // sent, so the toggles redraw from the response.
    set((prev) => ({
      preferences: {
        ...prev.preferences,
        pushEnabled: result.data.pushEnabled,
        mutedTypes: result.data.mutedTypes,
        status: 'ready',
        isSaving: false,
      },
    }));
    return true;
  },

  reset: () => {
    set({
      lists: { all: EMPTY_SLICE, unread: EMPTY_SLICE },
      unreadCount: 0,
      preferences: EMPTY_PREFERENCES,
      pendingIds: new Set(),
      error: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
