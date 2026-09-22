/**
 * Chat operations, as seen by the renderer: one allowlisted IPC call each.
 * Which transport the main process used — the socket or the HTTP fallback —
 * is its business; both answer the same shapes.
 */
import type {
  AttachChatFilesResponse,
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  Conversation,
  ConversationPage,
  ConversationSummary,
  CreateConversationRequest,
  IpcError,
  LocalFileSource,
  MessagePage,
  Participant,
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

export interface OutgoingMessage {
  conversationId: string;
  clientId: string;
  body: string;
  replyToMessageId?: string | undefined;
  attachmentIds?: readonly string[] | undefined;
}

export async function sendMessage(
  outgoing: OutgoingMessage,
): Promise<Result<ChatMessage, MessagesError>> {
  const { replyToMessageId, attachmentIds, ...rest } = outgoing;
  const result = await ipc.sendChatMessage({
    ...rest,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(attachmentIds === undefined || attachmentIds.length === 0
      ? {}
      : { attachmentIds: [...attachmentIds] }),
  });
  return result.ok ? ok(result.data.message) : fail(result.error);
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  body: string,
): Promise<Result<ChatMessage, MessagesError>> {
  const result = await ipc.editChatMessage({ conversationId, messageId, body });
  return result.ok ? ok(result.data.message) : fail(result.error);
}

export async function unsendMessage(
  conversationId: string,
  messageId: string,
): Promise<Result<true, MessagesError>> {
  const result = await ipc.deleteChatMessage({ conversationId, messageId });
  return result.ok ? ok(true) : fail(result.error);
}

/** `emoji: null` removes the caller's reaction. Answers the full list either way. */
export async function setReaction(
  conversationId: string,
  messageId: string,
  emoji: string | null,
): Promise<Result<ChatReaction[], MessagesError>> {
  const result =
    emoji === null
      ? await ipc.unreactToChatMessage({ conversationId, messageId })
      : await ipc.reactToChatMessage({ conversationId, messageId, emoji });
  return result.ok ? ok(result.data.reactions) : fail(result.error);
}

export async function attachFiles(
  conversationId: string,
  limit: number,
): Promise<Result<AttachChatFilesResponse, MessagesError>> {
  const result = await ipc.attachChatFiles({ conversationId, limit });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** A file the user pasted or dropped, read into memory by the composer. */
export interface LocalFile {
  fileName?: string | undefined;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Uploads pasted or dropped files to the draft. The main process checks a
 * paste really is an image; a drop may be any file, as the picker allows.
 */
export async function uploadLocalFiles(
  conversationId: string,
  source: LocalFileSource,
  files: readonly LocalFile[],
): Promise<Result<AttachChatFilesResponse, MessagesError>> {
  const result = await ipc.uploadLocalChatFiles({
    conversationId,
    source,
    files: files.map(({ fileName, bytes }) =>
      fileName === undefined ? { bytes } : { fileName, bytes },
    ),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchAttachment(
  attachmentId: string,
): Promise<Result<ChatAttachment, MessagesError>> {
  const result = await ipc.getChatAttachment({ attachmentId });
  return result.ok ? ok(result.data.attachment) : fail(result.error);
}

/** Resolves false when the user cancelled the save dialog. */
export async function saveAttachment(
  attachmentId: string,
): Promise<Result<boolean, MessagesError>> {
  const result = await ipc.saveChatAttachment({ attachmentId });
  return result.ok ? ok(result.data.saved) : fail(result.error);
}

export async function renameGroup(
  conversationId: string,
  title: string,
): Promise<Result<Conversation, MessagesError>> {
  const result = await ipc.renameGroup({ conversationId, title });
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

/** Opens the picker in the main process; a cancel is a CANCELLED failure. */
export async function setGroupPhoto(
  conversationId: string,
): Promise<Result<Conversation, MessagesError>> {
  const result = await ipc.setGroupPhoto({ conversationId });
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

export async function removeGroupPhoto(
  conversationId: string,
): Promise<Result<Conversation, MessagesError>> {
  const result = await ipc.removeGroupPhoto({ conversationId });
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

export async function addGroupMembers(
  conversationId: string,
  userIds: string[],
): Promise<Result<Participant[], MessagesError>> {
  const result = await ipc.addGroupMembers({ conversationId, userIds });
  return result.ok ? ok(result.data.participants) : fail(result.error);
}

export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<Result<true, MessagesError>> {
  const result = await ipc.removeGroupMember({ conversationId, userId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function changeGroupRole(
  conversationId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<Result<Participant[], MessagesError>> {
  const result = await ipc.changeGroupRole({ conversationId, userId, role });
  return result.ok ? ok(result.data.participants) : fail(result.error);
}

export async function leaveGroup(conversationId: string): Promise<Result<true, MessagesError>> {
  const result = await ipc.leaveGroup({ conversationId });
  return result.ok ? ok(true) : fail(result.error);
}

/** Sends (or re-sends — it is idempotent) an invite card into the DM with `userId`. */
export async function inviteToGroup(
  conversationId: string,
  userId: string,
): Promise<Result<ChatMessage, MessagesError>> {
  const result = await ipc.inviteToGroup({ conversationId, userId });
  return result.ok ? ok(result.data.message) : fail(result.error);
}

export async function acceptInvite(
  inviteId: string,
): Promise<Result<ConversationSummary, MessagesError>> {
  const result = await ipc.acceptGroupInvite({ inviteId });
  return result.ok ? ok(result.data.conversation) : fail(result.error);
}

export async function declineInvite(inviteId: string): Promise<Result<true, MessagesError>> {
  const result = await ipc.declineGroupInvite({ inviteId });
  return result.ok ? ok(true) : fail(result.error);
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
