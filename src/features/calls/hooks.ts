/**
 * Call hooks: the subscription the app shell mounts, and the small reads the
 * call screens share.
 */
import type { Author, Call, ConversationSummary } from '@shared/ipc-types';
import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';
import { useSocketStatus } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { useUser } from '@/features/users/hooks';
import { displayName } from '@/lib/user-display';

import { useCallsStore } from './store';
import { ownState } from './types';

/**
 * Attaches the call store to the chat frames for as long as there is a
 * session. Mounted from the app shell, so a call rings on any screen.
 */
export function useCallSubscription(): void {
  const userId = useCurrentUser()?.id;
  const subscribe = useCallsStore((state) => state.subscribe);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    return subscribe(userId);
  }, [userId, subscribe]);
}

/** The other person in a direct call, or whoever started a group call, once resolved. */
export function useCallPeer(): Author | undefined {
  const peerId = useCallsStore((state) => state.peerId);
  return useUser(peerId ?? undefined);
}

/** Whether the current call is a group call, known before the service has answered. */
export function useIsGroupCall(): boolean {
  const kind = useCallsStore((state) => state.call?.kind);
  const conversationId = useCallsStore((state) => state.conversationId);
  const conversationType = useMessagesStore(
    (state) => state.conversations.find((item) => item.id === conversationId)?.type,
  );
  return kind === undefined ? conversationType === 'GROUP' : kind === 'GROUP';
}

/** What the call screens call the call: the other person, or the group's name. */
export function useCallTitle(): string {
  const conversationId = useCallsStore((state) => state.conversationId);
  const isGroup = useIsGroupCall();
  const groupTitle = useMessagesStore(
    (state) => state.conversations.find((item) => item.id === conversationId)?.title,
  );
  const peer = useCallPeer();
  if (isGroup) {
    return groupTitle ?? 'Group call';
  }
  return peer === undefined ? 'Call' : displayName(peer);
}

/**
 * A conversation's live call for its "Join call" bar: fetched when the chat
 * opens and again after every reconnect, then kept current by the call frames.
 */
export function useConversationLiveCall(conversationId: string): Call | null {
  const load = useCallsStore((state) => state.loadConversationCall);
  const socket = useSocketStatus();
  const isConnected = socket === 'connected';
  useEffect(() => {
    if (isConnected) {
      void load(conversationId);
    }
  }, [conversationId, isConnected, load]);
  return useCallsStore((state) => state.liveCalls[conversationId] ?? null);
}

/** Seconds since `answeredAt`, ticking once a second; null until answered. */
export function useCallElapsed(answeredAt: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (answeredAt === null || answeredAt === undefined) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [answeredAt]);
  if (answeredAt === null || answeredAt === undefined) {
    return null;
  }
  const started = Date.parse(answeredAt);
  return Number.isNaN(started) ? null : Math.max(0, (now - started) / 1000);
}

/**
 * Whether a conversation can be called from here, and if not, why: calls
 * need someone else to ring, the live socket, and one at a time. A group with
 * a call already going on is joined rather than called (`isLive`).
 */
export function useCallAvailability(conversation: ConversationSummary): {
  canCall: boolean;
  reason: string | null;
  isLive: boolean;
} {
  const phase = useCallsStore((state) => state.phase);
  const viewerId = useCallsStore((state) => state.viewerId);
  const live = useCallsStore((state) => state.liveCalls[conversation.id]);
  const socket = useSocketStatus();
  const isLive = live !== undefined && ownState(live, viewerId) !== 'INVITED';
  const result = (canCall: boolean, reason: string | null) => ({ canCall, reason, isLive });
  if (conversation.type === 'GROUP' && conversation.participants.length < 2) {
    return result(false, 'Nobody else is here to call');
  }
  if (phase !== 'idle') {
    return result(false, 'You are already in a call');
  }
  if (socket !== 'connected') {
    return result(false, 'Reconnecting…');
  }
  return result(true, null);
}
