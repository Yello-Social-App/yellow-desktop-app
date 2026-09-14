/**
 * Choosing and reading image files for upload.
 *
 * The renderer never names a path: it asks for an upload, and the main process
 * opens the OS picker, so the set of readable files is whatever the user just
 * pointed at and nothing else (OWASP A01). Extension and size are checked here
 * before any bytes are sent.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { BrowserWindow, dialog, nativeImage, type IpcMainInvokeEvent } from 'electron';

import { createLogger } from '../../shared/logger';
import { ipcFail, ipcOk, type IpcResult } from '../../shared/ipc-types';

const log = createLogger('ipc.images');

/** The API caps every post image at 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** What the server accepts, by content: JPEG, PNG, GIF and WebP. */
const ALLOWED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const PICKER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

export interface PickOptions {
  title: string;
  /** Allow more than one file, capped at `limit`. */
  multiple?: boolean;
  limit?: number;
}

/** Returns the chosen paths, or an empty array when the user cancelled. */
export async function pickImageFiles(
  event: IpcMainInvokeEvent,
  options: PickOptions,
): Promise<string[]> {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (parentWindow === null) {
    return [];
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
    title: options.title,
    properties: options.multiple === true ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Images', extensions: PICKER_EXTENSIONS }],
  });

  if (canceled) {
    return [];
  }

  const limit = options.limit ?? 1;
  return filePaths.slice(0, limit);
}

export interface ImagePart {
  blob: Blob;
  fileName: string;
  byteLength: number;
}

/** Reads one chosen file into a form part, refusing anything off the allowlist. */
export async function readImagePart(filePath: string): Promise<IpcResult<ImagePart>> {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = ALLOWED_IMAGE_EXTENSIONS[extension];
  if (contentType === undefined) {
    return ipcFail('INVALID_PAYLOAD', 'Choose a JPEG, PNG, GIF or WebP image.');
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    log.warn('image_unreadable', {});
    return ipcFail('IO_ERROR', 'That file could not be read.');
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return ipcFail('INVALID_PAYLOAD', 'Images must be 5 MB or smaller.');
  }

  // Copy into a plain ArrayBuffer: a Node Buffer is not a valid BlobPart.
  const body = new Uint8Array(bytes).buffer;
  return ipcOk({
    blob: new Blob([body], { type: contentType }),
    fileName: path.basename(filePath),
    byteLength: bytes.byteLength,
  });
}

/**
 * The longest edge of a composer thumbnail.
 *
 * Previews are scaled here rather than sent whole: ten 5 MB originals would be
 * about 66 MB of base64 crossing IPC to be drawn at 96px. The *upload* still
 * carries the original bytes — only what the renderer sees is shrunk.
 */
export const PREVIEW_MAX_EDGE = 320;

/**
 * A `data:` URL preview of the given bytes, downscaled. Falls back to the
 * original bytes when the image cannot be decoded, so a valid-but-exotic file
 * still shows something rather than an empty box (A10).
 */
export function toPreviewDataUrl(bytes: Buffer, contentType: string): string {
  const image = nativeImage.createFromBuffer(bytes);
  const { width, height } = image.getSize();

  if (width === 0 || height === 0) {
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= PREVIEW_MAX_EDGE) {
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  const scale = PREVIEW_MAX_EDGE / longestEdge;
  const resized = image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good',
  });

  return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
}
