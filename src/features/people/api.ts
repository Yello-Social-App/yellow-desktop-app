/**
 * People search, as seen by the renderer: one allowlisted IPC call.
 */
import type { FriendEntryPage, IpcError } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type PeopleError = IpcError;

/** One relevance-ordered page of people matching `query` by name or username. */
export async function searchPeople(
  query: string,
  page: number,
): Promise<Result<FriendEntryPage, PeopleError>> {
  const result = await ipc.searchUsers({ query, page });
  return result.ok ? ok(result.data) : fail(result.error);
}
