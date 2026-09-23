/**
 * Filesystem access, narrowed to two operations, and the app's own details.
 *
 * The renderer can neither name a path nor read one back: it supplies a leaf
 * file name that has already been pattern-checked by its schema, the user picks
 * the destination through the OS dialog, and the main process writes only there
 * (OWASP A01 — no renderer-controlled path ever reaches the filesystem).
 *
 * The app details can be read, or copied as text for a bug report. The copy is
 * written here from the same values, never from anything the renderer sends.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, clipboard, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { createLogger } from '../../../shared/logger';
import { isSecureStorageAvailable } from '../../api/token-store';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  appInfoCopiedResponseSchema,
  appInfoResponseSchema,
  emptyRequestSchema,
  exportPostsRequestSchema,
  ipcFail,
  ipcOk,
  type AppInfoCopiedResponse,
  type AppInfoResponse,
  type ExportPostsResponse,
  type IpcResult,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.fs');

const EXPORT_EXTENSION = '.json';
const JSON_INDENT = 2;

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function readAppInfo(): AppInfoResponse {
  return appInfoResponseSchema.parse({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    secureStorageAvailable: isSecureStorageAvailable(),
  });
}

export function registerFsHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.FS_EXPORT_POSTS,
    exportPostsRequestSchema,
    async ({ suggestedName, entries }, event): Promise<IpcResult<ExportPostsResponse>> => {
      const parentWindow = ownerWindow(event);
      if (parentWindow === null) {
        return ipcFail('UNKNOWN', 'No window is available to own the dialog.');
      }

      const defaultPath = path.join(
        app.getPath('downloads'),
        `${suggestedName}${EXPORT_EXTENSION}`,
      );

      const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
        title: 'Export posts',
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (canceled || filePath === '') {
        log.info('export_cancelled', {});
        return ipcFail('CANCELLED', 'Export was cancelled.');
      }

      // The destination came from the OS dialog, so it is the user's choice —
      // only the extension is normalised.
      const target =
        path.extname(filePath).toLowerCase() === EXPORT_EXTENSION
          ? filePath
          : `${filePath}${EXPORT_EXTENSION}`;

      try {
        await writeFile(target, JSON.stringify({ entries }, null, JSON_INDENT), 'utf8');
      } catch (error) {
        log.error('export_write_failed', { error });
        return ipcFail('IO_ERROR', 'The file could not be written.');
      }

      log.info('export_written', { entryCount: entries.length });
      return ipcOk({ written: true, entryCount: entries.length });
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.FS_READ_APP_INFO,
    emptyRequestSchema,
    (): IpcResult<AppInfoResponse> => ipcOk(readAppInfo()),
  );

  registerIpcHandler(
    IPC_CHANNELS.FS_COPY_APP_INFO,
    emptyRequestSchema,
    async (): Promise<IpcResult<AppInfoCopiedResponse>> => {
      const info = readAppInfo();
      const text = [
        `Yello ${info.appVersion}`,
        `Electron ${info.electronVersion}`,
        `Chromium ${info.chromeVersion}`,
        `Platform ${info.platform} (${info.arch})`,
      ].join('\n');
      // A clipboard the OS refuses is reported, not thrown: the button says so.
      try {
        await clipboard.writeText(text);
      } catch (error) {
        log.warn('app_info_copy_failed', { error });
        return ipcOk(appInfoCopiedResponseSchema.parse({ copied: false }));
      }
      return ipcOk(appInfoCopiedResponseSchema.parse({ copied: true }));
    },
  );
}
