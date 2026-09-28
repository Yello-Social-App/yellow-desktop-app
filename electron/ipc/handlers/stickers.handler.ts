/**
 * Stickers: making one from a picture, the caller's library, recent, packs,
 * and keeping a sticker someone else sent.
 *
 * Making one is two calls by the service's design — upload the picture as a
 * draft, which answers both versions (whole, and cut out), then save the
 * draft with the version chosen — so switching between them in the dialog
 * costs no second upload.
 *
 * Before that, the person crops the picture, in the page. So the picture
 * travels twice. First to the page, to crop: from the OS picker (the main
 * process reads what the user pointed at, so the page never names a path,
 * A01) or the clipboard (read here, on a click) — checked for size and
 * format, scaled down, and handed over as a `data:` URL. A dropped or pasted
 * picture the page reads itself. Then the cropped square comes back as bytes,
 * which are checked again — size, format from the leading bytes, pixel budget
 * — before they are uploaded; the service decodes and re-encodes them once
 * more on its side (A05/A08).
 *
 * Which library a sticker is in, and whether a message's sticker may be kept,
 * are the service's calls: it answers 404 for anything that is not the
 * caller's, and nothing here pre-empts that (A01).
 */
import { readFile, stat } from 'node:fs/promises';

import { clipboard, nativeImage } from 'electron';
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { noContentSchema } from '../../api/envelope';
import { apiRequest, apiRequestWithStatus } from '../../api/http-client';
import { stickerSourcePart } from '../../chat/files';
import { IPC_CHANNELS } from '../channels';
import { pickImageFiles, toPreviewDataUrl } from '../image-picker';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  chatMessageRefSchema,
  emptyRequestSchema,
  ipcFail,
  ipcOk,
  listMyStickersRequestSchema,
  renameStickerRequestSchema,
  saveStickerRequestSchema,
  STICKER_CROP_SOURCE_MAX_EDGE,
  STICKER_PICTURE_MAX_BYTES,
  STICKER_SOURCE_MAX_BYTES,
  STICKER_SOURCE_MAX_EDGE,
  STICKER_SOURCE_MAX_PIXELS,
  stickerDraftFromBytesRequestSchema,
  stickerDraftSchema,
  stickerIdRequestSchema,
  stickerPackSchema,
  stickerPageSchema,
  stickerSchema,
  type AcknowledgedResponse,
  type IpcResult,
  type SavedStickerResponse,
  type StickerDraftResponse,
  type StickerListResponse,
  type StickerPacksResponse,
  type StickerPage,
  type StickerResponse,
  type StickerSourceResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.stickers');

/** Upload plus, once the service turns it on, background removal. */
const DRAFT_TIMEOUT_MS = 60_000;
/** A full library is two pages at the service's cap. */
const MY_STICKERS_PAGE_SIZE = 100;
const RECENT_STICKERS_SIZE = 24;
/** The picker offers only what the service takes. */
const STICKER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
/** The status a save-from-message answers when the sticker was already yours. */
const HTTP_OK = 200;

const recentListSchema = z.array(stickerSchema).max(50);
const packListSchema = z.array(stickerPackSchema).max(100);

const TOO_LARGE: IpcResult<never> = ipcFail('INVALID_PAYLOAD', 'That picture is over 5 MB.', {
  apiReason: 'PAYLOAD_TOO_LARGE',
});
const PICTURE_TOO_LARGE: IpcResult<never> = ipcFail(
  'INVALID_PAYLOAD',
  'That picture is over 10 MB.',
  { apiReason: 'PICTURE_TOO_LARGE' },
);

/**
 * The pixel budget, when the platform decoder can read the picture. One it
 * cannot (WebP on some platforms) goes up unchecked here: the service judges
 * it, and says IMAGE_TOO_LARGE itself.
 */
function withinPixelBudget(bytes: Uint8Array): boolean {
  const { width, height } = nativeImage.createFromBuffer(Buffer.from(bytes)).getSize();
  if (width === 0 || height === 0) {
    return true;
  }
  return (
    width <= STICKER_SOURCE_MAX_EDGE &&
    height <= STICKER_SOURCE_MAX_EDGE &&
    width * height <= STICKER_SOURCE_MAX_PIXELS
  );
}

/** Checks the bytes and uploads them as a draft. */
async function uploadDraft(bytes: Uint8Array): Promise<IpcResult<StickerDraftResponse>> {
  if (bytes.byteLength > STICKER_SOURCE_MAX_BYTES) {
    return TOO_LARGE;
  }
  const part = stickerSourcePart(bytes);
  if (!part.ok) {
    log.info('sticker_source_refused', { reason: 'format' });
    return part;
  }
  if (!withinPixelBudget(bytes)) {
    log.info('sticker_source_refused', { reason: 'pixels' });
    return ipcFail(
      'INVALID_PAYLOAD',
      'That picture is too big. Try one under 4096 pixels a side.',
      {
        apiReason: 'IMAGE_TOO_LARGE',
      },
    );
  }

  const form = new FormData();
  form.append('image', part.data.blob, part.data.fileName);
  const result = await apiRequest({
    method: 'post',
    url: ENDPOINTS.chat.stickerDrafts,
    body: form,
    schema: stickerDraftSchema,
    service: 'chat',
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  if (!result.ok) {
    return result;
  }
  log.info('sticker_draft_created', { cutout: result.data.cutoutStatus });
  return ipcOk({ draft: result.data });
}

/**
 * A picture for the cropper: checked for size and format, then scaled so its
 * long edge is at most `STICKER_CROP_SOURCE_MAX_EDGE` — enough to crop a
 * 512 square from a third of it — and handed over as a `data:` URL.
 */
function cropSourceFrom(bytes: Uint8Array): IpcResult<StickerSourceResponse> {
  if (bytes.byteLength > STICKER_PICTURE_MAX_BYTES) {
    return PICTURE_TOO_LARGE;
  }
  const part = stickerSourcePart(bytes);
  if (!part.ok) {
    log.info('sticker_source_refused', { reason: 'format' });
    return part;
  }
  return ipcOk({
    dataUrl: toPreviewDataUrl(
      Buffer.from(bytes),
      part.data.blob.type,
      STICKER_CROP_SOURCE_MAX_EDGE,
    ),
    cancelled: false,
  });
}

/** Reads a picked file, sized before it is read so a huge one never loads. */
async function readPickedFile(filePath: string): Promise<IpcResult<Uint8Array>> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return ipcFail('INVALID_PAYLOAD', 'That is not a file.');
    }
    if (info.size > STICKER_PICTURE_MAX_BYTES) {
      return PICTURE_TOO_LARGE;
    }
    return ipcOk(new Uint8Array(await readFile(filePath)));
  } catch {
    log.warn('sticker_source_unreadable', {});
    return ipcFail('IO_ERROR', 'That picture could not be read.');
  }
}

/**
 * The first picture on the clipboard, or null when there is none. One larger
 * than the cropper needs is scaled to fit as PNG first — a 4K screenshot is
 * well over the picture cap as a bitmap — and one the platform cannot decode
 * goes as it came, for the format check to judge.
 */
async function readClipboardPicture(): Promise<Uint8Array | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'));
    if (type === undefined) {
      continue;
    }
    const payload = await item.getType(type);
    if (!(payload instanceof Blob)) {
      continue;
    }
    const bytes = new Uint8Array(await payload.arrayBuffer());
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    if (longest <= STICKER_CROP_SOURCE_MAX_EDGE) {
      return bytes;
    }
    const fitted = image.resize({
      width: Math.max(1, Math.round((width * STICKER_CROP_SOURCE_MAX_EDGE) / longest)),
      height: Math.max(1, Math.round((height * STICKER_CROP_SOURCE_MAX_EDGE) / longest)),
      quality: 'good',
    });
    return new Uint8Array(fitted.toPNG());
  }
  return null;
}

export function registerStickerHandlers(): void {
  registerDraftHandlers();
  registerLibraryHandlers();
}

/** A picture to crop, from the picker or the clipboard; the crop as a draft; saving it. */
function registerDraftHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.STICKERS_PICK_SOURCE,
    emptyRequestSchema,
    async (_request, event): Promise<IpcResult<StickerSourceResponse>> => {
      const [filePath] = await pickImageFiles(event, {
        title: 'Choose a picture',
        extensions: STICKER_EXTENSIONS,
      });
      if (filePath === undefined) {
        return ipcOk({ dataUrl: null, cancelled: true });
      }
      const bytes = await readPickedFile(filePath);
      return bytes.ok ? cropSourceFrom(bytes.data) : bytes;
    },
  );

  // Read here rather than through the page's clipboard API: the renderer is
  // never granted clipboard-read, and this runs only on the user's click.
  registerIpcHandler(
    IPC_CHANNELS.STICKERS_PASTE_SOURCE,
    emptyRequestSchema,
    async (): Promise<IpcResult<StickerSourceResponse>> => {
      let bytes: Uint8Array | null;
      try {
        bytes = await readClipboardPicture();
      } catch {
        log.warn('clipboard_unreadable', {});
        return ipcFail('IO_ERROR', 'The clipboard could not be read.');
      }
      if (bytes === null) {
        return ipcFail('INVALID_PAYLOAD', 'There’s no picture on the clipboard.', {
          apiReason: 'CLIPBOARD_EMPTY',
        });
      }
      return cropSourceFrom(bytes);
    },
  );

  // The cropped square, from the page: untrusted bytes, checked again.
  registerIpcHandler(
    IPC_CHANNELS.STICKERS_DRAFT_FROM_BYTES,
    stickerDraftFromBytesRequestSchema,
    async ({ bytes }): Promise<IpcResult<StickerDraftResponse>> => uploadDraft(bytes),
  );

  registerIpcHandler(
    IPC_CHANNELS.STICKERS_SAVE,
    saveStickerRequestSchema,
    async ({ draftId, background, name }): Promise<IpcResult<StickerResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.stickers,
        body: { draftId, background, name },
        schema: stickerSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      log.info('sticker_saved', { background });
      return ipcOk({ sticker: result.data });
    },
  );
}

/** Reading the library, recent and packs; renaming, deleting, keeping another's. */
function registerLibraryHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.STICKERS_LIST_MINE,
    listMyStickersRequestSchema,
    async ({ cursor }): Promise<IpcResult<StickerPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.myStickers,
        params: { limit: MY_STICKERS_PAGE_SIZE, cursor },
        schema: stickerPageSchema,
        service: 'chat',
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.STICKERS_LIST_RECENT,
    emptyRequestSchema,
    async (): Promise<IpcResult<StickerListResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.recentStickers,
        params: { size: RECENT_STICKERS_SIZE },
        schema: recentListSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk({ stickers: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STICKERS_LIST_PACKS,
    emptyRequestSchema,
    async (): Promise<IpcResult<StickerPacksResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.stickerPacks,
        schema: packListSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk({ packs: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STICKERS_RENAME,
    renameStickerRequestSchema,
    async ({ stickerId, name }): Promise<IpcResult<StickerResponse>> => {
      const result = await apiRequest({
        method: 'patch',
        url: ENDPOINTS.chat.sticker(stickerId),
        body: { name },
        schema: stickerSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk({ sticker: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.STICKERS_DELETE,
    stickerIdRequestSchema,
    async ({ stickerId }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.chat.sticker(stickerId),
        schema: noContentSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      log.info('sticker_deleted', {});
      return ipcOk(acknowledgedResponseSchema.parse({ acknowledged: true }));
    },
  );

  // Addressed through the message, so the service authorizes it by
  // conversation membership — a sticker id alone would say nothing (A01).
  registerIpcHandler(
    IPC_CHANNELS.STICKERS_SAVE_FROM_MESSAGE,
    chatMessageRefSchema,
    async ({ conversationId, messageId }): Promise<IpcResult<SavedStickerResponse>> => {
      const result = await apiRequestWithStatus({
        method: 'post',
        url: ENDPOINTS.chat.saveMessageSticker(conversationId, messageId),
        schema: stickerSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      const alreadyMine = result.data.status === HTTP_OK;
      log.info('sticker_kept_from_message', { alreadyMine });
      return ipcOk({ sticker: result.data.data, alreadyMine });
    },
  );
}
