/**
 * The bridge, and nothing but the bridge.
 *
 * `ipcRenderer` itself is never exposed — only named functions, each bound to
 * one allowlisted channel (OWASP A01). The renderer cannot reach a channel that
 * has no function here, and cannot invent one.
 *
 * Note what the bridge cannot do: there is no function that returns an access
 * or refresh token, because the renderer is never given one.
 *
 * This file stays deliberately thin: it forwards, it does not decide. Request
 * validation happens in the main process, response validation in the renderer.
 * The one inbound channel (`chat:event`) hands the renderer a value it parses
 * itself before use.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from './ipc/channels';

import type {
  AcknowledgedResponse,
  AppInfoResponse,
  ChatMessageResponse,
  ChatSocketState,
  CommentPage,
  CommentResponse,
  ConversationIdRequest,
  ConversationPage,
  ConversationResponse,
  CreateCommentRequest,
  CreateConversationRequest,
  CreatePostRequest,
  DiscardImagesRequest,
  DeleteCommentRequest,
  DeletedResponse,
  ExportPostsRequest,
  ExportPostsResponse,
  FeedRequest,
  FeedResponse,
  ForgotPasswordRequest,
  FriendEntryPage,
  FriendEntryResponse,
  FriendUserRequest,
  IpcResult,
  ListCommentsRequest,
  ListConversationsRequest,
  ListFriendRequestsRequest,
  ListMessagesRequest,
  LinkPreviewRequest,
  LinkPreviewResponse,
  ListReactorsRequest,
  LoginRequest,
  MarkReadRequest,
  MessagePage,
  PageRequest,
  PostIdRequest,
  PostResponse,
  ProfileResponse,
  PublicUserRequest,
  ReactionSummary,
  ReactionTargetRequest,
  ReactorPage,
  RegisterRequest,
  RegisterResponse,
  RepostRequest,
  ResendOtpRequest,
  ResetPasswordRequest,
  SendChatMessageRequest,
  SessionResponse,
  ShareLinkCopiedResponse,
  StageImagesRequest,
  StageImagesResponse,
  ToggleReactionRequest,
  TypingRequest,
  UpdateCommentRequest,
  UpdatePostRequest,
  UserPostsRequest,
  UserPostsResponse,
  VerifyOtpRequest,
  VerifyResetOtpRequest,
  WindowState,
  YelloBridge,
} from '../shared/ipc-types';

const BRIDGE_KEY = 'yello';

function invoke<TResponse>(channel: string, payload?: unknown): Promise<IpcResult<TResponse>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<TResponse>>;
}

const bridge: YelloBridge = {
  auth: {
    login: (request: LoginRequest) => invoke<SessionResponse>(IPC_CHANNELS.AUTH_LOGIN, request),
    register: (request: RegisterRequest) =>
      invoke<RegisterResponse>(IPC_CHANNELS.AUTH_REGISTER, request),
    verifyOtp: (request: VerifyOtpRequest) =>
      invoke<SessionResponse>(IPC_CHANNELS.AUTH_VERIFY_OTP, request),
    logout: () => invoke<SessionResponse>(IPC_CHANNELS.AUTH_LOGOUT),
    currentSession: () => invoke<SessionResponse>(IPC_CHANNELS.AUTH_CURRENT_SESSION),
    resendOtp: (request: ResendOtpRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.AUTH_RESEND_OTP, request),
    forgotPassword: (request: ForgotPasswordRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.AUTH_FORGOT_PASSWORD, request),
    verifyResetOtp: (request: VerifyResetOtpRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.AUTH_VERIFY_RESET_OTP, request),
    resetPassword: (request: ResetPasswordRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.AUTH_RESET_PASSWORD, request),
  },
  feed: {
    list: (request: FeedRequest) => invoke<FeedResponse>(IPC_CHANNELS.FEED_LIST, request),
    createPost: (request: CreatePostRequest) =>
      invoke<PostResponse>(IPC_CHANNELS.FEED_CREATE_POST, request),
    stageImages: (request?: StageImagesRequest) =>
      invoke<StageImagesResponse>(IPC_CHANNELS.FEED_STAGE_IMAGES, request),
    discardImages: (request: DiscardImagesRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.FEED_DISCARD_IMAGES, request),
  },
  posts: {
    get: (request: PostIdRequest) => invoke<PostResponse>(IPC_CHANNELS.POSTS_GET, request),
    update: (request: UpdatePostRequest) =>
      invoke<PostResponse>(IPC_CHANNELS.POSTS_UPDATE, request),
    remove: (request: PostIdRequest) => invoke<DeletedResponse>(IPC_CHANNELS.POSTS_DELETE, request),
    repost: (request: RepostRequest) => invoke<PostResponse>(IPC_CHANNELS.POSTS_REPOST, request),
    copyShareLink: (request: PostIdRequest) =>
      invoke<ShareLinkCopiedResponse>(IPC_CHANNELS.POSTS_COPY_SHARE_LINK, request),
  },
  comments: {
    create: (request: CreateCommentRequest) =>
      invoke<CommentResponse>(IPC_CHANNELS.COMMENTS_CREATE, request),
    list: (request: ListCommentsRequest) =>
      invoke<CommentPage>(IPC_CHANNELS.COMMENTS_LIST, request),
    update: (request: UpdateCommentRequest) =>
      invoke<CommentResponse>(IPC_CHANNELS.COMMENTS_UPDATE, request),
    remove: (request: DeleteCommentRequest) =>
      invoke<DeletedResponse>(IPC_CHANNELS.COMMENTS_DELETE, request),
  },
  reactions: {
    toggle: (request: ToggleReactionRequest) =>
      invoke<ReactionSummary>(IPC_CHANNELS.REACTIONS_TOGGLE, request),
    summary: (request: ReactionTargetRequest) =>
      invoke<ReactionSummary>(IPC_CHANNELS.REACTIONS_SUMMARY, request),
    list: (request: ListReactorsRequest) =>
      invoke<ReactorPage>(IPC_CHANNELS.REACTIONS_LIST, request),
  },
  friends: {
    list: (request: PageRequest) => invoke<FriendEntryPage>(IPC_CHANNELS.FRIENDS_LIST, request),
    requests: (request: ListFriendRequestsRequest) =>
      invoke<FriendEntryPage>(IPC_CHANNELS.FRIENDS_REQUESTS, request),
    blocked: (request: PageRequest) =>
      invoke<FriendEntryPage>(IPC_CHANNELS.FRIENDS_BLOCKED, request),
    sendRequest: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_SEND_REQUEST, request),
    cancelRequest: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_CANCEL_REQUEST, request),
    accept: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_ACCEPT, request),
    decline: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_DECLINE, request),
    remove: (request: FriendUserRequest) =>
      invoke<DeletedResponse>(IPC_CHANNELS.FRIENDS_REMOVE, request),
    block: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_BLOCK, request),
    unblock: (request: FriendUserRequest) =>
      invoke<FriendEntryResponse>(IPC_CHANNELS.FRIENDS_UNBLOCK, request),
  },
  profile: {
    listPosts: (request: UserPostsRequest) =>
      invoke<UserPostsResponse>(IPC_CHANNELS.PROFILE_LIST_POSTS, request),
    getUser: (request: PublicUserRequest) =>
      invoke<ProfileResponse>(IPC_CHANNELS.PROFILE_GET_USER, request),
  },
  chat: {
    listConversations: (request: ListConversationsRequest) =>
      invoke<ConversationPage>(IPC_CHANNELS.CHAT_LIST_CONVERSATIONS, request),
    createConversation: (request: CreateConversationRequest) =>
      invoke<ConversationResponse>(IPC_CHANNELS.CHAT_CREATE_CONVERSATION, request),
    getConversation: (request: ConversationIdRequest) =>
      invoke<ConversationResponse>(IPC_CHANNELS.CHAT_GET_CONVERSATION, request),
    listMessages: (request: ListMessagesRequest) =>
      invoke<MessagePage>(IPC_CHANNELS.CHAT_LIST_MESSAGES, request),
    sendMessage: (request: SendChatMessageRequest) =>
      invoke<ChatMessageResponse>(IPC_CHANNELS.CHAT_SEND_MESSAGE, request),
    markRead: (request: MarkReadRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.CHAT_MARK_READ, request),
    typing: (request: TypingRequest) =>
      invoke<AcknowledgedResponse>(IPC_CHANNELS.CHAT_TYPING, request),
    socketState: () => invoke<ChatSocketState>(IPC_CHANNELS.CHAT_SOCKET_STATE),
    onEvent: (listener: (event: unknown) => void) => {
      // The IpcRendererEvent is not forwarded: it carries the sender, which
      // the page has no business holding. Only the payload crosses.
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(IPC_CHANNELS.CHAT_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.CHAT_EVENT, handler);
      };
    },
  },
  links: {
    preview: (request: LinkPreviewRequest) =>
      invoke<LinkPreviewResponse>(IPC_CHANNELS.LINKS_PREVIEW, request),
  },
  files: {
    exportPosts: (request: ExportPostsRequest) =>
      invoke<ExportPostsResponse>(IPC_CHANNELS.FS_EXPORT_POSTS, request),
    readAppInfo: () => invoke<AppInfoResponse>(IPC_CHANNELS.FS_READ_APP_INFO),
  },
  window: {
    minimize: () => invoke<WindowState>(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke<WindowState>(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => invoke<WindowState>(IPC_CHANNELS.WINDOW_CLOSE),
    getState: () => invoke<WindowState>(IPC_CHANNELS.WINDOW_GET_STATE),
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
