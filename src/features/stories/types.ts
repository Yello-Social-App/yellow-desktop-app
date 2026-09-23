/**
 * Story shapes as the screens hold them. The wire `Story` is one slide; a
 * ring is an author and their active slides, oldest first — the play order.
 */
import {
  STORY_BACKGROUNDS,
  STORY_TEXT_MAX,
  type Author,
  type Story,
  type StoryBackground,
  type StoryVisibility,
} from '@shared/ipc-types';

export { STORY_TEXT_MAX };
export type { Story, StoryBackground, StoryVisibility };

export const STORY_SLIDE_MS = 5000;
export const STORY_COVERS = STORY_BACKGROUNDS;

/** Rings per feed page: the server's cap, so a friend list loads in few calls. */
export const STORY_FEED_PAGE_SIZE = 50;
export const STORY_ARCHIVE_PAGE_SIZE = 30;
export const STORY_VIEWERS_PAGE_SIZE = 20;

/** The viewer list is deleted this long after posting; the count stays. */
export const STORY_VIEWERS_RETENTION_MS = 48 * 60 * 60 * 1000;

/** A signed link this close to expiry is treated as already expired. */
const URL_EXPIRY_MARGIN_MS = 30_000;

export interface StoryRing {
  author: Author;
  /** Oldest first. Never empty: a ring with nothing to play is not drawn. */
  slides: Story[];
  hasUnseen: boolean;
}

export const STORY_VISIBILITY_OPTIONS: readonly { value: StoryVisibility; label: string }[] = [
  { value: 'FRIENDS', label: 'Friends' },
  { value: 'PUBLIC', label: 'Everyone' },
];

/** The class a slide is painted with: its gradient, or black behind a photo. */
export function backdropOf(story: Story): string {
  if (story.type === 'IMAGE') {
    return 'bg-black';
  }
  return story.background ?? STORY_COVERS[0];
}

/** Whether a slide's signed image link has lapsed (or is about to). */
export function isImageUrlStale(story: Story, now: number = Date.now()): boolean {
  const expiresAt = story.image?.urlExpiresAt;
  if (story.image === null || expiresAt === null || expiresAt === undefined) {
    return false;
  }
  const at = Date.parse(expiresAt);
  return !Number.isNaN(at) && at - URL_EXPIRY_MARGIN_MS <= now;
}

/** Whether a story has passed its 24 hours. */
export function hasExpired(expiresAt: string, now: number = Date.now()): boolean {
  const at = Date.parse(expiresAt);
  return !Number.isNaN(at) && at <= now;
}

/** Where a ring starts playing: its first unwatched slide, or the top when all are watched. */
export function firstUnseenIndex(slides: readonly Story[]): number {
  const index = slides.findIndex((slide) => !slide.isSeen);
  return index === -1 ? 0 : index;
}
