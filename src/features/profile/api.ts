/**
 * Profile reads, as seen by the renderer: one allowlisted IPC call each.
 *
 * There is no profile edit or avatar upload on this API, so there is nothing
 * here that writes.
 */
import type { IpcError, User, UserPostsResponse } from '@shared/ipc-types';

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
