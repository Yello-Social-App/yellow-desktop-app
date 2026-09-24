/**
 * Community shapes — Reddit-style groups with their own posts.
 *
 * The records come from the API (see @shared/ipc-types). What lives here is
 * the paging, the names the screens use for a list, and the one rule a vote
 * button needs: pressing the arrow you already hold clears it.
 *
 * Community posts also take the six feed reactions and a comment thread; those
 * reuse the feed's reaction control and the comments feature as they are.
 */
import {
  COMMUNITY_POST_BODY_MAX,
  COMMUNITY_POST_TITLE_MAX,
  COMMUNITY_SLUG_PATTERN,
  type Community,
  type CommunityMembership,
  type CommunityPost,
  type CommunityPostScope,
  type CommunityPostSort,
  type CommunitySort,
  type CommunitySummary,
  type ReactionType,
  type Vote,
} from '@shared/ipc-types';

export const COMMUNITIES_PAGE_SIZE = 20;
export const COMMUNITY_POSTS_PAGE_SIZE = 20;

/**
 * Which post list: the front page (everything, or only joined communities),
 * or one community's own, as `c/<slug>`. A string rather than an object so a
 * hook can depend on it directly.
 */
export type PostFeedSource = CommunityPostScope | `c/${string}`;

export function communityFeed(slug: string): PostFeedSource {
  return `c/${slug}`;
}

export interface DirectoryQuery {
  sort: CommunitySort;
  membership?: CommunityMembership | undefined;
  q?: string;
  size?: number;
}

export const POST_SORT_LABELS: Record<CommunityPostSort, string> = {
  hot: 'Hot',
  new: 'New',
  top: 'Top',
};

/** The vote to send when an arrow is pressed: the same arrow again clears it. */
export function nextVote(current: Vote, pressed: 1 | -1): Vote {
  return current === pressed ? 0 : pressed;
}

/**
 * The flat `reactionCounts` with the viewer's one reaction moved from `from`
 * to `to` — the optimistic repaint a toggle draws before the server answers.
 * A `total` key, when present, moves with it.
 */
export function shiftReaction(
  counts: Readonly<Record<string, number>>,
  from: ReactionType | null,
  to: ReactionType | null,
): Record<string, number> {
  const next = { ...counts };
  const bump = (key: string, by: number): void => {
    next[key] = Math.max(0, (next[key] ?? 0) + by);
  };
  if (from !== null) {
    bump(from, -1);
  }
  if (to !== null) {
    bump(to, 1);
  }
  if (typeof counts.total === 'number') {
    bump('total', (to === null ? 0 : 1) - (from === null ? 0 : 1));
  }
  return next;
}

export function isCommunitySlug(value: string | undefined): value is string {
  return value !== undefined && COMMUNITY_SLUG_PATTERN.test(value);
}

export { COMMUNITY_POST_BODY_MAX, COMMUNITY_POST_TITLE_MAX };
export type {
  Community,
  CommunityMembership,
  CommunityPost,
  CommunityPostSort,
  CommunitySort,
  CommunitySummary,
  Vote,
};
