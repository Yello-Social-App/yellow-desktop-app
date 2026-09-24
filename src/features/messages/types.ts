/**
 * Chat shapes: what the renderer adds on top of the wire records, and the few
 * rules the screens share — who may do what in a group, how an empty line is
 * described, and how a group change reads as a sentence.
 */
import {
  CHAT_COMPOSE_MAX_LENGTH,
  type Author,
  type ChatMessage,
  type ConversationSummary,
  type GroupChange,
  type ParticipantRole,
} from '@shared/ipc-types';
import { z } from 'zod';

import { displayName } from '@/lib/user-display';

export const MESSAGE_MAX_LENGTH = CHAT_COMPOSE_MAX_LENGTH;

/** The one-tap reactions offered on a message. Any single emoji is valid upstream. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** Where an outgoing line stands: still in flight, confirmed, or refused. */
export type DeliveryState = 'sending' | 'sent' | 'failed';

/** A message as the thread holds it: the wire record plus its delivery state. */
export interface ThreadMessage extends ChatMessage {
  delivery: DeliveryState;
}

/**
 * A group change, drawn as a line in the thread. The service does not store
 * these in history yet, so they exist only for as long as this session saw them.
 */
export interface GroupNotice {
  id: string;
  conversationId: string;
  createdAt: string;
  change: GroupChange;
}

/**
 * Text is optional when files ride along, which only the composer knows; so
 * this checks length, and the composer checks "text or a file".
 */
export const composeMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .max(MESSAGE_MAX_LENGTH, `Keep it under ${String(MESSAGE_MAX_LENGTH)} characters.`),
});

export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;

/** The DOM id of a line in the thread, which a reply's quote scrolls to. */
export function messageAnchor(messageId: string): string {
  return `message-${messageId}`;
}

/** Ids of everyone in a conversation other than the viewer. */
export function peerIdsOf(conversation: ConversationSummary, viewerId: string): string[] {
  return conversation.participants
    .map((participant) => participant.userId)
    .filter((id) => id !== viewerId);
}

/**
 * A direct conversation is named after the other person; a group after its
 * title, or its members while it has none.
 */
export function conversationTitle(
  conversation: ConversationSummary,
  viewerId: string,
  people: Record<string, Author>,
): string {
  if (conversation.type === 'GROUP' && conversation.title !== undefined) {
    return conversation.title;
  }
  const names = peerIdsOf(conversation, viewerId).map((id) => {
    const person = people[id];
    return person === undefined ? '…' : displayName(person);
  });
  if (names.length === 0) {
    return 'Just you';
  }
  return names.join(', ');
}

const ATTACHMENT_WORDING = {
  IMAGE: 'Sent a photo',
  VOICE: 'Sent a voice message',
  FILE: 'Sent a file',
} as const;

/** What a line says when it has no text of its own, in the service's wording. */
export function describeMessage(
  message: Pick<ChatMessage, 'body'> &
    Partial<Pick<ChatMessage, 'attachments' | 'groupInvite' | 'deletedAt'>>,
): string {
  if (message.deletedAt !== undefined && message.deletedAt !== null) {
    return 'Message deleted';
  }
  if (message.body !== '') {
    return message.body;
  }
  if (message.groupInvite !== undefined && message.groupInvite !== null) {
    return `Invite to ${message.groupInvite.title ?? 'a group'}`;
  }
  const [first] = message.attachments ?? [];
  if (first !== undefined) {
    return ATTACHMENT_WORDING[first.kind];
  }
  // The list's preview carries no more than this; a tombstone, a file and an
  // invite all look alike from here.
  return 'Sent a message';
}

export function roleOf(
  conversation: ConversationSummary | undefined,
  userId: string | null | undefined,
): ParticipantRole | null {
  if (conversation === undefined || userId === null || userId === undefined) {
    return null;
  }
  return conversation.participants.find((p) => p.userId === userId)?.role ?? null;
}

/**
 * The group rights table from the chat docs, as the UI reads it. These only
 * decide which controls are drawn — the service enforces every one of them
 * and its refusal is what counts (OWASP A01).
 */
export const groupRights = {
  /** Rename, set or remove the photo, remove a member. */
  canManage: (role: ParticipantRole | null): boolean => role === 'OWNER' || role === 'ADMIN',
  /** Promote or demote. */
  canChangeRoles: (role: ParticipantRole | null): boolean => role === 'OWNER',
  /** Remove this person: admins remove members, only the owner removes an admin. */
  canRemove: (actor: ParticipantRole | null, target: ParticipantRole): boolean => {
    if (target === 'OWNER') {
      return false;
    }
    if (target === 'ADMIN') {
      return actor === 'OWNER';
    }
    return actor === 'OWNER' || actor === 'ADMIN';
  },
};

/** "Alice added Bob and Chea" — a group change as a sentence. */
export function describeChange(
  change: GroupChange,
  people: Record<string, Author>,
  viewerId: string | null,
): string {
  const nameOf = (id: string | undefined): string => {
    if (id === undefined) {
      return 'Someone';
    }
    if (id === viewerId) {
      return 'You';
    }
    const person = people[id];
    return person === undefined ? 'Someone' : displayName(person);
  };
  const actor = nameOf(change.actorId);
  const names = listOf(change.userIds.map((id) => (id === viewerId ? 'you' : nameOf(id))));

  switch (change.kind) {
    case 'RENAMED':
      return `${actor} renamed the group`;
    case 'PHOTO_CHANGED':
      return `${actor} changed the group photo`;
    case 'MEMBERS_ADDED':
      return `${actor} added ${names}`;
    case 'MEMBER_REMOVED':
      return `${actor} removed ${names}`;
    case 'MEMBER_LEFT':
      return `${names.charAt(0).toUpperCase()}${names.slice(1)} left the group`;
    case 'ROLE_CHANGED':
      return `${actor} changed the role of ${names}`;
    default:
      return `${actor} updated the group`;
  }
}

function listOf(names: readonly string[]): string {
  if (names.length === 0) {
    return 'someone';
  }
  if (names.length === 1) {
    return names[0] ?? 'someone';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}
