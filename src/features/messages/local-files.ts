/**
 * Reading what the user pasted or dropped into memory, for upload.
 *
 * Shared by the composer (paste) and the thread (drop). The `File` objects are
 * the capability here: they are exactly what the user handed over, and the
 * page can read nothing else from disk. Nothing is filtered by type beyond what
 * the caller asks for — the main process and the service both check the bytes.
 */
import { CHAT_ATTACHMENT_MAX_BYTES } from '@shared/ipc-types';

import type { LocalFile } from './api';

const MAX_MEGABYTES = String(Math.floor(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024)));

export interface ReadLocalFiles {
  files: LocalFile[];
  /** Why some were left out (too large, a folder, unreadable), or null. */
  problem: string | null;
}

export async function readLocalFiles(candidates: readonly File[]): Promise<ReadLocalFiles> {
  const fitting = candidates.filter((file) => file.size <= CHAT_ATTACHMENT_MAX_BYTES);
  let problem =
    fitting.length < candidates.length ? `Files must be ${MAX_MEGABYTES} MB or smaller.` : null;

  const read = await Promise.all(
    fitting.map(async (file): Promise<LocalFile | null> => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // A dropped folder arrives as an empty, unreadable "file".
        return bytes.byteLength === 0
          ? null
          : { fileName: file.name === '' ? undefined : file.name, bytes };
      } catch {
        return null;
      }
    }),
  );
  const files = read.filter((file): file is LocalFile => file !== null);
  if (files.length < fitting.length) {
    problem ??= 'Folders and empty files cannot be attached.';
  }
  return { files, problem };
}

/** Whether a drag carries files, as opposed to text or a link. */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes('Files') === true;
}
