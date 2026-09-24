/**
 * Comments on posts and on community posts, and replies to comments.
 *
 * The list endpoint pages top-level comments, newest first, with each one's
 * replies nested underneath (oldest first, one level deep). A page is therefore
 * a complete thread for the comments on it; this layer hands it back as sent
 * and lets the UI decide how to hold it.
 *
 * Both kinds of post share the comment shape and everything addressed by
 * comment id (edit, delete, react); only listing and creating are routed by
 * `parentType`.
 */

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { noContentSchema } from '../../api/envelope';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  commentPageSchema,
  commentResponseSchema,
  commentSchema,
  createCommentRequestSchema,
  deleteCommentRequestSchema,
  deletedResponseSchema,
  ipcOk,
  listCommentsRequestSchema,
  updateCommentRequestSchema,
  type CommentPage,
  type CommentParentType,
  type CommentResponse,
  type DeletedResponse,
  type IpcResult,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.comments');

function threadUrl(parentType: CommentParentType, postId: string): string {
  return parentType === 'COMMUNITY_POST'
    ? ENDPOINTS.communityPosts.comments(postId)
    : ENDPOINTS.posts.comments(postId);
}

export function registerCommentHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.COMMENTS_CREATE,
    createCommentRequestSchema,
    async ({
      parentType,
      postId,
      content,
      parentCommentId,
    }): Promise<IpcResult<CommentResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: threadUrl(parentType, postId),
        body: {
          content,
          ...(parentCommentId === undefined ? {} : { parentCommentId }),
        },
        schema: commentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('comment_created', { parentType, reply: parentCommentId !== undefined });
      return ipcOk(commentResponseSchema.parse({ comment: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMENTS_LIST,
    listCommentsRequestSchema,
    async ({ parentType, postId, page, size }): Promise<IpcResult<CommentPage>> =>
      apiRequest({
        method: 'get',
        url: threadUrl(parentType, postId),
        schema: commentPageSchema,
        params: { page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMENTS_UPDATE,
    updateCommentRequestSchema,
    async ({ commentId, content }): Promise<IpcResult<CommentResponse>> => {
      // Only the commenter may edit; the server answers ACCESS_DENIED otherwise.
      const result = await apiRequest({
        method: 'put',
        url: ENDPOINTS.comments.byId(commentId),
        body: { content },
        schema: commentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('comment_updated', {});
      return ipcOk(commentResponseSchema.parse({ comment: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMENTS_DELETE,
    deleteCommentRequestSchema,
    async ({ commentId }): Promise<IpcResult<DeletedResponse>> => {
      // The server allows the comment's author, the post's (or community
      // post's) author and moderators; deciding which the caller is belongs
      // there, not in the client (A01).
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.comments.byId(commentId),
        schema: noContentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('comment_deleted', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );
}
