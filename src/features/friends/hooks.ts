/**
 * Friendship hooks: thin selectors over the store, plus the one derived answer
 * the profile screens, reactor rows and chat need — the relationship with a
 * given user, and the actions that change it.
 */
import { useEffect, useMemo } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';

import { useFriendsStore, type ListName } from './store';
import { relationshipOf, type Relationship } from './types';

/** Loads every list once, then keeps them for the session. */
export function useFriendsLoader(): void {
  const status = useFriendsStore((state) => state.lists.friends.status);
  const loadAll = useFriendsStore((state) => state.loadAll);

  useEffect(() => {
    if (status === 'idle') {
      void loadAll();
    }
  }, [status, loadAll]);
}

/** Opening a screen that shows the lists is when they catch up (throttled in the store). */
export function useFriendsRefreshOnShow(): void {
  const refresh = useFriendsStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);
}

/** How often the lists are re-read while the window is in front. */
const FRIENDS_POLL_MS = 30_000;

/**
 * Keeps the friend lists current while the app is open. The server pushes a
 * notification for a new request and an acceptance (handled where
 * notifications arrive), but nothing when the other side declines, cancels or
 * removes the friendship — so the lists are also re-read when the window comes
 * back to the front, and on a slow poll while it is visible. Mounted once, from
 * the app shell.
 */
export function useFriendsSync(): void {
  const refresh = useFriendsStore((state) => state.refresh);

  useEffect(() => {
    const catchUp = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    const timer = window.setInterval(catchUp, FRIENDS_POLL_MS);
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [refresh]);
}

export function useFriendList(name: ListName) {
  return useFriendsStore((state) => state.lists[name]);
}

/** How many requests are waiting on an answer — for the sidebar badge. */
export function usePendingRequestCount(): number {
  return useFriendsStore((state) => state.lists.received.total);
}

export interface RelationshipControl {
  relationship: Relationship;
  isBusy: boolean;
  sendRequest: () => void;
  cancelRequest: () => void;
  accept: () => void;
  decline: () => void;
  unfriend: () => void;
  block: () => void;
  unblock: () => void;
}

/**
 * The relationship with one user and the actions that change it.
 *
 * Precedence, most recent first: a status this session's own mutation was
 * answered with; then what the caller's row reported (a profile's or a
 * reactor's `friendStatus`, fresh from the server); then what the lists
 * held here say. Loads the lists on demand, since a profile can be opened
 * without visiting /friends.
 */
export function useRelationship(
  userId: string | undefined,
  reported?: string | null,
): RelationshipControl {
  const viewer = useCurrentUser();
  const lists = useFriendsStore((state) => state.lists);
  const statuses = useFriendsStore((state) => state.statuses);
  const pendingIds = useFriendsStore((state) => state.pendingIds);
  // Selected one by one: a fresh object per render would defeat the store's
  // reference check and re-render every subscriber on every store change.
  const sendRequest = useFriendsStore((state) => state.sendRequest);
  const cancelRequest = useFriendsStore((state) => state.cancelRequest);
  const accept = useFriendsStore((state) => state.accept);
  const decline = useFriendsStore((state) => state.decline);
  const unfriend = useFriendsStore((state) => state.unfriend);
  const block = useFriendsStore((state) => state.block);
  const unblock = useFriendsStore((state) => state.unblock);

  useFriendsLoader();

  const relationship = useMemo<Relationship>(() => {
    if (userId === undefined) {
      return 'none';
    }
    if (viewer !== null && viewer.id === userId) {
      return 'self';
    }
    const mutated = statuses[userId];
    if (mutated !== undefined) {
      return relationshipOf(mutated);
    }
    if (reported !== undefined && reported !== null) {
      return relationshipOf(reported);
    }
    const inList = (name: ListName) => lists[name].entries.some((e) => e.user.id === userId);
    if (inList('blocked')) {
      return 'blocked';
    }
    if (inList('friends')) {
      return 'friends';
    }
    if (inList('received')) {
      return 'incoming';
    }
    if (inList('sent')) {
      return 'outgoing';
    }
    return 'none';
  }, [userId, viewer, statuses, reported, lists]);

  const isBusy = userId !== undefined && pendingIds.has(userId);

  return useMemo(() => {
    const run = (action: (id: string) => Promise<boolean>) => () => {
      if (userId !== undefined) {
        void action(userId);
      }
    };
    return {
      relationship,
      isBusy,
      sendRequest: run(sendRequest),
      cancelRequest: run(cancelRequest),
      accept: run(accept),
      decline: run(decline),
      unfriend: run(unfriend),
      block: run(block),
      unblock: run(unblock),
    };
  }, [
    relationship,
    isBusy,
    userId,
    sendRequest,
    cancelRequest,
    accept,
    decline,
    unfriend,
    block,
    unblock,
  ]);
}
