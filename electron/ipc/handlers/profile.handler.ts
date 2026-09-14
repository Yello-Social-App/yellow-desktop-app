/**
 * Profile reads, for the caller and for other users.
 *
 * `GET /users/{id}` returns a narrower record than `/users/me` — no email, no
 * status — plus `friendStatus`, the viewer's relationship as the server sees
 * it. The same schema covers both, because those fields are optional on it.
 *
 * There is no profile edit or avatar upload on this API; the renderer offers
 * neither.
 */
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  ipcOk,
  pageOf,
  postSchema,
  profileResponseSchema,
  publicUserRequestSchema,
  userPostsRequestSchema,
  userPostsResponseSchema,
  userSchema,
  type IpcResult,
  type ProfileResponse,
  type UserPostsResponse,
} from '../../../shared/ipc-types';

const postPageSchema = pageOf(postSchema);

export function registerProfileHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.PROFILE_GET_USER,
    publicUserRequestSchema,
    async ({ userId }): Promise<IpcResult<ProfileResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.users.byId(userId),
        schema: userSchema,
      });

      return result.ok ? ipcOk(profileResponseSchema.parse({ user: result.data })) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.PROFILE_LIST_POSTS,
    userPostsRequestSchema,
    async ({ userId, page, size }): Promise<IpcResult<UserPostsResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.users.posts(userId),
        schema: postPageSchema,
        params: { page, size },
      });

      if (!result.ok) {
        return result;
      }

      return ipcOk(
        userPostsResponseSchema.parse({
          posts: result.data.content,
          page: result.data.page,
          totalElements: result.data.totalElements,
          totalPages: result.data.totalPages,
          last: result.data.last,
        }),
      );
    },
  );
}
