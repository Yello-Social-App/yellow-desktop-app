/**
 * Chat: conversations, history, sending, read markers and typing; editing,
 * unsending and reacting; files; and group management and invites.
 *
 * Two transports, one contract. History and conversation management are
 * HTTP against the chat service; sending, read markers and typing go over
 * the live socket when it is up and fall back to the HTTP routes when it is
 * not — the service defines both as the same operation. The renderer never
 * knows which was used.
 *
 * Edit, unsend and react go over HTTP even with the socket up. On the socket
 * they have no direct reply — success is only the fan-out, failure an `error`
 * frame — while HTTP answers the caller with the result, so the renderer can
 * reconcile at once and still take the fan-out when it arrives. The socket
 * form would buy nothing but a second way to time out.
 *
 * Who may do what (sender-only edit, admin-only rename, owner-only roles) is
 * the service's call; the renderer hides controls a role does not have, but
 * nothing here pre-empts a refusal — the 403 is the authority (A01).
 *
 * Membership is enforced server-side: a conversation the caller is not in
 * answers 404 (ids are not enumerable), never 403, and nothing here tries to
 * pre-empt that (OWASP A01).
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import {
  droppedFilePart,
  pastedImagePart,
  pickChatFiles,
  readChatFile,
  saveChatFile,
  type FilePart,
} from '../../chat/files';
import { chatSocket, SocketFailure } from '../../chat/socket';
import { IPC_CHANNELS } from '../channels';
import { pickImageFiles, readImagePart } from '../image-picker';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  addGroupMembersRequestSchema,
  attachChatFilesRequestSchema,
  attachChatFilesResponseSchema,
  attachmentIdRequestSchema,
  attachmentResponseSchema,
  changeMemberRoleRequestSchema,
  CHAT_ATTACHMENT_MAX_BYTES,
  chatAttachmentSchema,
  chatMessageRefSchema,
  chatMessageResponseSchema,
  chatMessageSchema,
  chatSocketStateSchema,
  conversationIdRequestSchema,
  conversationPageSchema,
  conversationResponseSchema,
  conversationSchema,
  conversationSummarySchema,
  createConversationRequestSchema,
  deletedResponseSchema,
  editChatMessageRequestSchema,
  emptyRequestSchema,
  groupInviteResultSchema,
  groupMemberRequestSchema,
  groupParticipantsSchema,
  groupRecordResponseSchema,
  inviteIdRequestSchema,
  ipcFail,
  ipcOk,
  listConversationsRequestSchema,
  listMessagesRequestSchema,
  markReadRequestSchema,
  messagePageSchema,
  messageReactionsSchema,
  participantSchema,
  reactChatMessageRequestSchema,
  renameGroupRequestSchema,
  savedFileResponseSchema,
  sendChatMessageRequestSchema,
  typingRequestSchema,
  uploadLocalFilesRequestSchema,
  type AcknowledgedResponse,
  type AttachChatFilesResponse,
  type AttachmentResponse,
  type ChatAttachment,
  type ChatMessageResponse,
  type ChatSocketState,
  type ConversationPage,
  type ConversationResponse,
  type DeletedResponse,
  type GroupInviteResult,
  type GroupParticipants,
  type GroupRecordResponse,
  type IpcResult,
  type MessagePage,
  type MessageReactions,
  type SavedFileResponse,
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

const ACKNOWLEDGED_TRUE: AcknowledgedResponse = { acknowledged: true };

/** A conversation detail as a list row: what accepting an invite answers with. */
function summaryOf(detail: z.infer<typeof conversationDetailSchema>): ConversationResponse {
  return conversationResponseSchema.parse({
    conversation: conversationSummarySchema.parse({
      ...detail,
      lastMessage: null,
      unreadCount: 0,
    }),
  });
}

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

  return ipcOk(summaryOf(detail.data));
}

/** Wraps a bare group record, as a rename or a photo change answers. */
function asGroupRecord(
  result: IpcResult<z.infer<typeof conversationSchema>>,
): IpcResult<GroupRecordResponse> {
  return result.ok ? ipcOk(groupRecordResponseSchema.parse({ conversation: result.data })) : result;
}

/** A refusal that says nothing new is still a refusal, but a cancel is not. */
const CANCELLED: IpcResult<never> = ipcFail('CANCELLED', 'Cancelled.');

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
    async ({
      conversationId,
      clientId,
      body,
      replyToMessageId,
      attachmentIds,
    }): Promise<IpcResult<ChatMessageResponse>> => {
      // Absent keys stay absent: the service reads `[]` and a missing list alike,
      // but a stray `replyToMessageId: undefined` would be noise on the wire.
      const payload = {
        clientId,
        body,
        ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
        ...(attachmentIds === undefined || attachmentIds.length === 0 ? {} : { attachmentIds }),
      };

      if (chatSocket.isConnected()) {
        try {
          const reply = await chatSocket.request(
            'message.send',
            { conversationId, ...payload },
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
        body: payload,
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

  registerMessageActionHandlers();
  registerAttachmentHandlers();
  registerGroupHandlers();
}

/** Edit, unsend, react: the sender-or-member actions on one line. */
function registerMessageActionHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.CHAT_EDIT_MESSAGE,
    editChatMessageRequestSchema,
    async ({ conversationId, messageId, body }): Promise<IpcResult<ChatMessageResponse>> => {
      const result = await apiRequest({
        method: 'patch',
        url: ENDPOINTS.chat.message(conversationId, messageId),
        body: { body },
        schema: chatMessageSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      log.info('message_edited', {});
      return ipcOk(chatMessageResponseSchema.parse({ message: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_DELETE_MESSAGE,
    chatMessageRefSchema,
    async ({ conversationId, messageId }): Promise<IpcResult<DeletedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.chat.message(conversationId, messageId),
        schema: noContentSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      log.info('message_unsent', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_REACT,
    reactChatMessageRequestSchema,
    async ({ conversationId, messageId, emoji }): Promise<IpcResult<MessageReactions>> =>
      apiRequest({
        method: 'put',
        url: ENDPOINTS.chat.reaction(conversationId, messageId),
        body: { emoji },
        schema: messageReactionsSchema,
        service: 'chat',
      }),
  );

  // Idempotent upstream: removing a reaction you do not have answers the list.
  registerIpcHandler(
    IPC_CHANNELS.CHAT_UNREACT,
    chatMessageRefSchema,
    async ({ conversationId, messageId }): Promise<IpcResult<MessageReactions>> =>
      apiRequest({
        method: 'delete',
        url: ENDPOINTS.chat.reaction(conversationId, messageId),
        schema: messageReactionsSchema,
        service: 'chat',
      }),
  );
}

/**
 * Files: upload for a draft (picked, pasted or dropped), refresh an expired link, save
 * to disk.
 *
 * An upload is two steps by the service's design — upload, then send the id —
 * and the first happens as soon as the files are picked, so the composer can
 * show what is attached and the send itself stays a small JSON frame that
 * works over the socket.
 */
function registerAttachmentHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.CHAT_ATTACH_FILES,
    attachChatFilesRequestSchema,
    async ({ conversationId, limit }, event): Promise<IpcResult<AttachChatFilesResponse>> => {
      const paths = await pickChatFiles(event);
      if (paths.length === 0) {
        return ipcOk(
          attachChatFilesResponseSchema.parse({ attachments: [], cancelled: true, skipped: 0 }),
        );
      }

      const accepted = paths.slice(0, limit);
      return uploadParts(
        conversationId,
        accepted.map((filePath) => () => readChatFile(filePath)),
        paths.length - accepted.length,
        limit,
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_UPLOAD_LOCAL_FILES,
    uploadLocalFilesRequestSchema,
    async ({ conversationId, source, files }): Promise<IpcResult<AttachChatFilesResponse>> =>
      uploadParts(
        conversationId,
        files.map(
          ({ bytes, fileName }, index) =>
            () =>
              Promise.resolve(
                source === 'paste'
                  ? pastedImagePart(bytes, fileName, index)
                  : droppedFilePart(bytes, fileName, index),
              ),
        ),
        0,
        files.length,
      ),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_GET_ATTACHMENT,
    attachmentIdRequestSchema,
    async ({ attachmentId }): Promise<IpcResult<AttachmentResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.attachment(attachmentId),
        schema: chatAttachmentSchema,
        service: 'chat',
      });
      return result.ok
        ? ipcOk(attachmentResponseSchema.parse({ attachment: result.data }))
        : result;
    },
  );

  /**
   * Addressed by id, never by URL: the renderer could otherwise name any
   * address for the main process to fetch. The link is re-read from the
   * service, which also re-checks membership (A01).
   */
  registerIpcHandler(
    IPC_CHANNELS.CHAT_SAVE_ATTACHMENT,
    attachmentIdRequestSchema,
    async ({ attachmentId }, event): Promise<IpcResult<SavedFileResponse>> => {
      const fresh = await apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.attachment(attachmentId),
        schema: chatAttachmentSchema,
        service: 'chat',
      });
      if (!fresh.ok) {
        return fresh;
      }
      if (fresh.data.url === null) {
        return ipcFail('API', 'Files are not available on this server right now.');
      }
      const saved = await saveChatFile(event, fresh.data.url, fresh.data.fileName);
      return saved.ok ? ipcOk(savedFileResponseSchema.parse(saved.data)) : saved;
    },
  );
}

/**
 * Uploads parts one at a time to a conversation's draft, and reports what did
 * not make it. Shared by the picker and paste: the parts come from different
 * places, and are read lazily so a picked 10 MB file is loaded only when its
 * turn comes.
 *
 * One at a time: the service takes one file per request, and a burst of ten
 * parallel 10 MB uploads helps nobody on a home connection.
 */
async function uploadParts(
  conversationId: string,
  parts: readonly (() => Promise<IpcResult<FilePart>>)[],
  overCap: number,
  limit: number,
): Promise<IpcResult<AttachChatFilesResponse>> {
  let skipped = overCap;
  let skippedReason: string | undefined =
    overCap > 0 ? `Only ${String(limit)} more file(s) fit in this message.` : undefined;
  const attachments: ChatAttachment[] = [];

  for (const [index, read] of parts.entries()) {
    const part = await read();
    if (!part.ok) {
      skipped += 1;
      skippedReason ??= part.error.message;
      continue;
    }
    const form = new FormData();
    form.append('file', part.data.blob, part.data.fileName);
    const uploaded = await apiRequest({
      method: 'post',
      url: ENDPOINTS.chat.attachments(conversationId),
      body: form,
      schema: chatAttachmentSchema,
      service: 'chat',
    });
    if (!uploaded.ok) {
      skipped += 1;
      skippedReason ??=
        uploaded.error.apiCode === 'UNAVAILABLE'
          ? 'Files cannot be sent on this server yet.'
          : uploaded.error.message;
      // Not configured is not going to change for the next file.
      if (uploaded.error.apiCode === 'UNAVAILABLE') {
        skipped += parts.length - index - 1;
        break;
      }
      continue;
    }
    attachments.push(uploaded.data);
  }

  log.info('attachments_uploaded', { count: attachments.length, skipped });
  return ipcOk(
    attachChatFilesResponseSchema.parse({
      attachments,
      cancelled: false,
      skipped,
      ...(skippedReason === undefined ? {} : { skippedReason }),
    }),
  );
}

/** Rename, photo, members, roles, leave, and the invite cards. */
function registerGroupHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.CHAT_RENAME_GROUP,
    renameGroupRequestSchema,
    async ({ conversationId, title }): Promise<IpcResult<GroupRecordResponse>> =>
      asGroupRecord(
        await apiRequest({
          method: 'patch',
          url: ENDPOINTS.chat.conversation(conversationId),
          body: { title },
          schema: conversationSchema,
          service: 'chat',
        }),
      ),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_SET_GROUP_PHOTO,
    conversationIdRequestSchema,
    async ({ conversationId }, event): Promise<IpcResult<GroupRecordResponse>> => {
      const [filePath] = await pickImageFiles(event, { title: 'Choose a group photo' });
      if (filePath === undefined) {
        return CANCELLED;
      }
      // JPEG, PNG, GIF or WebP by extension here; by content at the service,
      // which refuses an SVG or HTML "photo" whatever it is called.
      const part = await readImagePart(filePath, CHAT_ATTACHMENT_MAX_BYTES);
      if (!part.ok) {
        return part;
      }
      const form = new FormData();
      form.append('file', part.data.blob, part.data.fileName);
      const result = await apiRequest({
        method: 'put',
        url: ENDPOINTS.chat.photo(conversationId),
        body: form,
        schema: conversationSchema,
        service: 'chat',
      });
      log.info(result.ok ? 'group_photo_set' : 'group_photo_failed', {});
      return asGroupRecord(result);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_REMOVE_GROUP_PHOTO,
    conversationIdRequestSchema,
    async ({ conversationId }): Promise<IpcResult<GroupRecordResponse>> =>
      asGroupRecord(
        await apiRequest({
          method: 'delete',
          url: ENDPOINTS.chat.photo(conversationId),
          schema: conversationSchema,
          service: 'chat',
        }),
      ),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_ADD_MEMBERS,
    addGroupMembersRequestSchema,
    async ({ conversationId, userIds }): Promise<IpcResult<GroupParticipants>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.members(conversationId),
        body: { userIds },
        schema: groupParticipantsSchema,
        service: 'chat',
      });
      if (result.ok) {
        log.info('group_members_added', { count: userIds.length });
      }
      return result;
    },
  );

  // Removing yourself is `leave`, which the service insists on (400 otherwise).
  registerIpcHandler(
    IPC_CHANNELS.CHAT_REMOVE_MEMBER,
    groupMemberRequestSchema,
    async ({ conversationId, userId }): Promise<IpcResult<AcknowledgedResponse>> => {
      if (userId === chatSocket.viewerId()) {
        return ipcFail('INVALID_PAYLOAD', 'Leave the group instead of removing yourself.');
      }
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.chat.member(conversationId, userId),
        schema: noContentSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk(ACKNOWLEDGED_TRUE) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_CHANGE_ROLE,
    changeMemberRoleRequestSchema,
    async ({ conversationId, userId, role }): Promise<IpcResult<GroupParticipants>> =>
      apiRequest({
        method: 'patch',
        url: ENDPOINTS.chat.member(conversationId, userId),
        body: { role },
        schema: groupParticipantsSchema,
        service: 'chat',
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_LEAVE_GROUP,
    conversationIdRequestSchema,
    async ({ conversationId }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.leave(conversationId),
        schema: noContentSchema,
        service: 'chat',
      });
      if (result.ok) {
        log.info('group_left', {});
      }
      return result.ok ? ipcOk(ACKNOWLEDGED_TRUE) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_INVITE,
    groupMemberRequestSchema,
    async ({ conversationId, userId }): Promise<IpcResult<GroupInviteResult>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.invites(conversationId),
        body: { userId },
        schema: groupInviteResultSchema,
        service: 'chat',
      });
      if (result.ok) {
        log.info('group_invite_sent', {});
      }
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_ACCEPT_INVITE,
    inviteIdRequestSchema,
    async ({ inviteId }): Promise<IpcResult<ConversationResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.acceptInvite(inviteId),
        schema: conversationDetailSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      log.info('group_invite_accepted', {});
      return ipcOk(summaryOf(result.data));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CHAT_DECLINE_INVITE,
    inviteIdRequestSchema,
    async ({ inviteId }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.declineInvite(inviteId),
        schema: noContentSchema,
        service: 'chat',
      });
      return result.ok ? ipcOk(ACKNOWLEDGED_TRUE) : result;
    },
  );
}
