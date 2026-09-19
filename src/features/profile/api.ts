/**
 * Profiles as seen by the renderer — reads, and the caller's own edit: one
 * allowlisted IPC call each.
 */
import type {
  IpcError,
  StagedImage,
  UpdateProfileRequest,
  User,
  UserPostsResponse,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type ProfileError = IpcError;

/**
 * Another user's public profile. Narrower than the signed-in one — no email,
 * no status — but with `friendStatus`, the viewer's relationship as the server
 * sees it.
 */
export async function fetchUser(userId: string): Promise<Result<User, ProfileError>> {
  const result = await ipc.getUser({ userId });
  return result.ok ? ok(result.data.user) : fail(result.error);
}

export async function fetchUserPosts(
  userId: string,
  page: number,
  size: number,
): Promise<Result<UserPostsResponse, ProfileError>> {
  const result = await ipc.listUserPosts({ userId, page, size });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** Edits the caller's own profile; answers with the profile as it now stands. */
export async function updateProfile(
  request: UpdateProfileRequest,
): Promise<Result<User, ProfileError>> {
  const result = await ipc.updateProfile(request);
  return result.ok ? ok(result.data.user) : fail(result.error);
}

/**
 * Opens the OS picker for one profile photo or cover and stages it for
 * preview. `null` when the picker was dismissed, which is not an error.
 */
export async function stageProfileImage(
  purpose: 'avatar' | 'cover',
): Promise<Result<StagedImage | null, ProfileError>> {
  const result = await ipc.stageImages({ purpose });
  return result.ok ? ok(result.data.images[0] ?? null) : fail(result.error);
}

/** Frees a staged photo the user replaced, removed, or never saved. */
export async function discardProfileImages(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) {
    return;
  }
  await ipc.discardImages({ tokens: [...tokens] });
}
