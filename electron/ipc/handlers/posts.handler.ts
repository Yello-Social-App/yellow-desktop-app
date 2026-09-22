/**
 * Single-post reads and writes: fetch, edit, delete, repost, copy share link.
 *
 * Authorisation is not re-implemented here and must not be: the server decides
 * whether the caller may see or edit a post, and answers `POST_NOT_VISIBLE` or
 * `ACCESS_DENIED` when not. A client-side check would be advisory only (OWASP
 * A01), so these handlers pass the failure straight through instead of
 * pretending to enforce anything.
 *
 * Post ids arrive validated by `registerIpcHandler` and are percent-encoded by
 * `ENDPOINTS`, so a crafted id cannot address a different route (A05).
 */
import { clipboard } from 'electron';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { noContentSchema } from '../../api/envelope';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';
import { discardStagedImages, resolveStagedImages } from '../staged-images';

import {
  deletedResponseSchema,
  ipcFail,
  ipcOk,
  postIdRequestSchema,
  postResponseSchema,
  postSchema,
  repostRequestSchema,
  shareLinkCopiedResponseSchema,
  updatePostRequestSchema,
  type DeletedResponse,
  type IpcResult,
  type PostResponse,
  type ShareLinkCopiedResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.posts');

/** A 204 hands the parser `undefined`; nothing else is acceptable. */

export function registerPostHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.POSTS_GET,
    postIdRequestSchema,
    async ({ postId }): Promise<IpcResult<PostResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.posts.byId(postId),
        schema: postSchema,
      });

      return result.ok ? ipcOk(postResponseSchema.parse({ post: result.data })) : result;
    },
  );

  /**
   * The endpoint takes JSON or multipart on the same path. JSON is sent unless
   * there are files to append — every field is optional upstream, so only what
   * is actually changing goes in either body.
   */
  registerIpcHandler(
    IPC_CHANNELS.POSTS_UPDATE,
    updatePostRequestSchema,
    async ({
      postId,
      content,
      visibility,
      removeImageIds = [],
      imageTokens = [],
    }): Promise<IpcResult<PostResponse>> => {
      const parts = resolveStagedImages(imageTokens);
      if (!parts.ok) {
        return parts;
      }

      let body: unknown;
      if (parts.data.length === 0) {
        body = {
          ...(content === undefined ? {} : { content }),
          ...(visibility === undefined ? {} : { visibility }),
          ...(removeImageIds.length === 0 ? {} : { removeImageIds }),
        };
      } else {
        const form = new FormData();
        if (content !== undefined) {
          form.append('content', content);
        }
        if (visibility !== undefined) {
          form.append('visibility', visibility);
        }
        // `[]`-suffixed keys, repeated per item: that is how this server reads a list.
        for (const imageId of removeImageIds) {
          form.append('removeImageIds[]', imageId);
        }
        for (const part of parts.data) {
          form.append('images[]', part.blob, part.fileName);
        }
        body = form;
      }

      const result = await apiRequest({
        method: 'put',
        url: ENDPOINTS.posts.byId(postId),
        body,
        schema: postSchema,
      });

      if (!result.ok) {
        return result;
      }

      // Only once the server has them: a failed edit keeps its attachments.
      discardStagedImages(imageTokens);

      log.info('post_updated', {
        added: parts.data.length,
        removed: removeImageIds.length,
      });
      return ipcOk(postResponseSchema.parse({ post: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.POSTS_DELETE,
    postIdRequestSchema,
    async ({ postId }): Promise<IpcResult<DeletedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.posts.byId(postId),
        schema: noContentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('post_deleted', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.POSTS_REPOST,
    repostRequestSchema,
    async ({ postId, content }): Promise<IpcResult<PostResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.posts.repost(postId),
        body: content === undefined ? {} : { content },
        schema: postSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('post_reposted', {});
      return ipcOk(postResponseSchema.parse({ post: result.data }));
    },
  );

  /**
   * Copying is its own channel because the clipboard write has to happen here:
   * the page holds no clipboard permission under the default-deny policy. The
   * link is the `shareUrl` the server returns on the post, re-read here rather
   * than accepted from the renderer, so what lands on the clipboard is always
   * a URL the server just produced for this post id — the renderer never says
   * what gets written (OWASP A01). A non-public post fails here with
   * POST_NOT_VISIBLE for anyone but its author, which is the check that
   * decides whether sharing is offered at all.
   */
  registerIpcHandler(
    IPC_CHANNELS.POSTS_COPY_SHARE_LINK,
    postIdRequestSchema,
    async ({ postId }): Promise<IpcResult<ShareLinkCopiedResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.posts.byId(postId),
        schema: postSchema,
      });

      if (!result.ok) {
        return result;
      }

      const url = result.data.shareUrl;
      if (url === undefined) {
        return ipcFail('API', 'This post has no share link.');
      }

      // A clipboard the OS refuses is not worth failing the whole call over:
      // the URL still comes back, and the UI can show it (A10).
      let copied = true;
      try {
        await clipboard.writeText(url);
      } catch (error) {
        copied = false;
        log.warn('share_link_copy_failed', { error });
      }

      log.info('share_link_copied', { copied });
      return ipcOk(shareLinkCopiedResponseSchema.parse({ url, copied }));
    },
  );
}
