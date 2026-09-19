/**
 * Profiles: reading one, and editing the caller's own.
 *
 * `GET /users/{id}` returns a narrower record than `/users/me` — no email, no
 * status — plus `friendStatus`, the viewer's relationship as the server sees
 * it. The same schema covers both, because those fields are optional on it.
 *
 * An edit's avatar and cover are staged first (feed.handler.ts owns the
 * picker), so the renderer hands back tokens and never a path or the bytes
 * (OWASP A01).
 */
import { createLogger } from '../../../shared/logger';
import { accountProfileOf, hasAccount, markAccountActive } from '../../api/account-vault';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';
import type { ImagePart } from '../image-picker';
import { discardStagedImages, resolveStagedImages } from '../staged-images';

import {
  ipcOk,
  pageOf,
  postSchema,
  profileResponseSchema,
  publicUserRequestSchema,
  updateProfileRequestSchema,
  userPostsRequestSchema,
  userPostsResponseSchema,
  userSchema,
  type IpcResult,
  type ProfileResponse,
  type UpdateProfileRequest,
  type UserPostsResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.profile');

const postPageSchema = pageOf(postSchema);

/** The text fields an edit may carry, with absent ones left out entirely. */
function textFieldsOf(request: UpdateProfileRequest): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  if (request.username !== undefined) {
    fields.username = request.username;
  }
  if (request.fullName !== undefined) {
    fields.fullName = request.fullName;
  }
  if (request.bio !== undefined) {
    fields.bio = request.bio;
  }
  return fields;
}

/**
 * The body for an edit. JSON when no image is attached, because only JSON can
 * say `null`; multipart when one is, where a cleared field goes as an empty
 * string — the Laravel API converts empty strings to null on the way in, so
 * the meaning survives the form encoding.
 */
function editBodyOf(
  request: UpdateProfileRequest,
  avatar: ImagePart | undefined,
  cover: ImagePart | undefined,
): unknown {
  const fields = textFieldsOf(request);

  if (avatar === undefined && cover === undefined) {
    return {
      ...fields,
      ...(request.removeAvatar === true ? { removeAvatar: true } : {}),
      ...(request.removeCover === true ? { removeCover: true } : {}),
    };
  }

  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value ?? '');
  }
  if (avatar !== undefined) {
    form.append('avatar', avatar.blob, avatar.fileName);
  } else if (request.removeAvatar === true) {
    form.append('removeAvatar', '1');
  }
  if (cover !== undefined) {
    form.append('cover', cover.blob, cover.fileName);
  } else if (request.removeCover === true) {
    form.append('removeCover', '1');
  }
  return form;
}

/** The staged part behind an optional token; a stale token is a refusal (A10). */
function stagedPartOf(token: string | undefined): IpcResult<ImagePart | undefined> {
  if (token === undefined) {
    return ipcOk(undefined);
  }
  const staged = resolveStagedImages([token]);
  return staged.ok ? ipcOk(staged.data[0]) : staged;
}

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

  registerIpcHandler(
    IPC_CHANNELS.PROFILE_UPDATE,
    updateProfileRequestSchema,
    async (request): Promise<IpcResult<ProfileResponse>> => {
      // Both resolved before anything is sent: half an edit is worse than a
      // refusal the dialog can explain.
      const avatar = stagedPartOf(request.avatarToken);
      if (!avatar.ok) {
        return avatar;
      }
      const cover = stagedPartOf(request.coverToken);
      if (!cover.ok) {
        return cover;
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.users.me,
        body: editBodyOf(request, avatar.data, cover.data),
        schema: userSchema,
      });

      if (!result.ok) {
        // Staged images stay, so a retry after fixing a field needs no re-pick.
        return result;
      }

      const tokens = [request.avatarToken, request.coverToken].filter(
        (token): token is string => token !== undefined,
      );
      discardStagedImages(tokens);

      // The account switcher shows this name and face too.
      if (hasAccount(result.data.id)) {
        await markAccountActive(accountProfileOf(result.data));
      }

      log.info('profile_updated', { images: tokens.length });
      return ipcOk(profileResponseSchema.parse({ user: result.data }));
    },
  );
}
