/**
 * Sticker operations, as seen by the renderer: one allowlisted IPC call each.
 * The main process opens the picker and reads the clipboard itself and hands
 * back a picture to crop; what it is handed in return is the cropped square.
 */
import type {
  IpcError,
  Sticker,
  StickerBackground,
  StickerDraft,
  StickerPack,
  StickerPage,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type StickersError = IpcError;

/** A picture to crop, as a `data:` URL; null when the user cancelled the picker. */
export type SourceResult = Result<string | null, StickersError>;

export async function pickSource(): Promise<SourceResult> {
  const result = await ipc.pickStickerSource();
  return result.ok ? ok(result.data.dataUrl) : fail(result.error);
}

export async function pasteSource(): Promise<SourceResult> {
  const result = await ipc.pasteStickerSource();
  return result.ok ? ok(result.data.dataUrl) : fail(result.error);
}

/** Uploads the cropped square as a draft. */
export async function draftFromBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Result<StickerDraft, StickersError>> {
  const result = await ipc.stickerDraftFromBytes({ bytes });
  return result.ok ? ok(result.data.draft) : fail(result.error);
}

export async function saveDraft(
  draftId: string,
  background: StickerBackground,
  name: string,
): Promise<Result<Sticker, StickersError>> {
  const result = await ipc.saveSticker({ draftId, background, name });
  return result.ok ? ok(result.data.sticker) : fail(result.error);
}

export async function fetchMyStickers(
  cursor?: string,
): Promise<Result<StickerPage, StickersError>> {
  const result = await ipc.listMyStickers(cursor === undefined ? {} : { cursor });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchRecentStickers(): Promise<Result<Sticker[], StickersError>> {
  const result = await ipc.listRecentStickers();
  return result.ok ? ok(result.data.stickers) : fail(result.error);
}

export async function fetchStickerPacks(): Promise<Result<StickerPack[], StickersError>> {
  const result = await ipc.listStickerPacks();
  return result.ok ? ok(result.data.packs) : fail(result.error);
}

export async function renameSticker(
  stickerId: string,
  name: string,
): Promise<Result<Sticker, StickersError>> {
  const result = await ipc.renameSticker({ stickerId, name });
  return result.ok ? ok(result.data.sticker) : fail(result.error);
}

export async function deleteSticker(stickerId: string): Promise<Result<true, StickersError>> {
  const result = await ipc.deleteSticker({ stickerId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function keepMessageSticker(
  conversationId: string,
  messageId: string,
): Promise<Result<{ sticker: Sticker; alreadyMine: boolean }, StickersError>> {
  const result = await ipc.saveMessageSticker({ conversationId, messageId });
  return result.ok ? ok(result.data) : fail(result.error);
}
