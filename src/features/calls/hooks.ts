/**
 * Call hooks: the subscription the app shell mounts, and the small reads the
 * call screens share.
 */
import type { Author, ConversationSummary } from '@shared/ipc-types';
import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';
import { useSocketStatus } from '@/features/messages/hooks';
import { useUser } from '@/features/users/hooks';

import { useCallsStore } from './store';

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

/** The person on the other end of the current call, once resolved. */
export function useCallPeer(): Author | undefined {
  const peerId = useCallsStore((state) => state.peerId);
  return useUser(peerId ?? undefined);
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
 * Whether a conversation can be called from here, and if not, why: calls are
 * direct-only, need the live socket, and one at a time.
 */
export function useCallAvailability(conversation: ConversationSummary): {
  canCall: boolean;
  reason: string | null;
} {
  const phase = useCallsStore((state) => state.phase);
  const socket = useSocketStatus();
  if (conversation.type !== 'DIRECT') {
    return { canCall: false, reason: 'Group calls are not available yet' };
  }
  if (phase !== 'idle') {
    return { canCall: false, reason: 'You are already in a call' };
  }
  if (socket !== 'connected') {
    return { canCall: false, reason: 'Reconnecting…' };
  }
  return { canCall: true, reason: null };
}
