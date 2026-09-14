/**
 * Images the user has picked but not yet posted.
 *
 * Shared by the composer (create) and the editor (append on update), which is
 * what earns it a module of its own rather than a map inside one handler: two
 * copies would each enforce their own cap and neither would know what the
 * other was holding.
 *
 * Hard-capped at POST_MAX_IMAGES so a renderer that keeps asking cannot grow it
 * without limit (OWASP A06). The cap *refuses* rather than evicting: the
 * entries here are exactly the ones a composer is showing thumbnails for, so
 * dropping the oldest to make room would quietly invalidate a photo the user
 * can still see attached, and the post would fail at publish time.
 */
import { randomUUID } from 'node:crypto';

import { ipcFail, ipcOk, POST_MAX_IMAGES, type IpcResult } from '../../shared/ipc-types';

import type { ImagePart } from './image-picker';

const stagedImages = new Map<string, ImagePart>();

export function remainingStagingCapacity(): number {
  return Math.max(0, POST_MAX_IMAGES - stagedImages.size);
}

/** Holds a part and returns the opaque token the renderer will pass back. */
export function stageImage(part: ImagePart): string {
  const token = randomUUID();
  stagedImages.set(token, part);
  return token;
}

export function discardStagedImages(tokens: readonly string[]): void {
  for (const token of tokens) {
    stagedImages.delete(token);
  }
}

/**
 * Resolves every token before anything is sent: a half-uploaded set of
 * images is worse than a refusal the composer can explain (A10). The entries
 * stay staged until the caller confirms the server has them.
 */
export function resolveStagedImages(tokens: readonly string[]): IpcResult<ImagePart[]> {
  const parts: ImagePart[] = [];
  for (const token of tokens) {
    const part = stagedImages.get(token);
    if (part === undefined) {
      return ipcFail('INVALID_PAYLOAD', 'One of those photos is no longer attached. Add it again.');
    }
    parts.push(part);
  }
  return ipcOk(parts);
}
