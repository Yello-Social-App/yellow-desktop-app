/**
 * Chat state.
 *
 * Conversations, the loaded threads, the live socket's state and who is
 * typing are all read by more than one component, so they sit in one store.
 * The store is also where pushed frames land (`handleEvent`), so a message
 * arriving while the user is on the feed still moves its conversation to the
 * top and bumps the badge.
 *
 * Sending is optimistic and reconciled on `clientId`: the line is drawn at
 * once as `sending`, and whichever arrives first — the reply to the send or
 * the `message.new` echo every participant gets — replaces it with the
 * server's record. The same key makes a retry safe: the service returns the
 * original message rather than a duplicate.
 *
 * Threads are held newest-last for display; the wire is newest-first and
 * older pages are prepended.
 */
import type {
  ChatMessage,
  ChatSocketState,
  ChatEvent,
  ConversationSummary,
} from '@shared/ipc-types';
import { create } from 'zustand';

import { useUsersStore } from '@/features/users/store';
import { onChatEvent, ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';

import {
  createConversation,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  markRead,
  sendMessage,
  sendTyping,
} from './api';
import type { ThreadMessage } from './types';

const log = createLogger('messages.store');

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Thread {
  messages: ThreadMessage[];
  nextCursor: string | null;
  status: LoadStatus;
  isLoadingOlder: boolean;
}

const EMPTY_THREAD: Thread = {
  messages: [],
  nextCursor: null,
  status: 'idle',
  isLoadingOlder: false,
};

/** How long a typing signal is shown without a fresh one. */
const TYPING_TTL_MS = 5000;

interface MessagesState {
  viewerId: string | null;
  status: LoadStatus;
  error: string | null;
  conversations: ConversationSummary[];
  nextCursor: string | null;
  isLoadingMore: boolean;
  threads: Record<string, Thread>;
  activeConversationId: string | null;
  socket: ChatSocketState;
  /** conversation id → user id → when their typing signal expires. */
  typing: Record<string, Record<string, number>>;
  isSending: boolean;

  /** Attaches to the pushed frames; returns the detach. Mount once per session. */
  subscribe: (viewerId: string) => () => void;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  open: (conversationId: string | null) => Promise<void>;
  loadOlder: (conversationId: string) => Promise<void>;
  send: (body: string) => Promise<boolean>;
  retry: (clientId: string) => Promise<boolean>;
  markActiveRead: () => void;
  setTyping: (typing: boolean) => void;
  startDirect: (peerId: string) => Promise<string | null>;
  startGroup: (title: string, memberIds: string[]) => Promise<string | null>;
  handleEvent: (event: ChatEvent) => void;
  clearError: () => void;
}

function byActivity(a: ConversationSummary, b: ConversationSummary): number {
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
}

function upsertConversation(
  list: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  const rest = list.filter((item) => item.id !== conversation.id);
  return [conversation, ...rest].sort(byActivity);
}

function asThreadMessage(message: ChatMessage): ThreadMessage {
  return { ...message, delivery: 'sent' };
}

/**
 * Puts a confirmed message into a thread: replaces the optimistic line with
 * the same `clientId`, drops a duplicate by id, appends otherwise.
 */
function reconcile(thread: Thread, message: ChatMessage): Thread {
  const confirmed = asThreadMessage(message);
  const byClient =
    message.clientId === ''
      ? -1
      : thread.messages.findIndex((m) => m.clientId === message.clientId);
  if (byClient !== -1) {
    const messages = [...thread.messages];
    messages[byClient] = confirmed;
    return { ...thread, messages };
  }
  if (thread.messages.some((m) => m.id === message.id)) {
    return thread;
  }
  return { ...thread, messages: [...thread.messages, confirmed] };
}

function localId(clientId: string): string {
  return `local:${clientId}`;
}

export const useMessagesStore = create<MessagesState>((set, get) => {
  function withThread(conversationId: string, update: (thread: Thread) => Thread): void {
    set((state) => ({
      threads: {
        ...state.threads,
        [conversationId]: update(state.threads[conversationId] ?? EMPTY_THREAD),
      },
    }));
  }

  function primePeople(conversations: readonly ConversationSummary[]): void {
    const ids = new Set<string>();
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        ids.add(participant.userId);
      }
    }
    void useUsersStore.getState().resolve([...ids]);
  }

  /** Adopts a conversation the list did not have yet (a new one, or a missed one). */
  async function adopt(conversationId: string): Promise<ConversationSummary | null> {
    const known = get().conversations.find((item) => item.id === conversationId);
    if (known !== undefined) {
      return known;
    }
    const result = await fetchConversation(conversationId);
    if (!result.ok) {
      return null;
    }
    primePeople([result.data]);
    set((state) => ({ conversations: upsertConversation(state.conversations, result.data) }));
    return result.data;
  }

  async function deliver(conversationId: string, clientId: string, body: string): Promise<boolean> {
    set({ isSending: true });
    const result = await sendMessage(conversationId, clientId, body);
    set({ isSending: false });

    if (!result.ok) {
      withThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.clientId === clientId ? { ...m, delivery: 'failed' } : m,
        ),
      }));
      set({ error: result.error.message });
      return false;
    }

    withThread(conversationId, (thread) => reconcile(thread, result.data));
    set((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation === undefined) {
        return {};
      }
      return {
        conversations: upsertConversation(state.conversations, {
          ...conversation,
          lastMessage: result.data,
          lastMessageAt: result.data.createdAt,
        }),
        error: null,
      };
    });
    return true;
  }

  return {
    viewerId: null,
    status: 'idle',
    error: null,
    conversations: [],
    nextCursor: null,
    isLoadingMore: false,
    threads: {},
    activeConversationId: null,
    socket: { status: 'disconnected', onlineUserIds: [] },
    typing: {},
    isSending: false,

    subscribe: (viewerId) => {
      set({ viewerId });
      const detach = onChatEvent((event) => {
        get().handleEvent(event);
      });
      void ipc.chatSocketState().then((result) => {
        if (result.ok) {
          set({ socket: result.data });
        }
      });
      return () => {
        detach();
        // A new session starts clean; nothing from this one may leak across.
        set({
          viewerId: null,
          status: 'idle',
          conversations: [],
          nextCursor: null,
          threads: {},
          activeConversationId: null,
          typing: {},
          socket: { status: 'disconnected', onlineUserIds: [] },
        });
      };
    },

    load: async () => {
      set({ status: 'loading', error: null });
      const result = await fetchConversations();
      if (!result.ok) {
        set({ status: 'error', error: result.error.message });
        return;
      }
      primePeople(result.data.items);
      set({
        conversations: [...result.data.items].sort(byActivity),
        nextCursor: result.data.nextCursor,
        status: 'ready',
      });
    },

    loadMore: async () => {
      const { nextCursor, isLoadingMore } = get();
      if (nextCursor === null || isLoadingMore) {
        return;
      }
      set({ isLoadingMore: true });
      const result = await fetchConversations(nextCursor);
      set({ isLoadingMore: false });
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      primePeople(result.data.items);
      set((state) => ({
        conversations: [...state.conversations, ...result.data.items].sort(byActivity),
        nextCursor: result.data.nextCursor,
      }));
    },

    open: async (conversationId) => {
      set({ activeConversationId: conversationId });
      if (conversationId === null) {
        return;
      }

      const conversation = await adopt(conversationId);
      if (conversation === null) {
        set({ error: 'That conversation could not be opened.' });
        return;
      }

      const thread = get().threads[conversationId] ?? EMPTY_THREAD;
      if (thread.status === 'idle' || thread.status === 'error') {
        withThread(conversationId, (t) => ({ ...t, status: 'loading' }));
        const result = await fetchMessages(conversationId);
        if (!result.ok) {
          withThread(conversationId, (t) => ({ ...t, status: 'error' }));
          set({ error: result.error.message });
          return;
        }
        withThread(conversationId, () => ({
          messages: [...result.data.items].reverse().map(asThreadMessage),
          nextCursor: result.data.nextCursor,
          status: 'ready',
          isLoadingOlder: false,
        }));
      }

      get().markActiveRead();
    },

    loadOlder: async (conversationId) => {
      const thread = get().threads[conversationId];
      if (thread === undefined) {
        return;
      }
      if (thread.nextCursor === null || thread.isLoadingOlder) {
        return;
      }
      withThread(conversationId, (t) => ({ ...t, isLoadingOlder: true }));
      const result = await fetchMessages(conversationId, thread.nextCursor);
      if (!result.ok) {
        withThread(conversationId, (t) => ({ ...t, isLoadingOlder: false }));
        set({ error: result.error.message });
        return;
      }
      withThread(conversationId, (t) => {
        const known = new Set(t.messages.map((m) => m.id));
        const older = [...result.data.items]
          .reverse()
          .filter((m) => !known.has(m.id))
          .map(asThreadMessage);
        return {
          ...t,
          messages: [...older, ...t.messages],
          nextCursor: result.data.nextCursor,
          isLoadingOlder: false,
        };
      });
    },

    send: async (body) => {
      const { activeConversationId, viewerId } = get();
      if (activeConversationId === null || viewerId === null) {
        return false;
      }

      const clientId = crypto.randomUUID();
      const optimistic: ThreadMessage = {
        id: localId(clientId),
        conversationId: activeConversationId,
        senderId: viewerId,
        clientId,
        body,
        createdAt: new Date().toISOString(),
        delivery: 'sending',
      };
      withThread(activeConversationId, (thread) => ({
        ...thread,
        messages: [...thread.messages, optimistic],
      }));

      return deliver(activeConversationId, clientId, body);
    },

    retry: async (clientId) => {
      const { activeConversationId } = get();
      if (activeConversationId === null) {
        return false;
      }
      const line = get().threads[activeConversationId]?.messages.find(
        (m) => m.clientId === clientId,
      );
      if (line === undefined) {
        return false;
      }
      withThread(activeConversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.clientId === clientId ? { ...m, delivery: 'sending' } : m,
        ),
      }));
      return deliver(activeConversationId, clientId, line.body);
    },

    markActiveRead: () => {
      const { activeConversationId, threads, conversations, viewerId } = get();
      if (activeConversationId === null || viewerId === null) {
        return;
      }
      const thread = threads[activeConversationId];
      const conversation = conversations.find((item) => item.id === activeConversationId);
      if (thread === undefined || conversation === undefined) {
        return;
      }

      // The marker is the newest confirmed line, whoever wrote it.
      const newest = [...thread.messages].reverse().find((m) => m.delivery === 'sent');
      if (newest === undefined) {
        return;
      }
      const mine = conversation.participants.find((p) => p.userId === viewerId);
      if (conversation.unreadCount === 0 && mine?.lastReadMessageId === newest.id) {
        return;
      }

      set((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === activeConversationId
            ? {
                ...item,
                unreadCount: 0,
                participants: item.participants.map((p) =>
                  p.userId === viewerId
                    ? { ...p, lastReadMessageId: newest.id, lastReadAt: new Date().toISOString() }
                    : p,
                ),
              }
            : item,
        ),
      }));
      void markRead(activeConversationId, newest.id);
    },

    setTyping: (typing) => {
      const { activeConversationId } = get();
      if (activeConversationId !== null) {
        sendTyping(activeConversationId, typing);
      }
    },

    startDirect: async (peerId) => {
      const result = await createConversation({ type: 'DIRECT', peerId });
      if (!result.ok) {
        set({ error: result.error.message });
        return null;
      }
      primePeople([result.data]);
      set((state) => ({
        conversations: upsertConversation(state.conversations, {
          ...result.data,
          ...(state.conversations.find((item) => item.id === result.data.id) ?? {}),
        }),
        error: null,
      }));
      log.info('direct_conversation_opened', {});
      return result.data.id;
    },

    startGroup: async (title, memberIds) => {
      const result = await createConversation({ type: 'GROUP', title, memberIds });
      if (!result.ok) {
        set({ error: result.error.message });
        return null;
      }
      primePeople([result.data]);
      set((state) => ({
        conversations: upsertConversation(state.conversations, result.data),
        error: null,
      }));
      log.info('group_conversation_created', { members: memberIds.length });
      return result.data.id;
    },

    handleEvent: (event) => {
      const { viewerId } = get();
      switch (event.event) {
        case 'socket': {
          const wasDown = get().socket.status !== 'connected';
          set({ socket: event.data });
          // Back after a gap: whatever arrived meanwhile was not pushed here.
          if (wasDown && event.data.status === 'connected' && get().status === 'ready') {
            void get().load();
            const active = get().activeConversationId;
            if (active !== null) {
              withThread(active, (t) => ({ ...t, status: 'idle' }));
              void get().open(active);
            }
          }
          return;
        }

        case 'presence': {
          set((state) => {
            const online = new Set(state.socket.onlineUserIds);
            if (event.data.online) {
              online.add(event.data.userId);
            } else {
              online.delete(event.data.userId);
            }
            return { socket: { ...state.socket, onlineUserIds: [...online] } };
          });
          return;
        }

        case 'message.new': {
          const { message } = event.data;
          const isActive = get().activeConversationId === message.conversationId;
          const isMine = message.senderId === viewerId;

          if (get().threads[message.conversationId] !== undefined) {
            withThread(message.conversationId, (thread) => reconcile(thread, message));
          }

          void adopt(message.conversationId).then((conversation) => {
            if (conversation === null) {
              return;
            }
            set((state) => ({
              conversations: upsertConversation(state.conversations, {
                ...conversation,
                lastMessage: message,
                lastMessageAt: message.createdAt,
                unreadCount:
                  isMine || isActive ? conversation.unreadCount : conversation.unreadCount + 1,
              }),
              // Their line arriving ends their typing signal.
              typing: withoutTyping(state.typing, message.conversationId, message.senderId),
            }));
            if (isActive && !isMine) {
              get().markActiveRead();
            }
          });
          return;
        }

        case 'message.read': {
          const { conversationId, userId, lastReadMessageId, readAt } = event.data;
          set((state) => ({
            conversations: state.conversations.map((item) =>
              item.id === conversationId
                ? {
                    ...item,
                    participants: item.participants.map((p) =>
                      p.userId === userId ? { ...p, lastReadMessageId, lastReadAt: readAt } : p,
                    ),
                    unreadCount: userId === viewerId ? 0 : item.unreadCount,
                  }
                : item,
            ),
          }));
          return;
        }

        case 'conversation.new': {
          const summary: ConversationSummary = {
            ...event.data.conversation,
            participants: event.data.participants,
            lastMessage: null,
            unreadCount: 0,
          };
          primePeople([summary]);
          set((state) => ({ conversations: upsertConversation(state.conversations, summary) }));
          return;
        }

        case 'typing': {
          const { conversationId, userId, typing } = event.data;
          if (userId === viewerId) {
            return;
          }
          set((state) => ({
            typing: typing
              ? {
                  ...state.typing,
                  [conversationId]: {
                    ...(state.typing[conversationId] ?? {}),
                    [userId]: Date.now() + TYPING_TTL_MS,
                  },
                }
              : withoutTyping(state.typing, conversationId, userId),
          }));
          return;
        }
      }
    },

    clearError: () => {
      set({ error: null });
    },
  };
});

function withoutTyping(
  typing: Record<string, Record<string, number>>,
  conversationId: string,
  userId: string,
): Record<string, Record<string, number>> {
  const inConversation = typing[conversationId];
  if (inConversation?.[userId] === undefined) {
    return typing;
  }
  const rest = Object.fromEntries(Object.entries(inConversation).filter(([id]) => id !== userId));
  return { ...typing, [conversationId]: rest };
}
