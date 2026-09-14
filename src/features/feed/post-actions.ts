/**
 * Everything a post card can do to a post: react, edit, delete, repost, copy a
 * share link.
 *
 * The problem shape is one set of operations against several different lists —
 * the home feed lives in a zustand store, a profile timeline in local state,
 * and both render the same card. So the mutations take a *sink*: where an
 * updated, removed or new post should land. That is a Strategy in its ordinary
 * TypeScript spelling (an object of functions), which is what keeps the feed
 * from being the only list whose buttons work. Rejected: putting these on the
 * feed store, which is how liking from a profile silently did nothing.
 *
 * Authorisation is not decided here. `canEdit` only chooses whether to *show* a
 * control; the server rejects an edit or delete by a non-author with
 * `ACCESS_DENIED` regardless (OWASP A01).
 */
import type { Post, UpdatePostRequest } from '@shared/ipc-types';
import { useCallback, useState } from 'react';

import {
  copyShareLink,
  deletePost as deletePostRequest,
  editPost,
  repost as repostRequest,
  toggleReaction as toggleReactionRequest,
  type FeedError,
} from './api';
import { PRIMARY_REACTION } from './types';

/** Where the result of a mutation goes. */
export interface PostSink {
  replace: (post: Post) => void;
  remove: (postId: string) => void;
  /** Absent on lists a new post does not belong to, such as another user's timeline. */
  prepend?: (post: Post) => void;
}

export type PostEdit = Omit<UpdatePostRequest, 'postId'>;

export interface PostActions {
  toggleReaction: (post: Post) => Promise<void>;
  save: (post: Post, changes: PostEdit) => Promise<boolean>;
  remove: (post: Post) => Promise<boolean>;
  repost: (post: Post, content?: string) => Promise<boolean>;
  /** Copies the link in the main process and returns it for the confirmation. */
  copyLink: (post: Post) => Promise<string | null>;
  /** The post id with an operation in flight, so one card can show its own state. */
  pendingPostId: string | null;
  error: FeedError | null;
  clearError: () => void;
}

/**
 * `isOwner` is the server's answer and is preferred; the author check is the
 * fallback for a record that predates the field.
 */
export function canEdit(post: Post, viewerId: string | undefined): boolean {
  return post.isOwner || (viewerId !== undefined && post.author.id === viewerId);
}

export function usePostActions(sink: PostSink): PostActions {
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [error, setError] = useState<FeedError | null>(null);

  const toggleReaction = useCallback(
    async (post: Post) => {
      const current = post.viewerReaction ?? null;

      // Optimistic: repaint now, reconcile with the server's summary below.
      sink.replace({ ...post, viewerReaction: current === null ? PRIMARY_REACTION : null });

      // The toggle removes when sent the type already held — so to clear a
      // LOVE the heart must send LOVE, not LIKE, or it would change it instead.
      const result = await toggleReactionRequest(post.id, current ?? PRIMARY_REACTION);

      if (!result.ok) {
        // Roll back to the last state the server confirmed.
        sink.replace(post);
        setError(result.error);
        return;
      }

      sink.replace({
        ...post,
        reactionCounts: { ...result.data.counts, total: result.data.total },
        viewerReaction: result.data.viewerReaction ?? null,
      });
    },
    [sink],
  );

  const save = useCallback(
    async (post: Post, changes: PostEdit) => {
      setPendingPostId(post.id);
      setError(null);
      const result = await editPost(post.id, changes);
      setPendingPostId(null);

      if (!result.ok) {
        setError(result.error);
        return false;
      }

      sink.replace(result.data);
      return true;
    },
    [sink],
  );

  const remove = useCallback(
    async (post: Post) => {
      setPendingPostId(post.id);
      setError(null);
      const result = await deletePostRequest(post.id);
      setPendingPostId(null);

      if (!result.ok) {
        setError(result.error);
        return false;
      }

      sink.remove(post.id);
      return true;
    },
    [sink],
  );

  const repost = useCallback(
    async (post: Post, content?: string) => {
      setPendingPostId(post.id);
      setError(null);
      const result = await repostRequest(post.id, content);
      setPendingPostId(null);

      if (!result.ok) {
        setError(result.error);
        return false;
      }

      // The repost is a post of the viewer's own, so it belongs at the top of a
      // list that shows their posts, and the quoted original's count moves.
      sink.prepend?.(result.data);
      sink.replace({ ...post, repostCount: post.repostCount + 1 });
      return true;
    },
    [sink],
  );

  const copyLink = useCallback(async (post: Post) => {
    setPendingPostId(post.id);
    setError(null);
    const result = await copyShareLink(post.id);
    setPendingPostId(null);

    if (!result.ok) {
      setError(result.error);
      return null;
    }

    return result.data.url;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    toggleReaction,
    save,
    remove,
    repost,
    copyLink,
    pendingPostId,
    error,
    clearError,
  };
}
