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
/** The notify service: a third mount on the same host, own version segment. */
const notify = '/notifications/v1';

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
    /** Signed in: checks the current password, then emails a code. */
    changePasswordOtp: `${base}/auth/change-password/otp`,
    /** Spends that code; answers with a new token pair and revokes every other. */
    changePassword: `${base}/auth/change-password`,
  },
  users: {
    /** GET reads the caller's own profile; POST edits it (JSON, or multipart with images). */
    me: `${base}/users/me`,
    search: `${base}/users/search`,
    byId: (userId: string) => `${base}/users/${seg(userId)}`,
    posts: (userId: string) => `${base}/users/${seg(userId)}/posts`,
    block: (userId: string) => `${base}/users/${seg(userId)}/block`,
    /** Mute (POST) and unmute (DELETE); both idempotent, both 204. */
    mute: (userId: string) => `${base}/users/${seg(userId)}/mute`,
    muted: `${base}/users/me/muted`,
    savedPosts: `${base}/users/me/saved-posts`,
  },
  feed: {
    list: `${base}/feed`,
  },
  posts: {
    create: `${base}/posts`,
    byId: (postId: string) => `${base}/posts/${seg(postId)}`,
    repost: (postId: string) => `${base}/posts/${seg(postId)}/repost`,
    comments: (postId: string) => `${base}/posts/${seg(postId)}/comments`,
    reports: (postId: string) => `${base}/posts/${seg(postId)}/reports`,
    /** Hide (POST) and unhide (DELETE) for the caller's own feed; both 204. */
    hide: (postId: string) => `${base}/posts/${seg(postId)}/hide`,
    /** A toggle: saves, or removes the save; answers with the state after. */
    save: (postId: string) => `${base}/posts/${seg(postId)}/save`,
  },
  feedback: {
    create: `${base}/feedback`,
    mine: `${base}/feedback/me`,
  },
  reports: {
    mine: `${base}/reports/me`,
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
  communities: {
    list: `${base}/communities`,
    bySlug: (slug: string) => `${base}/communities/${seg(slug)}`,
    /** Join (POST) and leave (DELETE); both idempotent. */
    membership: (slug: string) => `${base}/communities/${seg(slug)}/membership`,
    posts: (slug: string) => `${base}/communities/${seg(slug)}/posts`,
  },
  communityPosts: {
    frontPage: `${base}/community-posts`,
    vote: (postId: string) => `${base}/community-posts/${seg(postId)}/vote`,
  },
  projects: {
    list: `${base}/projects`,
    tech: `${base}/projects/tech`,
    byId: (projectId: string) => `${base}/projects/${seg(projectId)}`,
    views: (projectId: string) => `${base}/projects/${seg(projectId)}/views`,
    /** Like (POST) and unlike (DELETE); both idempotent. */
    like: (projectId: string) => `${base}/projects/${seg(projectId)}/like`,
  },
  notifications: {
    /**
     * Slash-less on purpose: the trailing-slash form answers 307 to this one,
     * and a redirect is a round trip spent for nothing.
     */
    list: notify,
    unreadCount: `${notify}/unread-count`,
    read: (notificationId: string) => `${notify}/${seg(notificationId)}/read`,
    readAll: `${notify}/read-all`,
    remove: (notificationId: string) => `${notify}/${seg(notificationId)}`,
    devices: `${notify}/devices`,
    unregisterDevice: `${notify}/devices/unregister`,
    preferences: `${notify}/preferences`,
  },
  chat: {
    conversations: `${chat}/conversations`,
    conversation: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}`,
    messages: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/messages`,
    /** PATCH edits the text, DELETE unsends it for everyone (a tombstone stays). */
    message: (conversationId: string, messageId: string) =>
      `${chat}/conversations/${seg(conversationId)}/messages/${seg(messageId)}`,
    /** PUT sets the caller's one reaction, DELETE removes it. */
    reaction: (conversationId: string, messageId: string) =>
      `${chat}/conversations/${seg(conversationId)}/messages/${seg(messageId)}/reaction`,
    read: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/read`,
    /** Multipart upload, one `file` per request; the result is pending until sent. */
    attachments: (conversationId: string) =>
      `${chat}/conversations/${seg(conversationId)}/attachments`,
    /** A fresh presigned link for an attachment whose URL has expired. */
    attachment: (attachmentId: string) => `${chat}/attachments/${seg(attachmentId)}`,
    /** PUT (multipart) sets a group's photo, DELETE removes it. */
    photo: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/photo`,
    members: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/members`,
    /** DELETE removes someone else; PATCH changes their role. */
    member: (conversationId: string, userId: string) =>
      `${chat}/conversations/${seg(conversationId)}/members/${seg(userId)}`,
    leave: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/leave`,
    invites: (conversationId: string) => `${chat}/conversations/${seg(conversationId)}/invites`,
    acceptInvite: (inviteId: string) => `${chat}/invites/${seg(inviteId)}/accept`,
    declineInvite: (inviteId: string) => `${chat}/invites/${seg(inviteId)}/decline`,
    /** The live socket, relative to the API origin (wss:// for https://). */
    socket: chat,
  },
} as const;
