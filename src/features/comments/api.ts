/**
 * Comment operations, as seen by the renderer: one allowlisted IPC call each.
 *
 * Reactions are addressed by `{targetType, targetId}` because the API attaches
 * them to posts as well as comments; the helpers here fix the target type so
 * callers pass a comment id and nothing more.
 */
import type {
  Comment,
  CommentPage,
  IpcError,
  ReactionSummary,
  ReactionType,
} from '@shared/ipc-types';

import { PRIMARY_REACTION } from '@/features/feed/types';
import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { COMMENTS_PAGE_SIZE } from './types';

export type CommentsError = IpcError;

/** Top-level comments, newest first, each with its replies nested oldest first. */
export async function fetchComments(
  postId: string,
  page = 0,
  size: number = COMMENTS_PAGE_SIZE,
): Promise<Result<CommentPage, CommentsError>> {
  const result = await ipc.listComments({ postId, page, size });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** Supply `parentCommentId` to reply to a comment rather than to the post. */
export async function addComment(
  postId: string,
  content: string,
  parentCommentId?: string,
): Promise<Result<Comment, CommentsError>> {
  const result = await ipc.createComment({
    postId,
    content,
    ...(parentCommentId === undefined ? {} : { parentCommentId }),
  });
  return result.ok ? ok(result.data.comment) : fail(result.error);
}

/** Allowed for the comment's author and for the post's author. */
export async function deleteComment(commentId: string): Promise<Result<true, CommentsError>> {
  const result = await ipc.deleteComment({ commentId });
  return result.ok ? ok(true) : fail(result.error);
}

/**
 * Adds, changes or removes in one call: the server compares `type` with the
 * viewer's current reaction. Sending the type already held removes it.
 */
export async function toggleCommentReaction(
  commentId: string,
  type: ReactionType = PRIMARY_REACTION,
): Promise<Result<ReactionSummary, CommentsError>> {
  const result = await ipc.toggleReaction({ targetType: 'COMMENT', targetId: commentId, type });
  return result.ok ? ok(result.data) : fail(result.error);
}
