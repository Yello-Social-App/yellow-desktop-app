/**
 * Comment-thread state, keyed by post id.
 *
 * One store rather than per-card component state: several threads can be open
 * at once in the timeline, a thread has to survive the card re-rendering as the
 * feed refreshes, and the same post appears on both the home feed and a
 * profile. A `Record<postId, ThreadState>` is the smallest shape that gives all
 * three, and it matches the store vocabulary the feed and notifications already
 * use. Rejected: keeping threads in the feed store, which would tie comments to
 * a list the profile pages do not use.
 *
 * A thread remembers what it hangs off (`parentType`), set when it is opened,
 * so paging and replying reach the same route without every caller repeating
 * it. Post and community-post ids are both server UUIDs, so one keyspace holds
 * both kinds.
 *
 * The post's own `commentCount` is *not* updated here — that record belongs to
 * whichever list holds the post, so `submit` and `remove` report what changed
 * and the caller applies it.
 */
import type { Comment, CommentParentType, ReactionType } from '@shared/ipc-types';
import { create } from 'zustand';

import { createLogger } from '@/lib/logger';

import {
  addComment,
  deleteComment,
  editComment,
  fetchComments,
  toggleCommentReaction,
} from './api';
import { flattenThread, replyRootOf } from './types';
import { PRIMARY_REACTION } from '@/features/feed/types';

const log = createLogger('comments.store');

export type ThreadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ThreadState {
  parentType: CommentParentType;
  items: Comment[];
  status: ThreadStatus;
  error: string | null;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  isSubmitting: boolean;
  /**
   * The comment being replied to, or null for a reply to the post itself.
   * May itself be a reply: the API nests one level, so the new comment then
   * attaches to that reply's parent, and the person is addressed by name.
   */
  replyTo: Comment | null;
  /** Comment ids with an in-flight delete or reaction. */
  pendingIds: ReadonlySet<string>;
}

const EMPTY_THREAD: ThreadState = {
  parentType: 'POST',
  items: [],
  status: 'idle',
  error: null,
  page: 0,
  hasMore: false,
  isLoadingMore: false,
  isSubmitting: false,
  replyTo: null,
  pendingIds: new Set(),
};

interface CommentsState {
  threads: Readonly<Record<string, ThreadState>>;
  /** Loads page 0 unless the thread is already loaded. */
  open: (postId: string, parentType: CommentParentType) => Promise<void>;
  reload: (postId: string, parentType: CommentParentType) => Promise<void>;
  loadMore: (postId: string) => Promise<void>;
  setReplyTo: (postId: string, comment: Comment | null) => void;
  /** Resolves to the new comment, or null when the post rejected it. */
  submit: (postId: string, content: string) => Promise<Comment | null>;
  /** Resolves true when the server took the new text. */
  edit: (postId: string, commentId: string, content: string) => Promise<boolean>;
  /** Resolves true when the comment (and any replies shown under it) went. */
  remove: (postId: string, commentId: string) => Promise<boolean>;
  toggleReaction: (postId: string, commentId: string, type?: ReactionType) => Promise<void>;
  clearError: (postId: string) => void;
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

export const useCommentsStore = create<CommentsState>((set, get) => {
  /** Reads a thread, defaulting rather than throwing on an unopened post. */
  function threadOf(postId: string): ThreadState {
    return get().threads[postId] ?? EMPTY_THREAD;
  }

  function patch(postId: string, changes: Partial<ThreadState>): void {
    set((state) => ({
      threads: {
        ...state.threads,
        [postId]: { ...(state.threads[postId] ?? EMPTY_THREAD), ...changes },
      },
    }));
  }

  async function loadPage(postId: string, page: number): Promise<void> {
    const result = await fetchComments(threadOf(postId).parentType, postId, page);

    if (!result.ok) {
      patch(postId, {
        status: page === 0 ? 'error' : threadOf(postId).status,
        error: result.error.message,
        isLoadingMore: false,
      });
      return;
    }

    // Held flat, replies after their parent; the tree is rebuilt for display.
    const existing = page === 0 ? [] : threadOf(postId).items;
    patch(postId, {
      items: [...existing, ...flattenThread(result.data.content)],
      page: result.data.page,
      hasMore: !result.data.last,
      status: 'ready',
      error: null,
      isLoadingMore: false,
    });
  }

  return {
    threads: {},

    open: async (postId, parentType) => {
      const thread = threadOf(postId);
      if (thread.status === 'ready' || thread.status === 'loading') {
        return;
      }
      patch(postId, { parentType, status: 'loading', error: null, page: 0 });
      await loadPage(postId, 0);
    },

    reload: async (postId, parentType) => {
      patch(postId, { parentType, status: 'loading', error: null, page: 0 });
      await loadPage(postId, 0);
    },

    loadMore: async (postId) => {
      const { hasMore, isLoadingMore, page } = threadOf(postId);
      if (!hasMore || isLoadingMore) {
        return;
      }
      patch(postId, { isLoadingMore: true });
      await loadPage(postId, page + 1);
    },

    setReplyTo: (postId, comment) => {
      patch(postId, { replyTo: comment });
    },

    submit: async (postId, content) => {
      const thread = threadOf(postId);
      if (thread.isSubmitting) {
        return null;
      }

      patch(postId, { isSubmitting: true, error: null });
      const parentId = replyRootOf(thread.replyTo);
      const result = await addComment(thread.parentType, postId, content, parentId);

      if (!result.ok) {
        patch(postId, { isSubmitting: false, error: result.error.message });
        return null;
      }

      // Where it lands follows the server's order: top-level comments read
      // newest first, so a new one leads; replies read oldest first under
      // their parent, so a new one trails.
      const items = threadOf(postId).items;
      patch(postId, {
        items: parentId === undefined ? [result.data, ...items] : [...items, result.data],
        isSubmitting: false,
        replyTo: null,
      });
      log.info('comment_added', { reply: parentId !== undefined });
      return result.data;
    },

    edit: async (postId, commentId, content) => {
      if (threadOf(postId).pendingIds.has(commentId)) {
        return false;
      }

      patch(postId, { pendingIds: withPending(threadOf(postId).pendingIds, commentId, true) });
      const result = await editComment(commentId, content);

      if (!result.ok) {
        patch(postId, {
          pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
          error: result.error.message,
        });
        return false;
      }

      // The server's record replaces ours, minus the nested replies the plain
      // comment shape drops — those are already rows of their own here.
      patch(postId, {
        items: threadOf(postId).items.map((item) =>
          item.id === commentId ? { ...item, content: result.data.content } : item,
        ),
        pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
      });
      log.info('comment_edited', {});
      return true;
    },

    remove: async (postId, commentId) => {
      if (threadOf(postId).pendingIds.has(commentId)) {
        return false;
      }

      patch(postId, { pendingIds: withPending(threadOf(postId).pendingIds, commentId, true) });
      const result = await deleteComment(commentId);

      if (!result.ok) {
        patch(postId, {
          pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
          error: result.error.message,
        });
        return false;
      }

      // Replies to a deleted comment go with it server-side; drop them here too
      // rather than leaving rows pointing at a parent that no longer exists.
      patch(postId, {
        items: threadOf(postId).items.filter(
          (item) => item.id !== commentId && item.parentCommentId !== commentId,
        ),
        pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
        replyTo: threadOf(postId).replyTo?.id === commentId ? null : threadOf(postId).replyTo,
      });
      return true;
    },

    toggleReaction: async (postId, commentId, type) => {
      const existing = threadOf(postId).items.find((item) => item.id === commentId);
      if (existing === undefined || threadOf(postId).pendingIds.has(commentId)) {
        return;
      }

      const current = existing.viewerReaction ?? null;
      // The server removes when sent the type already held and sets it
      // otherwise, so clearing means sending back whatever the viewer had.
      const sent = type ?? current ?? PRIMARY_REACTION;
      const next = sent === current ? null : sent;
      const countDelta = next === null ? -1 : current === null ? 1 : 0;

      // Optimistic: repaint now, reconcile with the server's summary below.
      patch(postId, {
        items: threadOf(postId).items.map((item) =>
          item.id === commentId
            ? {
                ...item,
                viewerReaction: next,
                reactionCount: Math.max(0, item.reactionCount + countDelta),
              }
            : item,
        ),
        pendingIds: withPending(threadOf(postId).pendingIds, commentId, true),
      });

      const result = await toggleCommentReaction(commentId, sent);

      if (!result.ok) {
        // Roll back to the last state the server confirmed.
        patch(postId, {
          items: threadOf(postId).items.map((item) => (item.id === commentId ? existing : item)),
          pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
          error: result.error.message,
        });
        return;
      }

      patch(postId, {
        items: threadOf(postId).items.map((item) =>
          item.id === commentId
            ? {
                ...item,
                reactionCount: result.data.total,
                viewerReaction: result.data.viewerReaction ?? null,
              }
            : item,
        ),
        pendingIds: withPending(threadOf(postId).pendingIds, commentId, false),
      });
    },

    clearError: (postId) => {
      patch(postId, { error: null });
    },
  };
});

export { EMPTY_THREAD };
