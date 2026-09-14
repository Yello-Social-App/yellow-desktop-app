/**
 * Friendship hooks: thin selectors over the store, plus the one derived answer
 * the profile screens need.
 */
import type { FriendStatus } from '@shared/ipc-types';
import { useEffect, useMemo } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';

import { useFriendsStore, type Relationship } from './store';

/** Loads both pages once, then keeps them for the session. */
export function useFriendsLoader(): void {
  const status = useFriendsStore((state) => state.status);
  const load = useFriendsStore((state) => state.load);

  useEffect(() => {
    if (status === 'idle') {
      void load();
    }
  }, [status, load]);
}

/** How many requests are waiting on an answer — for the sidebar badge. */
export function usePendingRequestCount(): number {
  return useFriendsStore((state) => state.requests.length);
}

export interface RelationshipControl {
  relationship: Relationship;
  /** The friendship id, when there is an incoming request to answer. */
  friendshipId: string | null;
  isBusy: boolean;
  sendRequest: () => void;
  accept: () => void;
  decline: () => void;
  unfriend: () => void;
}

/**
 * The friendship state with one user and the actions that change it. Loads the
 * lists on demand, since a profile can be opened without visiting /friends.
 */
export function useRelationship(userId: string | undefined): RelationshipControl {
  const viewer = useCurrentUser();
  const friends = useFriendsStore((state) => state.friends);
  const requests = useFriendsStore((state) => state.requests);
  const sentRequests = useFriendsStore((state) => state.sentRequests);
  const pendingIds = useFriendsStore((state) => state.pendingIds);
  const sendRequest = useFriendsStore((state) => state.sendRequest);
  const accept = useFriendsStore((state) => state.accept);
  const decline = useFriendsStore((state) => state.decline);
  const unfriend = useFriendsStore((state) => state.unfriend);

  useFriendsLoader();

  const friendshipId = useMemo(
    () =>
      userId === undefined ? null : (requests.find((item) => item.user.id === userId)?.id ?? null),
    [requests, userId],
  );

  const relationship: Relationship = useMemo(() => {
    if (userId === undefined) {
      return 'none';
    }
    if (viewer !== null && viewer.id === userId) {
      return 'self';
    }
    if (friends.some((item) => item.user.id === userId)) {
      return 'friends';
    }
    if (friendshipId !== null) {
      return 'incoming';
    }
    if (sentRequests.has(userId)) {
      return 'outgoing';
    }
    return 'none';
  }, [userId, viewer, friends, friendshipId, sentRequests]);

  const isBusy =
    userId !== undefined &&
    (pendingIds.has(userId) || (friendshipId !== null && pendingIds.has(friendshipId)));

  return {
    relationship,
    friendshipId,
    isBusy,
    sendRequest: () => {
      if (userId !== undefined) {
        void sendRequest(userId);
      }
    },
    accept: () => {
      if (friendshipId !== null) {
        void accept(friendshipId);
      }
    },
    decline: () => {
      if (friendshipId !== null) {
        void decline(friendshipId);
      }
    },
    unfriend: () => {
      if (userId !== undefined) {
        void unfriend(userId);
      }
    },
  };
}

/** The server's `friendStatus` vocabulary, in this store's terms. */
const REPORTED_RELATIONSHIPS: Record<FriendStatus, Relationship> = {
  SELF: 'self',
  FRIENDS: 'friends',
  REQUEST_SENT: 'outgoing',
  REQUEST_RECEIVED: 'incoming',
  NONE: 'none',
};

function isFriendStatus(value: string | undefined): value is FriendStatus {
  return value !== undefined && value in REPORTED_RELATIONSHIPS;
}

/**
 * A relationship control for a row the *server* has already classified — a
 * reactor, say — rather than one derived from the lists held here.
 *
 * The server's answer wins because it knows things this store cannot: an
 * outgoing request sent from another device, for one. The actions are still
 * the store's, and `onChanged` fires after any of them succeeds so the caller
 * can re-read the row rather than guess the new status. An unknown status
 * (added server-side later) falls back to the derived answer (A10).
 */
export function useReportedRelationship(
  userId: string,
  reported: string | undefined,
  onChanged: () => void,
): RelationshipControl {
  const derived = useRelationship(userId);
  const relationship = isFriendStatus(reported)
    ? REPORTED_RELATIONSHIPS[reported]
    : derived.relationship;

  // An incoming request can only be answered with its friendship id, which
  // the reactor row does not carry; the requests list is where it lives.
  const requests = useFriendsStore((state) => state.requests);
  const friendshipId = useMemo(
    () => requests.find((item) => item.user.id === userId)?.id ?? null,
    [requests, userId],
  );

  const sendRequest = useFriendsStore((state) => state.sendRequest);
  const accept = useFriendsStore((state) => state.accept);
  const decline = useFriendsStore((state) => state.decline);
  const unfriend = useFriendsStore((state) => state.unfriend);

  const after = (done: Promise<boolean>): void => {
    void done.then((changed) => {
      if (changed) {
        onChanged();
      }
    });
  };

  return {
    relationship,
    friendshipId,
    isBusy: derived.isBusy,
    sendRequest: () => {
      after(sendRequest(userId));
    },
    accept: () => {
      if (friendshipId !== null) {
        after(accept(friendshipId));
      }
    },
    decline: () => {
      if (friendshipId !== null) {
        after(decline(friendshipId));
      }
    },
    unfriend: () => {
      after(unfriend(userId));
    },
  };
}
