/**
 * Community shapes — Reddit-style groups with their own posts.
 *
 * No API yet: the store seeds from src/mocks and keeps joins and votes in
 * memory for the session. The shapes are written the way an endpoint would
 * most likely return them, so wiring one later is a store change only.
 */
import type { Author } from '@shared/ipc-types';

export interface Community {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  members: number;
  online: number;
  tags: string[];
  rules: string[];
  createdAt: string;
  isJoined: boolean;
}

export interface CommunityPost {
  id: string;
  communitySlug: string;
  author: Author;
  title: string;
  body: string;
  tag: string;
  score: number;
  commentCount: number;
  createdAt: string;
  /** -1, 0 or 1 — Reddit's two-way vote. */
  viewerVote: -1 | 0 | 1;
}

export const COMMUNITY_POST_TITLE_MAX = 200;
export const COMMUNITY_POST_BODY_MAX = 5000;
