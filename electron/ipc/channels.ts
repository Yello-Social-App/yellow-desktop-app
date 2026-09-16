/**
 * The IPC allowlist.
 *
 * Nothing outside this map is registered by the main process or exposed through
 * the preload bridge (OWASP A01). `registerIpcHandler` refuses any channel that
 * is not listed here, so the allowlist is enforced at startup rather than by
 * convention.
 */
export const IPC_CHANNELS = {
  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_VERIFY_OTP: 'auth:verify-otp',
  AUTH_RESEND_OTP: 'auth:resend-otp',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_CURRENT_SESSION: 'auth:current-session',
  AUTH_FORGOT_PASSWORD: 'auth:forgot-password',
  AUTH_VERIFY_RESET_OTP: 'auth:verify-reset-otp',
  AUTH_RESET_PASSWORD: 'auth:reset-password',
  FEED_LIST: 'feed:list',
  FEED_CREATE_POST: 'feed:create-post',
  FEED_STAGE_IMAGES: 'feed:stage-images',
  FEED_DISCARD_IMAGES: 'feed:discard-images',
  POSTS_GET: 'posts:get',
  POSTS_UPDATE: 'posts:update',
  POSTS_DELETE: 'posts:delete',
  POSTS_REPOST: 'posts:repost',
  POSTS_COPY_SHARE_LINK: 'posts:copy-share-link',
  COMMENTS_CREATE: 'comments:create',
  COMMENTS_LIST: 'comments:list',
  COMMENTS_DELETE: 'comments:delete',
  REACTIONS_TOGGLE: 'reactions:toggle',
  REACTIONS_SUMMARY: 'reactions:summary',
  REACTIONS_LIST: 'reactions:list',
  COMMENTS_UPDATE: 'comments:update',
  FRIENDS_LIST: 'friends:list',
  FRIENDS_REQUESTS: 'friends:requests',
  FRIENDS_BLOCKED: 'friends:blocked',
  FRIENDS_SEND_REQUEST: 'friends:send-request',
  FRIENDS_CANCEL_REQUEST: 'friends:cancel-request',
  FRIENDS_ACCEPT: 'friends:accept',
  FRIENDS_DECLINE: 'friends:decline',
  FRIENDS_REMOVE: 'friends:remove',
  FRIENDS_BLOCK: 'friends:block',
  FRIENDS_UNBLOCK: 'friends:unblock',
  PROFILE_LIST_POSTS: 'profile:list-posts',
  PROFILE_GET_USER: 'profile:get-user',
  CHAT_LIST_CONVERSATIONS: 'chat:list-conversations',
  CHAT_CREATE_CONVERSATION: 'chat:create-conversation',
  CHAT_GET_CONVERSATION: 'chat:get-conversation',
  CHAT_LIST_MESSAGES: 'chat:list-messages',
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_MARK_READ: 'chat:mark-read',
  CHAT_TYPING: 'chat:typing',
  CHAT_SOCKET_STATE: 'chat:socket-state',
  /** Main → renderer push; the one channel here that is not an invoke handler. */
  CHAT_EVENT: 'chat:event',
  NOTIFICATIONS_LIST: 'notifications:list',
  NOTIFICATIONS_UNREAD_COUNT: 'notifications:unread-count',
  NOTIFICATIONS_MARK_READ: 'notifications:mark-read',
  NOTIFICATIONS_MARK_ALL_READ: 'notifications:mark-all-read',
  NOTIFICATIONS_DISMISS: 'notifications:dismiss',
  NOTIFICATIONS_REGISTER_DEVICE: 'notifications:register-device',
  NOTIFICATIONS_UNREGISTER_DEVICE: 'notifications:unregister-device',
  NOTIFICATIONS_PREFERENCES: 'notifications:preferences',
  NOTIFICATIONS_SAVE_PREFERENCES: 'notifications:save-preferences',
  /** Main -> renderer push, as CHAT_EVENT is: what the inbox watcher saw. */
  NOTIFICATIONS_EVENT: 'notifications:event',
  LINKS_PREVIEW: 'links:preview',
  FS_EXPORT_POSTS: 'fs:export-posts',
  FS_READ_APP_INFO: 'fs:read-app-info',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_GET_STATE: 'window:get-state',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS));

export function isAllowedChannel(channel: string): channel is IpcChannel {
  return ALLOWED_CHANNELS.has(channel);
}
