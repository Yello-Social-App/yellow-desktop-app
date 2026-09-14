/**
 * Friendship shapes.
 *
 * The records themselves come from the API (see @shared/ipc-types); what lives
 * here is the paging size and the translation from the server's
 * `friendStatus` vocabulary to what a button should read.
 */
import type { FriendEntry, FriendRequestDirection, FriendStatus } from '@shared/ipc-types';

export const FRIENDS_PAGE_SIZE = 20;

/** What to show on a relationship control for one user. */
export type Relationship = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked' | 'self';

/**
 * The server never reveals a block — either side of one reads as NONE — so
 * `blocked` is known only from the blocked list and this session's own block
 * actions. The store tracks it as a local status alongside the server's.
 */
export const LOCAL_BLOCKED_STATUS = 'BLOCKED';

const REPORTED_RELATIONSHIPS: Record<FriendStatus, Relationship> = {
  SELF: 'self',
  FRIENDS: 'friends',
  REQUEST_SENT: 'outgoing',
  REQUEST_RECEIVED: 'incoming',
  NONE: 'none',
};

/** An unknown status (added server-side later) reads as `none` rather than voiding the row (A10). */
export function relationshipOf(status: string | undefined | null): Relationship {
  if (status === LOCAL_BLOCKED_STATUS) {
    return 'blocked';
  }
  if (status !== undefined && status !== null && status in REPORTED_RELATIONSHIPS) {
    return REPORTED_RELATIONSHIPS[status as FriendStatus];
  }
  return 'none';
}

export type { FriendEntry, FriendRequestDirection, FriendStatus };
