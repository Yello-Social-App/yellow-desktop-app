/**
 * Every server path in one place, so a version bump is a one-file change.
 *
 * Two services share the host. The Yello API is mounted under `/v1` and wraps
 * every answer in an envelope; the chat service (yello-chat) is mounted under
 * `/ws` and answers bare JSON — `apiRequest` is told which it is talking to.
 */
export const API_VERSION = 'v1';

const base = `/${API_VERSION}`;
const chat = '/ws';

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
    byId: (userId: string) => `${base}/users/${seg(userId)}`,
    posts: (userId: string) => `${base}/users/${seg(userId)}/posts`,
    block: (userId: string) => `${base}/users/${seg(userId)}/block`,
  },
  feed: {
    list: `${base}/feed`,
  },
  posts: {
    create: `${base}/posts`,
    byId: (postId: string) => `${base}/posts/${seg(postId)}`,
    repost: (postId: string) => `${base}/posts/${seg(postId)}/repost`,
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
    blocked: `${base}/friends/blocked`,
    /** Send (POST) and cancel (DELETE) a request, by the other user's id. */
    requestTo: (userId: string) => `${base}/friends/requests/${seg(userId)}`,
    accept: (userId: string) => `${base}/friends/requests/${seg(userId)}/accept`,
    decline: (userId: string) => `${base}/friends/requests/${seg(userId)}/decline`,
    remove: (userId: string) => `${base}/friends/${seg(userId)}`,
  },
  chat: {
    conversations: `${chat}/conversations`,
    conversation: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}`,
    messages: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/messages`,
    read: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/read`,
    /** The live socket, relative to the API origin (wss:// for https://). */
    socket: chat,
  },
} as const;
