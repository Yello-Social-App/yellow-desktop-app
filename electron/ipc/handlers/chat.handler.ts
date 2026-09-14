/**
 * Chat: conversations, history, sending, read markers and typing.
 *
 * Two transports, one contract. History and conversation management are
 * HTTP against the chat service; sending, read markers and typing go over
 * the live socket when it is up and fall back to the HTTP routes when it is
 * not — the service defines both as the same operation. The renderer never
 * knows which was used.
 *
 * Membership is enforced server-side: a conversation the caller is not in
 * answers 404 (ids are not enumerable), never 403, and nothing here tries to
 * pre-empt that (OWASP A01).
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { chatSocket, SocketFailure } from '../../chat/socket';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  chatMessageResponseSchema,
  chatMessageSchema,
  chatSocketStateSchema,
  conversationIdRequestSchema,
  conversationPageSchema,
  conversationResponseSchema,
  conversationSchema,
  conversationSummarySchema,
  createConversationRequestSchema,
  emptyRequestSchema,
  ipcFail,
  ipcOk,
  listConversationsRequestSchema,
  listMessagesRequestSchema,
  markReadRequestSchema,
  messagePageSchema,
  participantSchema,
  sendChatMessageRequestSchema,
  typingRequestSchema,
  type AcknowledgedResponse,
  type ChatMessageResponse,
  type ChatSocketState,
  type ConversationPage,
  type ConversationResponse,
  type IpcResult,
  type MessagePage,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.chat');

const ACKNOWLEDGED = acknowledgedResponseSchema.parse({ acknowledged: true });

const noContentSchema = z.undefined();

/** `GET /ws/conversations/{id}`: the record plus participants, no list extras. */
const conversationDetailSchema = conversationSchema.extend({
  participants: z
    .array(participantSchema)
    .max(600)
    .nullish()
    .transform((value) => value ?? []),
});

/** The socket's `message.sent` reply. */
const messageSentSchema = z.object({ message: chatMessageSchema });

/**
 * A freshly created conversation and a fetched one both come back without
 * the list's `lastMessage`/`unreadCount`; the summary the renderer keeps is
 * built from the detail with those at their obvious starting values.
 */
async function fetchConversationSummary(
  conversationId: string,
): Promise<IpcResult<ConversationResponse>> {
  const detail = await apiRequest({
    method: 'get',
    url: ENDPOINTS.chat.conversation(conversationId),
    schema: conversationDetailSchema,
    service: 'chat',
  });
  if (!detail.ok) {
    return detail;
  }

  const summary = conversationSummarySchema.parse({
    ...detail.data,
    lastMessage: null,
    unreadCount: 0,
  });
  return ipcOk(conversationResponseSchema.parse({ conversation: summary }));
}

export function registerChatHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.CHAT_LIST_CONVERSATIONS,
    listConversationsRequestSchema,
    async ({ cursor, limit }): Promise<IpcResult<ConversationPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.conversations,
        schema: conversationPageSchema,
        params: { limit, cursor },
        service: 'chat',
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_CREATE_CONVERSATION,
    createConversationRequestSchema,
    async (request): Promise<IpcResult<ConversationResponse>> => {
      const created = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.conversations,
        body: request,
        schema: conversationSchema,
        service: 'chat',
      });
      if (!created.ok) {
        return created;
      }

      log.info('conversation_created', { type: request.type });
      return fetchConversationSummary(created.data.id);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_GET_CONVERSATION,
    conversationIdRequestSchema,
    async ({ conversationId }): Promise<IpcResult<ConversationResponse>> =>
      fetchConversationSummary(conversationId),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_LIST_MESSAGES,
    listMessagesRequestSchema,
    // Wire order is newest first; the renderer reverses for display.
    async ({ conversationId, cursor, limit }): Promise<IpcResult<MessagePage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.messages(conversationId),
        schema: messagePageSchema,
        params: { limit, cursor },
        service: 'chat',
      }),
  );

  /**
   * `clientId` is the idempotency key on both transports, so a send that
   * timed out on the socket and is retried over HTTP yields the original
   * message rather than a duplicate.
   */
  registerIpcHandler(
    IPC_CHANNELS.CHAT_SEND_MESSAGE,
    sendChatMessageRequestSchema,
    async ({ conversationId, clientId, body }): Promise<IpcResult<ChatMessageResponse>> => {
      if (chatSocket.isConnected()) {
        try {
          const reply = await chatSocket.request(
            'message.send',
            { conversationId, clientId, body },
            'message.sent',
          );
          const parsed = messageSentSchema.safeParse(reply);
          if (parsed.success) {
            log.info('message_sent', { transport: 'socket' });
            return ipcOk(chatMessageResponseSchema.parse({ message: parsed.data.message }));
          }
          log.warn('message_sent_reply_rejected', {});
        } catch (failure: unknown) {
          if (failure instanceof SocketFailure) {
            // A rejection from the service is final; only transport trouble
            // earns the HTTP retry below.
            if (failure.code !== 'TIMEOUT' && failure.code !== 'DISCONNECTED') {
              log.info('message_send_refused', { code: failure.code });
              return ipcFail('API', failure.message, { apiCode: failure.code });
            }
            log.warn('message_send_socket_failed', { code: failure.code });
          }
        }
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.messages(conversationId),
        body: { clientId, body },
        schema: chatMessageSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }

      log.info('message_sent', { transport: 'http' });
      return ipcOk(chatMessageResponseSchema.parse({ message: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_MARK_READ,
    markReadRequestSchema,
    async ({ conversationId, messageId }): Promise<IpcResult<AcknowledgedResponse>> => {
      if (chatSocket.send('message.read', { conversationId, messageId })) {
        return ipcOk(ACKNOWLEDGED);
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.read(conversationId),
        body: { messageId },
        schema: noContentSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk(ACKNOWLEDGED) : result;
    },
  );

  // Typing has no HTTP form: with the socket down it is simply not sent.
  registerIpcHandler(
    IPC_CHANNELS.CHAT_TYPING,
    typingRequestSchema,
    ({ conversationId, typing }): IpcResult<AcknowledgedResponse> => {
      const sent = chatSocket.send('typing', { conversationId, typing });
      return ipcOk(acknowledgedResponseSchema.parse({ acknowledged: sent }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_SOCKET_STATE,
    emptyRequestSchema,
    (): IpcResult<ChatSocketState> => ipcOk(chatSocketStateSchema.parse(chatSocket.state())),
  );
}
