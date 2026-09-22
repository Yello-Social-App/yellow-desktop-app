/**
 * Files in and out of a conversation: picking, pasting or dropping what to
 * upload, and saving an attachment to disk.
 *
 * Both directions run here rather than in the renderer for the reasons the
 * image picker gives: the page never names a path (the OS dialog does, so the
 * readable and writable set is exactly what the user pointed at), and the bytes
 * never cross the bridge (OWASP A01).
 *
 * Unlike post images, a chat file may be of any type — the service sniffs the
 * bytes, renders JPEG/PNG/GIF/WebP inline and forces everything else to
 * download as `application/octet-stream`. So nothing is refused by extension
 * here; only size is checked, before a byte is uploaded.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';

import { createLogger } from '../../shared/logger';
import { CHAT_ATTACHMENT_MAX_BYTES, ipcFail, ipcOk, type IpcResult } from '../../shared/ipc-types';
import { isChatMediaUrl } from '../security/media-hosts';

const log = createLogger('chat.files');

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_MEGABYTES = String(Math.floor(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024)));

export interface FilePart {
  blob: Blob;
  fileName: string;
}

/** Returns the chosen paths, or an empty array when the user cancelled. */
export async function pickChatFiles(event: IpcMainInvokeEvent): Promise<string[]> {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (parentWindow === null) {
    return [];
  }
  const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
    title: 'Attach files',
    properties: ['openFile', 'multiSelections'],
  });
  return canceled ? [] : filePaths;
}

/** Reads one chosen file into a form part, refusing it when it is over the cap. */
export async function readChatFile(filePath: string): Promise<IpcResult<FilePart>> {
  const fileName = path.basename(filePath);
  try {
    // Sized before it is read, so a 4 GB video is refused without loading it.
    const info = await stat(filePath);
    if (!info.isFile()) {
      return ipcFail('INVALID_PAYLOAD', `${fileName} is not a file.`);
    }
    if (info.size > CHAT_ATTACHMENT_MAX_BYTES) {
      return ipcFail('INVALID_PAYLOAD', `Files must be ${MAX_MEGABYTES} MB or smaller.`);
    }
    const bytes = await readFile(filePath);
    // The type is the service's call, made from the bytes; claiming one here
    // would only be a hint it ignores.
    const body = new Uint8Array(bytes).buffer;
    return ipcOk({ blob: new Blob([body], { type: 'application/octet-stream' }), fileName });
  } catch {
    log.warn('chat_file_unreadable', {});
    return ipcFail('IO_ERROR', `${fileName} could not be read.`);
  }
}

/** The image formats the service renders inline, by their leading bytes. */
const IMAGE_SIGNATURES: readonly {
  type: string;
  extension: string;
  test: (b: Uint8Array) => boolean;
}[] = [
  {
    type: 'image/png',
    extension: 'png',
    test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  },
  {
    type: 'image/jpeg',
    extension: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/gif',
    extension: 'gif',
    test: (b) => /^GIF8[79]a$/.test(String.fromCharCode(...b.subarray(0, 6))),
  },
  {
    type: 'image/webp',
    extension: 'webp',
    test: (b) =>
      String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
  },
];

/**
 * Turns pasted bytes into a form part — only if they really are an image.
 *
 * The bytes came from the renderer, so the type is read from the bytes
 * themselves, never from what the page claimed; anything that is not a JPEG,
 * PNG, GIF or WebP is refused here, before it is uploaded (A05). The service
 * sniffs again on its side.
 */
export function pastedImagePart(
  bytes: Uint8Array,
  fileName: string | undefined,
  index: number,
): IpcResult<FilePart> {
  const format = IMAGE_SIGNATURES.find((signature) => signature.test(bytes));
  if (format === undefined) {
    return ipcFail('INVALID_PAYLOAD', 'Only JPEG, PNG, GIF and WebP images can be pasted.');
  }
  // A screenshot on the clipboard is usually called "image.png", or nothing;
  // a dated name is more use in a download list than ten identical ones.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = index === 0 ? '' : `-${String(index + 1)}`;
  const named =
    fileName === undefined || /^image\.\w+$/i.test(fileName)
      ? `pasted-${stamp}${suffix}.${format.extension}`
      : safeFileName(fileName);
  // Copied into a plain ArrayBuffer: the IPC view may share a larger buffer.
  const body = new Uint8Array(bytes).buffer;
  return ipcOk({ blob: new Blob([body], { type: format.type }), fileName: named });
}

/**
 * Turns dropped bytes into a form part. Any type is allowed, as the picker
 * allows — the service sniffs the bytes, renders only real images inline and
 * forces everything else to download — so only the name is cleaned here.
 */
export function droppedFilePart(
  bytes: Uint8Array,
  fileName: string | undefined,
  index: number,
): IpcResult<FilePart> {
  const named = fileName === undefined ? `dropped-${String(index + 1)}` : safeFileName(fileName);
  const body = new Uint8Array(bytes).buffer;
  return ipcOk({ blob: new Blob([body], { type: 'application/octet-stream' }), fileName: named });
}

/**
 * A name safe to offer in a save dialog: no directory parts, no control or
 * reserved characters, never empty. The dialog is still the user's to change;
 * this only keeps the suggestion from pointing anywhere but the folder shown.
 */
function safeFileName(name: string): string {
  const cleaned = path
    .basename(name)
    .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]+/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned === '' ? 'attachment' : cleaned;
}

/**
 * Asks where to save, then fetches a presigned URL and writes it there.
 *
 * The URL is checked against the chat-media allowlist before anything is
 * fetched — it came from a server response, and the main process is not a
 * general-purpose fetcher (A01). It is fetched with no credentials: the link is
 * its own authorisation, and the API bearer token must never leave for another
 * host (A04). A response larger than the service's own cap is refused rather
 * than buffered (A06).
 */
export async function saveChatFile(
  event: IpcMainInvokeEvent,
  url: string,
  fileName: string,
): Promise<IpcResult<{ saved: boolean }>> {
  if (!isChatMediaUrl(url)) {
    log.warn('chat_file_host_refused', {});
    return ipcFail('API', 'That file is not available from a trusted location.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (parentWindow === null) {
    return ipcFail('UNKNOWN', 'The window is no longer open.');
  }

  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
    title: 'Save file',
    defaultPath: path.join(app.getPath('downloads'), safeFileName(fileName)),
  });
  if (canceled || filePath === '') {
    return ipcOk({ saved: false });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    log.warn('chat_file_fetch_failed', {});
    return ipcFail('NETWORK', 'The file could not be downloaded.');
  }

  if (!response.ok) {
    log.warn('chat_file_fetch_refused', { status: response.status });
    return ipcFail('API', 'The file could not be downloaded. Try again.');
  }

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > CHAT_ATTACHMENT_MAX_BYTES) {
    return ipcFail('API', 'That file is larger than chat allows.');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
    return ipcFail('API', 'That file is larger than chat allows.');
  }

  try {
    await writeFile(filePath, bytes);
  } catch {
    log.warn('chat_file_write_failed', {});
    return ipcFail('IO_ERROR', 'The file could not be saved there.');
  }

  log.info('chat_file_saved', { bytes: bytes.byteLength });
  return ipcOk({ saved: true });
}
