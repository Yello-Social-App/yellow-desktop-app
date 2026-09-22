/**
 * Typed access to the preload bridge.
 *
 * Everything the main process returns is parsed against its schema before it is
 * handed back (OWASP A08) — a response is untrusted input like any other. The
 * bridge being absent (renderer opened in a plain browser) is a normal failure
 * here, not a crash.
 */
import {
  attachChatFilesResponseSchema,
  attachmentResponseSchema,
  groupInviteResultSchema,
  groupParticipantsSchema,
  groupRecordResponseSchema,
  messageReactionsSchema,
  savedFileResponseSchema,
  type AddGroupMembersRequest,
  type AttachChatFilesRequest,
  type UploadLocalFilesRequest,
  type AttachmentIdRequest,
  type ChangeMemberRoleRequest,
  type ChatMessageRef,
  type EditChatMessageRequest,
  type GroupMemberRequest,
  type InviteIdRequest,
  type ReactChatMessageRequest,
  type RenameGroupRequest,
  accountListResponseSchema,
  acknowledgedResponseSchema,
  appInfoResponseSchema,
  chatMessageResponseSchema,
  chatSocketStateSchema,
  commentPageSchema,
  commentResponseSchema,
  communityPageSchema,
  communityPostPageSchema,
  communityPostResponseSchema,
  communityPostVoteSchema,
  communityResponseSchema,
  conversationPageSchema,
  conversationResponseSchema,
  deletedResponseSchema,
  exportPostsResponseSchema,
  feedResponseSchema,
  friendEntryPageSchema,
  friendEntryResponseSchema,
  ipcFail,
  ipcResultSchema,
  linkPreviewResponseSchema,
  markAllNotificationsReadSchema,
  messagePageSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationResponseSchema,
  postResponseSchema,
  projectLikeSchema,
  projectPageSchema,
  projectResponseSchema,
  profileResponseSchema,
  reactionSummarySchema,
  reactorPageSchema,
  registerResponseSchema,
  sessionResponseSchema,
  shareLinkCopiedResponseSchema,
  stageImagesResponseSchema,
  techCountListSchema,
  unreadCountSchema,
  userPostsResponseSchema,
  windowStateSchema,
  type AccountIdRequest,
  type CommunitySlugRequest,
  type ConversationIdRequest,
  type CreateCommentRequest,
  type CreateCommunityPostRequest,
  type CreateConversationRequest,
  type CreatePostRequest,
  type DeleteCommentRequest,
  type DiscardImagesRequest,
  type ExportPostsRequest,
  type FeedRequest,
  type ForgotPasswordRequest,
  type FriendUserRequest,
  type IpcResult,
  type ListCommentsRequest,
  type ListCommunitiesRequest,
  type ListCommunityPostsRequest,
  type ListConversationsRequest,
  type ListFriendRequestsRequest,
  type ListFrontPagePostsRequest,
  type ListNotificationsRequest,
  type ListProjectTechRequest,
  type ListProjectsRequest,
  type ListMessagesRequest,
  type LinkPreviewRequest,
  type ListReactorsRequest,
  type LoginRequest,
  type MarkReadRequest,
  type NotificationIdRequest,
  type PageRequest,
  type PostIdRequest,
  type ProjectIdRequest,
  type PublishProjectRequest,
  type PublicUserRequest,
  type ReactionTargetRequest,
  type RegisterDeviceRequest,
  type RegisterRequest,
  type RepostRequest,
  type SearchUsersRequest,
  type ResendOtpRequest,
  type ResetPasswordRequest,
  type SendChatMessageRequest,
  type StageImagesRequest,
  type ToggleReactionRequest,
  type TypingRequest,
  type UnregisterDeviceRequest,
  type UpdateProfileRequest,
  type UpdateCommentRequest,
  type UpdateNotificationPreferencesRequest,
  type UpdatePostRequest,
  type UserPostsRequest,
  type VerifyOtpRequest,
  type VerifyResetOtpRequest,
  type VoteCommunityPostRequest,
  type YelloBridge,
  chatEventSchema,
  deviceResponseSchema,
  notificationEventSchema,
  type ChatEvent,
  type NotificationEvent,
} from '@shared/ipc-types';
import type { z } from 'zod';

import { createLogger } from './logger';

const log = createLogger('renderer.ipc');

type UnauthenticatedListener = () => void;
const unauthenticatedListeners = new Set<UnauthenticatedListener>();

/**
 * Fires when a call fails with UNAUTHENTICATED after the main process has
 * already tried and failed to refresh — the session is over, whatever screen
 * the user is on. The auth store subscribes; a screen never has to interpret
 * that error itself.
 */
export function onUnauthenticated(listener: UnauthenticatedListener): () => void {
  unauthenticatedListeners.add(listener);
  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

function bridge(): YelloBridge | undefined {
  return window.yello;
}

export function isBridgeAvailable(): boolean {
  return bridge() !== undefined;
}

async function guarded<TSchema extends z.ZodType>(
  operation: string,
  dataSchema: TSchema,
  run: (api: YelloBridge) => Promise<unknown>,
): Promise<IpcResult<z.infer<TSchema>>> {
  const api = bridge();
  if (api === undefined) {
    return ipcFail('UNKNOWN', 'Desktop bridge is unavailable.');
  }

  let raw: unknown;
  try {
    raw = await run(api);
  } catch (error) {
    log.error('ipc_call_failed', { operation, error });
    return ipcFail('UNKNOWN', 'The desktop operation failed.');
  }

  const parsed = ipcResultSchema(dataSchema).safeParse(raw);
  if (!parsed.success) {
    // Field paths, not values — enough to name what disagreed without logging
    // anything the response actually carried.
    const fields = [
      ...new Set(parsed.error.issues.slice(0, 8).map((issue) => issue.path.join('.') || '(root)')),
    ].join(', ');
    log.error('ipc_response_rejected', {
      operation,
      issues: parsed.error.issues.length,
      fields,
    });
    return ipcFail('INVALID_PAYLOAD', 'The desktop response had an unexpected shape.');
  }

  const result = parsed.data as IpcResult<z.infer<TSchema>>;
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') {
    for (const listener of unauthenticatedListeners) {
      listener();
    }
  }
  return result;
}

export const ipc = {
  login: (request: LoginRequest) =>
    guarded('auth.login', sessionResponseSchema, (api) => api.auth.login(request)),
  register: (request: RegisterRequest) =>
    guarded('auth.register', registerResponseSchema, (api) => api.auth.register(request)),
  verifyOtp: (request: VerifyOtpRequest) =>
    guarded('auth.verifyOtp', sessionResponseSchema, (api) => api.auth.verifyOtp(request)),
  logout: () => guarded('auth.logout', sessionResponseSchema, (api) => api.auth.logout()),
  currentSession: () =>
    guarded('auth.currentSession', sessionResponseSchema, (api) => api.auth.currentSession()),

  resendOtp: (request: ResendOtpRequest) =>
    guarded('auth.resendOtp', acknowledgedResponseSchema, (api) => api.auth.resendOtp(request)),
  forgotPassword: (request: ForgotPasswordRequest) =>
    guarded('auth.forgotPassword', acknowledgedResponseSchema, (api) =>
      api.auth.forgotPassword(request),
    ),
  verifyResetOtp: (request: VerifyResetOtpRequest) =>
    guarded('auth.verifyResetOtp', acknowledgedResponseSchema, (api) =>
      api.auth.verifyResetOtp(request),
    ),
  resetPassword: (request: ResetPasswordRequest) =>
    guarded('auth.resetPassword', acknowledgedResponseSchema, (api) =>
      api.auth.resetPassword(request),
    ),

  listAccounts: () =>
    guarded('auth.listAccounts', accountListResponseSchema, (api) => api.auth.listAccounts()),
  switchAccount: (request: AccountIdRequest) =>
    guarded('auth.switchAccount', sessionResponseSchema, (api) => api.auth.switchAccount(request)),
  forgetAccount: (request: AccountIdRequest) =>
    guarded('auth.forgetAccount', acknowledgedResponseSchema, (api) =>
      api.auth.forgetAccount(request),
    ),

  listFeed: (request: FeedRequest) =>
    guarded('feed.list', feedResponseSchema, (api) => api.feed.list(request)),
  createPost: (request: CreatePostRequest) =>
    guarded('feed.createPost', postResponseSchema, (api) => api.feed.createPost(request)),
  stageImages: (request?: StageImagesRequest) =>
    guarded('feed.stageImages', stageImagesResponseSchema, (api) => api.feed.stageImages(request)),
  discardImages: (request: DiscardImagesRequest) =>
    guarded('feed.discardImages', acknowledgedResponseSchema, (api) =>
      api.feed.discardImages(request),
    ),

  getPost: (request: PostIdRequest) =>
    guarded('posts.get', postResponseSchema, (api) => api.posts.get(request)),
  updatePost: (request: UpdatePostRequest) =>
    guarded('posts.update', postResponseSchema, (api) => api.posts.update(request)),
  deletePost: (request: PostIdRequest) =>
    guarded('posts.remove', deletedResponseSchema, (api) => api.posts.remove(request)),
  repost: (request: RepostRequest) =>
    guarded('posts.repost', postResponseSchema, (api) => api.posts.repost(request)),
  copyPostShareLink: (request: PostIdRequest) =>
    guarded('posts.copyShareLink', shareLinkCopiedResponseSchema, (api) =>
      api.posts.copyShareLink(request),
    ),

  createComment: (request: CreateCommentRequest) =>
    guarded('comments.create', commentResponseSchema, (api) => api.comments.create(request)),
  listComments: (request: ListCommentsRequest) =>
    guarded('comments.list', commentPageSchema, (api) => api.comments.list(request)),
  updateComment: (request: UpdateCommentRequest) =>
    guarded('comments.update', commentResponseSchema, (api) => api.comments.update(request)),
  deleteComment: (request: DeleteCommentRequest) =>
    guarded('comments.remove', deletedResponseSchema, (api) => api.comments.remove(request)),

  toggleReaction: (request: ToggleReactionRequest) =>
    guarded('reactions.toggle', reactionSummarySchema, (api) => api.reactions.toggle(request)),
  reactionSummary: (request: ReactionTargetRequest) =>
    guarded('reactions.summary', reactionSummarySchema, (api) => api.reactions.summary(request)),
  listReactors: (request: ListReactorsRequest) =>
    guarded('reactions.list', reactorPageSchema, (api) => api.reactions.list(request)),

  listFriends: (request: PageRequest) =>
    guarded('friends.list', friendEntryPageSchema, (api) => api.friends.list(request)),
  listFriendRequests: (request: ListFriendRequestsRequest) =>
    guarded('friends.requests', friendEntryPageSchema, (api) => api.friends.requests(request)),
  listBlockedUsers: (request: PageRequest) =>
    guarded('friends.blocked', friendEntryPageSchema, (api) => api.friends.blocked(request)),
  sendFriendRequest: (request: FriendUserRequest) =>
    guarded('friends.sendRequest', friendEntryResponseSchema, (api) =>
      api.friends.sendRequest(request),
    ),
  cancelFriendRequest: (request: FriendUserRequest) =>
    guarded('friends.cancelRequest', friendEntryResponseSchema, (api) =>
      api.friends.cancelRequest(request),
    ),
  acceptFriendRequest: (request: FriendUserRequest) =>
    guarded('friends.accept', friendEntryResponseSchema, (api) => api.friends.accept(request)),
  declineFriendRequest: (request: FriendUserRequest) =>
    guarded('friends.decline', friendEntryResponseSchema, (api) => api.friends.decline(request)),
  removeFriend: (request: FriendUserRequest) =>
    guarded('friends.remove', deletedResponseSchema, (api) => api.friends.remove(request)),
  blockUser: (request: FriendUserRequest) =>
    guarded('friends.block', friendEntryResponseSchema, (api) => api.friends.block(request)),
  unblockUser: (request: FriendUserRequest) =>
    guarded('friends.unblock', friendEntryResponseSchema, (api) => api.friends.unblock(request)),

  listUserPosts: (request: UserPostsRequest) =>
    guarded('profile.listPosts', userPostsResponseSchema, (api) => api.profile.listPosts(request)),
  getUser: (request: PublicUserRequest) =>
    guarded('profile.getUser', profileResponseSchema, (api) => api.profile.getUser(request)),
  updateProfile: (request: UpdateProfileRequest) =>
    guarded('profile.update', profileResponseSchema, (api) => api.profile.update(request)),
  searchUsers: (request: SearchUsersRequest) =>
    guarded('profile.searchUsers', friendEntryPageSchema, (api) =>
      api.profile.searchUsers(request),
    ),

  listConversations: (request: ListConversationsRequest) =>
    guarded('chat.listConversations', conversationPageSchema, (api) =>
      api.chat.listConversations(request),
    ),
  createConversation: (request: CreateConversationRequest) =>
    guarded('chat.createConversation', conversationResponseSchema, (api) =>
      api.chat.createConversation(request),
    ),
  getConversation: (request: ConversationIdRequest) =>
    guarded('chat.getConversation', conversationResponseSchema, (api) =>
      api.chat.getConversation(request),
    ),
  listMessages: (request: ListMessagesRequest) =>
    guarded('chat.listMessages', messagePageSchema, (api) => api.chat.listMessages(request)),
  sendChatMessage: (request: SendChatMessageRequest) =>
    guarded('chat.sendMessage', chatMessageResponseSchema, (api) => api.chat.sendMessage(request)),
  editChatMessage: (request: EditChatMessageRequest) =>
    guarded('chat.editMessage', chatMessageResponseSchema, (api) => api.chat.editMessage(request)),
  deleteChatMessage: (request: ChatMessageRef) =>
    guarded('chat.deleteMessage', deletedResponseSchema, (api) => api.chat.deleteMessage(request)),
  reactToChatMessage: (request: ReactChatMessageRequest) =>
    guarded('chat.react', messageReactionsSchema, (api) => api.chat.react(request)),
  unreactToChatMessage: (request: ChatMessageRef) =>
    guarded('chat.unreact', messageReactionsSchema, (api) => api.chat.unreact(request)),
  attachChatFiles: (request: AttachChatFilesRequest) =>
    guarded('chat.attachFiles', attachChatFilesResponseSchema, (api) =>
      api.chat.attachFiles(request),
    ),
  uploadLocalChatFiles: (request: UploadLocalFilesRequest) =>
    guarded('chat.uploadLocalFiles', attachChatFilesResponseSchema, (api) =>
      api.chat.uploadLocalFiles(request),
    ),
  getChatAttachment: (request: AttachmentIdRequest) =>
    guarded('chat.getAttachment', attachmentResponseSchema, (api) =>
      api.chat.getAttachment(request),
    ),
  saveChatAttachment: (request: AttachmentIdRequest) =>
    guarded('chat.saveAttachment', savedFileResponseSchema, (api) =>
      api.chat.saveAttachment(request),
    ),
  renameGroup: (request: RenameGroupRequest) =>
    guarded('chat.renameGroup', groupRecordResponseSchema, (api) => api.chat.renameGroup(request)),
  setGroupPhoto: (request: ConversationIdRequest) =>
    guarded('chat.setGroupPhoto', groupRecordResponseSchema, (api) =>
      api.chat.setGroupPhoto(request),
    ),
  removeGroupPhoto: (request: ConversationIdRequest) =>
    guarded('chat.removeGroupPhoto', groupRecordResponseSchema, (api) =>
      api.chat.removeGroupPhoto(request),
    ),
  addGroupMembers: (request: AddGroupMembersRequest) =>
    guarded('chat.addMembers', groupParticipantsSchema, (api) => api.chat.addMembers(request)),
  removeGroupMember: (request: GroupMemberRequest) =>
    guarded('chat.removeMember', acknowledgedResponseSchema, (api) =>
      api.chat.removeMember(request),
    ),
  changeGroupRole: (request: ChangeMemberRoleRequest) =>
    guarded('chat.changeRole', groupParticipantsSchema, (api) => api.chat.changeRole(request)),
  leaveGroup: (request: ConversationIdRequest) =>
    guarded('chat.leaveGroup', acknowledgedResponseSchema, (api) => api.chat.leaveGroup(request)),
  inviteToGroup: (request: GroupMemberRequest) =>
    guarded('chat.invite', groupInviteResultSchema, (api) => api.chat.invite(request)),
  acceptGroupInvite: (request: InviteIdRequest) =>
    guarded('chat.acceptInvite', conversationResponseSchema, (api) =>
      api.chat.acceptInvite(request),
    ),
  declineGroupInvite: (request: InviteIdRequest) =>
    guarded('chat.declineInvite', acknowledgedResponseSchema, (api) =>
      api.chat.declineInvite(request),
    ),
  markConversationRead: (request: MarkReadRequest) =>
    guarded('chat.markRead', acknowledgedResponseSchema, (api) => api.chat.markRead(request)),
  sendTyping: (request: TypingRequest) =>
    guarded('chat.typing', acknowledgedResponseSchema, (api) => api.chat.typing(request)),
  chatSocketState: () =>
    guarded('chat.socketState', chatSocketStateSchema, (api) => api.chat.socketState()),

  listNotifications: (request: ListNotificationsRequest) =>
    guarded('notifications.list', notificationPageSchema, (api) => api.notifications.list(request)),
  unreadNotificationCount: () =>
    guarded('notifications.unreadCount', unreadCountSchema, (api) =>
      api.notifications.unreadCount(),
    ),
  markNotificationRead: (request: NotificationIdRequest) =>
    guarded('notifications.markRead', notificationResponseSchema, (api) =>
      api.notifications.markRead(request),
    ),
  markAllNotificationsRead: () =>
    guarded('notifications.markAllRead', markAllNotificationsReadSchema, (api) =>
      api.notifications.markAllRead(),
    ),
  dismissNotification: (request: NotificationIdRequest) =>
    guarded('notifications.dismiss', deletedResponseSchema, (api) =>
      api.notifications.dismiss(request),
    ),
  registerPushDevice: (request: RegisterDeviceRequest) =>
    guarded('notifications.registerDevice', deviceResponseSchema, (api) =>
      api.notifications.registerDevice(request),
    ),
  unregisterPushDevice: (request: UnregisterDeviceRequest) =>
    guarded('notifications.unregisterDevice', acknowledgedResponseSchema, (api) =>
      api.notifications.unregisterDevice(request),
    ),
  notificationPreferences: () =>
    guarded('notifications.preferences', notificationPreferencesSchema, (api) =>
      api.notifications.preferences(),
    ),
  saveNotificationPreferences: (request: UpdateNotificationPreferencesRequest) =>
    guarded('notifications.savePreferences', notificationPreferencesSchema, (api) =>
      api.notifications.savePreferences(request),
    ),

  listCommunities: (request: ListCommunitiesRequest) =>
    guarded('communities.list', communityPageSchema, (api) => api.communities.list(request)),
  getCommunity: (request: CommunitySlugRequest) =>
    guarded('communities.get', communityResponseSchema, (api) => api.communities.get(request)),
  joinCommunity: (request: CommunitySlugRequest) =>
    guarded('communities.join', communityResponseSchema, (api) => api.communities.join(request)),
  leaveCommunity: (request: CommunitySlugRequest) =>
    guarded('communities.leave', communityResponseSchema, (api) => api.communities.leave(request)),
  listCommunityPosts: (request: ListCommunityPostsRequest) =>
    guarded('communities.listPosts', communityPostPageSchema, (api) =>
      api.communities.listPosts(request),
    ),
  listFrontPagePosts: (request: ListFrontPagePostsRequest) =>
    guarded('communities.frontPage', communityPostPageSchema, (api) =>
      api.communities.frontPage(request),
    ),
  createCommunityPost: (request: CreateCommunityPostRequest) =>
    guarded('communities.createPost', communityPostResponseSchema, (api) =>
      api.communities.createPost(request),
    ),
  voteCommunityPost: (request: VoteCommunityPostRequest) =>
    guarded('communities.vote', communityPostVoteSchema, (api) => api.communities.vote(request)),

  listProjects: (request: ListProjectsRequest) =>
    guarded('showcase.list', projectPageSchema, (api) => api.showcase.list(request)),
  listProjectTech: (request: ListProjectTechRequest) =>
    guarded('showcase.tech', techCountListSchema, (api) => api.showcase.tech(request)),
  getProject: (request: ProjectIdRequest) =>
    guarded('showcase.get', projectResponseSchema, (api) => api.showcase.get(request)),
  recordProjectView: (request: ProjectIdRequest) =>
    guarded('showcase.recordView', acknowledgedResponseSchema, (api) =>
      api.showcase.recordView(request),
    ),
  publishProject: (request: PublishProjectRequest) =>
    guarded('showcase.publish', projectResponseSchema, (api) => api.showcase.publish(request)),
  likeProject: (request: ProjectIdRequest) =>
    guarded('showcase.like', projectLikeSchema, (api) => api.showcase.like(request)),
  unlikeProject: (request: ProjectIdRequest) =>
    guarded('showcase.unlike', projectLikeSchema, (api) => api.showcase.unlike(request)),

  linkPreview: (request: LinkPreviewRequest) =>
    guarded('links.preview', linkPreviewResponseSchema, (api) => api.links.preview(request)),

  exportPosts: (request: ExportPostsRequest) =>
    guarded('files.exportPosts', exportPostsResponseSchema, (api) =>
      api.files.exportPosts(request),
    ),
  readAppInfo: () =>
    guarded('files.readAppInfo', appInfoResponseSchema, (api) => api.files.readAppInfo()),

  minimizeWindow: () =>
    guarded('window.minimize', windowStateSchema, (api) => api.window.minimize()),
  toggleMaximizeWindow: () =>
    guarded('window.toggleMaximize', windowStateSchema, (api) => api.window.toggleMaximize()),
  closeWindow: () => guarded('window.close', windowStateSchema, (api) => api.window.close()),
  getWindowState: () =>
    guarded('window.getState', windowStateSchema, (api) => api.window.getState()),
} as const;

/**
 * Frames pushed from the main process. Each one is parsed against the shared
 * schema before the listener sees it (A08); a value that does not parse is
 * dropped, not delivered. Returns the unsubscribe, or a no-op when there is
 * no bridge.
 */
export function onChatEvent(listener: (event: ChatEvent) => void): () => void {
  const api = bridge();
  if (api === undefined) {
    return () => undefined;
  }
  return api.chat.onEvent((raw) => {
    const parsed = chatEventSchema.safeParse(raw);
    if (parsed.success) {
      listener(parsed.data);
    } else {
      log.warn('chat_event_rejected', {});
    }
  });
}

/**
 * Frames pushed by the inbox watcher: the unread count changing, rows arriving,
 * and a native OS notification having been clicked. Parsed against the shared
 * schema before the listener sees it (A08); a value that does not parse is
 * dropped. Returns the unsubscribe, or a no-op when there is no bridge.
 */
export function onNotificationEvent(listener: (event: NotificationEvent) => void): () => void {
  const api = bridge();
  if (api === undefined) {
    return () => undefined;
  }
  return api.notifications.onEvent((raw) => {
    const parsed = notificationEventSchema.safeParse(raw);
    if (parsed.success) {
      listener(parsed.data);
    } else {
      log.warn('notification_event_rejected', {});
    }
  });
}
