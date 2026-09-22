/**
 * Friendship state: friends, the requests received and sent, and blocks.
 *
 * All four lists are held here rather than in the route, because the profile
 * screens and the chat picker need the same answer the friends screen does —
 * "what is my relationship with this person?" — and independently fetched
 * copies would disagree.
 *
 * Every mutation answers with the server's own `friendStatus`, which is kept
 * per user in `statuses` and wins over whatever a list or a profile said
 * before. The lists are moved between accordingly, so the sidebar badge and
 * the tabs stay right without a refetch.
 */
import type { FriendEntry } from '@shared/ipc-types';
import { create } from 'zustand';

import { useUsersStore } from '@/features/users/store';
import { createLogger } from '@/lib/logger';

import {
  acceptFriendRequest,
  blockUser,
  cancelFriendRequest,
  declineFriendRequest,
  fetchBlockedUsers,
  fetchFriendRequests,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  unblockUser,
  type FriendsError,
} from './api';
import { FRIENDS_PAGE_SIZE, FRIENDS_REFRESH_MAX_SIZE, LOCAL_BLOCKED_STATUS } from './types';

const log = createLogger('friends.store');

export type ListStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ListName = 'friends' | 'received' | 'sent' | 'blocked';

export interface ListSlice {
  entries: FriendEntry[];
  status: ListStatus;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  /** The server's count, when a page has been read; what the tab shows. */
  total: number;
}

const EMPTY_SLICE: ListSlice = {
  entries: [],
  status: 'idle',
  page: 0,
  hasMore: false,
  isLoadingMore: false,
  total: 0,
};

const FETCHERS: Record<ListName, (page: number, size?: number) => ReturnType<typeof fetchFriends>> =
  {
    friends: (page, size) => fetchFriends(page, size),
    received: (page, size) => fetchFriendRequests('received', page, size),
    sent: (page, size) => fetchFriendRequests('sent', page, size),
    blocked: (page, size) => fetchBlockedUsers(page, size),
  };

const LIST_NAMES = ['friends', 'received', 'sent', 'blocked'] as const;

/** A background refresh closer than this to the last one is skipped. */
const REFRESH_THROTTLE_MS = 10_000;

/** The API's own conflict code for a request that already exists. */
const REQUEST_CONFLICT = 'FRIEND_REQUEST_CONFLICT';

interface FriendsState {
  lists: Record<ListName, ListSlice>;
  /** The latest `friendStatus` the server reported per user, from any mutation. */
  statuses: Record<string, string>;
  /** User ids with an operation in flight. */
  pendingIds: ReadonlySet<string>;
  error: string | null;
  load: (name: ListName) => Promise<void>;
  loadAll: () => Promise<void>;
  loadMore: (name: ListName) => Promise<void>;
  /**
   * Re-reads every list in the background, without a loading state, so what
   * the other side did — accepting, declining, removing — shows up. Throttled
   * unless `force`d, which a live notification does.
   */
  refresh: (options?: { force?: boolean }) => Promise<void>;
  lastRefreshedAt: number;
  sendRequest: (userId: string) => Promise<boolean>;
  cancelRequest: (userId: string) => Promise<boolean>;
  accept: (userId: string) => Promise<boolean>;
  decline: (userId: string) => Promise<boolean>;
  unfriend: (userId: string) => Promise<boolean>;
  block: (userId: string) => Promise<boolean>;
  unblock: (userId: string) => Promise<boolean>;
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

function without(slice: ListSlice, userId: string): ListSlice {
  const entries = slice.entries.filter((item) => item.user.id !== userId);
  const removed = slice.entries.length - entries.length;
  return { ...slice, entries, total: Math.max(0, slice.total - removed) };
}

function withEntry(slice: ListSlice, entry: FriendEntry): ListSlice {
  const rest = without(slice, entry.user.id);
  return { ...rest, entries: [entry, ...rest.entries], total: rest.total + 1 };
}

export const useFriendsStore = create<FriendsState>((set, get) => {
  /**
   * Runs one mutation with the shared bookkeeping: the pending flag, the
   * error, and — on success — the server's status plus the list moves the
   * caller describes. What differs between the seven mutations is only the
   * call and the moves, so that is all each one states.
   */
  async function mutate(
    userId: string,
    call: () => Promise<
      { ok: true; data: FriendEntry | true } | { ok: false; error: FriendsError }
    >,
    apply: (
      lists: Record<ListName, ListSlice>,
      entry: FriendEntry | null,
    ) => Record<ListName, ListSlice>,
    status: string | null,
    event: string,
    tolerated?: string,
  ): Promise<boolean> {
    if (get().pendingIds.has(userId)) {
      return false;
    }

    set((state) => ({ pendingIds: withPending(state.pendingIds, userId, true), error: null }));
    const result = await call();

    if (!result.ok) {
      // Some conflicts are the state we wanted anyway — the button only needs
      // to stop offering the action, not report a failure.
      const tolerable = tolerated !== undefined && result.error.apiCode === tolerated;
      set((state) => ({
        pendingIds: withPending(state.pendingIds, userId, false),
        error: tolerable ? null : result.error.message,
        statuses:
          tolerable && status !== null ? { ...state.statuses, [userId]: status } : state.statuses,
      }));
      return tolerable;
    }

    const entry = result.data === true ? null : result.data;
    const reported = entry?.friendStatus ?? status;
    set((state) => ({
      lists: apply(state.lists, entry),
      pendingIds: withPending(state.pendingIds, userId, false),
      statuses:
        reported === null ? state.statuses : { ...state.statuses, [userId]: status ?? reported },
      error: null,
    }));
    log.info(event, {});
    return true;
  }

  return {
    lists: { friends: EMPTY_SLICE, received: EMPTY_SLICE, sent: EMPTY_SLICE, blocked: EMPTY_SLICE },
    statuses: {},
    pendingIds: new Set(),
    error: null,
    lastRefreshedAt: 0,

    load: async (name) => {
      set((state) => ({
        lists: { ...state.lists, [name]: { ...state.lists[name], status: 'loading' } },
      }));

      const result = await FETCHERS[name](0);
      if (!result.ok) {
        set((state) => ({
          lists: { ...state.lists, [name]: { ...state.lists[name], status: 'error' } },
          error: result.error.message,
        }));
        return;
      }

      useUsersStore.getState().prime(result.data.content.map((entry) => entry.user));
      set((state) => ({
        lists: {
          ...state.lists,
          [name]: {
            entries: result.data.content,
            status: 'ready',
            page: result.data.page,
            hasMore: !result.data.last,
            isLoadingMore: false,
            total: result.data.totalElements,
          },
        },
      }));
    },

    loadAll: async () => {
      // Fresh lists are the truth again; per-user answers from before are stale.
      set({ statuses: {}, error: null, lastRefreshedAt: Date.now() });
      // Independent reads: one failing must not blank the others.
      await Promise.all(
        (['friends', 'received', 'sent', 'blocked'] as const).map((name) => get().load(name)),
      );
    },

    refresh: async ({ force = false } = {}) => {
      const state = get();
      // Before the first load there is nothing to catch up; the loader owns that.
      if (state.lists.friends.status !== 'ready') {
        return;
      }
      if (!force && Date.now() - state.lastRefreshedAt < REFRESH_THROTTLE_MS) {
        return;
      }
      set({ lastRefreshedAt: Date.now() });

      const results = await Promise.all(
        LIST_NAMES.map(async (name) => {
          // As many rows as are on screen, so a refresh never shortens a list
          // the user scrolled; the API caps a page, so it may take several.
          const wanted = Math.max(get().lists[name].entries.length, 1);
          const size = Math.min(wanted, FRIENDS_REFRESH_MAX_SIZE);
          const pages = Math.ceil(wanted / size);
          const content: FriendEntry[] = [];
          let last = true;
          let total = 0;
          for (let page = 0; page < pages; page += 1) {
            const result = await FETCHERS[name](page, size);
            if (!result.ok) {
              return null;
            }
            content.push(...result.data.content);
            last = result.data.last;
            total = result.data.totalElements;
            if (last) {
              break;
            }
          }
          return { name, content, last, total };
        }),
      );

      const fresh = results.filter((entry) => entry !== null);
      if (fresh.length === 0) {
        // A background miss is not worth an error banner; the next one retries.
        log.warn('friends_refresh_failed', {});
        return;
      }

      useUsersStore.getState().prime(fresh.flatMap((entry) => entry.content.map((e) => e.user)));
      set((current) => {
        const lists = { ...current.lists };
        for (const entry of fresh) {
          lists[entry.name] = {
            ...lists[entry.name],
            entries: entry.content,
            status: 'ready',
            // `loadMore` pages at FRIENDS_PAGE_SIZE: point it past what is held.
            page: Math.max(0, Math.ceil(entry.content.length / FRIENDS_PAGE_SIZE) - 1),
            hasMore: !entry.last,
            total: entry.total,
          };
        }
        // The lists now say where each relationship stands. A status kept from
        // this session's own actions only still counts while one is in flight,
        // and a block, which the server never reports back.
        const statuses: Record<string, string> = {};
        for (const [userId, status] of Object.entries(current.statuses)) {
          if (current.pendingIds.has(userId) || status === LOCAL_BLOCKED_STATUS) {
            statuses[userId] = status;
          }
        }
        return { lists, statuses };
      });
    },

    loadMore: async (name) => {
      const slice = get().lists[name];
      if (!slice.hasMore || slice.isLoadingMore) {
        return;
      }

      set((state) => ({
        lists: { ...state.lists, [name]: { ...state.lists[name], isLoadingMore: true } },
      }));
      const result = await FETCHERS[name](slice.page + 1);

      if (!result.ok) {
        set((state) => ({
          lists: { ...state.lists, [name]: { ...state.lists[name], isLoadingMore: false } },
          error: result.error.message,
        }));
        return;
      }

      useUsersStore.getState().prime(result.data.content.map((entry) => entry.user));
      set((state) => ({
        lists: {
          ...state.lists,
          [name]: {
            ...state.lists[name],
            entries: [...state.lists[name].entries, ...result.data.content],
            page: result.data.page,
            hasMore: !result.data.last,
            isLoadingMore: false,
            total: result.data.totalElements,
          },
        },
      }));
    },

    sendRequest: (userId) =>
      mutate(
        userId,
        () => sendFriendRequest(userId),
        (lists, entry) =>
          entry === null ? lists : { ...lists, sent: withEntry(lists.sent, entry) },
        null,
        'friend_request_sent',
        REQUEST_CONFLICT,
      ),

    cancelRequest: (userId) =>
      mutate(
        userId,
        () => cancelFriendRequest(userId),
        (lists) => ({ ...lists, sent: without(lists.sent, userId) }),
        null,
        'friend_request_cancelled',
      ),

    accept: (userId) =>
      mutate(
        userId,
        () => acceptFriendRequest(userId),
        (lists, entry) => ({
          ...lists,
          received: without(lists.received, userId),
          friends: entry === null ? lists.friends : withEntry(lists.friends, entry),
        }),
        null,
        'friend_request_accepted',
      ),

    decline: (userId) =>
      mutate(
        userId,
        () => declineFriendRequest(userId),
        (lists) => ({ ...lists, received: without(lists.received, userId) }),
        null,
        'friend_request_declined',
      ),

    unfriend: (userId) =>
      mutate(
        userId,
        () => removeFriend(userId),
        (lists) => ({ ...lists, friends: without(lists.friends, userId) }),
        'NONE',
        'friendship_removed',
      ),

    // A block ends every other relationship at once; the server reports NONE
    // afterwards, which is exactly what it would say to a stranger, so the
    // local status remembers the block for this session's buttons.
    block: (userId) =>
      mutate(
        userId,
        () => blockUser(userId),
        (lists, entry) => ({
          friends: without(lists.friends, userId),
          received: without(lists.received, userId),
          sent: without(lists.sent, userId),
          blocked: entry === null ? lists.blocked : withEntry(lists.blocked, entry),
        }),
        LOCAL_BLOCKED_STATUS,
        'user_blocked',
      ),

    unblock: (userId) =>
      mutate(
        userId,
        () => unblockUser(userId),
        (lists) => ({ ...lists, blocked: without(lists.blocked, userId) }),
        'NONE',
        'user_unblocked',
      ),

    clearError: () => {
      set({ error: null });
    },
  };
});
