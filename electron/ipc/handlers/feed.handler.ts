/**
 * The feed, staging post images, and creating posts.
 *
 * The feed is the API's one cursor-paginated endpoint: pages are keyed by the
 * previous response's `nextCursor` rather than an offset, so a post arriving
 * mid-scroll cannot shift a page boundary and duplicate a row.
 *
 * Images are staged before they are posted, the same two-step shape the avatar
 * upload uses: the picker runs here, the bytes stay here (staged-images.ts),
 * and the renderer gets a token and a thumbnail. It never names a path (OWASP
 * A01) and never holds the bytes — and the user gets to look at what they
 * picked before it is published.
 *
 * Single-post reads and edits live in posts.handler.ts; reactions in
 * reactions.handler.ts.
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { pickImageFiles, readImagePart, toPreviewDataUrl } from '../image-picker';
import { registerIpcHandler } from '../register';
import {
  discardStagedImages,
  remainingStagingCapacity,
  resolveStagedImages,
  stageImage,
} from '../staged-images';

import {
  acknowledgedResponseSchema,
  createPostRequestSchema,
  discardImagesRequestSchema,
  feedRequestSchema,
  feedResponseSchema,
  ipcOk,
  POST_MAX_IMAGES,
  postResponseSchema,
  postSchema,
  stageImagesRequestSchema,
  stageImagesResponseSchema,
  type AcknowledgedResponse,
  type FeedResponse,
  type IpcResult,
  type PostResponse,
  type StageImagesResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.feed');

const cursorPageSchema = z.object({
  content: z
    .array(postSchema)
    .nullish()
    .transform((value) => value ?? []),
  nextCursor: z.string().nullish(),
  hasMore: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
});

export function registerFeedHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.FEED_LIST,
    feedRequestSchema,
    async ({ cursor, size }): Promise<IpcResult<FeedResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.feed.list,
        schema: cursorPageSchema,
        params: { size, ...(cursor === undefined ? {} : { cursor }) },
      });

      if (!result.ok) {
        return result;
      }

      log.info('feed_loaded', { count: result.data.content.length });
      return ipcOk(
        feedResponseSchema.parse({
          posts: result.data.content,
          nextCursor: result.data.nextCursor ?? null,
          hasMore: result.data.hasMore,
        }),
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.FEED_STAGE_IMAGES,
    stageImagesRequestSchema,
    async (request, event): Promise<IpcResult<StageImagesResponse>> => {
      const paths = await pickImageFiles(event, {
        title: 'Choose images for your post',
        multiple: true,
        limit: POST_MAX_IMAGES,
      });

      if (paths.length === 0) {
        return ipcOk(stageImagesResponseSchema.parse({ images: [], cancelled: true, skipped: 0 }));
      }

      // Whatever is already staged is already attached somewhere, so the room
      // left here is the room left there — and an editor may have less still,
      // because of the images its post already carries.
      const capacity = Math.min(request?.limit ?? POST_MAX_IMAGES, remainingStagingCapacity());
      const accepted = paths.slice(0, capacity);
      const images = [];

      for (const filePath of accepted) {
        const part = await readImagePart(filePath);
        if (!part.ok) {
          return part;
        }

        // The thumbnail is derived from the same bytes that will be uploaded,
        // so what the user approves is exactly what gets sent.
        const bytes = Buffer.from(await part.data.blob.arrayBuffer());
        images.push({
          token: stageImage(part.data),
          fileName: part.data.fileName,
          previewDataUrl: toPreviewDataUrl(bytes, part.data.blob.type),
          byteSize: part.data.byteLength,
        });
      }

      log.info('post_images_staged', { count: images.length });
      return ipcOk(
        stageImagesResponseSchema.parse({
          images,
          cancelled: false,
          skipped: paths.length - accepted.length,
        }),
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.FEED_DISCARD_IMAGES,
    discardImagesRequestSchema,
    ({ tokens }): IpcResult<AcknowledgedResponse> => {
      discardStagedImages(tokens);
      return ipcOk(acknowledgedResponseSchema.parse({ acknowledged: true }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.FEED_CREATE_POST,
    createPostRequestSchema,
    async ({ content, visibility, imageTokens }): Promise<IpcResult<PostResponse>> => {
      // The endpoint is multipart even with no image attached.
      const form = new FormData();
      form.append('content', content);
      form.append('visibility', visibility);

      const parts = resolveStagedImages(imageTokens);
      if (!parts.ok) {
        return parts;
      }

      for (const part of parts.data) {
        form.append('images', part.blob, part.fileName);
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.posts.create,
        body: form,
        schema: postSchema,
      });

      if (!result.ok) {
        return result;
      }

      // Only once the server has them: a failed post keeps its attachments, so
      // retrying does not mean picking every file again.
      discardStagedImages(imageTokens);

      log.info('post_created', { images: result.data.images.length });
      return ipcOk(postResponseSchema.parse({ post: result.data }));
    },
  );
}
