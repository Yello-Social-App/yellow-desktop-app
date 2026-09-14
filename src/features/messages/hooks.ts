/**
 * Chat hooks. The join between a conversation and the people in it happens
 * here — ids from the chat service, records from the user directory — so the
 * chat components stay presentational.
 */
import type { Author, ConversationSummary } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrentUser } from '@/features/auth/hooks';
import { useUsers } from '@/features/users/hooks';
import { TYPING_IDLE_MS } from '@/lib/constants';

import { useMessagesStore, type Thread } from './store';
import { conversationTitle, peerIdsOf, type ThreadMessage } from './types';

const NO_MESSAGES_PREVIEW = 'No messages yet';
const EMPTY_THREAD: Thread = {
  messages: [],
  nextCursor: null,
  status: 'idle',
  isLoadingOlder: false,
};

/**
 * Attaches the store to the pushed frames for as long as there is a session,
 * and loads the list once. Mounted from the app shell, so a message arriving
 * on any screen still moves its conversation and bumps the badge.
 */
export function useChatSubscription(): void {
  const user = useCurrentUser();
  const subscribe = useMessagesStore((state) => state.subscribe);
  const load = useMessagesStore((state) => state.load);
  const status = useMessagesStore((state) => state.status);
  const userId = user?.id;

  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    return subscribe(userId);
  }, [userId, subscribe]);

  useEffect(() => {
    if (userId !== undefined && status === 'idle') {
      void load();
    }
  }, [userId, status, load]);
}

/** A conversation with everything the list needs to draw it. */
export interface ConversationRow {
  conversation: ConversationSummary;
  title: string;
  /** Everyone but the viewer, resolved; placeholders while loading. */
  peers: Author[];
  preview: string;
  previewIsMine: boolean;
  isOnline: boolean;
  unreadCount: number;
}

function usePeopleFor(conversations: readonly ConversationSummary[], viewerId: string | undefined) {
  const ids = useMemo(() => {
    const all = new Set<string>();
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        all.add(participant.userId);
      }
      if (conversation.lastMessage !== null) {
        all.add(conversation.lastMessage.senderId);
      }
    }
    if (viewerId !== undefined) {
      all.delete(viewerId);
    }
    return [...all];
  }, [conversations, viewerId]);
  return useUsers(ids);
}

export function useConversationRows(): {
  rows: ConversationRow[];
  status: ReturnType<typeof useMessagesStore.getState>['status'];
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
} {
  const user = useCurrentUser();
  const conversations = useMessagesStore((state) => state.conversations);
  const status = useMessagesStore((state) => state.status);
  const error = useMessagesStore((state) => state.error);
  const nextCursor = useMessagesStore((state) => state.nextCursor);
  const isLoadingMore = useMessagesStore((state) => state.isLoadingMore);
  const loadMore = useMessagesStore((state) => state.loadMore);
  const online = useMessagesStore((state) => state.socket.onlineUserIds);
  const people = usePeopleFor(conversations, user?.id);

  const rows = useMemo<ConversationRow[]>(() => {
    const viewerId = user?.id ?? '';
    const onlineSet = new Set(online);
    return conversations.map((conversation) => {
      const peerIds = peerIdsOf(conversation, viewerId);
      const last = conversation.lastMessage;
      return {
        conversation,
        title: conversationTitle(conversation, viewerId, people),
        peers: peerIds.map((id) => people[id]).filter((p): p is Author => p !== undefined),
        preview: last === null ? NO_MESSAGES_PREVIEW : last.body,
        previewIsMine: last !== null && last.senderId === viewerId,
        isOnline: peerIds.some((id) => onlineSet.has(id)),
        unreadCount: conversation.unreadCount,
      };
    });
  }, [conversations, people, online, user]);

  return {
    rows,
    status,
    error,
    hasMore: nextCursor !== null,
    isLoadingMore,
    loadMore: () => {
      void loadMore();
    },
  };
}

/** Sum of unread across conversations — the sidebar badge. */
export function useUnreadMessageCount(): number {
  return useMessagesStore((state) =>
    state.conversations.reduce((sum, item) => sum + item.unreadCount, 0),
  );
}

export function useSocketStatus() {
  return useMessagesStore((state) => state.socket.status);
}

export function useIsOnline(userId: string | undefined): boolean {
  return useMessagesStore(
    (state) => userId !== undefined && state.socket.onlineUserIds.includes(userId),
  );
}

/** Opens the conversation in the URL, and closes it when the URL has none. */
export function useOpenConversation(conversationId: string | undefined): void {
  const open = useMessagesStore((state) => state.open);
  const status = useMessagesStore((state) => state.status);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    void open(conversationId ?? null);
  }, [conversationId, status, open]);
}

export function useActiveConversation(): ConversationRow | null {
  const { rows } = useConversationRows();
  const activeId = useMessagesStore((state) => state.activeConversationId);
  return useMemo(
    () => rows.find((row) => row.conversation.id === activeId) ?? null,
    [rows, activeId],
  );
}

export function useActiveThread(): Thread & { loadOlder: () => void } {
  const activeId = useMessagesStore((state) => state.activeConversationId);
  const thread = useMessagesStore((state) =>
    activeId === null ? EMPTY_THREAD : (state.threads[activeId] ?? EMPTY_THREAD),
  );
  const loadOlder = useMessagesStore((state) => state.loadOlder);
  return {
    ...thread,
    loadOlder: () => {
      if (activeId !== null) {
        void loadOlder(activeId);
      }
    },
  };
}

/** Who has read up to which message, keyed by message id, for the receipts. */
export function useReadReceipts(): Record<string, string[]> {
  const conversation = useMessagesStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  );
  const viewerId = useMessagesStore((state) => state.viewerId);
  return useMemo(() => {
    const receipts: Record<string, string[]> = {};
    if (conversation === undefined) {
      return receipts;
    }
    for (const participant of conversation.participants) {
      if (participant.userId === viewerId || participant.lastReadMessageId === undefined) {
        continue;
      }
      const readers = receipts[participant.lastReadMessageId] ?? [];
      readers.push(participant.userId);
      receipts[participant.lastReadMessageId] = readers;
    }
    return receipts;
  }, [conversation, viewerId]);
}

/** The peers currently typing in the active conversation, as people. */
export function useTypingPeers(): Author[] {
  const activeId = useMessagesStore((state) => state.activeConversationId);
  const typing = useMessagesStore((state) =>
    activeId === null ? undefined : state.typing[activeId],
  );
  const [now, setNow] = useState(() => Date.now());

  const liveIds = useMemo(
    () =>
      typing === undefined
        ? []
        : Object.entries(typing)
            .filter(([, expiresAt]) => expiresAt > now)
            .map(([id]) => id),
    [typing, now],
  );

  // Ticks only while there is a signal that could expire.
  useEffect(() => {
    if (liveIds.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [liveIds.length]);

  const people = useUsers(liveIds);
  return liveIds.map((id) => people[id]).filter((p): p is Author => p !== undefined);
}

export interface Composer {
  send: (body: string) => Promise<boolean>;
  retry: (message: ThreadMessage) => void;
  /** Call on every keystroke; the typing signal is raised once and dropped when idle. */
  onInput: () => void;
  isSending: boolean;
  hasConversation: boolean;
}

export function useComposer(): Composer {
  const send = useMessagesStore((state) => state.send);
  const retry = useMessagesStore((state) => state.retry);
  const setTyping = useMessagesStore((state) => state.setTyping);
  const isSending = useMessagesStore((state) => state.isSending);
  const hasConversation = useMessagesStore((state) => state.activeConversationId !== null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const stopTyping = useCallback(() => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (isTyping.current) {
      isTyping.current = false;
      setTyping(false);
    }
  }, [setTyping]);

  const onInput = useCallback(() => {
    if (!isTyping.current) {
      isTyping.current = true;
      setTyping(true);
    }
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
    }
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [setTyping, stopTyping]);

  useEffect(() => stopTyping, [stopTyping]);

  return {
    send: async (body) => {
      stopTyping();
      return send(body);
    },
    retry: (message) => {
      void retry(message.clientId);
    },
    onInput,
    isSending,
    hasConversation,
  };
}

/** Starts (or finds) a conversation and goes to it. */
export function useStartConversation(): {
  direct: (peerId: string) => Promise<void>;
  group: (title: string, memberIds: string[]) => Promise<void>;
  isStarting: boolean;
} {
  const navigate = useNavigate();
  const startDirect = useMessagesStore((state) => state.startDirect);
  const startGroup = useMessagesStore((state) => state.startGroup);
  const [isStarting, setIsStarting] = useState(false);

  const go = useCallback(
    async (started: Promise<string | null>) => {
      setIsStarting(true);
      const id = await started;
      setIsStarting(false);
      if (id !== null) {
        await navigate(`/messages/${encodeURIComponent(id)}`);
      }
    },
    [navigate],
  );

  return {
    direct: (peerId) => go(startDirect(peerId)),
    group: (title, memberIds) => go(startGroup(title, memberIds)),
    isStarting,
  };
}

export function useActivePeers(): Author[] {
  // Selected as stable references and derived here: a selector returning a
  // fresh array would re-render on every store change.
  const conversation = useMessagesStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  );
  const viewerId = useMessagesStore((state) => state.viewerId);
  const ids = useMemo(
    () =>
      conversation === undefined || viewerId === null ? [] : peerIdsOf(conversation, viewerId),
    [conversation, viewerId],
  );
  const people = useUsers(ids);
  return ids.map((id) => people[id]).filter((p): p is Author => p !== undefined);
}
