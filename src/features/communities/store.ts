/**
 * Community state, normalised: every community by slug and every post by id,
 * with each list holding only an ordered set of keys into those maps.
 *
 * The same community is drawn in the rail, the directory grid and its own
 * header, and the same post on the front page, the Home tab and inside its
 * community. Holding a copy per list — as the friends store does — would mean
 * every join and every vote patching every list that might show it; holding
 * one record means the server's answer is written once and every list that
 * points at it is right.
 *
 * Lists are keyed by the query that produced them. A change that moves an item
 * in or out of a filtered list (joining, leaving, a new post) marks those lists
 * stale rather than editing them: the hooks refetch a stale list the next time
 * it is on screen, and keep drawing the old rows until the answer lands.
 */
import type { Community, CommunityPost, CommunityPostSort, IpcError } from '@shared/ipc-types';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/store';
import { useUsersStore } from '@/features/users/store';
import { createLogger } from '@/lib/logger';
import { fail, ok, type Result } from '@/lib/result';

import {
  fetchCommunities,
  fetchCommunity,
  fetchPosts,
  publishCommunityPost,
  setMembership as requestMembership,
  voteOnPost,
} from './api';
import {
  COMMUNITIES_PAGE_SIZE,
  communityFeed,
  isCommunitySlug,
  nextVote,
  type DirectoryQuery,
  type PostFeedSource,
} from './types';

const log = createLogger('communities.store');

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DirectorySlice {
  query: DirectoryQuery;
  slugs: string[];
  status: LoadStatus;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

export interface FeedSlice {
  source: PostFeedSource;
  sort: CommunityPostSort;
  ids: string[];
  status: LoadStatus;
  cursor: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

/** One community read by slug: `missing` is a 404, which a page draws differently. */
export interface Lookup {
  status: LoadStatus | 'missing';
  error: string | null;
}

export function directoryKey(query: DirectoryQuery): string {
  const q = (query.q ?? '').trim().toLowerCase();
  return `${query.membership ?? 'any'}|${query.sort}|${String(query.size ?? COMMUNITIES_PAGE_SIZE)}|${q}`;
}

export function feedKey(source: PostFeedSource, sort: CommunityPostSort): string {
  return `${source}|${sort}`;
}

const NOT_FOUND = 'RESOURCE_NOT_FOUND';

interface CommunitiesState {
  communities: Record<string, Community>;
  posts: Record<string, CommunityPost>;
  lookups: Record<string, Lookup>;
  directories: Record<string, DirectorySlice>;
  feeds: Record<string, FeedSlice>;
  /** Slugs with a join or leave in flight, and post ids with a vote in flight. */
  pendingIds: ReadonlySet<string>;
  /** The last failed join, leave or vote, for a banner. Reads report on their list. */
  error: string | null;
  loadDirectory: (query: DirectoryQuery) => Promise<void>;
  loadMoreDirectory: (query: DirectoryQuery) => Promise<void>;
  loadCommunity: (slug: string) => Promise<void>;
  loadFeed: (source: PostFeedSource, sort: CommunityPostSort) => Promise<void>;
  loadMoreFeed: (source: PostFeedSource, sort: CommunityPostSort) => Promise<void>;
  setMembership: (slug: string, joined: boolean) => Promise<boolean>;
  vote: (postId: string, pressed: 1 | -1) => Promise<void>;
  publish: (draft: {
    slug: string;
    title: string;
    body: string;
    tag: string;
  }) => Promise<Result<CommunityPost, IpcError>>;
  clearError: () => void;
  reset: () => void;
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

function bySlug(items: readonly Community[]): Record<string, Community> {
  return Object.fromEntries(items.map((item) => [item.slug, item]));
}

function byId(items: readonly CommunityPost[]): Record<string, CommunityPost> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** Appends keys that are not already present; pages can overlap as ranks shift. */
function appendUnique(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing);
  return [...existing, ...incoming.filter((key) => !seen.has(key))];
}

/** Marks lists stale in place of editing them; see the module note. */
function staled<TSlice extends { status: LoadStatus }>(
  slices: Record<string, TSlice>,
  predicate: (slice: TSlice) => boolean,
): Record<string, TSlice> {
  return Object.fromEntries(
    Object.entries(slices).map(([key, slice]) => [
      key,
      predicate(slice) && slice.status === 'ready' ? { ...slice, status: 'idle' } : slice,
    ]),
  );
}

const initialState = {
  communities: {},
  posts: {},
  lookups: {},
  directories: {},
  feeds: {},
  pendingIds: new Set<string>(),
  error: null,
};

export const useCommunitiesStore = create<CommunitiesState>((set, get) => ({
  ...initialState,

  loadDirectory: async (query) => {
    const key = directoryKey(query);
    const current = get().directories[key];
    set((state) => ({
      directories: {
        ...state.directories,
        // Keeps the rows it had, so a refresh does not blank the list.
        [key]: {
          query,
          slugs: current?.slugs ?? [],
          page: current?.page ?? 0,
          hasMore: current?.hasMore ?? false,
          isLoadingMore: false,
          status: 'loading',
          error: null,
        },
      },
    }));

    const result = await fetchCommunities(query, 0);
    if (!result.ok) {
      set((state) => {
        const latest = state.directories[key];
        return latest === undefined
          ? {}
          : {
              directories: {
                ...state.directories,
                [key]: { ...latest, status: 'error', error: result.error.message },
              },
            };
      });
      return;
    }

    const { content, page, last } = result.data;
    set((state) => ({
      communities: { ...state.communities, ...bySlug(content) },
      directories: {
        ...state.directories,
        [key]: {
          query,
          slugs: content.map((item) => item.slug),
          page,
          hasMore: !last,
          isLoadingMore: false,
          status: 'ready',
          error: null,
        },
      },
    }));
  },

  loadMoreDirectory: async (query) => {
    const key = directoryKey(query);
    const slice = get().directories[key];
    if (slice === undefined || !slice.hasMore || slice.isLoadingMore || slice.status !== 'ready') {
      return;
    }

    set((state) => ({
      directories: { ...state.directories, [key]: { ...slice, isLoadingMore: true } },
    }));
    const result = await fetchCommunities(query, slice.page + 1);

    set((state) => {
      const latest = state.directories[key] ?? slice;
      if (!result.ok) {
        return {
          directories: {
            ...state.directories,
            [key]: { ...latest, isLoadingMore: false, error: result.error.message },
          },
        };
      }
      const { content, page, last } = result.data;
      return {
        communities: { ...state.communities, ...bySlug(content) },
        directories: {
          ...state.directories,
          [key]: {
            ...latest,
            slugs: appendUnique(
              latest.slugs,
              content.map((item) => item.slug),
            ),
            page,
            hasMore: !last,
            isLoadingMore: false,
            error: null,
          },
        },
      };
    });
  },

  loadCommunity: async (slug) => {
    // A slug that cannot exist is a 404 without asking — and is never sent.
    if (!isCommunitySlug(slug)) {
      set((state) => ({
        lookups: { ...state.lookups, [slug]: { status: 'missing', error: null } },
      }));
      return;
    }

    set((state) => ({ lookups: { ...state.lookups, [slug]: { status: 'loading', error: null } } }));
    const result = await fetchCommunity(slug);

    if (!result.ok) {
      const missing = result.error.apiCode === NOT_FOUND;
      set((state) => ({
        lookups: {
          ...state.lookups,
          [slug]: missing
            ? { status: 'missing', error: null }
            : { status: 'error', error: result.error.message },
        },
      }));
      return;
    }

    set((state) => ({
      communities: { ...state.communities, [slug]: result.data },
      lookups: { ...state.lookups, [slug]: { status: 'ready', error: null } },
    }));
  },

  loadFeed: async (source, sort) => {
    const key = feedKey(source, sort);
    const current = get().feeds[key];
    set((state) => ({
      feeds: {
        ...state.feeds,
        [key]: {
          source,
          sort,
          ids: current?.ids ?? [],
          cursor: current?.cursor ?? null,
          hasMore: current?.hasMore ?? false,
          isLoadingMore: false,
          status: 'loading',
          error: null,
        },
      },
    }));

    const result = await fetchPosts(source, sort, null);
    if (!result.ok) {
      set((state) => {
        const latest = state.feeds[key];
        return latest === undefined
          ? {}
          : {
              feeds: {
                ...state.feeds,
                [key]: { ...latest, status: 'error', error: result.error.message },
              },
            };
      });
      return;
    }

    const { content, nextCursor, hasMore } = result.data;
    useUsersStore.getState().prime(content.map((post) => post.author));
    set((state) => ({
      posts: { ...state.posts, ...byId(content) },
      feeds: {
        ...state.feeds,
        [key]: {
          source,
          sort,
          ids: content.map((post) => post.id),
          cursor: nextCursor,
          hasMore: hasMore && nextCursor !== null,
          isLoadingMore: false,
          status: 'ready',
          error: null,
        },
      },
    }));
  },

  loadMoreFeed: async (source, sort) => {
    const key = feedKey(source, sort);
    const slice = get().feeds[key];
    if (
      slice === undefined ||
      !slice.hasMore ||
      slice.cursor === null ||
      slice.isLoadingMore ||
      slice.status !== 'ready'
    ) {
      return;
    }

    set((state) => ({ feeds: { ...state.feeds, [key]: { ...slice, isLoadingMore: true } } }));
    // The cursor is only valid with the sort it came from, which the key pins.
    const result = await fetchPosts(source, sort, slice.cursor);

    if (result.ok) {
      useUsersStore.getState().prime(result.data.content.map((post) => post.author));
    }
    set((state) => {
      const latest = state.feeds[key] ?? slice;
      if (!result.ok) {
        return {
          feeds: {
            ...state.feeds,
            [key]: { ...latest, isLoadingMore: false, error: result.error.message },
          },
        };
      }
      const { content, nextCursor, hasMore } = result.data;
      return {
        posts: { ...state.posts, ...byId(content) },
        feeds: {
          ...state.feeds,
          [key]: {
            ...latest,
            ids: appendUnique(
              latest.ids,
              content.map((post) => post.id),
            ),
            cursor: nextCursor,
            hasMore: hasMore && nextCursor !== null,
            isLoadingMore: false,
            error: null,
          },
        },
      };
    });
  },

  setMembership: async (slug, joined) => {
    if (get().pendingIds.has(slug)) {
      return false;
    }

    set((state) => ({ pendingIds: withPending(state.pendingIds, slug, true), error: null }));
    const result = await requestMembership(slug, joined);

    if (!result.ok) {
      set((state) => ({
        pendingIds: withPending(state.pendingIds, slug, false),
        error: result.error.message,
      }));
      return false;
    }

    // The answer carries the real count; it replaces ours rather than adjusting it.
    set((state) => ({
      communities: { ...state.communities, [slug]: result.data },
      pendingIds: withPending(state.pendingIds, slug, false),
      directories: staled(state.directories, (slice) => slice.query.membership !== undefined),
      feeds: staled(state.feeds, (slice) => slice.source === 'joined' || slice.source === 'all'),
    }));
    log.info(joined ? 'community_joined' : 'community_left', {});
    return true;
  },

  vote: async (postId, pressed) => {
    const before = get().posts[postId];
    if (before === undefined || get().pendingIds.has(postId)) {
      return;
    }

    const value = nextVote(before.viewerVote, pressed);
    // Drawn at once: a vote that waits on the network feels broken. The
    // server's answer then replaces the guess, or the snapshot comes back.
    set((state) => ({
      pendingIds: withPending(state.pendingIds, postId, true),
      error: null,
      posts: {
        ...state.posts,
        [postId]: { ...before, viewerVote: value, score: before.score - before.viewerVote + value },
      },
    }));

    const result = await voteOnPost(postId, value);

    set((state) => {
      const latest = state.posts[postId];
      const settled =
        latest === undefined
          ? state.posts
          : {
              ...state.posts,
              [postId]: result.ok
                ? { ...latest, score: result.data.score, viewerVote: result.data.viewerVote }
                : { ...latest, score: before.score, viewerVote: before.viewerVote },
            };
      return {
        posts: settled,
        pendingIds: withPending(state.pendingIds, postId, false),
        error: result.ok ? null : result.error.message,
      };
    });
  },

  publish: async (draft) => {
    const result = await publishCommunityPost(draft);
    if (!result.ok) {
      return fail(result.error);
    }

    const post = result.data;
    const own = communityFeed(post.community.slug);
    set((state) => ({
      posts: { ...state.posts, [post.id]: post },
      // Shown at the top of its own community at once, whatever the sort —
      // the author expects to see it there. The front pages rank it themselves.
      feeds: staled(
        Object.fromEntries(
          Object.entries(state.feeds).map(([key, slice]) => [
            key,
            slice.source === own ? { ...slice, ids: [post.id, ...slice.ids] } : slice,
          ]),
        ),
        (slice) => slice.source === 'all' || slice.source === 'joined',
      ),
    }));
    log.info('community_post_published', {});
    return ok(post);
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({ ...initialState, pendingIds: new Set() });
  },
}));

// Membership and votes are the viewer's own: nothing of one session may be
// drawn for the next account to sign in on this window.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useCommunitiesStore.getState().reset();
  }
});
