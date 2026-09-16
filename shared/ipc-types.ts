/**
 * The single source of truth for everything that crosses the main <-> renderer
 * boundary.
 *
 * Every payload is described by a zod schema, and both sides parse before they
 * trust: main validates requests (a compromised renderer is untrusted input),
 * the renderer validates responses (OWASP A08 — nothing is deserialized into
 * state on shape assumptions alone).
 *
 * Note what is *absent* from these types: access and refresh tokens. All HTTP
 * happens in the main process, so the renderer is never given a credential it
 * could leak through an XSS payload or a devtools session (A02/A04).
 *
 * Failures travel as a Result value rather than a thrown error, so callers have
 * to handle the failure branch to read the data.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Domain — mirrors the Yello API (/docs/json) and the yello-chat service (/ws/docs)
 * ------------------------------------------------------------------ */

/**
 * Optional strings in the API arrive as `null` as often as they are absent,
 * and an empty string is not meaningfully different from either.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) =>
      value === null || value === undefined || value === '' ? undefined : value,
    );

export const userSchema = z.object({
  id: z.string().min(1).max(64),
  email: z.string().max(254).optional(),
  username: z.string().min(1).max(64),
  fullName: optionalText(200),
  avatarUrl: optionalText(2048),
  bio: optionalText(1000),
  status: optionalText(64),
  createdAt: optionalText(64),
  /**
   * Only on `GET /users/{id}`: the viewer's relationship to this person, as the
   * server sees it. Held as text rather than an enum so a status added later
   * cannot void the profile (A10); compare against FRIEND_STATUSES.
   */
  friendStatus: optionalText(32),
});

export const authorSchema = z.object({
  id: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  fullName: optionalText(200),
  avatarUrl: optionalText(2048),
});

export const postImageSchema = z.object({
  /** What `removeImageIds` takes on an edit. Optional so an older row still renders. */
  id: optionalText(64),
  url: z.string().max(2048),
  position: z.number().int().nonnegative().optional(),
});

export const REACTION_TYPES = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'ANGRY'] as const;
export const reactionTypeSchema = z.enum(REACTION_TYPES);

export const POST_VISIBILITIES = ['PUBLIC', 'FRIENDS', 'PRIVATE'] as const;
export const postVisibilitySchema = z.enum(POST_VISIBILITIES);

/**
 * `reactionCounts` is a partial map — only non-zero types appear — and it also
 * carries a `total` key, so it is read as a plain record rather than a fixed
 * shape.
 */
const reactionCountsSchema = z
  .record(z.string(), z.number())
  .nullish()
  .transform((value) => value ?? {});

const postBaseShape = {
  id: z.string().min(1).max(64),
  author: authorSchema,
  content: optionalText(10_000).transform((value) => value ?? ''),
  createdAt: z.string().max(64),
  images: z
    .array(postImageSchema)
    .max(20)
    .nullish()
    .transform((value) => value ?? []),
  reactionCounts: reactionCountsSchema,
  viewerReaction: reactionTypeSchema.nullish(),
  commentCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
  repostCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
  shareUrl: optionalText(2048),
  visibility: optionalText(32),
  /** The server's word on authorship; always false for an anonymous read. */
  isOwner: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
};

/** A repost embeds the post it quotes; nesting stops at one level. */
const quotedPostSchema = z.object(postBaseShape);

export const postSchema = z.object({
  ...postBaseShape,
  originalPost: quotedPostSchema.nullish(),
});

/** Timestamps are always present in practice; a missing one must not void a row. */
const timestamp = z
  .string()
  .max(64)
  .nullish()
  .transform((value) => value ?? '');

export const commentSchema = z.object({
  id: z.string().min(1).max(64),
  postId: z.string().min(1).max(64),
  author: authorSchema,
  /** Set when this comment is a reply; replies nest one level deep. */
  parentCommentId: optionalText(64),
  content: z
    .string()
    .max(5000)
    .nullish()
    .transform((value) => value ?? ''),
  reactionCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
  viewerReaction: reactionTypeSchema.nullish(),
  createdAt: timestamp,
});

/**
 * A top-level comment as the list endpoint returns it: with its replies
 * nested underneath. Replies carry an empty `replies` of their own, which the
 * plain comment schema strips.
 */
export const threadCommentSchema = commentSchema.extend({
  replies: z
    .array(commentSchema)
    .max(500)
    .nullish()
    .transform((value) => value ?? []),
});

export const FRIEND_STATUSES = [
  'SELF',
  'FRIENDS',
  'REQUEST_SENT',
  'REQUEST_RECEIVED',
  'NONE',
] as const;

/**
 * What every friendship mutation returns, and each row of the friends,
 * requests and blocked lists. There is no friendship id anywhere: the other
 * user's id addresses every route, and `friendStatus` says what the button
 * should read now.
 */
export const friendEntrySchema = z.object({
  /** Always the other party, never the caller. */
  user: authorSchema,
  /** Text rather than an enum so a status added later cannot void a list (A10). */
  friendStatus: z
    .string()
    .max(32)
    .nullish()
    .transform((value) => value ?? 'NONE'),
  /** Lists only: when the friendship was accepted / the request was sent. */
  since: optionalText(64),
});

/**
 * Spring's offset page. Every field is defaulted rather than required: a
 * missing count is a zero, not a parse failure that would blank a whole list.
 * Used by five endpoints, which is what earns it a factory rather than a
 * copy per handler.
 */
export function pageOf<TSchema extends z.ZodType>(item: TSchema) {
  return z.object({
    content: z
      .array(item)
      .max(200)
      .nullish()
      .transform((value) => value ?? []),
    page: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? 0),
    size: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? 0),
    totalElements: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? 0),
    totalPages: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? 0),
    last: z
      .boolean()
      .nullish()
      .transform((value) => value ?? true),
  });
}

export interface Page<TItem> {
  content: TItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

export type User = z.infer<typeof userSchema>;
export type Author = z.infer<typeof authorSchema>;
export type Post = z.infer<typeof postSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type ThreadComment = z.infer<typeof threadCommentSchema>;
export type FriendEntry = z.infer<typeof friendEntrySchema>;
export type FriendStatus = (typeof FRIEND_STATUSES)[number];
export type ReactionType = z.infer<typeof reactionTypeSchema>;
export type PostVisibility = z.infer<typeof postVisibilitySchema>;

/**
 * What the renderer is told about the current session. Deliberately no token:
 * `expiresAt` is enough to drive expiry in the UI.
 */
export const sessionSchema = z.object({
  user: userSchema,
  expiresAt: z.number().int().positive(),
});

export type Session = z.infer<typeof sessionSchema>;

/* ------------------------------------------------------------------ *
 * Result envelope
 * ------------------------------------------------------------------ */

export const IPC_ERROR_CODES = [
  'INVALID_PAYLOAD',
  'UNAUTHORIZED_SENDER',
  'SECURE_STORAGE_UNAVAILABLE',
  'IO_ERROR',
  'CANCELLED',
  'NETWORK',
  'API',
  'UNAUTHENTICATED',
  'UNKNOWN',
] as const;

export const ipcErrorSchema = z.object({
  code: z.enum(IPC_ERROR_CODES),
  /** Operator-safe text only: never a stack trace, path, or credential. */
  message: z.string().max(500),
  /** The API's own error code (e.g. INVALID_CREDENTIALS), when it supplied one. */
  apiCode: z.string().max(64).optional(),
  /** Per-field validation messages the API returned, for form display. */
  fieldErrors: z.record(z.string(), z.array(z.string().max(300)).max(10)).optional(),
});

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];
export type IpcError = z.infer<typeof ipcErrorSchema>;
export type IpcResult<TData> = { ok: true; data: TData } | { ok: false; error: IpcError };

export function ipcResultSchema<TSchema extends z.ZodType>(data: TSchema) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: ipcErrorSchema }),
  ]);
}

export function ipcOk<TData>(data: TData): IpcResult<TData> {
  return { ok: true, data };
}

export function ipcFail<TData = never>(
  code: IpcErrorCode,
  message: string,
  extra?: { apiCode?: string; fieldErrors?: Record<string, string[]> },
): IpcResult<TData> {
  return { ok: false, error: { code, message, ...extra } };
}

/* ------------------------------------------------------------------ *
 * Per-channel payloads
 * ------------------------------------------------------------------ */

export const emptyRequestSchema = z.undefined();

/* -- auth -- */

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
  /** Persist the refresh token in the OS keychain so the session survives a restart. */
  remember: z.boolean(),
});

export const registerRequestSchema = z.object({
  email: z.email().max(254),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.]+$/),
  fullName: z.string().max(100).optional(),
  password: z.string().min(12).max(128),
});

export const registerResponseSchema = z.object({
  userId: z.string().max(64).optional(),
  email: z.string().max(254),
  message: z.string().max(500),
});

export const OTP_CODE_PATTERN = /^[0-9]{6}$/;

export const verifyOtpRequestSchema = z.object({
  email: z.email(),
  code: z.string().regex(OTP_CODE_PATTERN),
  remember: z.boolean(),
});

export const sessionResponseSchema = z.object({ session: sessionSchema.nullable() });

/**
 * The password-reset flow is three calls, and the renderer sees a credential
 * in none of them: `forgot-password` and `resend-otp` answer the same 200
 * whether or not the address exists, so neither can enumerate accounts (A01);
 * `verify-reset-otp` exchanges the emailed code for a reset token that is held
 * in the main process; and `reset-password` spends that held token. The
 * renderer is only ever told that a step was accepted.
 */
export const forgotPasswordRequestSchema = z.object({
  email: z.email().max(254),
});

/** Re-sends whichever code the account is currently waiting on. */
export const resendOtpRequestSchema = z.object({
  email: z.email().max(254),
});

export const verifyResetOtpRequestSchema = z.object({
  email: z.email().max(254),
  code: z.string().regex(OTP_CODE_PATTERN),
});

export const resetPasswordRequestSchema = z.object({
  newPassword: z.string().min(12).max(128),
});

export const acknowledgedResponseSchema = z.object({ acknowledged: z.boolean() });

/* -- feed & posts -- */

export const feedRequestSchema = z.object({
  cursor: z.string().max(512).optional(),
  size: z.number().int().min(1).max(50),
});

export const feedResponseSchema = z.object({
  posts: z.array(postSchema),
  nextCursor: z.string().max(512).nullable(),
  hasMore: z.boolean(),
});

export const POST_MAX_IMAGES = 10;

/**
 * Attaching an image is two steps, the same shape the avatar upload uses: the
 * main process opens the OS picker, validates and holds the bytes, and hands
 * back an opaque token plus a thumbnail to show. The renderer never names a
 * path, so it cannot make the app read a file of its choosing (A01), and never
 * holds the bytes it is about to upload.
 *
 * Two steps rather than one because the user has to see what they picked before
 * it is published — a picker that posts the moment it closes gives them no
 * chance to change their mind.
 */
export const stagedImageSchema = z.object({
  /** Opaque handle to the staged file; the renderer passes it back to publish. */
  token: z.string().min(1).max(64),
  fileName: z.string().max(255),
  /** A downscaled `data:` URL for the composer thumbnail, never the full file. */
  previewDataUrl: z.string().max(2_000_000),
  byteSize: z.number().int().nonnegative(),
});

/**
 * How many more the caller can attach. The main process caps at what is
 * staged overall; an editor also has to leave room for the images the post
 * already has.
 */
export const stageImagesRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(POST_MAX_IMAGES).optional(),
  })
  .optional();

export const stageImagesResponseSchema = z.object({
  images: z.array(stagedImageSchema).max(POST_MAX_IMAGES),
  /** True when the picker was dismissed without choosing anything. */
  cancelled: z.boolean(),
  /** Files chosen but not staged, because the per-post limit was already met. */
  skipped: z.number().int().nonnegative(),
});

/** Frees staged bytes the user removed from the composer, or abandoned. */
export const discardImagesRequestSchema = z.object({
  tokens: z.array(z.string().min(1).max(64)).max(POST_MAX_IMAGES),
});

/** Content may be empty only when images are attached — the API's own rule. */
export const createPostRequestSchema = z
  .object({
    content: z.string().trim().max(5000),
    visibility: postVisibilitySchema,
    imageTokens: z.array(z.string().min(1).max(64)).max(POST_MAX_IMAGES),
  })
  .refine((value) => value.content.length > 0 || value.imageTokens.length > 0, {
    message: 'A post needs text or at least one image.',
    path: ['content'],
  });

export const postResponseSchema = z.object({ post: postSchema });

export const postIdRequestSchema = z.object({
  postId: z.string().min(1).max(64),
});

/**
 * Every field is optional and absent means unchanged. Images are edited in two
 * directions at once: `removeImageIds` names existing ones by the `id` on the
 * post, and `imageTokens` are staged handles to append, exactly as on create.
 */
export const updatePostRequestSchema = z.object({
  postId: z.string().min(1).max(64),
  content: z.string().trim().max(5000).optional(),
  visibility: postVisibilitySchema.optional(),
  removeImageIds: z.array(z.string().min(1).max(64)).max(POST_MAX_IMAGES).optional(),
  imageTokens: z.array(z.string().min(1).max(64)).max(POST_MAX_IMAGES).optional(),
});

export const repostRequestSchema = z.object({
  postId: z.string().min(1).max(64),
  content: z.string().trim().max(5000).optional(),
});

/**
 * Copying is done in the main process, from the `shareUrl` the *server* returns
 * for a post id — the renderer never supplies the text that lands on the
 * clipboard, so a compromised renderer cannot plant arbitrary content there
 * (A01). It also sidesteps the default-deny permission policy, which refuses
 * clipboard access to the page.
 */
export const shareLinkCopiedResponseSchema = z.object({
  url: z.string().max(2048),
  copied: z.boolean(),
});

/** Deletes answer 204; the renderer gets a flag rather than an empty result. */
export const deletedResponseSchema = z.object({ deleted: z.boolean() });

/* -- reactions -- */

export const REACTION_TARGET_TYPES = ['POST', 'COMMENT'] as const;
export const reactionTargetTypeSchema = z.enum(REACTION_TARGET_TYPES);

const reactionTargetShape = {
  targetType: reactionTargetTypeSchema,
  targetId: z.string().min(1).max(64),
};

export const reactionTargetRequestSchema = z.object(reactionTargetShape);

/**
 * One call for add, change and remove: the server compares `type` with the
 * caller's current reaction and does whichever applies. Sending the type you
 * already hold removes it.
 */
export const toggleReactionRequestSchema = z.object({
  ...reactionTargetShape,
  type: reactionTypeSchema,
});

export const reactionSummarySchema = z.object({
  counts: z.record(z.string(), z.number()).default({}),
  total: z.number().int().nonnegative().default(0),
  viewerReaction: reactionTypeSchema.nullish(),
});

/** Who reacted, optionally narrowed to one reaction type. */
export const listReactorsRequestSchema = z.object({
  ...reactionTargetShape,
  type: reactionTypeSchema.optional(),
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

/**
 * The viewer's relationship to a reactor, as the server reports it. Held as
 * text rather than an enum so a status added later cannot void the list
 * (A10); compare against FRIEND_STATUSES.
 */
export const reactorSchema = z.object({
  user: authorSchema,
  type: reactionTypeSchema,
  reactedAt: timestamp,
  friendStatus: optionalText(32),
});

export const reactorPageSchema = pageOf(reactorSchema);

/* -- comments -- */

export const COMMENT_MAX_LENGTH = 2000;

export const createCommentRequestSchema = z.object({
  postId: z.string().min(1).max(64),
  content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  /** Supply to reply to an existing comment rather than to the post. */
  parentCommentId: z.string().min(1).max(64).optional(),
});

export const commentResponseSchema = z.object({ comment: commentSchema });

export const listCommentsRequestSchema = z.object({
  postId: z.string().min(1).max(64),
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

export const commentPageSchema = pageOf(threadCommentSchema);

export const deleteCommentRequestSchema = z.object({
  commentId: z.string().min(1).max(64),
});

export const updateCommentRequestSchema = z.object({
  commentId: z.string().min(1).max(64),
  content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
});

/* -- friends -- */

export const pageRequestSchema = z.object({
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

/** Every friendship route is addressed by the other user's id. */
export const friendUserRequestSchema = z.object({
  userId: z.string().min(1).max(64),
});

export const FRIEND_REQUEST_DIRECTIONS = ['received', 'sent'] as const;

/** Requests waiting on the caller's answer, or ones the caller sent. */
export const listFriendRequestsRequestSchema = pageRequestSchema.extend({
  direction: z.enum(FRIEND_REQUEST_DIRECTIONS),
});

export const friendEntryResponseSchema = z.object({ entry: friendEntrySchema });

export const friendEntryPageSchema = pageOf(friendEntrySchema);

/* -- profile -- */

export const profileResponseSchema = z.object({ user: userSchema });

/**
 * A public profile carries no `email` and no `status` but does carry
 * `friendStatus`; the shared user schema marks all three optional, so one type
 * covers both reads.
 */
export const publicUserRequestSchema = z.object({
  userId: z.string().min(1).max(64),
});

export const userPostsRequestSchema = z.object({
  userId: z.string().min(1).max(64),
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

export const userPostsResponseSchema = z.object({
  posts: z.array(postSchema),
  page: z.number().int().nonnegative(),
  totalElements: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  last: z.boolean(),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UserPostsRequest = z.infer<typeof userPostsRequestSchema>;
export type UserPostsResponse = z.infer<typeof userPostsResponseSchema>;

/* -- chat (yello-chat: /ws/* over HTTP, live frames over the socket) -- */

export const CHAT_MESSAGE_MAX_LENGTH = 20_000;
export const CHAT_PAGE_MAX_SIZE = 100;

export const CONVERSATION_TYPES = ['DIRECT', 'GROUP'] as const;
export const conversationTypeSchema = z.enum(CONVERSATION_TYPES);

/**
 * Chat rows carry user *ids* only — the chat service knows nothing about names
 * or avatars. The renderer resolves each id through `GET /users/{id}` and
 * caches the answer (see features/users), so these schemas stay exactly what
 * the wire carries.
 */
export const participantSchema = z.object({
  userId: z.string().min(1).max(64),
  /** OWNER or MEMBER; text so a role added later cannot void a conversation. */
  role: z
    .string()
    .max(16)
    .nullish()
    .transform((value) => value ?? 'MEMBER'),
  joinedAt: timestamp,
  lastReadMessageId: optionalText(64),
  lastReadAt: optionalText(64),
});

export const chatMessageSchema = z.object({
  id: z.string().min(1).max(64),
  conversationId: z.string().min(1).max(64),
  senderId: z.string().min(1).max(64),
  /** The sender's idempotency key; what an optimistic row is reconciled on. */
  clientId: z
    .string()
    .max(64)
    .nullish()
    .transform((value) => value ?? ''),
  body: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
  createdAt: timestamp,
});

const lastMessageSchema = z.object({
  id: z.string().min(1).max(64),
  senderId: z.string().min(1).max(64),
  body: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
  createdAt: timestamp,
});

/** The bare conversation record, as `POST /ws/conversations` and `conversation.new` carry it. */
export const conversationSchema = z.object({
  id: z.string().min(1).max(64),
  type: conversationTypeSchema,
  title: optionalText(100),
  createdBy: z.string().min(1).max(64),
  createdAt: timestamp,
  lastMessageAt: optionalText(64),
});

/** A row of the conversation list: the record plus what the list needs to draw it. */
export const conversationSummarySchema = conversationSchema.extend({
  participants: z
    .array(participantSchema)
    .max(600)
    .nullish()
    .transform((value) => value ?? []),
  lastMessage: lastMessageSchema.nullish().transform((value) => value ?? null),
  /** Messages from others after the caller's read marker. */
  unreadCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
});

/** Keyset pages: pass `nextCursor` back as `cursor` for the next (older) page. */
export const conversationPageSchema = z.object({
  items: z
    .array(conversationSummarySchema)
    .max(200)
    .nullish()
    .transform((value) => value ?? []),
  nextCursor: z
    .string()
    .max(512)
    .nullish()
    .transform((value) => value ?? null),
});

export const messagePageSchema = z.object({
  items: z
    .array(chatMessageSchema)
    .max(200)
    .nullish()
    .transform((value) => value ?? []),
  nextCursor: z
    .string()
    .max(512)
    .nullish()
    .transform((value) => value ?? null),
});

export const listConversationsRequestSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(CHAT_PAGE_MAX_SIZE),
});

export const CHAT_GROUP_TITLE_MAX = 100;
export const CHAT_GROUP_MAX_MEMBERS = 500;

/**
 * A direct conversation is idempotent per pair — asking again returns the one
 * that exists. A group is new every time; the caller becomes its OWNER.
 */
export const createConversationRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIRECT'),
    peerId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('GROUP'),
    title: z.string().trim().min(1).max(CHAT_GROUP_TITLE_MAX),
    memberIds: z.array(z.string().min(1).max(64)).min(1).max(CHAT_GROUP_MAX_MEMBERS),
  }),
]);

export const conversationIdRequestSchema = z.object({
  conversationId: z.string().min(1).max(64),
});

export const conversationResponseSchema = z.object({ conversation: conversationSummarySchema });

export const listMessagesRequestSchema = z.object({
  conversationId: z.string().min(1).max(64),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(CHAT_PAGE_MAX_SIZE),
});

export const sendChatMessageRequestSchema = z.object({
  conversationId: z.string().min(1).max(64),
  /** Generated by the renderer per attempt; a retry resends the same one. */
  clientId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
});

export const chatMessageResponseSchema = z.object({ message: chatMessageSchema });

export const markReadRequestSchema = z.object({
  conversationId: z.string().min(1).max(64),
  /** The last message seen; the server never moves the marker backwards. */
  messageId: z.string().min(1).max(64),
});

export const typingRequestSchema = z.object({
  conversationId: z.string().min(1).max(64),
  typing: z.boolean(),
});

export const CHAT_SOCKET_STATUSES = ['disconnected', 'connecting', 'connected'] as const;

export const chatSocketStateSchema = z.object({
  status: z.enum(CHAT_SOCKET_STATUSES),
  /** Users with an open socket, as the server last reported them. */
  onlineUserIds: z.array(z.string().min(1).max(64)).max(5000),
});

/**
 * What the main process pushes to the renderer from the live socket. Each is
 * a server frame that has already been parsed there — an unknown or malformed
 * frame never reaches the page (A08). `socket` is the one local event: the
 * connection's own state, so the UI can say "reconnecting" honestly.
 */
export const chatEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('socket'),
    data: chatSocketStateSchema,
  }),
  z.object({
    event: z.literal('message.new'),
    data: z.object({ message: chatMessageSchema }),
  }),
  z.object({
    event: z.literal('message.read'),
    data: z.object({
      conversationId: z.string().min(1).max(64),
      userId: z.string().min(1).max(64),
      lastReadMessageId: z.string().min(1).max(64),
      readAt: timestamp,
    }),
  }),
  z.object({
    event: z.literal('conversation.new'),
    data: z.object({
      conversation: conversationSchema,
      participants: z
        .array(participantSchema)
        .max(600)
        .nullish()
        .transform((value) => value ?? []),
    }),
  }),
  z.object({
    event: z.literal('typing'),
    data: z.object({
      conversationId: z.string().min(1).max(64),
      userId: z.string().min(1).max(64),
      typing: z.boolean(),
    }),
  }),
  z.object({
    event: z.literal('presence'),
    data: z.object({
      userId: z.string().min(1).max(64),
      online: z.boolean(),
    }),
  }),
]);

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type Participant = z.infer<typeof participantSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;
export type ListConversationsRequest = z.infer<typeof listConversationsRequestSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type ConversationIdRequest = z.infer<typeof conversationIdRequestSchema>;
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;
export type ListMessagesRequest = z.infer<typeof listMessagesRequestSchema>;
export type SendChatMessageRequest = z.infer<typeof sendChatMessageRequestSchema>;
export type ChatMessageResponse = z.infer<typeof chatMessageResponseSchema>;
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>;
export type TypingRequest = z.infer<typeof typingRequestSchema>;
export type ChatSocketStatus = (typeof CHAT_SOCKET_STATUSES)[number];
export type ChatSocketState = z.infer<typeof chatSocketStateSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;

/* -- link previews -- */

export const LINK_URL_MAX = 2048;

export const linkPreviewRequestSchema = z.object({
  url: z.url().max(LINK_URL_MAX),
});

/**
 * What an unfurled link looks like. The image arrives as a `data:` URL: the
 * main process fetched, validated and downscaled it, so the renderer never
 * loads from an arbitrary host and the CSP `img-src` stays closed.
 */
export const linkPreviewSchema = z.object({
  url: z.string().max(LINK_URL_MAX),
  /** The page's own host, for the caption. */
  host: z.string().max(253),
  siteName: optionalText(120),
  title: optionalText(300),
  description: optionalText(500),
  imageDataUrl: optionalText(2_000_000),
  /** A known provider gets a tailored card; anything else is generic. */
  provider: z.enum(['youtube', 'github', 'generic']),
});

export const linkPreviewResponseSchema = z.object({
  /** Null when the page could not be read or had nothing worth showing. */
  preview: linkPreviewSchema.nullable(),
});

export type LinkPreviewRequest = z.infer<typeof linkPreviewRequestSchema>;
export type LinkPreview = z.infer<typeof linkPreviewSchema>;
export type LinkPreviewResponse = z.infer<typeof linkPreviewResponseSchema>;

/* -- notifications -- */

/**
 * The notify service (`/notifications/v1`) is a third service behind the same
 * origin. Unlike chat it answers in the API's own envelope, so it needs no new
 * transport — only its own paths.
 *
 * Rows are written by the service from domain events; there is no endpoint that
 * creates one. This app therefore only reads the inbox, acknowledges rows, and
 * manages its push registration and opt-outs.
 */

/**
 * The vocabulary this build knows how to route and offer as a mute.
 *
 * A row's `type` is nevertheless held as bounded text, not this enum: rows come
 * from domain events, and a type added server-side later must not void a whole
 * page of the inbox (A10). An unknown type still renders — the server's frozen
 * `title` says what happened — it simply gets the generic icon and no deep link.
 */
export const NOTIFICATION_TYPES = [
  'POST_CREATED',
  'POST_COMMENTED',
  'COMMENT_REPLIED',
  'POST_REPOSTED',
  'POST_REACTED',
  'COMMENT_REACTED',
  'FRIEND_REQUEST_RECEIVED',
  'FRIEND_REQUEST_ACCEPTED',
  /** Push-only: chat pushes never land in the inbox. */
  'CHAT_MESSAGE',
] as const;

export const notificationTypeSchema = z.string().min(1).max(64);

/** Beyond this many keys a `data` map is not a deep-link hint but a payload. */
const NOTIFICATION_DATA_MAX_KEYS = 20;

/**
 * Deep-link hints. Upstream this is always a flat string map (an FCM data map
 * allows nothing else), so anything richer is dropped rather than trusted. The
 * keys that survive are still read one at a time and checked as ids before they
 * are ever turned into a route (A01) — see `routeFor` in the renderer.
 */
const notificationDataSchema = z
  .record(z.string().max(64), z.string().max(512))
  .nullish()
  .transform((value) =>
    value === null || value === undefined
      ? {}
      : Object.fromEntries(Object.entries(value).slice(0, NOTIFICATION_DATA_MAX_KEYS)),
  );

/**
 * One inbox row. `read` is normalised against `readAt` here rather than trusted
 * twice: the two cannot then disagree in the UI, whichever the server sent.
 */
export const notificationSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: notificationTypeSchema,
    /** Frozen display text, re-rendered server-side as rows aggregate. */
    title: z.string().max(500),
    body: optionalText(2000).transform((value) => value ?? ''),
    data: notificationDataSchema,
    /** The most recent actor when rows have collapsed into one. */
    actorId: optionalText(64),
    /**
     * 1 unless rows collapsed. Read leniently and floored at 1: the row is
     * about something that happened, so a 0 or a missing count is a reason to
     * show it as a single event, never a reason to drop it.
     */
    aggregateCount: z
      .number()
      .int()
      .nullish()
      .transform((value) => (value === null || value === undefined ? 1 : Math.max(1, value))),
    read: z
      .boolean()
      .nullish()
      .transform((value) => value ?? false),
    readAt: optionalText(64),
    createdAt: z.string().max(64),
    /** Last *activity*, not last edit — and the inbox sort key. */
    updatedAt: z.string().max(64),
  })
  .transform((row) => ({ ...row, read: row.read || row.readAt !== undefined }));

/**
 * Keyset page: pass `nextCursor` back as `cursor`. `null` is the last page.
 *
 * Rows are parsed one at a time and the ones that fail are dropped, rather than
 * the array being parsed as a whole. A page is a feed of independent events
 * written from independent domain messages: if one of them carries a field this
 * build does not expect, the honest outcome is to lose that row, not to blank
 * the inbox and tell the user they have no notifications (A10). An all-or-
 * nothing array did exactly that.
 */
export const notificationPageSchema = z.object({
  items: z
    .array(z.unknown())
    .max(100)
    .nullish()
    .transform((value) =>
      (value ?? []).flatMap((row) => {
        const parsed = notificationSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  nextCursor: z
    .string()
    .max(512)
    .nullish()
    .transform((value) => value ?? null),
});

export const unreadCountSchema = z.object({
  count: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
});

/** Only rows that *were* unread are counted, so a second call answers 0. */
export const markAllNotificationsReadSchema = z.object({
  updated: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
});

/** The server clamps a larger size silently; refusing it here is honest instead. */
export const NOTIFICATIONS_PAGE_SIZE_MAX = 50;
/** The server's own cursor ceiling, enforced before a request is spent on it. */
const NOTIFICATION_CURSOR_MAX = 400;

export const listNotificationsRequestSchema = z.object({
  cursor: z.string().max(NOTIFICATION_CURSOR_MAX).optional(),
  size: z.number().int().min(1).max(NOTIFICATIONS_PAGE_SIZE_MAX),
  /** Only rows still unread. Pass it unchanged across a whole cursor walk. */
  unread: z.boolean().optional(),
});

export const notificationIdRequestSchema = z.object({
  notificationId: z.string().min(1).max(64),
});

/* -- notification devices -- */

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);

export const DEVICE_TOKEN_MIN = 20;
export const DEVICE_TOKEN_MAX = 4096;

/** Printable ASCII with no whitespace — the service's own rule for a token. */
const deviceTokenSchema = z
  .string()
  .min(DEVICE_TOKEN_MIN)
  .max(DEVICE_TOKEN_MAX)
  .regex(/^[\x21-\x7e]+$/, 'Token must be printable with no whitespace');

export const registerDeviceRequestSchema = z.object({
  token: deviceTokenSchema,
  platform: devicePlatformSchema,
  appVersion: z.string().max(40).nullish(),
  locale: z
    .string()
    .max(16)
    .regex(/^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/, 'Locale must look like "en" or "en-GB"')
    .nullish(),
});

export const unregisterDeviceRequestSchema = z.object({ token: deviceTokenSchema });

/**
 * The registered device, as the service describes it back. Note the absence of
 * `token`: it is deliberately never echoed, so it stays out of every response,
 * log and cache (A04). Identify a device by `id`.
 */
export const deviceResponseSchema = z.object({
  id: z.string().min(1).max(64),
  platform: z.string().max(32),
  appVersion: optionalText(40),
  locale: optionalText(16),
  lastSeenAt: z.string().max(64),
  createdAt: z.string().max(64),
});

/* -- notification preferences -- */

/**
 * Push opt-outs. A user who has never saved any gets these defaults rather than
 * a 404, so there is no "not configured yet" branch to write.
 *
 * `mutedTypes` is read as bounded text for the same reason a row's type is: a
 * mute the phone set for a type this build has never heard of must survive a
 * save made here.
 */
export const notificationPreferencesSchema = z.object({
  pushEnabled: z
    .boolean()
    .nullish()
    .transform((value) => value ?? true),
  mutedTypes: z
    .array(notificationTypeSchema)
    .max(64)
    .nullish()
    .transform((value) => value ?? []),
});

/**
 * `PUT /preferences` **replaces** the record — an omitted field resets to its
 * default rather than keeping the stored value, so `mutedTypes: undefined`
 * would clear every mute. Both fields are required here to make sending a
 * partial state impossible from this app.
 */
export const updateNotificationPreferencesRequestSchema = z.object({
  pushEnabled: z.boolean(),
  mutedTypes: z.array(notificationTypeSchema).max(64),
});

/**
 * What the main process pushes to the renderer as it watches the inbox.
 *
 * There is no socket for notifications and no FCM on the desktop, so the
 * watcher polls and publishes what changed. `activated` is the one frame that
 * originates with the user: it is a native OS notification having been clicked,
 * which the renderer turns into a deep link.
 */
export const notificationEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('unread-count'), data: unreadCountSchema }),
  z.object({
    event: z.literal('received'),
    data: z.object({ items: z.array(notificationSchema).max(NOTIFICATIONS_PAGE_SIZE_MAX) }),
  }),
  z.object({ event: z.literal('activated'), data: z.object({ notification: notificationSchema }) }),
]);

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationData = Record<string, string>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
export type MarkAllNotificationsRead = z.infer<typeof markAllNotificationsReadSchema>;
export type ListNotificationsRequest = z.infer<typeof listNotificationsRequestSchema>;
export type NotificationIdRequest = z.infer<typeof notificationIdRequestSchema>;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;
export type UnregisterDeviceRequest = z.infer<typeof unregisterDeviceRequestSchema>;
export type DeviceResponse = z.infer<typeof deviceResponseSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>;
export const notificationResponseSchema = z.object({ notification: notificationSchema });

export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

/* -- files & window -- */

export const postExportEntrySchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().max(10_000),
  createdAt: z.string().max(64),
  author: z.string().max(64),
});

export const exportPostsRequestSchema = z.object({
  suggestedName: z
    .string()
    .min(1)
    .max(80)
    // No separators or traversal segments: the name is a leaf, never a path.
    .regex(/^[a-zA-Z0-9-_ ]+$/, 'File name may contain letters, digits, spaces, "-" and "_" only'),
  entries: z.array(postExportEntrySchema).max(5000),
});

export const exportPostsResponseSchema = z.object({
  written: z.boolean(),
  entryCount: z.number().int().nonnegative(),
});

export const appInfoResponseSchema = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  chromeVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  secureStorageAvailable: z.boolean(),
  apiBaseUrl: z.string(),
});

export const windowStateSchema = z.object({
  isMaximized: z.boolean(),
  isFullScreen: z.boolean(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResendOtpRequest = z.infer<typeof resendOtpRequestSchema>;
export type VerifyResetOtpRequest = z.infer<typeof verifyResetOtpRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type AcknowledgedResponse = z.infer<typeof acknowledgedResponseSchema>;
export type PublicUserRequest = z.infer<typeof publicUserRequestSchema>;
export type PostIdRequest = z.infer<typeof postIdRequestSchema>;
export type UpdatePostRequest = z.infer<typeof updatePostRequestSchema>;
export type RepostRequest = z.infer<typeof repostRequestSchema>;
export type ShareLinkCopiedResponse = z.infer<typeof shareLinkCopiedResponseSchema>;
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;
export type ReactionTargetType = z.infer<typeof reactionTargetTypeSchema>;
export type ReactionTargetRequest = z.infer<typeof reactionTargetRequestSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type CommentResponse = z.infer<typeof commentResponseSchema>;
export type ListCommentsRequest = z.infer<typeof listCommentsRequestSchema>;
export type CommentPage = Page<ThreadComment>;
export type DeleteCommentRequest = z.infer<typeof deleteCommentRequestSchema>;
export type UpdateCommentRequest = z.infer<typeof updateCommentRequestSchema>;
export type PageRequest = z.infer<typeof pageRequestSchema>;
export type FriendUserRequest = z.infer<typeof friendUserRequestSchema>;
export type ListFriendRequestsRequest = z.infer<typeof listFriendRequestsRequestSchema>;
export type FriendRequestDirection = (typeof FRIEND_REQUEST_DIRECTIONS)[number];
export type FriendEntryResponse = z.infer<typeof friendEntryResponseSchema>;
export type FriendEntryPage = Page<FriendEntry>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type FeedRequest = z.infer<typeof feedRequestSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;
export type StagedImage = z.infer<typeof stagedImageSchema>;
export type StageImagesRequest = z.infer<typeof stageImagesRequestSchema>;
export type StageImagesResponse = z.infer<typeof stageImagesResponseSchema>;
export type DiscardImagesRequest = z.infer<typeof discardImagesRequestSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type ToggleReactionRequest = z.infer<typeof toggleReactionRequestSchema>;
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;
export type ListReactorsRequest = z.infer<typeof listReactorsRequestSchema>;
export type Reactor = z.infer<typeof reactorSchema>;
export type ReactorPage = Page<Reactor>;
export type PostExportEntry = z.infer<typeof postExportEntrySchema>;
export type ExportPostsRequest = z.infer<typeof exportPostsRequestSchema>;
export type ExportPostsResponse = z.infer<typeof exportPostsResponseSchema>;
export type AppInfoResponse = z.infer<typeof appInfoResponseSchema>;
export type WindowState = z.infer<typeof windowStateSchema>;

/* ------------------------------------------------------------------ *
 * The bridge surface exposed on `window.yello`
 * ------------------------------------------------------------------ */

export interface YelloBridge {
  readonly auth: {
    login(request: LoginRequest): Promise<IpcResult<SessionResponse>>;
    register(request: RegisterRequest): Promise<IpcResult<RegisterResponse>>;
    verifyOtp(request: VerifyOtpRequest): Promise<IpcResult<SessionResponse>>;
    logout(): Promise<IpcResult<SessionResponse>>;
    currentSession(): Promise<IpcResult<SessionResponse>>;
    resendOtp(request: ResendOtpRequest): Promise<IpcResult<AcknowledgedResponse>>;
    forgotPassword(request: ForgotPasswordRequest): Promise<IpcResult<AcknowledgedResponse>>;
    verifyResetOtp(request: VerifyResetOtpRequest): Promise<IpcResult<AcknowledgedResponse>>;
    resetPassword(request: ResetPasswordRequest): Promise<IpcResult<AcknowledgedResponse>>;
  };
  readonly feed: {
    list(request: FeedRequest): Promise<IpcResult<FeedResponse>>;
    createPost(request: CreatePostRequest): Promise<IpcResult<PostResponse>>;
    /** Opens the OS picker and stages what was chosen, for preview. */
    stageImages(request?: StageImagesRequest): Promise<IpcResult<StageImagesResponse>>;
    discardImages(request: DiscardImagesRequest): Promise<IpcResult<AcknowledgedResponse>>;
  };
  readonly posts: {
    get(request: PostIdRequest): Promise<IpcResult<PostResponse>>;
    update(request: UpdatePostRequest): Promise<IpcResult<PostResponse>>;
    remove(request: PostIdRequest): Promise<IpcResult<DeletedResponse>>;
    repost(request: RepostRequest): Promise<IpcResult<PostResponse>>;
    copyShareLink(request: PostIdRequest): Promise<IpcResult<ShareLinkCopiedResponse>>;
  };
  readonly comments: {
    create(request: CreateCommentRequest): Promise<IpcResult<CommentResponse>>;
    list(request: ListCommentsRequest): Promise<IpcResult<CommentPage>>;
    update(request: UpdateCommentRequest): Promise<IpcResult<CommentResponse>>;
    remove(request: DeleteCommentRequest): Promise<IpcResult<DeletedResponse>>;
  };
  readonly reactions: {
    toggle(request: ToggleReactionRequest): Promise<IpcResult<ReactionSummary>>;
    summary(request: ReactionTargetRequest): Promise<IpcResult<ReactionSummary>>;
    list(request: ListReactorsRequest): Promise<IpcResult<ReactorPage>>;
  };
  readonly friends: {
    list(request: PageRequest): Promise<IpcResult<FriendEntryPage>>;
    requests(request: ListFriendRequestsRequest): Promise<IpcResult<FriendEntryPage>>;
    blocked(request: PageRequest): Promise<IpcResult<FriendEntryPage>>;
    sendRequest(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
    cancelRequest(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
    accept(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
    decline(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
    remove(request: FriendUserRequest): Promise<IpcResult<DeletedResponse>>;
    block(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
    unblock(request: FriendUserRequest): Promise<IpcResult<FriendEntryResponse>>;
  };
  readonly profile: {
    listPosts(request: UserPostsRequest): Promise<IpcResult<UserPostsResponse>>;
    getUser(request: PublicUserRequest): Promise<IpcResult<ProfileResponse>>;
  };
  readonly chat: {
    listConversations(request: ListConversationsRequest): Promise<IpcResult<ConversationPage>>;
    createConversation(
      request: CreateConversationRequest,
    ): Promise<IpcResult<ConversationResponse>>;
    getConversation(request: ConversationIdRequest): Promise<IpcResult<ConversationResponse>>;
    listMessages(request: ListMessagesRequest): Promise<IpcResult<MessagePage>>;
    sendMessage(request: SendChatMessageRequest): Promise<IpcResult<ChatMessageResponse>>;
    markRead(request: MarkReadRequest): Promise<IpcResult<AcknowledgedResponse>>;
    typing(request: TypingRequest): Promise<IpcResult<AcknowledgedResponse>>;
    socketState(): Promise<IpcResult<ChatSocketState>>;
    /**
     * Subscribes to frames pushed from the main process. Returns the
     * unsubscribe; the listener receives an unvalidated value the renderer
     * parses against `chatEventSchema` before use.
     */
    onEvent(listener: (event: unknown) => void): () => void;
  };
  readonly notifications: {
    list(request: ListNotificationsRequest): Promise<IpcResult<NotificationPage>>;
    unreadCount(): Promise<IpcResult<UnreadCount>>;
    markRead(request: NotificationIdRequest): Promise<IpcResult<NotificationResponse>>;
    markAllRead(): Promise<IpcResult<MarkAllNotificationsRead>>;
    dismiss(request: NotificationIdRequest): Promise<IpcResult<DeletedResponse>>;
    registerDevice(request: RegisterDeviceRequest): Promise<IpcResult<DeviceResponse>>;
    unregisterDevice(request: UnregisterDeviceRequest): Promise<IpcResult<AcknowledgedResponse>>;
    preferences(): Promise<IpcResult<NotificationPreferences>>;
    savePreferences(
      request: UpdateNotificationPreferencesRequest,
    ): Promise<IpcResult<NotificationPreferences>>;
    /**
     * Subscribes to what the inbox watcher publishes. Returns the unsubscribe;
     * the listener receives an unvalidated value the renderer parses against
     * `notificationEventSchema` before use.
     */
    onEvent(listener: (event: unknown) => void): () => void;
  };
  readonly links: {
    preview(request: LinkPreviewRequest): Promise<IpcResult<LinkPreviewResponse>>;
  };
  readonly files: {
    exportPosts(request: ExportPostsRequest): Promise<IpcResult<ExportPostsResponse>>;
    readAppInfo(): Promise<IpcResult<AppInfoResponse>>;
  };
  readonly window: {
    minimize(): Promise<IpcResult<WindowState>>;
    toggleMaximize(): Promise<IpcResult<WindowState>>;
    close(): Promise<IpcResult<WindowState>>;
    getState(): Promise<IpcResult<WindowState>>;
  };
}
