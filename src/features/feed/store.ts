/**
 * Feed state.
 *
 * Holds the loaded pages, the cursor for the next one, and the in-flight flags
 * the composer and the reaction buttons read.
 *
 * The post *mutations* are not here — they live in post-actions.ts, because a
 * profile timeline runs the same operations against a list this store does not
 * own. What the store contributes is the sink those mutations write into.
 */
import type { Post } from '@shared/ipc-types';
import { create } from 'zustand';

import { createLogger } from '@/lib/logger';

import { fetchFeed, publishPost } from './api';
import type { PostSink } from './post-actions';
import type { ComposePostInput } from './types';

const log = createLogger('feed.store');

export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

interface FeedState {
  posts: Post[];
  status: FeedStatus;
  error: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  isPublishing: boolean;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  publish: (input: ComposePostInput, imageTokens?: readonly string[]) => Promise<boolean>;
  /** Adopts a post the server has just returned, wherever it came from. */
  replacePost: (post: Post) => void;
  removePost: (postId: string) => void;
  prependPost: (post: Post) => void;
  /** Adjusts a post's comment count after the thread beneath it changed. */
  adjustCommentCount: (postId: string, delta: number) => void;
  clearError: () => void;
}

function replacePost(posts: Post[], updated: Post): Post[] {
  return posts.map((post) => (post.id === updated.id ? updated : post));
}

export const useFeedStore = create<FeedState>((set, get) => ({
  posts: [],
  status: 'idle',
  error: null,
  nextCursor: null,
  hasMore: false,
  isLoadingMore: false,
  isPublishing: false,

  load: async () => {
    set({ status: 'loading', error: null });
    const result = await fetchFeed();

    if (!result.ok) {
      set({ status: 'error', error: result.error.message });
      return;
    }

    set({
      posts: result.data.posts,
      nextCursor: result.data.nextCursor,
      hasMore: result.data.hasMore,
      status: 'ready',
    });
  },

  loadMore: async () => {
    const { nextCursor, hasMore, isLoadingMore, posts } = get();
    if (!hasMore || nextCursor === null || isLoadingMore) {
      return;
    }

    set({ isLoadingMore: true });
    const result = await fetchFeed(nextCursor);
    set({ isLoadingMore: false });

    if (!result.ok) {
      set({ error: result.error.message });
      return;
    }

    set({
      posts: [...posts, ...result.data.posts],
      nextCursor: result.data.nextCursor,
      hasMore: result.data.hasMore,
    });
  },

  publish: async (input, imageTokens = []) => {
    set({ isPublishing: true });
    const result = await publishPost(input, imageTokens);
    set({ isPublishing: false });

    if (!result.ok) {
      set({ error: result.error.message });
      return false;
    }

    set({ posts: [result.data, ...get().posts], error: null });
    log.info('post_published', {});
    return true;
  },

  replacePost: (post) => {
    set({ posts: replacePost(get().posts, post) });
  },

  removePost: (postId) => {
    set({ posts: get().posts.filter((post) => post.id !== postId) });
  },

  prependPost: (post) => {
    set({ posts: [post, ...get().posts] });
  },

  adjustCommentCount: (postId, delta) => {
    set({
      posts: get().posts.map((post) =>
        post.id === postId
          ? { ...post, commentCount: Math.max(0, post.commentCount + delta) }
          : post,
      ),
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));

/**
 * The feed's sink, as a module-level constant so `usePostActions` does not see
 * a new object on every render.
 */
export const feedPostSink: PostSink = {
  replace: (post) => {
    useFeedStore.getState().replacePost(post);
  },
  remove: (postId) => {
    useFeedStore.getState().removePost(postId);
  },
  prepend: (post) => {
    useFeedStore.getState().prependPost(post);
  },
};

/**
 * The feed outlives every other list: a profile timeline or a single post page
 * is fetched fresh on mount, but the feed keeps its posts for the session. So
 * a change made anywhere else — a comment, a reaction, an edit — has to reach
 * the feed's copy too, or the timeline shows the old count until a reload.
 *
 * These wrap another list's own updaters so the feed hears the same change.
 * Each feed update is a no-op when the feed does not hold that post.
 */
export function mirroredToFeed(sink: PostSink): PostSink {
  const mirrored: PostSink = {
    replace: (post) => {
      sink.replace(post);
      feedPostSink.replace(post);
    },
    remove: (postId) => {
      sink.remove(postId);
      feedPostSink.remove(postId);
    },
  };

  const { prepend } = sink;
  if (prepend !== undefined) {
    mirrored.prepend = (post) => {
      prepend(post);
      // A new post of the viewer's own belongs on the home feed as well.
      useFeedStore.getState().prependPost(post);
    };
  }

  return mirrored;
}

export function mirrorCommentCountToFeed(
  adjust: (postId: string, delta: number) => void,
): (postId: string, delta: number) => void {
  return (postId, delta) => {
    adjust(postId, delta);
    useFeedStore.getState().adjustCommentCount(postId, delta);
  };
}
