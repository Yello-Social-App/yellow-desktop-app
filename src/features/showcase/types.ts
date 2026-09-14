/**
 * Project showcase shapes — a KhmerCoder-style gallery of what people built.
 *
 * No API yet: seeded from src/mocks, likes and submissions kept in memory.
 */
import type { Author } from '@shared/ipc-types';

export interface Project {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Stands in for cover art until uploads exist. */
  emoji: string;
  tech: string[];
  author: Author;
  repoUrl: string | undefined;
  liveUrl: string | undefined;
  stars: number;
  likes: number;
  views: number;
  createdAt: string;
  viewerLiked: boolean;
  featured: boolean;
}

export const PROJECT_NAME_MAX = 60;
export const PROJECT_TAGLINE_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_TECH_MAX = 6;

export type ShowcaseSort = 'trending' | 'newest' | 'stars';
