/**
 * Community operations, as seen by the renderer: one allowlisted IPC call each.
 * A community is addressed by its slug, a post by its id.
 */
import type {
  Community,
  CommunityPost,
  CommunityPostPage,
  CommunityPostSort,
  CommunityPostVote,
  CommunityPage,
  IpcError,
  ReactionSummary,
  ReactionType,
  Vote,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import {
  COMMUNITIES_PAGE_SIZE,
  COMMUNITY_POSTS_PAGE_SIZE,
  type DirectoryQuery,
  type PostFeedSource,
} from './types';

export type CommunitiesError = IpcError;

export async function fetchCommunities(
  query: DirectoryQuery,
  page: number,
): Promise<Result<CommunityPage, CommunitiesError>> {
  const result = await ipc.listCommunities({
    sort: query.sort,
    page,
    size: query.size ?? COMMUNITIES_PAGE_SIZE,
    ...(query.q === undefined || query.q.trim() === '' ? {} : { q: query.q.trim() }),
    ...(query.membership === undefined ? {} : { membership: query.membership }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchCommunity(slug: string): Promise<Result<Community, CommunitiesError>> {
  const result = await ipc.getCommunity({ slug });
  return result.ok ? ok(result.data.community) : fail(result.error);
}

/** Joins or leaves; answers with the community as it now stands. */
export async function setMembership(
  slug: string,
  joined: boolean,
): Promise<Result<Community, CommunitiesError>> {
  const result = joined ? await ipc.joinCommunity({ slug }) : await ipc.leaveCommunity({ slug });
  return result.ok ? ok(result.data.community) : fail(result.error);
}

export async function fetchPosts(
  source: PostFeedSource,
  sort: CommunityPostSort,
  cursor: string | null,
): Promise<Result<CommunityPostPage, CommunitiesError>> {
  const paging = {
    sort,
    size: COMMUNITY_POSTS_PAGE_SIZE,
    ...(cursor === null ? {} : { cursor }),
  };
  const result = source.startsWith('c/')
    ? await ipc.listCommunityPosts({ slug: source.slice(2), ...paging })
    : await ipc.listFrontPagePosts({ scope: source === 'joined' ? 'joined' : 'all', ...paging });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function publishCommunityPost(draft: {
  slug: string;
  title: string;
  body: string;
  tag: string;
}): Promise<Result<CommunityPost, CommunitiesError>> {
  const result = await ipc.createCommunityPost(draft);
  return result.ok ? ok(result.data.post) : fail(result.error);
}

/**
 * Adds, changes or removes in one call, as on a feed post: sending the type
 * already held removes it. Answers with the post's summary after the change.
 */
export async function reactToPost(
  postId: string,
  type: ReactionType,
): Promise<Result<ReactionSummary, CommunitiesError>> {
  const result = await ipc.toggleReaction({ targetType: 'COMMUNITY_POST', targetId: postId, type });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function voteOnPost(
  postId: string,
  value: Vote,
): Promise<Result<CommunityPostVote, CommunitiesError>> {
  const result = await ipc.voteCommunityPost({ postId, value });
  return result.ok ? ok(result.data) : fail(result.error);
}
