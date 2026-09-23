/**
 * Stories: the rings, one user's ring, one story, posting, marking seen, the
 * owner's viewer list and archive, deleting, and replying.
 *
 * A photo story's image is staged first, through the same picker a post uses
 * (feed.handler.ts, purpose `story`), so the renderer hands back a token and
 * never a path or the bytes (OWASP A01). The owner, viewer and replier are
 * always the token's user upstream; nothing here sends a user id of its own.
 *
 * A reply is sent here but delivered by chat: the `202` only says the API
 * accepted it, and the DM itself arrives as `message.new` on the socket, where
 * the messages store picks it up like any other line.
 */
import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { noContentSchema } from '../../api/envelope';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';
import { discardStagedImages, resolveStagedImages } from '../staged-images';

import {
  createStoryRequestSchema,
  deletedResponseSchema,
  emptyRequestSchema,
  ipcFail,
  ipcOk,
  replyToStoryRequestSchema,
  storyArchiveRequestSchema,
  storyFeedPageSchema,
  storyFeedRequestSchema,
  storyIdRequestSchema,
  storyPageSchema,
  storyReplyAcceptedSchema,
  storyRowsSchema,
  storySchema,
  storyViewerPageSchema,
  storyViewersRequestSchema,
  userStoriesRequestSchema,
  type AcknowledgedResponse,
  type CreateStoryRequest,
  type DeletedResponse,
  type IpcResult,
  type StoryFeedPage,
  type StoryList,
  type StoryPage,
  type StoryReplyAccepted,
  type StoryResponse,
  type StoryViewerPage,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.stories');

/**
 * The body for a new story: JSON for text, multipart for a photo. Only the
 * documented fields go — `expiresAt`, the author and the counts are the
 * server's to set.
 */
function createBodyOf(request: CreateStoryRequest): IpcResult<unknown> {
  if (request.type === 'TEXT') {
    return ipcOk({
      type: 'TEXT',
      text: request.text,
      background: request.background,
      visibility: request.visibility,
    });
  }

  const staged = resolveStagedImages([request.imageToken]);
  if (!staged.ok) {
    return staged;
  }
  const [image] = staged.data;
  if (image === undefined) {
    return ipcFail('INVALID_PAYLOAD', 'Choose a photo for your story.');
  }

  const form = new FormData();
  form.append('type', 'IMAGE');
  // One part, keyed `image` — not `image[]` as a post's are.
  form.append('image', image.blob, image.fileName);
  if (request.text !== undefined && request.text !== '') {
    form.append('text', request.text);
  }
  form.append('visibility', request.visibility);
  return ipcOk(form);
}

export function registerStoryHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.STORIES_FEED,
    storyFeedRequestSchema,
    async ({ page, size }): Promise<IpcResult<StoryFeedPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.stories.feed,
        schema: storyFeedPageSchema,
        params: { page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_MINE,
    emptyRequestSchema,
    async (): Promise<IpcResult<StoryList>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.stories.mine,
        schema: storyRowsSchema,
      });
      return result.ok ? ipcOk({ stories: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_OF_USER,
    userStoriesRequestSchema,
    async ({ userId }): Promise<IpcResult<StoryList>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.users.stories(userId),
        schema: storyRowsSchema,
      });
      return result.ok ? ipcOk({ stories: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_GET,
    storyIdRequestSchema,
    async ({ storyId }): Promise<IpcResult<StoryResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.stories.byId(storyId),
        schema: storySchema,
      });
      return result.ok ? ipcOk({ story: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_CREATE,
    createStoryRequestSchema,
    async (request): Promise<IpcResult<StoryResponse>> => {
      const body = createBodyOf(request);
      if (!body.ok) {
        return body;
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.stories.create,
        body: body.data,
        schema: storySchema,
      });

      if (!result.ok) {
        // A staged photo stays, so a retry after a refusal needs no re-pick.
        log.info('story_create_failed', { type: request.type, apiCode: result.error.apiCode });
        return result;
      }

      if (request.type === 'IMAGE') {
        discardStagedImages([request.imageToken]);
      }
      log.info('story_created', { type: request.type, visibility: request.visibility });
      return ipcOk({ story: result.data });
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_MARK_SEEN,
    storyIdRequestSchema,
    async ({ storyId }): Promise<IpcResult<AcknowledgedResponse>> => {
      // 204 and idempotent; the caller's own story is a no-op upstream.
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.stories.view(storyId),
        schema: noContentSchema,
      });
      return result.ok ? ipcOk({ acknowledged: true }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_VIEWERS,
    storyViewersRequestSchema,
    async ({ storyId, page, size }): Promise<IpcResult<StoryViewerPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.stories.viewers(storyId),
        schema: storyViewerPageSchema,
        params: { page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_ARCHIVE,
    storyArchiveRequestSchema,
    async ({ page, size, type }): Promise<IpcResult<StoryPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.stories.archive,
        schema: storyPageSchema,
        params: { page, size, ...(type === undefined ? {} : { type }) },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_DELETE,
    storyIdRequestSchema,
    async ({ storyId }): Promise<IpcResult<DeletedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.stories.byId(storyId),
        schema: noContentSchema,
      });
      if (!result.ok) {
        return result;
      }
      log.info('story_deleted', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STORIES_REPLY,
    replyToStoryRequestSchema,
    async ({ storyId, text, clientId }): Promise<IpcResult<StoryReplyAccepted>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.stories.replies(storyId),
        body: { text, clientId },
        schema: storyReplyAcceptedSchema,
      });
      // Never the text: that is a private message (A09).
      log.info(result.ok ? 'story_reply_accepted' : 'story_reply_failed', {
        ...(result.ok ? {} : { apiCode: result.error.apiCode }),
      });
      return result;
    },
  );
}
