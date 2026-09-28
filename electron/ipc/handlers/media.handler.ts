/**
 * Saving an image to disk, and copying it to the clipboard — for chat photos
 * and post images alike.
 *
 * Both run here: the page may not fetch from another origin (its CSP allows
 * `connect-src 'self'` only), is granted no clipboard permission, and never
 * names a path — the save dialog does. So the page names the *image*, and
 * this process decides whether it may be fetched:
 *
 *   - a chat photo by attachment id: the link is re-read from the service,
 *     which re-checks that the caller is in that conversation (A01);
 *   - anything else by URL, fetched only from the app's image-host allowlist,
 *     the same list the CSP allows images from — never an arbitrary address
 *     (A01, the SSRF case).
 *
 * Every fetch sends no credentials (the link is its own authorisation; the
 * API token never leaves for another host, A04), follows no redirects, is
 * bounded in time and size (A06), and is kept only if its bytes are really a
 * JPEG, PNG, GIF or WebP (A05).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage } from 'electron';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { imageFormatOf, safeFileName } from '../../chat/files';
import { isChatMediaUrl } from '../../security/media-hosts';
import { isAppImageUrl } from '../../security/image-hosts';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  chatAttachmentSchema,
  copyPngRequestSchema,
  IMAGE_EXPORT_MAX_BYTES,
  imageExportRequestSchema,
  ipcFail,
  ipcOk,
  type ImageCopiedResponse,
  type ImageCopyResponse,
  type ImageExportSource,
  type IpcResult,
  type SavedFileResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.media');

const FETCH_TIMEOUT_MS = 30_000;
/** A PNG from the page larger than this on a side is not something it made from a photo. */
const COPY_PNG_MAX_EDGE = 16_384;

interface FetchedImage {
  bytes: Buffer;
  type: string;
  extension: string;
}

/** The link to fetch: re-read for a chat photo, checked against the allowlist otherwise. */
async function resolveUrl(source: ImageExportSource): Promise<IpcResult<string>> {
  if (source.kind === 'url') {
    if (!isAppImageUrl(source.url)) {
      log.warn('image_host_refused', {});
      return ipcFail('INVALID_PAYLOAD', 'That image is not from a place Yello can save from.');
    }
    return ipcOk(source.url);
  }

  const fresh = await apiRequest({
    method: 'get',
    url: ENDPOINTS.chat.attachment(source.attachmentId),
    schema: chatAttachmentSchema,
    service: 'chat',
  });
  if (!fresh.ok) {
    return fresh;
  }
  if (fresh.data.kind !== 'IMAGE' || fresh.data.url === null) {
    return ipcFail('API', 'That photo is not available right now.');
  }
  if (!isChatMediaUrl(fresh.data.url)) {
    log.warn('image_host_refused', { source: 'chat' });
    return ipcFail('API', 'That photo is not available from a trusted location.');
  }
  return ipcOk(fresh.data.url);
}

/** Fetches the image, bounded, and keeps it only if its bytes are an image. */
async function fetchImage(source: ImageExportSource): Promise<IpcResult<FetchedImage>> {
  const url = await resolveUrl(source);
  if (!url.ok) {
    return url;
  }

  let response: Response;
  try {
    response = await fetch(url.data, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    log.warn('image_fetch_failed', {});
    return ipcFail('NETWORK', 'The image could not be downloaded.');
  }
  if (!response.ok) {
    log.warn('image_fetch_refused', { status: response.status });
    return ipcFail('API', 'The image could not be downloaded. Try again.');
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > IMAGE_EXPORT_MAX_BYTES) {
    return ipcFail('API', 'That image is too large to save.');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_EXPORT_MAX_BYTES) {
    return ipcFail('API', 'That image is too large to save.');
  }
  const format = imageFormatOf(bytes);
  if (format === undefined) {
    log.warn('image_not_an_image', {});
    return ipcFail('API', 'That is not an image Yello can save.');
  }
  return ipcOk({ bytes, ...format });
}

/** A name for the save dialog: the one suggested, cleaned, with the real extension. */
function suggestedName(fileName: string | undefined, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base =
    fileName === undefined
      ? `yello-image-${stamp}`
      : safeFileName(fileName).replace(/\.[a-z0-9]{1,5}$/i, '');
  return `${base === '' ? `yello-image-${stamp}` : base}.${extension}`;
}

/** Puts PNG bytes on the clipboard as an image, as a paste into any app expects. */
async function writePng(png: Buffer): Promise<void> {
  const body = new Uint8Array(png).buffer;
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([body], { type: 'image/png' }) }),
  ]);
}

export function registerMediaHandlers(): void {
  // Fetched before the dialog opens: the extension comes from the bytes, and
  // a link that has stopped working is better said before asking where.
  registerIpcHandler(
    IPC_CHANNELS.MEDIA_SAVE_IMAGE,
    imageExportRequestSchema,
    async ({ source, fileName }, event): Promise<IpcResult<SavedFileResponse>> => {
      const image = await fetchImage(source);
      if (!image.ok) {
        return image;
      }
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      if (parentWindow === null) {
        return ipcFail('UNKNOWN', 'The window is no longer open.');
      }

      const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
        title: 'Save image',
        defaultPath: path.join(
          app.getPath('downloads'),
          suggestedName(fileName, image.data.extension),
        ),
        filters: [{ name: 'Image', extensions: [image.data.extension] }],
      });
      if (canceled || filePath === '') {
        return ipcOk({ saved: false });
      }

      try {
        await writeFile(filePath, image.data.bytes);
      } catch {
        log.warn('image_write_failed', {});
        return ipcFail('IO_ERROR', 'The image could not be saved there.');
      }
      log.info('image_saved', { bytes: image.data.bytes.byteLength, type: image.data.type });
      return ipcOk({ saved: true });
    },
  );

  // The platform decoder reads PNG and JPEG; for anything else the bytes go
  // back to the page, which decodes every format the window can show and
  // hands over a PNG (MEDIA_COPY_PNG).
  registerIpcHandler(
    IPC_CHANNELS.MEDIA_COPY_IMAGE,
    imageExportRequestSchema,
    async ({ source }): Promise<IpcResult<ImageCopyResponse>> => {
      const image = await fetchImage(source);
      if (!image.ok) {
        return image;
      }
      const decoded = nativeImage.createFromBuffer(image.data.bytes);
      if (decoded.isEmpty()) {
        log.info('image_copy_needs_page', { type: image.data.type });
        return ipcOk({ copied: false, bytes: new Uint8Array(image.data.bytes) });
      }
      try {
        await writePng(decoded.toPNG());
      } catch {
        log.warn('clipboard_write_failed', {});
        return ipcFail('IO_ERROR', 'The image could not be copied.');
      }
      log.info('image_copied', { type: image.data.type });
      return ipcOk({ copied: true });
    },
  );

  // Bytes from the page: decoded here before they reach the clipboard, so
  // what is written is always an image this process read (A08).
  registerIpcHandler(
    IPC_CHANNELS.MEDIA_COPY_PNG,
    copyPngRequestSchema,
    async ({ bytes }): Promise<IpcResult<ImageCopiedResponse>> => {
      const png = Buffer.from(bytes);
      if (imageFormatOf(png)?.type !== 'image/png') {
        return ipcFail('INVALID_PAYLOAD', 'That image could not be copied.');
      }
      const decoded = nativeImage.createFromBuffer(png);
      const { width, height } = decoded.getSize();
      if (decoded.isEmpty() || width > COPY_PNG_MAX_EDGE || height > COPY_PNG_MAX_EDGE) {
        return ipcFail('INVALID_PAYLOAD', 'That image could not be copied.');
      }
      try {
        await writePng(decoded.toPNG());
      } catch {
        log.warn('clipboard_write_failed', {});
        return ipcFail('IO_ERROR', 'The image could not be copied.');
      }
      log.info('image_copied', { type: 'image/png', via: 'page' });
      return ipcOk({ copied: true });
    },
  );
}
