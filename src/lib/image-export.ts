/**
 * Saving an image to disk and copying it to the clipboard, as the page asks
 * for them. The main process does the fetching, the dialog and the clipboard
 * (see media.handler.ts); what happens here is the one step it cannot do
 * itself — decoding a WebP or GIF the platform decoder does not read, which
 * the window can, into a PNG it can.
 */
import type { ImageExportSource } from '@shared/ipc-types';

import { ipc } from './ipc';
import { fail, ok, type Result } from './result';

export type SaveOutcome = 'saved' | 'cancelled';

export async function saveImage(
  source: ImageExportSource,
  fileName?: string,
): Promise<Result<SaveOutcome, string>> {
  const result = await ipc.saveImage({
    source,
    ...(fileName === undefined || fileName.trim() === '' ? {} : { fileName }),
  });
  if (!result.ok) {
    return fail(result.error.message);
  }
  return ok(result.data.saved ? 'saved' : 'cancelled');
}

export async function copyImage(source: ImageExportSource): Promise<Result<true, string>> {
  const result = await ipc.copyImage({ source });
  if (!result.ok) {
    return fail(result.error.message);
  }
  if (result.data.copied) {
    return ok(true);
  }

  const png = await toPng(result.data.bytes);
  if (png === null) {
    return fail('That image could not be copied.');
  }
  const copied = await ipc.copyPng({ bytes: png });
  return copied.ok ? ok(true) : fail(copied.error.message);
}

/** Decodes image bytes and encodes them again as PNG; null when they do not decode. */
async function toPng(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  return blob === null ? null : new Uint8Array(await blob.arrayBuffer());
}
