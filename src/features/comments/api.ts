/**
 * Comment operations, as seen by the renderer: one allowlisted IPC call each.
 *
 * A thread hangs off either a post or a community post (`parentType`); that
 * only decides where listing and creating go. Everything after — edit,
 * delete, react — is addressed by comment id alone.
 *
 * Reactions are addressed by `{targetType, targetId}` because the API attaches
 * them to posts as well as comments; the helpers here fix the target type so
 * callers pass a comment id and nothing more.
 */
import type {
  Comment,
  CommentPage,
  CommentParentType,
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
  parentType: CommentParentType,
  postId: string,
  page = 0,
  size: number = COMMENTS_PAGE_SIZE,
): Promise<Result<CommentPage, CommentsError>> {
  const result = await ipc.listComments({ parentType, postId, page, size });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** Supply `parentCommentId` to reply to a comment rather than to the post. */
export async function addComment(
  parentType: CommentParentType,
  postId: string,
  content: string,
  parentCommentId?: string,
): Promise<Result<Comment, CommentsError>> {
  const result = await ipc.createComment({
    parentType,
    postId,
    content,
    ...(parentCommentId === undefined ? {} : { parentCommentId }),
  });
  return result.ok ? ok(result.data.comment) : fail(result.error);
}

/** Only the comment's author may edit; the server answers ACCESS_DENIED otherwise. */
export async function editComment(
  commentId: string,
  content: string,
): Promise<Result<Comment, CommentsError>> {
  const result = await ipc.updateComment({ commentId, content });
  return result.ok ? ok(result.data.comment) : fail(result.error);
}

/** Allowed for the comment's author, the post's author, and moderators. */
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
