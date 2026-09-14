/**
 * Story shapes — Instagram-style, 24-hour slides.
 *
 * No API and no uploads yet, so a slide is a gradient and a line of text.
 * When media lands, `cover` becomes an image URL and the viewer does not
 * otherwise change.
 */
import type { Author } from '@shared/ipc-types';

export interface StorySlide {
  id: string;
  /** One of the `.cover-N` gradient classes. */
  cover: string;
  text: string;
  createdAt: string;
}

export interface Story {
  id: string;
  author: Author;
  slides: StorySlide[];
  isSeen: boolean;
}

export const STORY_TEXT_MAX = 140;
export const STORY_SLIDE_MS = 5000;

export const STORY_COVERS = [
  'cover-0',
  'cover-1',
  'cover-2',
  'cover-3',
  'cover-4',
  'cover-5',
  'cover-6',
  'cover-7',
] as const;
