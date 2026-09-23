/**
 * Story state, normalised the way the showcase and communities stores are:
 * every slide by id, and each place that lists slides an ordered list of ids.
 *
 * One slide is drawn in the ring row, the viewer, a profile's avatar ring, the
 * archive and a chat reply's preview at once, so marking it seen, refreshing
 * its signed image link or deleting it is written to the one record and every
 * surface follows. (A snapshot handed to the viewer was the alternative, and
 * would have kept showing a ring as unseen after it had been watched.)
 *
 * Rings are keyed by author id: the feed's, a profile's, and the viewer's own,
 * which is `rings[<viewer id>]` and comes from `/stories/me` — the feed never
 * carries it.
 */
import type {
  Author,
  CreateStoryRequest,
  IpcError,
  Story,
  StoryReply,
  StoryFeedGroup,
  StoryReplyAccepted,
  StoryType,
} from '@shared/ipc-types';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/store';
import { useUsersStore } from '@/features/users/store';
import { createLogger } from '@/lib/logger';
import { fail, ok, type Result } from '@/lib/result';

import {
  createStory,
  deleteStory,
  fetchMyStories,
  fetchStory,
  fetchStoryArchive,
  fetchStoryFeed,
  fetchUserStories,
  markStorySeen,
  replyToStory,
  STORY_NOT_FOUND,
  storyErrorMessage,
} from './api';
import { hasExpired, isImageUrlStale } from './types';

const log = createLogger('stories.store');

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Where on screen a ring was opened from, so the viewer can grow out of it. */
export interface Origin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RingEntry {
  author: Author;
  /** Oldest first — the order they play in. */
  storyIds: string[];
}

export interface FeedSlice {
  /** Ring order as the server ranked it: unseen first, then newest. */
  authorIds: string[];
  status: LoadStatus;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
  /** When the first page last landed, so a focus refresh can skip a fresh one. */
  loadedAt: number;
}

export interface ArchiveSlice {
  type: StoryType | undefined;
  ids: string[];
  status: LoadStatus;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

/** A chat reply's story: loading, drawn, or gone for good (never asked again). */
export type PreviewStatus = 'loading' | 'ready' | 'unavailable';

export interface ViewerSession {
  /** Author ids, in the order the viewer walks them. */
  sequence: string[];
  origin: Origin | null;
}

interface StoriesState {
  stories: Record<string, Story>;
  rings: Record<string, RingEntry>;
  feed: FeedSlice;
  mineStatus: LoadStatus;
  /** A profile's ring, by user id; `missing` is the 404 (absent, suspended or blocked). */
  userLookups: Record<string, LoadStatus | 'missing'>;
  archive: ArchiveSlice;
  previews: Record<string, PreviewStatus>;
  viewer: ViewerSession | null;

  loadFeed: () => Promise<void>;
  loadMoreFeed: () => Promise<void>;
  loadMine: () => Promise<void>;
  loadUser: (userId: string) => Promise<void>;
  open: (sequence: string[], origin?: Origin) => void;
  close: () => void;
  markSeen: (storyId: string) => void;
  post: (draft: CreateStoryRequest) => Promise<Result<Story, string>>;
  remove: (storyId: string) => Promise<Result<true, string>>;
  reply: (
    storyId: string,
    text: string,
    clientId: string,
  ) => Promise<Result<StoryReplyAccepted, IpcError>>;
  /** Re-reads one story, for a fresh signed image link. */
  refreshStory: (storyId: string) => Promise<void>;
  /** Loads what a chat reply's bubble shows, once; see the rules in the body. */
  ensurePreview: (reply: StoryReply, viewerId: string | null) => void;
  loadArchive: (type: StoryType | undefined) => Promise<void>;
  loadMoreArchive: () => Promise<void>;
  reset: () => void;
}

const EMPTY_FEED: FeedSlice = {
  authorIds: [],
  status: 'idle',
  page: 0,
  hasMore: false,
  isLoadingMore: false,
  error: null,
  loadedAt: 0,
};

const EMPTY_ARCHIVE: ArchiveSlice = {
  type: undefined,
  ids: [],
  status: 'idle',
  page: 0,
  hasMore: false,
  isLoadingMore: false,
  error: null,
};

const initialState = {
  stories: {},
  rings: {},
  feed: EMPTY_FEED,
  mineStatus: 'idle' as LoadStatus,
  userLookups: {},
  archive: EMPTY_ARCHIVE,
  previews: {},
  viewer: null,
};

/** Feed pages read per full load: 4 × 50 rings covers any realistic friend list. */
const FEED_PAGES_MAX = 4;

/** Story ids whose view this session already reported; repeats change nothing upstream. */
const reportedViews = new Set<string>();
/** Story ids with a re-read in flight, so a burst of image errors costs one call. */
const refreshing = new Set<string>();

function viewerId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/**
 * Incoming records over the held ones. A slide this session already watched
 * stays watched: the view may still be on its way when a refresh lands.
 */
function withRecords(
  held: Record<string, Story>,
  incoming: readonly Story[],
): Record<string, Story> {
  const next = { ...held };
  for (const story of incoming) {
    const known = held[story.id];
    next[story.id] = known?.isSeen === true ? { ...story, isSeen: true } : story;
  }
  return next;
}

/** A page of feed rings folded in: the records, and each author's ring replaced. */
function withGroups(
  state: Pick<StoriesState, 'stories' | 'rings'>,
  groups: readonly StoryFeedGroup[],
): Pick<StoriesState, 'stories' | 'rings'> {
  const rings = { ...state.rings };
  for (const group of groups) {
    rings[group.author.id] = {
      author: group.author,
      storyIds: group.stories.map((story) => story.id),
    };
  }
  return {
    stories: withRecords(
      state.stories,
      groups.flatMap((group) => group.stories),
    ),
    rings,
  };
}

/** One author's ring set from their active stories — or dropped, when they have none. */
function withRing(
  rings: Record<string, RingEntry>,
  authorId: string,
  stories: readonly Story[],
): Record<string, RingEntry> {
  const rest = Object.fromEntries(Object.entries(rings).filter(([id]) => id !== authorId));
  const [first] = stories;
  return first === undefined
    ? rest
    : { ...rest, [authorId]: { author: first.author, storyIds: stories.map((story) => story.id) } };
}

function appendUnique(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing);
  return [...existing, ...incoming.filter((id) => !seen.has(id))];
}

/** Every trace of one slide gone: its record, its place in a ring, the archive. */
function withoutStory(
  state: Pick<StoriesState, 'stories' | 'rings' | 'feed' | 'archive'>,
  storyId: string,
): Pick<StoriesState, 'stories' | 'rings' | 'feed' | 'archive'> {
  const stories = Object.fromEntries(
    Object.entries(state.stories).filter(([id]) => id !== storyId),
  );
  const rings: Record<string, RingEntry> = {};
  for (const [authorId, ring] of Object.entries(state.rings)) {
    const storyIds = ring.storyIds.filter((id) => id !== storyId);
    if (storyIds.length > 0) {
      rings[authorId] = { ...ring, storyIds };
    }
  }
  return {
    stories,
    rings,
    feed: { ...state.feed, authorIds: state.feed.authorIds.filter((id) => id in rings) },
    archive: { ...state.archive, ids: state.archive.ids.filter((id) => id !== storyId) },
  };
}

export const useStoriesStore = create<StoriesState>((set, get) => {
  /** The viewer's own ring from their active stories, or none when there are none. */
  function withMine(rings: Record<string, RingEntry>, mine: readonly Story[]) {
    const myId = viewerId();
    return myId === null ? rings : withRing(rings, myId, mine);
  }

  return {
    ...initialState,

    /**
     * The whole ring list, not just what the Home row shows: avatars across
     * the app wear a ring from it, so up to FEED_PAGES_MAX pages are read in
     * one go. Past that, `loadMoreFeed` continues. A full reload also drops the
     * rings of friends who fell out of the feed (their stories expired or were
     * deleted), which would otherwise keep their avatars ringed.
     */
    loadFeed: async () => {
      set((state) => ({ feed: { ...state.feed, status: 'loading', error: null } }));

      const groups: StoryFeedGroup[] = [];
      let page = 0;
      let last = false;
      for (;;) {
        const result = await fetchStoryFeed(page);
        if (!result.ok) {
          if (page === 0) {
            set((state) => ({
              feed: { ...state.feed, status: 'error', error: storyErrorMessage(result.error) },
            }));
            return;
          }
          // Later pages failing still leaves the first ones worth drawing.
          break;
        }
        groups.push(...result.data.content.filter((group) => group.stories.length > 0));
        last = result.data.last;
        if (last || page + 1 >= FEED_PAGES_MAX) {
          break;
        }
        page += 1;
      }

      useUsersStore.getState().prime(groups.map((group) => group.author));
      const authorIds = appendUnique(
        [],
        groups.map((group) => group.author.id),
      );
      set((state) => {
        const current = new Set(authorIds);
        const myId = viewerId();
        const dropped = state.feed.authorIds.filter((id) => !current.has(id) && id !== myId);
        const rings = Object.fromEntries(
          Object.entries(state.rings).filter(([id]) => !dropped.includes(id)),
        );
        return {
          ...withGroups({ stories: state.stories, rings }, groups),
          feed: {
            authorIds,
            status: 'ready',
            page,
            hasMore: !last,
            isLoadingMore: false,
            error: null,
            loadedAt: Date.now(),
          },
        };
      });
    },

    loadMoreFeed: async () => {
      const { feed } = get();
      if (feed.status !== 'ready' || !feed.hasMore || feed.isLoadingMore) {
        return;
      }
      set((state) => ({ feed: { ...state.feed, isLoadingMore: true } }));
      const result = await fetchStoryFeed(feed.page + 1);
      if (!result.ok) {
        set((state) => ({
          feed: { ...state.feed, isLoadingMore: false, error: storyErrorMessage(result.error) },
        }));
        return;
      }

      const groups = result.data.content.filter((group) => group.stories.length > 0);
      useUsersStore.getState().prime(groups.map((group) => group.author));
      set((state) => ({
        ...withGroups(state, groups),
        feed: {
          ...state.feed,
          // A ring that moved up a page while scrolling is not drawn twice.
          authorIds: appendUnique(
            state.feed.authorIds,
            groups.map((group) => group.author.id),
          ),
          page: result.data.page,
          hasMore: !result.data.last,
          isLoadingMore: false,
        },
      }));
    },

    loadMine: async () => {
      set({ mineStatus: 'loading' });
      const result = await fetchMyStories();
      if (!result.ok) {
        log.warn('my_stories_failed', { code: result.error.code });
        set({ mineStatus: 'error' });
        return;
      }
      set((state) => ({
        stories: withRecords(state.stories, result.data),
        rings: withMine(state.rings, result.data),
        mineStatus: 'ready',
      }));
    },

    loadUser: async (userId) => {
      set((state) => ({ userLookups: { ...state.userLookups, [userId]: 'loading' } }));
      const result = await fetchUserStories(userId);
      if (!result.ok) {
        const missing = result.error.apiCode === STORY_NOT_FOUND;
        set((state) => ({
          userLookups: { ...state.userLookups, [userId]: missing ? 'missing' : 'error' },
        }));
        return;
      }
      set((state) => ({
        stories: withRecords(state.stories, result.data),
        rings: withRing(state.rings, userId, result.data),
        userLookups: { ...state.userLookups, [userId]: 'ready' },
      }));
    },

    open: (sequence, origin) => {
      if (sequence.length > 0) {
        set({ viewer: { sequence, origin: origin ?? null } });
      }
    },

    close: () => {
      set({ viewer: null });
    },

    /**
     * Flips the slide at once and tells the server in the background. A failed
     * report is not undone: the ring would bounce back to unseen for a slide
     * the user has just watched, and the next refresh settles it either way.
     */
    markSeen: (storyId) => {
      const story = get().stories[storyId];
      if (story === undefined) {
        return;
      }
      if (!story.isSeen) {
        set((state) => ({ stories: { ...state.stories, [storyId]: { ...story, isSeen: true } } }));
      }
      // The owner's own view is a no-op upstream; there is nothing to report.
      if (story.isOwner || reportedViews.has(storyId)) {
        return;
      }
      reportedViews.add(storyId);
      void markStorySeen(storyId).then((result) => {
        if (!result.ok) {
          log.warn('story_view_failed', { code: result.error.code, apiCode: result.error.apiCode });
        }
      });
    },

    post: async (draft) => {
      const result = await createStory(draft);
      if (!result.ok) {
        return fail(storyErrorMessage(result.error));
      }
      const story = result.data;
      set((state) => {
        const mine = state.rings[story.author.id];
        return {
          stories: { ...state.stories, [story.id]: story },
          // Straight onto "Your story", newest last; no need to re-read `/stories/me`.
          rings: {
            ...state.rings,
            [story.author.id]: {
              author: story.author,
              storyIds: [...(mine?.storyIds ?? []), story.id],
            },
          },
          // The archive lists newest first, and its query may not include this one.
          archive: { ...state.archive, status: 'idle' },
        };
      });
      log.info('story_posted', { type: story.type });
      return ok(story);
    },

    remove: async (storyId) => {
      const result = await deleteStory(storyId);
      if (!result.ok) {
        return fail(storyErrorMessage(result.error));
      }
      set((state) => withoutStory(state, storyId));
      log.info('story_deleted', {});
      return ok(true);
    },

    reply: async (storyId, text, clientId) => replyToStory(storyId, text, clientId),

    refreshStory: async (storyId) => {
      if (refreshing.has(storyId)) {
        return;
      }
      refreshing.add(storyId);
      const result = await fetchStory(storyId);
      refreshing.delete(storyId);

      if (result.ok) {
        set((state) => ({
          stories: withRecords(state.stories, [result.data]),
          previews: { ...state.previews, [storyId]: 'ready' },
        }));
        return;
      }
      if (result.error.apiCode === STORY_NOT_FOUND) {
        set((state) => ({ previews: { ...state.previews, [storyId]: 'unavailable' } }));
      }
    },

    /**
     * The chat bubble's rules, from the API guide:
     *   - someone else's story past `storyExpiresAt` is unavailable without asking;
     *   - otherwise it is read once; a 404 is final, and never asked again;
     *   - the author can still read their own after expiry (from the archive).
     * A cached record whose signed link has lapsed is read again for a fresh one.
     */
    ensurePreview: (reply, currentViewerId) => {
      const { storyId } = reply;
      const status = get().previews[storyId];
      if (status === 'loading' || status === 'unavailable') {
        return;
      }
      const cached = get().stories[storyId];
      if (status === 'ready' && cached !== undefined && !isImageUrlStale(cached)) {
        return;
      }
      const isAuthor = reply.storyAuthorId === currentViewerId;
      if (!isAuthor && hasExpired(reply.storyExpiresAt)) {
        set((state) => ({ previews: { ...state.previews, [storyId]: 'unavailable' } }));
        return;
      }

      set((state) => ({ previews: { ...state.previews, [storyId]: 'loading' } }));
      void fetchStory(storyId).then((result) => {
        set((state) => ({
          ...(result.ok ? { stories: withRecords(state.stories, [result.data]) } : {}),
          // Any refusal settles it for this session: asking again on every
          // render of the thread would be a request per scroll.
          previews: { ...state.previews, [storyId]: result.ok ? 'ready' : 'unavailable' },
        }));
      });
    },

    loadArchive: async (type) => {
      set((state) => ({
        archive: {
          ...state.archive,
          type,
          // A different filter is a different list; the same one keeps its rows while it reloads.
          ids: state.archive.type === type ? state.archive.ids : [],
          status: 'loading',
          error: null,
        },
      }));
      const result = await fetchStoryArchive(type, 0);
      if (get().archive.type !== type) {
        return;
      }
      if (!result.ok) {
        set((state) => ({
          archive: { ...state.archive, status: 'error', error: storyErrorMessage(result.error) },
        }));
        return;
      }
      set((state) => ({
        stories: withRecords(state.stories, result.data.content),
        archive: {
          type,
          ids: result.data.content.map((story) => story.id),
          status: 'ready',
          page: result.data.page,
          hasMore: !result.data.last,
          isLoadingMore: false,
          error: null,
        },
      }));
    },

    loadMoreArchive: async () => {
      const { archive } = get();
      if (archive.status !== 'ready' || !archive.hasMore || archive.isLoadingMore) {
        return;
      }
      set((state) => ({ archive: { ...state.archive, isLoadingMore: true } }));
      const result = await fetchStoryArchive(archive.type, archive.page + 1);
      if (get().archive.type !== archive.type) {
        return;
      }
      if (!result.ok) {
        set((state) => ({
          archive: {
            ...state.archive,
            isLoadingMore: false,
            error: storyErrorMessage(result.error),
          },
        }));
        return;
      }
      set((state) => ({
        stories: withRecords(state.stories, result.data.content),
        archive: {
          ...state.archive,
          ids: appendUnique(
            state.archive.ids,
            result.data.content.map((story) => story.id),
          ),
          page: result.data.page,
          hasMore: !result.data.last,
          isLoadingMore: false,
        },
      }));
    },

    reset: () => {
      reportedViews.clear();
      refreshing.clear();
      set({ ...initialState });
    },
  };
});

// Seen state, rings and the archive are the viewer's own: nothing of one
// session may be drawn for the next account to sign in on this window.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useStoriesStore.getState().reset();
  }
});
