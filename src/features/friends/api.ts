/**
 * Friend operations, as seen by the renderer: one allowlisted IPC call each.
 * Every call is addressed by the other user's id.
 */
import type {
  FriendEntry,
  FriendEntryPage,
  FriendRequestDirection,
  IpcError,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { FRIENDS_PAGE_SIZE } from './types';

export type FriendsError = IpcError;

type EntryResult = Promise<Result<FriendEntry, FriendsError>>;
type PageResult = Promise<Result<FriendEntryPage, FriendsError>>;

export function fetchFriends(page = 0, size: number = FRIENDS_PAGE_SIZE): PageResult {
  return ipc.listFriends({ page, size }).then((r) => (r.ok ? ok(r.data) : fail(r.error)));
}

export function fetchFriendRequests(
  direction: FriendRequestDirection,
  page = 0,
  size: number = FRIENDS_PAGE_SIZE,
): PageResult {
  return ipc
    .listFriendRequests({ direction, page, size })
    .then((r) => (r.ok ? ok(r.data) : fail(r.error)));
}

export function fetchBlockedUsers(page = 0, size: number = FRIENDS_PAGE_SIZE): PageResult {
  return ipc.listBlockedUsers({ page, size }).then((r) => (r.ok ? ok(r.data) : fail(r.error)));
}

function entry(call: ReturnType<typeof ipc.sendFriendRequest>): EntryResult {
  return call.then((r) => (r.ok ? ok(r.data.entry) : fail(r.error)));
}

export const sendFriendRequest = (userId: string): EntryResult =>
  entry(ipc.sendFriendRequest({ userId }));
export const cancelFriendRequest = (userId: string): EntryResult =>
  entry(ipc.cancelFriendRequest({ userId }));
export const acceptFriendRequest = (userId: string): EntryResult =>
  entry(ipc.acceptFriendRequest({ userId }));
export const declineFriendRequest = (userId: string): EntryResult =>
  entry(ipc.declineFriendRequest({ userId }));
export const blockUser = (userId: string): EntryResult => entry(ipc.blockUser({ userId }));
export const unblockUser = (userId: string): EntryResult => entry(ipc.unblockUser({ userId }));

export async function removeFriend(userId: string): Promise<Result<true, FriendsError>> {
  const result = await ipc.removeFriend({ userId });
  return result.ok ? ok(true) : fail(result.error);
}
