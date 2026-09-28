/**
 * Sticker rules the screens share: what an error says, what a search matches,
 * and when a presigned picture needs fetching again.
 */
import {
  STICKER_LIBRARY_MAX,
  type IpcError,
  type Sticker,
  type StickerImage,
} from '@shared/ipc-types';

/** A presigned link this close to expiry is treated as already expired. */
const URL_EXPIRY_MARGIN_MS = 60_000;

/** The chat service's finer cases, in the app's wording. Unknown ones fall through. */
const REASON_WORDING: Readonly<Record<string, string>> = {
  UNSUPPORTED_MEDIA: 'That file isn’t a picture. Try a PNG, JPG or WebP.',
  PAYLOAD_TOO_LARGE: 'That picture is over 5 MB. Try a smaller one.',
  PICTURE_TOO_LARGE: 'That picture is over 10 MB. Try a smaller one.',
  IMAGE_TOO_LARGE: 'That picture is too big. Try one under 4096 pixels a side.',
  CLIPBOARD_EMPTY: 'There’s no picture on the clipboard. Copy one, then try again.',
  DRAFT_NOT_FOUND: 'That picture expired. Add it again.',
  NO_SUBJECT:
    'Background removal isn’t available for this picture yet. Keep the background instead.',
  STICKER_LIMIT_REACHED: `You have ${String(STICKER_LIBRARY_MAX)} stickers. Delete one to make room.`,
  STICKER_NOT_FOUND: 'That sticker isn’t in your library any more.',
  ALREADY_AVAILABLE: 'That sticker is already in your picker.',
};

/** Rounds a wait up to whole minutes, the unit a person plans in. */
function waitWording(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) {
    return 'later';
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'in a minute' : `in ${String(minutes)} minutes`;
}

/** What a failed sticker call says to the person who made it. */
export function stickerErrorMessage(error: IpcError): string {
  const byReason = error.apiReason === undefined ? undefined : REASON_WORDING[error.apiReason];
  if (byReason !== undefined) {
    return byReason;
  }
  switch (error.apiCode) {
    case 'RATE_LIMITED':
      return `You’ve made a lot of stickers this hour. Try again ${waitWording(error.retryAfterSeconds)}.`;
    case 'UNAVAILABLE':
      return 'Stickers aren’t available on this server yet.';
    default:
      return error.message;
  }
}

/** Whether a sticker's own name matches what was typed; case and accents aside. */
export function matchesQuery(sticker: Sticker, query: string): boolean {
  const needle = fold(query);
  return needle === '' || fold(sticker.name).includes(needle);
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Whether a presigned picture is past (or about to pass) its expiry. */
export function isImageExpired(image: StickerImage): boolean {
  if (image.url === null) {
    return true;
  }
  if (image.urlExpiresAt === null) {
    return false;
  }
  const at = Date.parse(image.urlExpiresAt);
  return !Number.isNaN(at) && at - URL_EXPIRY_MARGIN_MS <= Date.now();
}

/** The list with `sticker` in front, any older copy of it dropped. */
export function withFirst(list: readonly Sticker[], sticker: Sticker): Sticker[] {
  return [sticker, ...list.filter((item) => item.id !== sticker.id)];
}

/** Each sticker once, first occurrence kept. */
export function uniqueById(list: readonly Sticker[]): Sticker[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}
