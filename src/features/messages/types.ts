/**
 * Chat shapes: what the renderer adds on top of the wire records.
 */
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type Author,
  type ChatMessage,
  type ConversationSummary,
} from '@shared/ipc-types';
import { z } from 'zod';

import { displayName } from '@/lib/user-display';

export const MESSAGE_MAX_LENGTH = CHAT_MESSAGE_MAX_LENGTH;

/** Where an outgoing line stands: still in flight, confirmed, or refused. */
export type DeliveryState = 'sending' | 'sent' | 'failed';

/** A message as the thread holds it: the wire record plus its delivery state. */
export interface ThreadMessage extends ChatMessage {
  delivery: DeliveryState;
}

export const composeMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Type a message before sending.')
    .max(MESSAGE_MAX_LENGTH, `Keep it under ${String(MESSAGE_MAX_LENGTH)} characters.`),
});

export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;

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
