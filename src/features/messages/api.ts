/**
 * Chat operations, as seen by the renderer: one allowlisted IPC call each.
 * Which transport the main process used — the socket or the HTTP fallback —
 * is its business; both answer the same shapes.
 */
import type {
  ChatMessage,
  ConversationPage,
  ConversationSummary,
  CreateConversationRequest,
  IpcError,
  MessagePage,
} from '@shared/ipc-types';

import { CONVERSATIONS_PAGE_SIZE, MESSAGES_PAGE_SIZE } from '@/lib/constants';
import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type MessagesError = IpcError;

export async function fetchConversations(
  cursor?: string,
): Promise<Result<ConversationPage, MessagesError>> {
  const result = await ipc.listConversations({
    limit: CONVERSATIONS_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchConversation(
  conversationId: string,
): Promise<Result<ConversationSummary, MessagesError>> {
  const result = await ipc.getConversation({ conversationId });
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

export async function createConversation(
  request: CreateConversationRequest,
): Promise<Result<ConversationSummary, MessagesError>> {
  const result = await ipc.createConversation(request);
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

/** Newest first on the wire; pass `cursor` for the next (older) page. */
export async function fetchMessages(
  conversationId: string,
  cursor?: string,
): Promise<Result<MessagePage, MessagesError>> {
  const result = await ipc.listMessages({
    conversationId,
    limit: MESSAGES_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function sendMessage(
  conversationId: string,
  clientId: string,
  body: string,
): Promise<Result<ChatMessage, MessagesError>> {
  const result = await ipc.sendChatMessage({ conversationId, clientId, body });
  return result.ok ? ok(result.data.message) : fail(result.error);
}

export async function markRead(
  conversationId: string,
  messageId: string,
): Promise<Result<true, MessagesError>> {
  const result = await ipc.markConversationRead({ conversationId, messageId });
  return result.ok ? ok(true) : fail(result.error);
}

export function sendTyping(conversationId: string, typing: boolean): void {
  void ipc.sendTyping({ conversationId, typing });
}
