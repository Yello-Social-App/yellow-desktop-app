/**
 * Comment hooks: one thread's state and the actions that change it, so the
 * components stay presentational.
 */
import type { ReactionType } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo } from 'react';

import { useCommentsStore, EMPTY_THREAD, type ThreadState } from './store';
import { toThread, type CommentNode } from './types';

export interface CommentThread extends ThreadState {
  /** Top-level comments with their replies grouped underneath. */
  nodes: CommentNode[];
}

/**
 * Loads the thread for `postId` on mount and returns its state. `enabled` is
 * how a collapsed card avoids fetching a thread nobody has opened.
 */
export function useCommentThread(postId: string, enabled: boolean): CommentThread {
  const thread = useCommentsStore((state) => state.threads[postId]) ?? EMPTY_THREAD;
  const open = useCommentsStore((state) => state.open);

  useEffect(() => {
    if (enabled) {
      void open(postId);
    }
  }, [enabled, open, postId]);

  const nodes = useMemo(() => toThread(thread.items), [thread.items]);

  return { ...thread, nodes };
}

export interface CommentActions {
  submit: (content: string) => Promise<boolean>;
  edit: (commentId: string, content: string) => Promise<boolean>;
  remove: (commentId: string) => Promise<boolean>;
  toggleReaction: (commentId: string, type?: ReactionType) => void;
  setReplyTo: (commentId: string | null) => void;
  loadMore: () => void;
  clearError: () => void;
}

/**
 * Actions bound to one post. `onCountChange` carries the delta back to whoever
 * owns the post record, since `commentCount` lives on the post rather than in
 * the thread.
 */
export function useCommentActions(
  postId: string,
  onCountChange: (delta: number) => void,
): CommentActions {
  // Selected one at a time rather than taking the whole store: zustand action
  // identities are stable, so these callbacks are not rebuilt every time any
  // thread anywhere changes.
  const submitComment = useCommentsStore((state) => state.submit);
  const editStoredComment = useCommentsStore((state) => state.edit);
  const removeComment = useCommentsStore((state) => state.remove);
  const toggleCommentReaction = useCommentsStore((state) => state.toggleReaction);
  const setThreadReplyTo = useCommentsStore((state) => state.setReplyTo);
  const loadMoreComments = useCommentsStore((state) => state.loadMore);
  const clearThreadError = useCommentsStore((state) => state.clearError);

  const submit = useCallback(
    async (content: string) => {
      const comment = await submitComment(postId, content);
      if (comment === null) {
        return false;
      }
      onCountChange(1);
      return true;
    },
    [submitComment, postId, onCountChange],
  );

  const edit = useCallback(
    (commentId: string, content: string) => editStoredComment(postId, commentId, content),
    [editStoredComment, postId],
  );

  const remove = useCallback(
    async (commentId: string) => {
      // Count the replies that go with it, so the post's total stays honest.
      const thread = useCommentsStore.getState().threads[postId] ?? EMPTY_THREAD;
      const removedCount =
        1 + thread.items.filter((item) => item.parentCommentId === commentId).length;

      const deleted = await removeComment(postId, commentId);
      if (deleted) {
        onCountChange(-removedCount);
      }
      return deleted;
    },
    [removeComment, postId, onCountChange],
  );

  const toggleReaction = useCallback(
    (commentId: string, type?: ReactionType) => {
      void toggleCommentReaction(postId, commentId, type);
    },
    [toggleCommentReaction, postId],
  );

  const setReplyTo = useCallback(
    (commentId: string | null) => {
      const thread = useCommentsStore.getState().threads[postId] ?? EMPTY_THREAD;
      const target =
        commentId === null ? null : (thread.items.find((item) => item.id === commentId) ?? null);
      setThreadReplyTo(postId, target);
    },
    [setThreadReplyTo, postId],
  );

  const loadMore = useCallback(() => {
    void loadMoreComments(postId);
  }, [loadMoreComments, postId]);

  const clearError = useCallback(() => {
    clearThreadError(postId);
  }, [clearThreadError, postId]);

  return { submit, edit, remove, toggleReaction, setReplyTo, loadMore, clearError };
}
