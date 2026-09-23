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
 * original message rather than a duplicate. A retry resends the line's own
 * reply target and files, so what is retried is exactly what was drawn.
 *
 * Edit, unsend and react are optimistic too, but reconciled by id: the call's
 * own answer replaces the guess, the fan-out frame that follows replaces it
 * again with the same thing, and a refusal puts the line back as it was. The
 * reaction list is always *replaced*, never merged — the service sends the
 * whole list for exactly that reason.
 *
 * Threads are held newest-last for display; the wire is newest-first and
 * older pages are prepended.
 */
import type {
  AttachChatFilesResponse,
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  ChatSocketState,
  ChatEvent,
  Conversation,
  ConversationSummary,
  GroupInviteStatus,
  LocalFileSource,
  Participant,
} from '@shared/ipc-types';
import { CHAT_MESSAGE_MAX_ATTACHMENTS } from '@shared/ipc-types';
import { create } from 'zustand';

import { useUsersStore } from '@/features/users/store';
import { onChatEvent, ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';
import type { Result } from '@/lib/result';

import {
  acceptInvite,
  addGroupMembers,
  attachFiles,
  changeGroupRole,
  createConversation,
  declineInvite,
  editMessage,
  fetchAttachment,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  inviteToGroup,
  leaveGroup,
  markRead,
  removeGroupMember,
  removeGroupPhoto,
  renameGroup,
  saveAttachment,
  sendMessage,
  sendTyping,
  setGroupPhoto,
  setReaction,
  unsendMessage,
  uploadLocalFiles,
  type MessagesError,
  type OutgoingMessage,
  type LocalFile,
} from './api';
import type { GroupNotice, ThreadMessage } from './types';

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
/** A quoted line is previewed, not copied: the service cuts it at 200 too. */
const REPLY_PREVIEW_LENGTH = 200;
/** Group-change lines kept per conversation; they are session-only anyway. */
const NOTICES_MAX = 50;
/** A presigned link this close to expiry is treated as already expired. */
const URL_EXPIRY_MARGIN_MS = 30_000;

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
  /** The line the composer is quoting, in the active conversation. */
  replyingToId: string | null;
  /** The line the composer is rewriting, in the active conversation. */
  editingId: string | null;
  /** Uploaded, not yet sent: conversation id → the files in its draft. */
  drafts: Record<string, ChatAttachment[]>;
  isAttaching: boolean;
  /** Group changes seen live this session, per conversation. */
  notices: Record<string, GroupNotice[]>;
  /** The open conversation the viewer just lost access to, so the page can leave it. */
  removedConversationId: string | null;
  /**
   * Direct chats whose last send the service refused with FORBIDDEN. In a
   * one-to-one chat that means a block stands between the two, and the API
   * deliberately never says who blocked whom — so this is learned from the
   * refusal, for this session, rather than read from anywhere.
   */
  refusedConversationIds: readonly string[];

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

  startReply: (messageId: string) => void;
  startEdit: (messageId: string) => void;
  cancelCompose: () => void;
  saveEdit: (body: string) => Promise<boolean>;
  unsend: (messageId: string) => Promise<boolean>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;

  attach: () => Promise<void>;
  /** Pasted or dropped files, already read by the page. */
  addLocalFiles: (source: LocalFileSource, files: LocalFile[]) => Promise<void>;
  dropAttachment: (attachmentId: string) => void;
  refreshAttachment: (attachment: ChatAttachment) => Promise<void>;
  saveAttachment: (attachmentId: string) => Promise<void>;

  refreshConversation: (conversationId: string) => Promise<void>;
  renameGroup: (conversationId: string, title: string) => Promise<boolean>;
  setGroupPhoto: (conversationId: string) => Promise<boolean>;
  removeGroupPhoto: (conversationId: string) => Promise<boolean>;
  addMembers: (conversationId: string, userIds: string[]) => Promise<boolean>;
  removeMember: (conversationId: string, userId: string) => Promise<boolean>;
  setRole: (conversationId: string, userId: string, role: 'ADMIN' | 'MEMBER') => Promise<boolean>;
  leave: (conversationId: string) => Promise<boolean>;
  invite: (conversationId: string, userIds: string[]) => Promise<number>;
  respondToInvite: (inviteId: string, accept: boolean) => Promise<string | null>;

  handleEvent: (event: ChatEvent) => void;
  /** Forgets a refusal, once something says the chat can be written to again. */
  clearRefusal: (conversationId: string) => void;
  clearError: () => void;
  acknowledgeRemoval: () => void;
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

/** The list preview of a full message: the four wire fields, plus what says "a photo". */
function asLastMessage(message: ChatMessage): NonNullable<ConversationSummary['lastMessage']> {
  return {
    id: message.id,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt,
    attachments: message.attachments,
    groupInvite: message.groupInvite,
    deletedAt: message.deletedAt,
  };
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

/** An unsent line: the text, files, reactions and story reference go; the line stays in history. */
function tombstone(message: ThreadMessage, deletedAt: string): ThreadMessage {
  return { ...message, body: '', attachments: [], reactions: [], storyReply: null, deletedAt };
}

/** Marks every reply quoting `messageId` as quoting a deleted line. */
function withQuoteDeleted(message: ThreadMessage, messageId: string): ThreadMessage {
  if (message.replyTo?.id !== messageId) {
    return message;
  }
  return { ...message, replyTo: { ...message.replyTo, body: '', deleted: true } };
}

/** The viewer's reaction moved to `emoji` (or removed, for null), counts kept honest. */
function withReaction(
  reactions: readonly ChatReaction[],
  viewerId: string,
  emoji: string | null,
): ChatReaction[] {
  const without = reactions
    .map((reaction) => {
      if (!reaction.userIds.includes(viewerId)) {
        return reaction;
      }
      const userIds = reaction.userIds.filter((id) => id !== viewerId);
      return { ...reaction, userIds, count: Math.max(0, reaction.count - 1) };
    })
    .filter((reaction) => reaction.count > 0);
  if (emoji === null) {
    return without;
  }
  const existing = without.find((reaction) => reaction.emoji === emoji);
  if (existing === undefined) {
    return [...without, { emoji, count: 1, userIds: [viewerId] }];
  }
  return without.map((reaction) =>
    reaction.emoji === emoji
      ? { ...reaction, count: reaction.count + 1, userIds: [...reaction.userIds, viewerId] }
      : reaction,
  );
}

/** Whether a presigned link is past (or about to pass) its expiry. */
function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  const at = Date.parse(expiresAt);
  return !Number.isNaN(at) && at - URL_EXPIRY_MARGIN_MS <= Date.now();
}

/** A record's own fields over a summary, keeping what only the list knows. */
function mergeRecord(summary: ConversationSummary, record: Conversation): ConversationSummary {
  return { ...summary, ...record };
}

/**
 * A fresh record, keeping the preview and unread count the list already had —
 * a record from a join or an accept carries neither, and must not blank them.
 */
function withListExtras(
  fresh: ConversationSummary,
  list: readonly ConversationSummary[],
): ConversationSummary {
  const known = list.find((item) => item.id === fresh.id);
  return known === undefined
    ? fresh
    : { ...fresh, lastMessage: known.lastMessage, unreadCount: known.unreadCount };
}

function localId(clientId: string): string {
  return `local:${clientId}`;
}

let noticeSequence = 0;

export const useMessagesStore = create<MessagesState>((set, get) => {
  function withThread(conversationId: string, update: (thread: Thread) => Thread): void {
    set((state) => ({
      threads: {
        ...state.threads,
        [conversationId]: update(state.threads[conversationId] ?? EMPTY_THREAD),
      },
    }));
  }

  /** Applies `update` to one line, if that thread is loaded and holds it. */
  function withMessage(
    conversationId: string,
    messageId: string,
    update: (message: ThreadMessage) => ThreadMessage,
  ): void {
    if (get().threads[conversationId] === undefined) {
      return;
    }
    withThread(conversationId, (thread) => ({
      ...thread,
      messages: thread.messages.map((m) => (m.id === messageId ? update(m) : m)),
    }));
  }

  function findMessage(conversationId: string, messageId: string): ThreadMessage | undefined {
    return get().threads[conversationId]?.messages.find((m) => m.id === messageId);
  }

  function withConversation(
    conversationId: string,
    update: (conversation: ConversationSummary) => ConversationSummary,
  ): void {
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === conversationId ? update(item) : item,
      ),
    }));
  }

  /** Keeps the list preview in step when the line it shows changes. */
  function withLastMessage(conversationId: string, message: ThreadMessage): void {
    withConversation(conversationId, (item) =>
      item.lastMessage?.id === message.id ? { ...item, lastMessage: asLastMessage(message) } : item,
    );
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

  function withParticipants(conversationId: string, participants: Participant[]): void {
    withConversation(conversationId, (item) => ({ ...item, participants }));
    void useUsersStore.getState().resolve(participants.map((p) => p.userId));
  }

  /** Forgets a conversation the viewer is no longer in. */
  function drop(conversationId: string): void {
    set((state) => {
      const isActive = state.activeConversationId === conversationId;
      return {
        conversations: state.conversations.filter((item) => item.id !== conversationId),
        threads: withoutKey(state.threads, conversationId),
        drafts: withoutKey(state.drafts, conversationId),
        notices: withoutKey(state.notices, conversationId),
        ...(isActive
          ? {
              activeConversationId: null,
              removedConversationId: conversationId,
              replyingToId: null,
              editingId: null,
            }
          : {}),
      };
    });
  }

  /** Every loaded card for this invite shows its new status. */
  function withInviteStatus(inviteId: string, status: GroupInviteStatus): void {
    set((state) => {
      const threads: Record<string, Thread> = {};
      for (const [id, thread] of Object.entries(state.threads)) {
        threads[id] = thread.messages.some((m) => m.groupInvite?.id === inviteId)
          ? {
              ...thread,
              messages: thread.messages.map((m) =>
                m.groupInvite?.id === inviteId
                  ? { ...m, groupInvite: { ...m.groupInvite, status } }
                  : m,
              ),
            }
          : thread;
      }
      return { threads };
    });
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

  async function deliver(outgoing: OutgoingMessage): Promise<boolean> {
    const { conversationId, clientId } = outgoing;
    set({ isSending: true });
    const result = await sendMessage(outgoing);
    set({ isSending: false });

    if (!result.ok) {
      withThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.clientId === clientId ? { ...m, delivery: 'failed' } : m,
        ),
      }));
      const conversation = get().conversations.find((item) => item.id === conversationId);
      if (result.error.apiCode === 'FORBIDDEN' && conversation?.type === 'DIRECT') {
        // Not an error to banner: the thread swaps its composer for a notice.
        set((state) => ({
          refusedConversationIds: state.refusedConversationIds.includes(conversationId)
            ? state.refusedConversationIds
            : [...state.refusedConversationIds, conversationId],
        }));
        return false;
      }
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
          lastMessage: asLastMessage(result.data),
          lastMessageAt: result.data.createdAt,
        }),
        error: null,
      };
    });
    return true;
  }

  /**
   * Runs one upload (picked or pasted) into the active conversation's draft:
   * checks there is room, holds `isAttaching` while it runs, and appends what
   * the service accepted. The draft is keyed by the conversation the upload
   * started in, so switching threads mid-upload files it in the right place.
   */
  async function addToDraft(
    upload: (
      conversationId: string,
      room: number,
    ) => Promise<Result<AttachChatFilesResponse, MessagesError>>,
  ): Promise<void> {
    const { activeConversationId, drafts, isAttaching } = get();
    if (activeConversationId === null || isAttaching) {
      return;
    }
    const room = CHAT_MESSAGE_MAX_ATTACHMENTS - (drafts[activeConversationId] ?? []).length;
    if (room <= 0) {
      set({ error: `A message can carry up to ${String(CHAT_MESSAGE_MAX_ATTACHMENTS)} files.` });
      return;
    }

    set({ isAttaching: true });
    const result = await upload(activeConversationId, room);
    set({ isAttaching: false });
    if (!result.ok) {
      set({ error: result.error.message });
      return;
    }
    if (result.data.cancelled) {
      return;
    }
    const { attachments, skipped, skippedReason } = result.data;
    set((state) => ({
      drafts: {
        ...state.drafts,
        [activeConversationId]: [...(state.drafts[activeConversationId] ?? []), ...attachments],
      },
      error:
        skipped === 0
          ? null
          : (skippedReason ?? `${String(skipped)} file(s) could not be attached.`),
    }));
  }

  /** The common tail of a group action: success clears the error, a refusal sets it. */
  function settle(result: { ok: true } | { ok: false; error: { message: string } }): boolean {
    set({ error: result.ok ? null : result.error.message });
    return result.ok;
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
    replyingToId: null,
    editingId: null,
    drafts: {},
    isAttaching: false,
    notices: {},
    removedConversationId: null,
    refusedConversationIds: [],

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
          replyingToId: null,
          editingId: null,
          drafts: {},
          notices: {},
          removedConversationId: null,
          refusedConversationIds: [],
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
      if (conversationId !== get().activeConversationId) {
        // A quote or an edit belongs to the thread it was started in.
        set({ replyingToId: null, editingId: null });
      }
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
      const { activeConversationId, viewerId, replyingToId, drafts } = get();
      if (activeConversationId === null || viewerId === null) {
        return false;
      }
      const attachments = drafts[activeConversationId] ?? [];
      if (body === '' && attachments.length === 0) {
        return false;
      }
      const quoted =
        replyingToId === null ? undefined : findMessage(activeConversationId, replyingToId);

      const clientId = crypto.randomUUID();
      const optimistic: ThreadMessage = {
        id: localId(clientId),
        conversationId: activeConversationId,
        senderId: viewerId,
        clientId,
        body,
        replyTo:
          quoted === undefined
            ? null
            : {
                id: quoted.id,
                senderId: quoted.senderId,
                body: quoted.body.slice(0, REPLY_PREVIEW_LENGTH),
                hasAttachments: quoted.attachments.length > 0,
                deleted: quoted.deletedAt !== null,
              },
        attachments,
        reactions: [],
        groupInvite: null,
        storyReply: null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        delivery: 'sending',
      };
      withThread(activeConversationId, (thread) => ({
        ...thread,
        messages: [...thread.messages, optimistic],
      }));
      // The draft is spent the moment it is drawn as a line; a failure keeps
      // its files on that line, which is what Retry resends.
      set((state) => ({
        replyingToId: null,
        drafts: { ...state.drafts, [activeConversationId]: [] },
      }));

      return deliver({
        conversationId: activeConversationId,
        clientId,
        body,
        replyToMessageId: quoted?.id,
        attachmentIds: attachments.map((attachment) => attachment.id),
      });
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
      return deliver({
        conversationId: activeConversationId,
        clientId,
        body: line.body,
        replyToMessageId: line.replyTo?.id,
        attachmentIds: line.attachments.map((attachment) => attachment.id),
      });
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

    startReply: (messageId) => {
      set({ replyingToId: messageId, editingId: null });
    },

    startEdit: (messageId) => {
      set({ editingId: messageId, replyingToId: null });
    },

    cancelCompose: () => {
      set({ replyingToId: null, editingId: null });
    },

    saveEdit: async (body) => {
      const { activeConversationId, editingId } = get();
      if (activeConversationId === null || editingId === null) {
        return false;
      }
      const before = findMessage(activeConversationId, editingId);
      set({ editingId: null });
      // The same text again is a no-op upstream too: no `editedAt`, no fan-out.
      if (before === undefined || before.body === body) {
        return true;
      }

      withMessage(activeConversationId, editingId, (m) => ({
        ...m,
        body,
        editedAt: new Date().toISOString(),
      }));
      const result = await editMessage(activeConversationId, editingId, body);
      if (!result.ok) {
        withMessage(activeConversationId, editingId, () => before);
        set({ error: result.error.message });
        return false;
      }
      const confirmed = asThreadMessage(result.data);
      withMessage(activeConversationId, editingId, () => confirmed);
      withLastMessage(activeConversationId, confirmed);
      set({ error: null });
      return true;
    },

    unsend: async (messageId) => {
      const { activeConversationId } = get();
      if (activeConversationId === null) {
        return false;
      }
      const before = findMessage(activeConversationId, messageId);
      if (before === undefined) {
        return false;
      }
      const quoting = (get().threads[activeConversationId]?.messages ?? []).filter(
        (m) => m.replyTo?.id === messageId,
      );

      const gone = tombstone(before, new Date().toISOString());
      withThread(activeConversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === messageId ? gone : withQuoteDeleted(m, messageId),
        ),
      }));
      if (get().editingId === messageId || get().replyingToId === messageId) {
        set({ editingId: null, replyingToId: null });
      }

      const result = await unsendMessage(activeConversationId, messageId);
      if (!result.ok) {
        // Put back the line and the quotes of it, exactly as they were.
        const restore = new Map(quoting.map((m) => [m.id, m]));
        restore.set(messageId, before);
        withThread(activeConversationId, (thread) => ({
          ...thread,
          messages: thread.messages.map((m) => restore.get(m.id) ?? m),
        }));
        set({ error: result.error.message });
        return false;
      }
      withLastMessage(activeConversationId, gone);
      return true;
    },

    toggleReaction: async (messageId, emoji) => {
      const { activeConversationId, viewerId } = get();
      if (activeConversationId === null || viewerId === null) {
        return;
      }
      const before = findMessage(activeConversationId, messageId);
      if (before?.deletedAt !== null) {
        return;
      }
      const mine = before.reactions.find((reaction) => reaction.userIds.includes(viewerId));
      // Tapping the emoji you already chose is the undo.
      const next = mine?.emoji === emoji ? null : emoji;

      withMessage(activeConversationId, messageId, (m) => ({
        ...m,
        reactions: withReaction(m.reactions, viewerId, next),
      }));
      const result = await setReaction(activeConversationId, messageId, next);
      if (!result.ok) {
        withMessage(activeConversationId, messageId, (m) => ({
          ...m,
          reactions: before.reactions,
        }));
        set({ error: result.error.message });
        return;
      }
      withMessage(activeConversationId, messageId, (m) => ({ ...m, reactions: result.data }));
    },

    attach: async () => {
      await addToDraft((conversationId, room) => attachFiles(conversationId, room));
    },

    addLocalFiles: async (source, files) => {
      await addToDraft((conversationId, room) =>
        uploadLocalFiles(conversationId, source, files.slice(0, room)).then((result) =>
          // What did not fit is reported the same way the picker reports it.
          result.ok && files.length > room
            ? {
                ...result,
                data: {
                  ...result.data,
                  skipped: result.data.skipped + files.length - room,
                  skippedReason:
                    result.data.skippedReason ??
                    `Only ${String(room)} more file(s) fit in this message.`,
                },
              }
            : result,
        ),
      );
    },

    dropAttachment: (attachmentId) => {
      const { activeConversationId } = get();
      if (activeConversationId === null) {
        return;
      }
      // There is no delete for a pending upload: one that is never sent is
      // simply never visible to anyone but the uploader.
      set((state) => ({
        drafts: {
          ...state.drafts,
          [activeConversationId]: (state.drafts[activeConversationId] ?? []).filter(
            (attachment) => attachment.id !== attachmentId,
          ),
        },
      }));
    },

    refreshAttachment: async (attachment) => {
      // Only an expired link is worth re-signing. A link that fails while still
      // valid failed for another reason, and asking again would loop.
      if (!isExpired(attachment.urlExpiresAt)) {
        return;
      }
      const result = await fetchAttachment(attachment.id);
      if (!result.ok) {
        return;
      }
      const fresh = result.data;
      const swap = (item: ChatAttachment): ChatAttachment => (item.id === fresh.id ? fresh : item);
      set((state) => {
        const threads: Record<string, Thread> = {};
        for (const [id, thread] of Object.entries(state.threads)) {
          threads[id] = thread.messages.some((m) => m.attachments.some((a) => a.id === fresh.id))
            ? {
                ...thread,
                messages: thread.messages.map((m) => ({
                  ...m,
                  attachments: m.attachments.map(swap),
                })),
              }
            : thread;
        }
        const drafts = Object.fromEntries(
          Object.entries(state.drafts).map(([id, draft]) => [id, draft.map(swap)]),
        );
        return { threads, drafts };
      });
    },

    saveAttachment: async (attachmentId) => {
      const result = await saveAttachment(attachmentId);
      if (!result.ok) {
        set({ error: result.error.message });
      }
    },

    refreshConversation: async (conversationId) => {
      const current = get().conversations.find((item) => item.id === conversationId);
      if (current === undefined || !isExpired(current.photoUrlExpiresAt)) {
        return;
      }
      const result = await fetchConversation(conversationId);
      if (!result.ok) {
        return;
      }
      withConversation(conversationId, (item) => ({
        ...item,
        ...result.data,
        // The detail has no list extras; keep the ones already known.
        lastMessage: item.lastMessage,
        unreadCount: item.unreadCount,
      }));
    },

    renameGroup: async (conversationId, title) => {
      const result = await renameGroup(conversationId, title);
      if (result.ok) {
        withConversation(conversationId, (item) => mergeRecord(item, result.data));
      }
      return settle(result);
    },

    setGroupPhoto: async (conversationId) => {
      const result = await setGroupPhoto(conversationId);
      if (!result.ok && result.error.code === 'CANCELLED') {
        return false;
      }
      if (result.ok) {
        withConversation(conversationId, (item) => mergeRecord(item, result.data));
      }
      return settle(result);
    },

    removeGroupPhoto: async (conversationId) => {
      const result = await removeGroupPhoto(conversationId);
      if (result.ok) {
        withConversation(conversationId, (item) => mergeRecord(item, result.data));
      }
      return settle(result);
    },

    addMembers: async (conversationId, userIds) => {
      const result = await addGroupMembers(conversationId, userIds);
      if (result.ok) {
        withParticipants(conversationId, result.data);
      }
      return settle(result);
    },

    removeMember: async (conversationId, userId) => {
      const result = await removeGroupMember(conversationId, userId);
      if (result.ok) {
        withConversation(conversationId, (item) => ({
          ...item,
          participants: item.participants.filter((p) => p.userId !== userId),
        }));
      }
      return settle(result);
    },

    setRole: async (conversationId, userId, role) => {
      const result = await changeGroupRole(conversationId, userId, role);
      if (result.ok) {
        withParticipants(conversationId, result.data);
      }
      return settle(result);
    },

    leave: async (conversationId) => {
      const result = await leaveGroup(conversationId);
      if (result.ok) {
        drop(conversationId);
        log.info('group_left', {});
      }
      return settle(result);
    },

    invite: async (conversationId, userIds) => {
      let sent = 0;
      let firstError: string | null = null;
      // One at a time: each opens (or reuses) a DM and posts a card into it.
      for (const userId of userIds) {
        const result = await inviteToGroup(conversationId, userId);
        if (!result.ok) {
          firstError ??= result.error.message;
          continue;
        }
        sent += 1;
        const card = result.data;
        if (get().threads[card.conversationId] !== undefined) {
          withThread(card.conversationId, (thread) => reconcile(thread, card));
        }
      }
      set({ error: firstError });
      return sent;
    },

    respondToInvite: async (inviteId, accept) => {
      if (!accept) {
        const result = await declineInvite(inviteId);
        if (result.ok) {
          withInviteStatus(inviteId, 'DECLINED');
        }
        settle(result);
        return null;
      }
      const result = await acceptInvite(inviteId);
      if (!result.ok) {
        settle(result);
        return null;
      }
      withInviteStatus(inviteId, 'ACCEPTED');
      primePeople([result.data]);
      set((state) => ({
        conversations: upsertConversation(
          state.conversations,
          withListExtras(result.data, state.conversations),
        ),
        error: null,
      }));
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

        case 'alert.activated':
          // Navigation is the shell's job (useChatSubscription); nothing to hold.
          return;

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
          // A line from them got through, so nothing blocks the chat any more.
          if (!isMine) {
            get().clearRefusal(message.conversationId);
          }

          void adopt(message.conversationId).then((conversation) => {
            if (conversation === null) {
              return;
            }
            set((state) => ({
              conversations: upsertConversation(state.conversations, {
                ...conversation,
                lastMessage: asLastMessage(message),
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

        case 'message.updated': {
          const confirmed = asThreadMessage(event.data.message);
          withMessage(confirmed.conversationId, confirmed.id, () => confirmed);
          withLastMessage(confirmed.conversationId, confirmed);
          return;
        }

        case 'message.deleted': {
          const { conversationId, messageId, deletedAt } = event.data;
          if (get().threads[conversationId] !== undefined) {
            withThread(conversationId, (thread) => ({
              ...thread,
              messages: thread.messages.map((m) =>
                m.id === messageId ? tombstone(m, deletedAt) : withQuoteDeleted(m, messageId),
              ),
            }));
          }
          withConversation(conversationId, (item) =>
            item.lastMessage?.id === messageId
              ? {
                  ...item,
                  lastMessage: { ...item.lastMessage, body: '', attachments: [], deletedAt },
                }
              : item,
          );
          if (get().editingId === messageId || get().replyingToId === messageId) {
            set({ editingId: null, replyingToId: null });
          }
          return;
        }

        case 'message.reactions': {
          const { conversationId, messageId, reactions } = event.data;
          withMessage(conversationId, messageId, (m) => ({ ...m, reactions }));
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
          set((state) => ({
            conversations: upsertConversation(
              state.conversations,
              withListExtras(summary, state.conversations),
            ),
          }));
          return;
        }

        case 'conversation.updated': {
          const { conversation, participants, change } = event.data;
          const known = get().conversations.find((item) => item.id === conversation.id);
          const next: ConversationSummary = {
            ...(known ?? { lastMessage: null, unreadCount: 0 }),
            ...conversation,
            participants,
          };
          primePeople([next]);
          set((state) => ({ conversations: upsertConversation(state.conversations, next) }));

          if (change !== null) {
            const ids = [
              ...change.userIds,
              ...(change.actorId === undefined ? [] : [change.actorId]),
            ];
            void useUsersStore.getState().resolve(ids);
            noticeSequence += 1;
            const notice: GroupNotice = {
              id: `notice:${String(noticeSequence)}`,
              conversationId: conversation.id,
              createdAt: new Date().toISOString(),
              change,
            };
            set((state) => ({
              notices: {
                ...state.notices,
                [conversation.id]: [...(state.notices[conversation.id] ?? []), notice].slice(
                  -NOTICES_MAX,
                ),
              },
            }));
          }
          return;
        }

        case 'conversation.removed': {
          const { conversationId, reason } = event.data;
          const wasActive = get().activeConversationId === conversationId;
          drop(conversationId);
          if (wasActive && reason === 'REMOVED') {
            set({ error: 'You were removed from that group.' });
          }
          return;
        }

        case 'group.invite.updated': {
          withInviteStatus(event.data.inviteId, event.data.status);
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

    clearRefusal: (conversationId) => {
      if (!get().refusedConversationIds.includes(conversationId)) {
        return;
      }
      set((state) => ({
        refusedConversationIds: state.refusedConversationIds.filter((id) => id !== conversationId),
      }));
    },

    clearError: () => {
      set({ error: null });
    },

    acknowledgeRemoval: () => {
      set({ removedConversationId: null });
    },
  };
});

function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

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
