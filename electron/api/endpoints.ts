/** Every server path in one place, so a version bump is a one-file change. */
export const API_VERSION = 'v1';

const base = `/api/${API_VERSION}`;

/**
 * Path segments are always percent-encoded here rather than at the call site,
 * so an id that came from the renderer cannot escape its segment and address a
 * different route (OWASP A01/A05).
 */
const seg = (value: string): string => encodeURIComponent(value);

export const ENDPOINTS = {
  auth: {
    login: `${base}/auth/login`,
    register: `${base}/auth/register`,
    verifyOtp: `${base}/auth/verify-otp`,
    resendOtp: `${base}/auth/resend-otp`,
    refresh: `${base}/auth/refresh`,
    logout: `${base}/auth/logout`,
    forgotPassword: `${base}/auth/forgot-password`,
    resetPassword: `${base}/auth/reset-password`,
  },
  users: {
    me: `${base}/users/me`,
    avatar: `${base}/users/me/avatar`,
    byId: (userId: string) => `${base}/users/${seg(userId)}`,
    posts: (userId: string) => `${base}/users/${seg(userId)}/posts`,
  },
  feed: {
    list: `${base}/feed`,
  },
  posts: {
    create: `${base}/posts`,
    byId: (postId: string) => `${base}/posts/${seg(postId)}`,
    repost: (postId: string) => `${base}/posts/${seg(postId)}/repost`,
    shareLink: (postId: string) => `${base}/posts/${seg(postId)}/share-link`,
    comments: (postId: string) => `${base}/posts/${seg(postId)}/comments`,
  },
  comments: {
    byId: (commentId: string) => `${base}/comments/${seg(commentId)}`,
  },
  reactions: {
    /** `targetType` is a closed enum upstream, never free renderer text. */
    forTarget: (targetType: string, targetId: string) =>
      `${base}/reactions/${seg(targetType)}/${seg(targetId)}`,
    summary: (targetType: string, targetId: string) =>
      `${base}/reactions/${seg(targetType)}/${seg(targetId)}/summary`,
  },
  friends: {
    list: `${base}/friends`,
    requests: `${base}/friends/requests`,
    requestTo: (userId: string) => `${base}/friends/requests/${seg(userId)}`,
    accept: (friendshipId: string) => `${base}/friends/requests/${seg(friendshipId)}/accept`,
    decline: (friendshipId: string) => `${base}/friends/requests/${seg(friendshipId)}/decline`,
    remove: (userId: string) => `${base}/friends/${seg(userId)}`,
  },
  notifications: {
    list: `${base}/notifications`,
    unreadCount: `${base}/notifications/unread-count`,
    markRead: (notificationId: string) => `${base}/notifications/${seg(notificationId)}/read`,
    markAllRead: `${base}/notifications/read-all`,
  },
} as const;
