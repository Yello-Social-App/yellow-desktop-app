/**
 * Chat hooks. The join between a conversation and the people in it happens
 * here — ids from the chat service, records from the user directory — so the
 * chat components stay presentational.
 */
import type {
  Author,
  LocalFileSource,
  ChatAttachment,
  ConversationSummary,
  ParticipantRole,
} from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendsStore } from '@/features/friends/store';
import { LOCAL_BLOCKED_STATUS } from '@/features/friends/types';
import { useUsers } from '@/features/users/hooks';
import { TYPING_IDLE_MS } from '@/lib/constants';
import { onChatEvent } from '@/lib/ipc';

import type { LocalFile } from './api';
import { isFileDrag, readLocalFiles } from './local-files';
import { useMessagesStore, type Thread } from './store';
import {
  conversationTitle,
  describeMessage,
  peerIdsOf,
  roleOf,
  type GroupNotice,
  type ThreadMessage,
} from './types';

const NO_MESSAGES_PREVIEW = 'No messages yet';
const NO_NOTICES: GroupNotice[] = [];
const NO_ATTACHMENTS: ChatAttachment[] = [];
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

  // A clicked desktop chat alert opens its conversation, from any screen. The
  // id has already passed the event schema; it is encoded into the segment
  // all the same, so it cannot address another route (A01).
  const navigate = useNavigate();
  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    return onChatEvent((event) => {
      if (event.event === 'alert.activated') {
        void navigate(`/messages/${encodeURIComponent(event.data.conversationId)}`);
      }
    });
  }, [userId, navigate]);
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
        preview: last === null ? NO_MESSAGES_PREVIEW : describeMessage(last),
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
  /** The line being quoted, and who wrote it. */
  replyingTo: { message: ThreadMessage; sender: Author | undefined; isOwn: boolean } | null;
  /** The line being rewritten; the composer holds its text while this is set. */
  editing: ThreadMessage | null;
  saveEdit: (body: string) => Promise<boolean>;
  /** Up-arrow in an empty composer: rewrite your newest line. */
  editLatest: () => boolean;
  cancel: () => void;
  attachments: ChatAttachment[];
  attach: () => void;
  addLocalFiles: (source: LocalFileSource, files: LocalFile[]) => void;
  dropAttachment: (attachmentId: string) => void;
  isAttaching: boolean;
  /** The open conversation, which a voice recording belongs to. */
  conversationId: string | null;
  /**
   * Whether the mic is offered: this runtime can record, and the server has
   * not answered 503 to a voice upload this session.
   */
  canRecordVoice: boolean;
}

/** MediaRecorder and getUserMedia both exist; the permission is asked for on use. */
const RUNTIME_CAN_RECORD =
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  // Typed as always present, but absent outside a secure context.
  'mediaDevices' in navigator &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

export function useComposer(): Composer {
  const send = useMessagesStore((state) => state.send);
  const retry = useMessagesStore((state) => state.retry);
  const setTyping = useMessagesStore((state) => state.setTyping);
  const isSending = useMessagesStore((state) => state.isSending);
  const hasConversation = useMessagesStore((state) => state.activeConversationId !== null);
  const thread = useActiveThread();
  const viewerId = useMessagesStore((state) => state.viewerId);
  const replyingToId = useMessagesStore((state) => state.replyingToId);
  const editingId = useMessagesStore((state) => state.editingId);
  const saveEdit = useMessagesStore((state) => state.saveEdit);
  const startEdit = useMessagesStore((state) => state.startEdit);
  const cancelCompose = useMessagesStore((state) => state.cancelCompose);
  const attach = useMessagesStore((state) => state.attach);
  const addLocalFiles = useMessagesStore((state) => state.addLocalFiles);
  const dropAttachment = useMessagesStore((state) => state.dropAttachment);
  const isAttaching = useMessagesStore((state) => state.isAttaching);
  const conversationId = useMessagesStore((state) => state.activeConversationId);
  const voiceUnavailable = useMessagesStore((state) => state.voiceUnavailable);
  const attachments = useMessagesStore((state) =>
    state.activeConversationId === null
      ? NO_ATTACHMENTS
      : (state.drafts[state.activeConversationId] ?? NO_ATTACHMENTS),
  );
  const quoted =
    replyingToId === null ? undefined : thread.messages.find((m) => m.id === replyingToId);
  const editing =
    editingId === null ? null : (thread.messages.find((m) => m.id === editingId) ?? null);
  const quotedSender = useUsers(quoted === undefined ? [] : [quoted.senderId]);
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
    replyingTo:
      quoted === undefined
        ? null
        : {
            message: quoted,
            sender: quotedSender[quoted.senderId],
            isOwn: quoted.senderId === viewerId,
          },
    editing,
    saveEdit: async (body) => {
      stopTyping();
      return saveEdit(body);
    },
    editLatest: () => {
      const latest = [...thread.messages]
        .reverse()
        .find(
          (m) =>
            m.senderId === viewerId &&
            m.delivery === 'sent' &&
            m.deletedAt === null &&
            m.body !== '',
        );
      if (latest === undefined) {
        return false;
      }
      startEdit(latest.id);
      return true;
    },
    cancel: cancelCompose,
    attachments,
    attach: () => {
      void attach();
    },
    addLocalFiles: (source, files) => {
      void addLocalFiles(source, files);
    },
    dropAttachment,
    isAttaching,
    conversationId,
    canRecordVoice: RUNTIME_CAN_RECORD && !voiceUnavailable,
  };
}

/** What a line in the thread can do, bound to the store once for every bubble. */
export function useMessageActions() {
  const startReply = useMessagesStore((state) => state.startReply);
  const startEdit = useMessagesStore((state) => state.startEdit);
  const unsend = useMessagesStore((state) => state.unsend);
  const toggleReaction = useMessagesStore((state) => state.toggleReaction);
  const refreshAttachment = useMessagesStore((state) => state.refreshAttachment);
  const saveAttachment = useMessagesStore((state) => state.saveAttachment);
  const respondToInvite = useMessagesStore((state) => state.respondToInvite);
  const retry = useMessagesStore((state) => state.retry);
  const navigate = useNavigate();

  return useMemo(
    () => ({
      retry: (message: ThreadMessage) => {
        void retry(message.clientId);
      },
      startReply,
      startEdit,
      unsend: (messageId: string) => {
        void unsend(messageId);
      },
      react: (messageId: string, emoji: string) => {
        void toggleReaction(messageId, emoji);
      },
      refreshAttachment: (attachment: ChatAttachment) => {
        void refreshAttachment(attachment);
      },
      saveAttachment: (attachmentId: string) => {
        void saveAttachment(attachmentId);
      },
      /** Accepting opens the group you just joined. */
      respondToInvite: async (inviteId: string, accept: boolean) => {
        const joined = await respondToInvite(inviteId, accept);
        if (joined !== null) {
          await navigate(`/messages/${encodeURIComponent(joined)}`);
        }
      },
      /** Opens a group you are already in, from its card. */
      openConversation: (conversationId: string) => {
        void navigate(`/messages/${encodeURIComponent(conversationId)}`);
      },
    }),
    [
      startReply,
      startEdit,
      unsend,
      toggleReaction,
      refreshAttachment,
      saveAttachment,
      respondToInvite,
      retry,
      navigate,
    ],
  );
}

/** The group-change lines seen this session in the active conversation. */
export function useThreadNotices(): GroupNotice[] {
  return useMessagesStore((state) =>
    state.activeConversationId === null
      ? NO_NOTICES
      : (state.notices[state.activeConversationId] ?? NO_NOTICES),
  );
}

/** The viewer's role in the active conversation — for which controls to draw. */
export function useActiveRole(): ParticipantRole | null {
  return useMessagesStore((state) =>
    roleOf(
      state.conversations.find((item) => item.id === state.activeConversationId),
      state.viewerId,
    ),
  );
}

/**
 * Leaves an open conversation the viewer was removed from or left: the URL
 * still names it, and it can no longer be read.
 */
export function useLeaveRemovedConversation(conversationId: string | undefined): void {
  const removed = useMessagesStore((state) => state.removedConversationId);
  const acknowledge = useMessagesStore((state) => state.acknowledgeRemoval);
  const navigate = useNavigate();

  useEffect(() => {
    if (removed === null) {
      return;
    }
    acknowledge();
    if (removed === conversationId) {
      void navigate('/messages', { replace: true });
    }
  }, [removed, conversationId, acknowledge, navigate]);
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

export interface FileDrop {
  /** A file drag is over the thread right now: draw the drop target. */
  isDragging: boolean;
  /** Why a drop would be refused, drawn in place of "Drop to attach". */
  refusal: string | null;
  handlers: {
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * Files dragged in from another window — a file manager, a browser, a photo
 * app — attach to the draft of the open conversation, as the paperclip would.
 *
 * Only a drag that carries files is taken; a dragged link or text is left to
 * the browser's own handling, so dropping text into the box still types it.
 * The enter/leave pair fires for every child the pointer crosses, so a depth
 * count, not the last event, decides whether the drag is still over the thread.
 */
export function useFileDrop(): FileDrop {
  const addLocalFiles = useMessagesStore((state) => state.addLocalFiles);
  const isEditing = useMessagesStore((state) => state.editingId !== null);
  const hasConversation = useMessagesStore((state) => state.activeConversationId !== null);
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const refusal = !hasConversation
    ? 'Open a conversation first.'
    : isEditing
      ? 'Finish editing before attaching files.'
      : null;

  const handlers = useMemo<FileDrop['handlers']>(
    () => ({
      onDragEnter: (event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        depth.current += 1;
        setIsDragging(true);
      },
      onDragOver: (event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        // Without this the drop never fires and Chromium opens the file.
        event.preventDefault();
        event.dataTransfer.dropEffect = refusal === null ? 'copy' : 'none';
      },
      onDragLeave: (event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setIsDragging(false);
        }
      },
      onDrop: (event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        depth.current = 0;
        setIsDragging(false);
        if (refusal !== null) {
          useMessagesStore.setState({ error: refusal });
          return;
        }
        const dropped = [...event.dataTransfer.files];
        void readLocalFiles(dropped).then(({ files, problem }) => {
          if (problem !== null) {
            useMessagesStore.setState({ error: problem });
          }
          if (files.length > 0) {
            void addLocalFiles('drop', files);
          }
        });
      },
    }),
    [refusal, addLocalFiles],
  );

  return { isDragging, refusal, handlers };
}

/**
 * Why a direct chat cannot be written to, the way Messenger splits it:
 *   - `you-blocked`: the viewer blocked the other person, which the app knows
 *     from the friends store, so it can say so and offer Unblock;
 *   - `unreachable`: the service refused a send for a block the viewer did not
 *     make. Who blocked whom is never exposed, so neither is it here.
 * Group chats are never blocked as a whole, so they answer null.
 */
export type DirectBlock = 'you-blocked' | 'unreachable' | null;

export function useDirectBlock(row: ConversationRow): DirectBlock {
  const conversationId = row.conversation.id;
  const peerId = row.conversation.type === 'DIRECT' ? row.peers[0]?.id : undefined;
  const youBlocked = useFriendsStore(
    (state) =>
      peerId !== undefined &&
      (state.statuses[peerId] === LOCAL_BLOCKED_STATUS ||
        state.lists.blocked.entries.some((entry) => entry.user.id === peerId)),
  );
  const isRefused = useMessagesStore((state) =>
    state.refusedConversationIds.includes(conversationId),
  );

  if (peerId === undefined) {
    return null;
  }
  if (youBlocked) {
    return 'you-blocked';
  }
  return isRefused ? 'unreachable' : null;
}
