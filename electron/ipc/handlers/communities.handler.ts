/**
 * Communities: the directory, one community, joining and leaving, its posts,
 * the front page across all of them, starting a thread, and voting.
 *
 * Every read works signed out upstream; here a token is always attached, so
 * the viewer fields (`isMember`, `viewerVote`, `isOwner`) are always filled.
 *
 * Joining and leaving are idempotent and both answer with the whole community,
 * so the renderer replaces its copy with the server's count rather than
 * guessing one. A vote is an absolute value, not a toggle: the renderer works
 * out the next state, so a retry cannot flip it the wrong way.
 */
import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS, type IpcChannel } from '../channels';
import { registerIpcHandler } from '../register';

import {
  communityPageSchema,
  communityPostPageSchema,
  communityPostSchema,
  communityPostVoteSchema,
  communitySchema,
  communitySlugRequestSchema,
  createCommunityPostRequestSchema,
  ipcOk,
  listCommunitiesRequestSchema,
  listCommunityPostsRequestSchema,
  listFrontPagePostsRequestSchema,
  voteCommunityPostRequestSchema,
  type CommunityPage,
  type CommunityPostPage,
  type CommunityPostResponse,
  type CommunityPostVote,
  type CommunityResponse,
  type IpcResult,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.communities');

/** Join and leave differ only in verb, so they are one table. */
const MEMBERSHIP: readonly { channel: IpcChannel; method: 'post' | 'delete'; event: string }[] = [
  { channel: IPC_CHANNELS.COMMUNITIES_JOIN, method: 'post', event: 'community_joined' },
  { channel: IPC_CHANNELS.COMMUNITIES_LEAVE, method: 'delete', event: 'community_left' },
];

export function registerCommunityHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_LIST,
    listCommunitiesRequestSchema,
    async ({ q, membership, sort, page, size }): Promise<IpcResult<CommunityPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.communities.list,
        schema: communityPageSchema,
        params: {
          sort,
          page,
          size,
          // A blank search is no search; sending `q=` only costs a filter pass.
          ...(q === undefined || q === '' ? {} : { q }),
          ...(membership === undefined ? {} : { membership }),
        },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_GET,
    communitySlugRequestSchema,
    async ({ slug }): Promise<IpcResult<CommunityResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.communities.bySlug(slug),
        schema: communitySchema,
      });
      return result.ok ? ipcOk({ community: result.data }) : result;
    },
  );

  for (const change of MEMBERSHIP) {
    registerIpcHandler(
      change.channel,
      communitySlugRequestSchema,
      async ({ slug }): Promise<IpcResult<CommunityResponse>> => {
        const result = await apiRequest({
          method: change.method,
          url: ENDPOINTS.communities.membership(slug),
          schema: communitySchema,
        });

        if (!result.ok) {
          return result;
        }

        log.info(change.event, {});
        return ipcOk({ community: result.data });
      },
    );
  }

  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_LIST_POSTS,
    listCommunityPostsRequestSchema,
    async ({ slug, sort, size, cursor }): Promise<IpcResult<CommunityPostPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.communities.posts(slug),
        schema: communityPostPageSchema,
        params: { sort, size, ...(cursor === undefined ? {} : { cursor }) },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_FRONT_PAGE,
    listFrontPagePostsRequestSchema,
    async ({ scope, sort, size, cursor }): Promise<IpcResult<CommunityPostPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.communityPosts.frontPage,
        schema: communityPostPageSchema,
        params: { scope, sort, size, ...(cursor === undefined ? {} : { cursor }) },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_CREATE_POST,
    createCommunityPostRequestSchema,
    async ({ slug, title, body, tag }): Promise<IpcResult<CommunityPostResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.communities.posts(slug),
        // Only the three documented fields: server-owned ones are ignored
        // upstream anyway, and sending none means none can be spoofed.
        body: { title, body, tag },
        schema: communityPostSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('community_post_created', {});
      return ipcOk({ post: result.data });
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.COMMUNITIES_VOTE,
    voteCommunityPostRequestSchema,
    async ({ postId, value }): Promise<IpcResult<CommunityPostVote>> =>
      apiRequest({
        method: 'put',
        url: ENDPOINTS.communityPosts.vote(postId),
        body: { value },
        schema: communityPostVoteSchema,
      }),
  );
}
