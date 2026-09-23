/**
 * The viewer's saved posts, as seen by the renderer: one allowlisted IPC call.
 * Saving and unsaving a post is a post action (feed/post-actions.ts), because
 * every list's card offers it.
 */
import type { IpcError, UserPostsResponse } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

/** The server caps a page at 50; 20 is its default. */
export const SAVED_PAGE_SIZE = 20;

/** Most recently saved first. */
export async function fetchSavedPosts(page: number): Promise<Result<UserPostsResponse, IpcError>> {
  const result = await ipc.listSavedPosts({ page, size: SAVED_PAGE_SIZE });
  return result.ok ? ok(result.data) : fail(result.error);
}
