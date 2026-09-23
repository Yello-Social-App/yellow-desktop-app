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
  coverUrl: optionalText(2048),
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
  /**
   * Whether the viewer bookmarked this post — their own state, never anyone
   * else's. On a quoted original it is the viewer's save of the original, which
   * is separate from a save of the repost.
   */
  isSaved: z
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

/**
 * Changing the password while signed in is two calls. The first proves the
 * current password and has a `CHANGE_PASSWORD` code emailed; the second spends
 * that code and answers with a new token pair, which the main process adopts —
 * the renderer is told it worked and nothing more (A02). Every other session,
 * this one's old token included, is revoked by the server.
 */
export const changePasswordOtpRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
});

export const changePasswordRequestSchema = z.object({
  code: z.string().regex(OTP_CODE_PATTERN),
  newPassword: z.string().min(12).max(128),
});

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
 * Attaching an image is two steps, for a post and for a profile photo alike: the
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
/**
 * What the pick is for. A post takes several; an avatar or a cover is one
 * image, so the picker opens single-select with a title that says which.
 */
export const IMAGE_PURPOSES = ['post', 'avatar', 'cover'] as const;

export const stageImagesRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(POST_MAX_IMAGES).optional(),
    purpose: z.enum(IMAGE_PURPOSES).optional(),
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

/** `POST /posts/{id}/save` is a toggle; this is the state *after* the call. */
export const saveStateSchema = z.object({
  postId: z.string().min(1).max(64),
  isSaved: z.boolean(),
});

/** The caller's saved posts, most recently saved first; the user is the token's. */
export const savedPostsRequestSchema = z.object({
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

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

/**
 * Editing the caller's own profile. Every field is optional: absent leaves it
 * as it is, `null` clears it (the username excepted — it can never be blank).
 * Images arrive as staging tokens, never paths or bytes (A01), and a remove
 * flag is ignored by the server when a new file is sent with it.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;
export const PROFILE_FULL_NAME_MAX = 100;
export const PROFILE_BIO_MAX = 500;

export const updateProfileRequestSchema = z.object({
  username: z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(USERNAME_PATTERN)
    .optional(),
  fullName: z.string().trim().min(1).max(PROFILE_FULL_NAME_MAX).nullable().optional(),
  bio: z.string().trim().min(1).max(PROFILE_BIO_MAX).nullable().optional(),
  avatarToken: z.string().min(1).max(64).optional(),
  removeAvatar: z.literal(true).optional(),
  coverToken: z.string().min(1).max(64).optional(),
  removeCover: z.literal(true).optional(),
});

/* -- people search -- */

/** The server's bounds on `q`; anything shorter is not sent at all. */
export const USER_SEARCH_QUERY_MIN = 2;
export const USER_SEARCH_QUERY_MAX = 100;

/**
 * Matches on full name and username only — email is neither searched nor
 * returned. Answered as a friend-entry page, since each row is exactly a
 * user plus the viewer's `friendStatus`, and the friends rows already draw
 * that shape.
 */
export const searchUsersRequestSchema = z.object({
  query: z.string().trim().min(USER_SEARCH_QUERY_MIN).max(USER_SEARCH_QUERY_MAX),
  page: z.number().int().min(0).max(1000),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type SearchUsersRequest = z.infer<typeof searchUsersRequestSchema>;
export type UserPostsRequest = z.infer<typeof userPostsRequestSchema>;
export type UserPostsResponse = z.infer<typeof userPostsResponseSchema>;

/* -- chat (yello-chat: /ws/* over HTTP, live frames over the socket) -- */

/** The wire ceiling, from the service's spec; what a received body is bounded by. */
export const CHAT_MESSAGE_MAX_LENGTH = 20_000;
/** What the service accepts on send by default (`CHAT_MESSAGE_MAX_LENGTH` there). */
export const CHAT_COMPOSE_MAX_LENGTH = 4000;
export const CHAT_PAGE_MAX_SIZE = 100;
/** Files one message may carry (`CHAT_MESSAGE_MAX_ATTACHMENTS`). */
export const CHAT_MESSAGE_MAX_ATTACHMENTS = 10;
/** Each upload and each group photo (`CHAT_ATTACHMENT_MAX_BYTES`, 10 MiB). */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const CONVERSATION_TYPES = ['DIRECT', 'GROUP'] as const;
export const conversationTypeSchema = z.enum(CONVERSATION_TYPES);

/** The roles a participant can hold. ADMIN is new; OWNER is exactly one person. */
export const PARTICIPANT_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * A presigned media link, or null.
 *
 * Only `https:` survives: these land in `<img src>` and in a download, and a
 * `javascript:` or `data:` value from a compromised or confused upstream must
 * never reach either (OWASP A05). The CSP `img-src` allowlist is the second
 * line; this is the first.
 */
const mediaUrl = z
  .string()
  .max(4096)
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) {
      return null;
    }
    try {
      return new URL(value).protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  });

const nullableTimestamp = z
  .string()
  .max(64)
  .nullish()
  .transform((value) => (value === null || value === undefined || value === '' ? null : value));

/**
 * Chat rows carry user *ids* only — the chat service knows nothing about names
 * or avatars. The renderer resolves each id through `GET /users/{id}` and
 * caches the answer (see features/users), so these schemas stay exactly what
 * the wire carries.
 */
export const participantSchema = z.object({
  userId: z.string().min(1).max(64),
  /**
   * OWNER, ADMIN or MEMBER. Text rather than the enum so a role added later
   * cannot void a conversation; an unrecognised one reads as MEMBER, the role
   * with the fewest rights, so it can never unlock a control (A01).
   */
  role: z
    .string()
    .max(16)
    .nullish()
    .transform((value): ParticipantRole =>
      value === 'OWNER' || value === 'ADMIN' ? value : 'MEMBER',
    ),
  joinedAt: timestamp,
  lastReadMessageId: optionalText(64),
  lastReadAt: optionalText(64),
});

/**
 * A file on a message. The kind is sniffed from the bytes server-side; an
 * unknown kind reads as FILE, which downloads rather than renders inline.
 */
export const chatAttachmentSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z
    .string()
    .max(16)
    .transform((value): 'IMAGE' | 'FILE' => (value === 'IMAGE' ? 'IMAGE' : 'FILE')),
  fileName: z.string().max(512),
  mimeType: z.string().max(255),
  sizeBytes: z.number().int().nonnegative(),
  url: mediaUrl,
  urlExpiresAt: nullableTimestamp,
});

export const chatReactionSchema = z.object({
  emoji: z.string().min(1).max(64),
  count: z.number().int().nonnegative(),
  userIds: z.array(z.string().min(1).max(64)).max(600),
});

const chatReactionListSchema = z
  .array(chatReactionSchema)
  .max(200)
  .nullish()
  .transform((value) => value ?? []);

/** The quoted message on a reply: a 200-character preview, not the record. */
export const replyPreviewSchema = z.object({
  id: z.string().min(1).max(64),
  senderId: z.string().min(1).max(64),
  body: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
  hasAttachments: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  deleted: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
});

export const GROUP_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED'] as const;
export type GroupInviteStatus = (typeof GROUP_INVITE_STATUSES)[number];

/**
 * An unrecognised status reads as DECLINED — a settled state — so an invite the
 * app does not understand never shows Join (A10).
 */
const inviteStatus = z
  .string()
  .max(16)
  .transform((value): GroupInviteStatus =>
    value === 'PENDING' || value === 'ACCEPTED' ? value : 'DECLINED',
  );

/** The group an invite card describes, as the card's message carries it. */
export const groupInviteCardSchema = z.object({
  id: z.string().min(1).max(64),
  conversationId: z.string().min(1).max(64),
  inviterId: z
    .string()
    .max(64)
    .nullish()
    .transform((value) => value ?? ''),
  /** Only this user may answer; everyone else sees the status. */
  inviteeId: z
    .string()
    .max(64)
    .nullish()
    .transform((value) => value ?? ''),
  status: inviteStatus,
  title: optionalText(100),
  memberCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
  photoUrl: mediaUrl,
  photoUrlExpiresAt: nullableTimestamp,
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
  /** Empty for an attachment-only message, an invite card and a tombstone. */
  body: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
  replyTo: replyPreviewSchema.nullish().transform((value) => value ?? null),
  attachments: z
    .array(chatAttachmentSchema)
    .max(20)
    .nullish()
    .transform((value) => value ?? []),
  reactions: chatReactionListSchema,
  groupInvite: groupInviteCardSchema.nullish().transform((value) => value ?? null),
  createdAt: timestamp,
  editedAt: nullableTimestamp,
  /** Set on a tombstone: the line stays in history as "Message deleted". */
  deletedAt: nullableTimestamp,
});

/**
 * The list's preview of the newest line. The server sends only the first four
 * fields; the rest are filled in locally when the preview comes from a live
 * frame, so "Sent a photo" can be said rather than an empty line.
 */
const lastMessageSchema = z.object({
  id: z.string().min(1).max(64),
  senderId: z.string().min(1).max(64),
  body: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
  createdAt: timestamp,
  attachments: z.array(chatAttachmentSchema).max(20).optional(),
  groupInvite: groupInviteCardSchema.nullish(),
  deletedAt: nullableTimestamp.optional(),
});

/** The bare conversation record, as `POST /ws/conversations` and `conversation.new` carry it. */
export const conversationSchema = z.object({
  id: z.string().min(1).max(64),
  type: conversationTypeSchema,
  title: optionalText(100),
  createdBy: z.string().min(1).max(64),
  createdAt: timestamp,
  lastMessageAt: optionalText(64),
  /** A group's photo: presigned, re-signed on every read, expires like attachments. */
  photoUrl: mediaUrl,
  photoUrlExpiresAt: nullableTimestamp,
});

const participantListSchema = z
  .array(participantSchema)
  .max(600)
  .nullish()
  .transform((value) => value ?? []);

/** A row of the conversation list: the record plus what the list needs to draw it. */
export const conversationSummarySchema = conversationSchema.extend({
  participants: participantListSchema,
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
/** The wire ceiling on a create request's member list. */
export const CHAT_GROUP_MAX_MEMBERS = 500;
/** How many people a group may hold by default (`CHAT_GROUP_MAX_MEMBERS` there). */
export const CHAT_GROUP_SIZE_LIMIT = 50;

const chatId = z.string().min(1).max(64);

/**
 * A direct conversation is idempotent per pair — asking again returns the one
 * that exists. A group is new every time; the caller becomes its OWNER.
 */
export const createConversationRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIRECT'),
    peerId: chatId,
  }),
  z.object({
    type: z.literal('GROUP'),
    title: z.string().trim().min(1).max(CHAT_GROUP_TITLE_MAX),
    memberIds: z.array(chatId).min(1).max(CHAT_GROUP_MAX_MEMBERS),
  }),
]);

export const conversationIdRequestSchema = z.object({
  conversationId: chatId,
});

export const conversationResponseSchema = z.object({ conversation: conversationSummarySchema });

export const listMessagesRequestSchema = z.object({
  conversationId: chatId,
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(CHAT_PAGE_MAX_SIZE),
});

/**
 * A send: text, files, or both, optionally quoting a line. The body may be
 * empty only when files ride along — the service's own rule, checked here so a
 * blank send never costs a round trip.
 */
export const sendChatMessageRequestSchema = z
  .object({
    conversationId: chatId,
    /** Generated by the renderer per attempt; a retry resends the same one. */
    clientId: chatId,
    body: z.string().trim().max(CHAT_COMPOSE_MAX_LENGTH),
    replyToMessageId: chatId.optional(),
    attachmentIds: z.array(chatId).max(CHAT_MESSAGE_MAX_ATTACHMENTS).optional(),
  })
  .refine((value) => value.body !== '' || (value.attachmentIds?.length ?? 0) > 0, {
    message: 'A message needs text or a file.',
    path: ['body'],
  });

export const chatMessageResponseSchema = z.object({ message: chatMessageSchema });

/** Addresses one message in one conversation — delete, and removing a reaction. */
export const chatMessageRefSchema = z.object({
  conversationId: chatId,
  messageId: chatId,
});

/** Text only: files and the reply target are fixed once sent. */
export const editChatMessageRequestSchema = chatMessageRefSchema.extend({
  body: z.string().trim().min(1).max(CHAT_COMPOSE_MAX_LENGTH),
});

/**
 * One emoji. The service is the judge of "exactly one" (a flag, a skin tone,
 * a ZWJ family are each one); this only bounds the length so a paragraph never
 * crosses the bridge.
 */
export const reactChatMessageRequestSchema = chatMessageRefSchema.extend({
  emoji: z.string().trim().min(1).max(32),
});

/** The whole reaction list after a change — replace, never merge. */
export const messageReactionsSchema = z.object({
  messageId: chatId,
  reactions: chatReactionListSchema,
});

export const markReadRequestSchema = z.object({
  conversationId: chatId,
  /** The last message seen; the server never moves the marker backwards. */
  messageId: chatId,
});

export const typingRequestSchema = z.object({
  conversationId: chatId,
  typing: z.boolean(),
});

/* -- chat attachments -- */

/**
 * Upload is picker-driven: the renderer names the conversation and how many
 * more files the draft has room for, and the main process opens the OS dialog,
 * so the page never names a path (A01).
 */
export const attachChatFilesRequestSchema = z.object({
  conversationId: chatId,
  limit: z.number().int().min(1).max(CHAT_MESSAGE_MAX_ATTACHMENTS),
});

export const attachChatFilesResponseSchema = z.object({
  /** Uploaded and pending: visible to the uploader only until they are sent. */
  attachments: z.array(chatAttachmentSchema).max(CHAT_MESSAGE_MAX_ATTACHMENTS),
  cancelled: z.boolean(),
  /** Files that were picked but not uploaded (over the cap, too large, refused). */
  skipped: z.number().int().nonnegative(),
  /** Why the first skipped file was refused, for the composer to say. */
  skippedReason: z.string().max(300).optional(),
});

/**
 * Files the user pasted or dropped into the conversation. Unlike the picker,
 * the bytes come from the page — a paste or a drop is only readable there, as
 * the `File` the user handed it — so the main process treats them as
 * untrusted: bounded here in count and size, and a paste is accepted only if
 * its leading bytes are a JPEG, PNG, GIF or WebP (A05/A06).
 *
 * Bytes rather than a path, deliberately: the preload *could* turn a dropped
 * `File` into its path on disk, but then the page would be naming a path for
 * the main process to read, and a compromised page could "drop" any file the
 * user can read (A01). The bytes are only ever what the user actually handed
 * over.
 */
export const LOCAL_FILE_SOURCES = ['paste', 'drop'] as const;

export const uploadLocalFilesRequestSchema = z.object({
  conversationId: chatId,
  /** A paste must be an image; a drop may be any file, as the picker allows. */
  source: z.enum(LOCAL_FILE_SOURCES),
  files: z
    .array(
      z.object({
        /** The file's own name, when it has one; a hint, never a path. */
        fileName: z.string().trim().min(1).max(255).optional(),
        bytes: z
          .instanceof(Uint8Array)
          .refine(
            (bytes) => bytes.byteLength > 0 && bytes.byteLength <= CHAT_ATTACHMENT_MAX_BYTES,
            'Each file must be 10 MB or smaller.',
          ),
      }),
    )
    .min(1)
    .max(CHAT_MESSAGE_MAX_ATTACHMENTS),
});

export const attachmentIdRequestSchema = z.object({ attachmentId: chatId });

export const attachmentResponseSchema = z.object({ attachment: chatAttachmentSchema });

export const savedFileResponseSchema = z.object({
  /** False when the user cancelled the save dialog. */
  saved: z.boolean(),
});

/* -- chat groups -- */

export const renameGroupRequestSchema = z.object({
  conversationId: chatId,
  title: z.string().trim().min(1).max(CHAT_GROUP_TITLE_MAX),
});

export const addGroupMembersRequestSchema = z.object({
  conversationId: chatId,
  userIds: z.array(chatId).min(1).max(CHAT_GROUP_SIZE_LIMIT),
});

export const groupMemberRequestSchema = z.object({
  conversationId: chatId,
  userId: chatId,
});

/** OWNER is never assignable: ownership moves only when the owner leaves. */
export const changeMemberRoleRequestSchema = groupMemberRequestSchema.extend({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export const groupParticipantsSchema = z.object({
  conversationId: chatId,
  participants: participantListSchema,
});

/** A rename or a photo change answers with the record, without participants. */
export const groupRecordResponseSchema = z.object({ conversation: conversationSchema });

export const groupInviteSchema = z.object({
  id: chatId,
  conversationId: chatId,
  inviterId: chatId,
  inviteeId: chatId,
  status: inviteStatus,
  createdAt: timestamp,
});

export const groupInviteResultSchema = z.object({
  invite: groupInviteSchema,
  /** The card, as it appears in the inviter's DM with the invitee. */
  message: chatMessageSchema,
});

export const inviteIdRequestSchema = z.object({ inviteId: chatId });

export const CHAT_SOCKET_STATUSES = ['disconnected', 'connecting', 'connected'] as const;

export const chatSocketStateSchema = z.object({
  status: z.enum(CHAT_SOCKET_STATUSES),
  /** Users with an open socket, as the server last reported them. */
  onlineUserIds: z.array(chatId).max(5000),
});

/** What changed in a group, enough to say "Alice added Bob and Chea". */
export const groupChangeSchema = z.object({
  /** RENAMED, PHOTO_CHANGED, MEMBERS_ADDED, MEMBER_REMOVED, MEMBER_LEFT, ROLE_CHANGED. */
  kind: z.string().min(1).max(32),
  actorId: optionalText(64),
  userIds: z
    .array(chatId)
    .max(600)
    .nullish()
    .transform((value) => value ?? []),
});

/**
 * What the main process pushes to the renderer from the live socket. Each is
 * a server frame that has already been parsed there — an unknown or malformed
 * frame never reaches the page (A08). `socket` and `alert.activated` are the
 * local events: the connection's own state, so the UI can say "reconnecting"
 * honestly, and a desktop chat alert having been clicked.
 */
export const chatEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('socket'),
    data: chatSocketStateSchema,
  }),
  z.object({
    event: z.literal('alert.activated'),
    data: z.object({ conversationId: chatId }),
  }),
  z.object({
    event: z.literal('message.new'),
    data: z.object({ message: chatMessageSchema }),
  }),
  z.object({
    event: z.literal('message.updated'),
    data: z.object({ message: chatMessageSchema }),
  }),
  z.object({
    event: z.literal('message.deleted'),
    data: z.object({
      conversationId: chatId,
      messageId: chatId,
      deletedAt: timestamp,
    }),
  }),
  z.object({
    event: z.literal('message.reactions'),
    data: z.object({
      conversationId: chatId,
      messageId: chatId,
      reactions: chatReactionListSchema,
    }),
  }),
  z.object({
    event: z.literal('message.read'),
    data: z.object({
      conversationId: chatId,
      userId: chatId,
      lastReadMessageId: chatId,
      readAt: timestamp,
    }),
  }),
  z.object({
    event: z.literal('conversation.new'),
    data: z.object({
      conversation: conversationSchema,
      participants: participantListSchema,
    }),
  }),
  z.object({
    event: z.literal('conversation.updated'),
    data: z.object({
      conversation: conversationSchema,
      participants: participantListSchema,
      change: groupChangeSchema.nullish().transform((value) => value ?? null),
    }),
  }),
  z.object({
    event: z.literal('conversation.removed'),
    data: z.object({
      conversationId: chatId,
      /** REMOVED or LEFT. */
      reason: z.string().max(16),
    }),
  }),
  z.object({
    event: z.literal('group.invite.updated'),
    data: z.object({
      inviteId: chatId,
      conversationId: chatId,
      status: inviteStatus,
    }),
  }),
  z.object({
    event: z.literal('typing'),
    data: z.object({
      conversationId: chatId,
      userId: chatId,
      typing: z.boolean(),
    }),
  }),
  z.object({
    event: z.literal('presence'),
    data: z.object({
      userId: chatId,
      online: z.boolean(),
    }),
  }),
]);

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type Participant = z.infer<typeof participantSchema>;
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;
export type ChatReaction = z.infer<typeof chatReactionSchema>;
export type ReplyPreview = z.infer<typeof replyPreviewSchema>;
export type GroupInviteCard = z.infer<typeof groupInviteCardSchema>;
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
export type ChatMessageRef = z.infer<typeof chatMessageRefSchema>;
export type EditChatMessageRequest = z.infer<typeof editChatMessageRequestSchema>;
export type ReactChatMessageRequest = z.infer<typeof reactChatMessageRequestSchema>;
export type MessageReactions = z.infer<typeof messageReactionsSchema>;
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>;
export type TypingRequest = z.infer<typeof typingRequestSchema>;
export type AttachChatFilesRequest = z.infer<typeof attachChatFilesRequestSchema>;
export type AttachChatFilesResponse = z.infer<typeof attachChatFilesResponseSchema>;
export type LocalFileSource = (typeof LOCAL_FILE_SOURCES)[number];
export type UploadLocalFilesRequest = z.infer<typeof uploadLocalFilesRequestSchema>;
export type AttachmentIdRequest = z.infer<typeof attachmentIdRequestSchema>;
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
export type SavedFileResponse = z.infer<typeof savedFileResponseSchema>;
export type RenameGroupRequest = z.infer<typeof renameGroupRequestSchema>;
export type AddGroupMembersRequest = z.infer<typeof addGroupMembersRequestSchema>;
export type GroupMemberRequest = z.infer<typeof groupMemberRequestSchema>;
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleRequestSchema>;
export type GroupParticipants = z.infer<typeof groupParticipantsSchema>;
export type GroupRecordResponse = z.infer<typeof groupRecordResponseSchema>;
export type GroupInvite = z.infer<typeof groupInviteSchema>;
export type GroupInviteResult = z.infer<typeof groupInviteResultSchema>;
export type InviteIdRequest = z.infer<typeof inviteIdRequestSchema>;
export type GroupChange = z.infer<typeof groupChangeSchema>;
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

/* -- account switching -- */

/**
 * A remembered account, as the renderer is allowed to see it.
 *
 * Note what is absent, and deliberately so: there is no token, and no field
 * from which one could be derived. Switching is addressed by `userId` alone,
 * and the main process will only act on an id its own vault already holds — the
 * renderer can name an account, never authenticate as one (OWASP A01/A02).
 */
export const accountSummarySchema = z.object({
  userId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  fullName: optionalText(200),
  avatarUrl: optionalText(2048),
  /** The account this session is currently signed in as. */
  isActive: z.boolean(),
});

export const accountListResponseSchema = z.object({
  accounts: z.array(accountSummarySchema).max(10),
  /**
   * Whether the OS keychain can encrypt a credential at rest. False on a Linux
   * desktop with no Secret Service, where accounts cannot be remembered at all
   * — the switcher says so rather than offering a button that silently does
   * nothing.
   */
  canRemember: z.boolean(),
  maxAccounts: z.number().int().positive().max(20),
});

export const accountIdRequestSchema = z.object({
  userId: z.string().min(1).max(64),
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;
export type AccountIdRequest = z.infer<typeof accountIdRequestSchema>;

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
  /** Push-only: chat alerts never land in the inbox. */
  'CHAT_MESSAGE',
  'CHAT_REACTION',
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

/* -- communities & showcase: shared pieces -- */

const nonNegativeCount = z
  .number()
  .int()
  .nonnegative()
  .nullish()
  .transform((value) => value ?? 0);

const flag = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

const textList = (itemMax: number, listMax: number) =>
  z
    .array(z.string().max(itemMax))
    .max(listMax)
    .nullish()
    .transform((value) => value ?? []);

/**
 * An array whose rows are parsed one at a time, dropping the ones that fail —
 * the lesson the notification inbox taught: one row with a field this build
 * does not expect must cost that row, not blank the whole list (A10).
 */
function rowsOf<TSchema extends z.ZodType>(item: TSchema, max: number) {
  return z
    .array(z.unknown())
    .max(max)
    .nullish()
    .transform((value) =>
      (value ?? []).flatMap((row) => {
        const parsed = item.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

/** An offset page, parsed row by row. */
function lenientPageOf<TSchema extends z.ZodType>(item: TSchema) {
  return pageOf(item).extend({ content: rowsOf(item, 200) });
}

/** A cursor page: pass `nextCursor` back as `cursor`, with the same sort. */
function cursorPageOf<TSchema extends z.ZodType>(item: TSchema) {
  return z.object({
    content: rowsOf(item, 200),
    nextCursor: z
      .string()
      .max(512)
      .nullish()
      .transform((value) => value ?? null),
    hasMore: flag,
  });
}

export const COMMUNITY_PAGE_SIZE_MAX = 50;
const pageNumber = z.number().int().min(0).max(1000);
const pageSize = z.number().int().min(1).max(COMMUNITY_PAGE_SIZE_MAX);
const cursorParam = z.string().max(512).optional();

/* -- communities -- */

/**
 * A slug is the community's path key, in a route here and a segment upstream.
 * Held to the server's own alphabet on both directions: a request cannot
 * address anything but a slug, and a response cannot put anything else into
 * an in-app link (A01/A05).
 */
export const COMMUNITY_SLUG_PATTERN = /^[a-z0-9-]{3,32}$/;
const communitySlugSchema = z.string().regex(COMMUNITY_SLUG_PATTERN);

export const COMMUNITY_SORTS = ['popular', 'newest', 'name'] as const;
export const COMMUNITY_MEMBERSHIPS = ['joined', 'not_joined'] as const;
export const COMMUNITY_POST_SORTS = ['hot', 'new', 'top'] as const;
export const COMMUNITY_POST_SCOPES = ['all', 'joined'] as const;
export const COMMUNITY_SEARCH_MAX = 64;
export const COMMUNITY_POST_TITLE_MAX = 200;
export const COMMUNITY_POST_BODY_MAX = 5000;
export const COMMUNITY_TAG_MAX = 64;

export const communitySchema = z.object({
  id: z.string().min(1).max(64),
  slug: communitySlugSchema,
  name: z.string().min(1).max(200),
  tagline: optionalText(500).transform((value) => value ?? ''),
  description: optionalText(10_000).transform((value) => value ?? ''),
  emoji: optionalText(32).transform((value) => value ?? ''),
  /** Post flairs; a new post's tag must be exactly one of these. */
  tags: textList(COMMUNITY_TAG_MAX, 50),
  rules: textList(1000, 50),
  memberCount: nonNegativeCount,
  /** Always null for now: the number is hidden rather than shown as a zero. */
  onlineCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
  createdAt: timestamp,
  isMember: flag,
});

export const communitySummarySchema = z.object({
  slug: communitySlugSchema,
  name: z.string().min(1).max(200),
  emoji: optionalText(32).transform((value) => value ?? ''),
});

export const COMMUNITY_VOTES = [-1, 0, 1] as const;
export const communityVoteSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

/** Read leniently: an out-of-range vote is no vote, not a void row. */
const viewerVoteSchema = z
  .number()
  .int()
  .nullish()
  .transform((value): Vote => (value === 1 || value === -1 ? value : 0));

export const communityPostSchema = z.object({
  id: z.string().min(1).max(64),
  community: communitySummarySchema,
  author: authorSchema,
  title: z.string().min(1).max(500),
  body: optionalText(COMMUNITY_POST_BODY_MAX * 2).transform((value) => value ?? ''),
  tag: z.string().max(COMMUNITY_TAG_MAX),
  /** Upvotes minus downvotes; may be negative. */
  score: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? 0),
  commentCount: nonNegativeCount,
  createdAt: timestamp,
  viewerVote: viewerVoteSchema,
  isOwner: flag,
});

export const communityPageSchema = lenientPageOf(communitySchema);
export const communityPostPageSchema = cursorPageOf(communityPostSchema);

export const communityResponseSchema = z.object({ community: communitySchema });
export const communityPostResponseSchema = z.object({ post: communityPostSchema });

export const communityPostVoteSchema = z.object({
  id: z.string().min(1).max(64),
  score: z.number().int(),
  viewerVote: viewerVoteSchema,
});

export const listCommunitiesRequestSchema = z.object({
  /** Name or slug (contains) or a tag (exact); blank means no filter. */
  q: z.string().trim().max(COMMUNITY_SEARCH_MAX).optional(),
  membership: z.enum(COMMUNITY_MEMBERSHIPS).optional(),
  sort: z.enum(COMMUNITY_SORTS),
  page: pageNumber,
  size: pageSize,
});

export const communitySlugRequestSchema = z.object({ slug: communitySlugSchema });

export const listCommunityPostsRequestSchema = z.object({
  slug: communitySlugSchema,
  sort: z.enum(COMMUNITY_POST_SORTS),
  size: pageSize,
  cursor: cursorParam,
});

/** The front page across communities; `joined` narrows to the caller's own. */
export const listFrontPagePostsRequestSchema = z.object({
  scope: z.enum(COMMUNITY_POST_SCOPES),
  sort: z.enum(COMMUNITY_POST_SORTS),
  size: pageSize,
  cursor: cursorParam,
});

export const createCommunityPostRequestSchema = z.object({
  slug: communitySlugSchema,
  title: z.string().trim().min(1).max(COMMUNITY_POST_TITLE_MAX),
  body: z.string().trim().max(COMMUNITY_POST_BODY_MAX),
  tag: z.string().min(1).max(COMMUNITY_TAG_MAX),
});

/** An absolute vote, never a toggle: a retry or a double click lands the same. */
export const voteCommunityPostRequestSchema = z.object({
  postId: z.string().min(1).max(64),
  value: communityVoteSchema,
});

export type Vote = (typeof COMMUNITY_VOTES)[number];
export type CommunitySort = (typeof COMMUNITY_SORTS)[number];
export type CommunityMembership = (typeof COMMUNITY_MEMBERSHIPS)[number];
export type CommunityPostSort = (typeof COMMUNITY_POST_SORTS)[number];
export type CommunityPostScope = (typeof COMMUNITY_POST_SCOPES)[number];
export type Community = z.infer<typeof communitySchema>;
export type CommunitySummary = z.infer<typeof communitySummarySchema>;
export type CommunityPost = z.infer<typeof communityPostSchema>;
export type CommunityPage = z.infer<typeof communityPageSchema>;
export type CommunityPostPage = z.infer<typeof communityPostPageSchema>;
export type CommunityResponse = z.infer<typeof communityResponseSchema>;
export type CommunityPostResponse = z.infer<typeof communityPostResponseSchema>;
export type CommunityPostVote = z.infer<typeof communityPostVoteSchema>;
export type ListCommunitiesRequest = z.infer<typeof listCommunitiesRequestSchema>;
export type CommunitySlugRequest = z.infer<typeof communitySlugRequestSchema>;
export type ListCommunityPostsRequest = z.infer<typeof listCommunityPostsRequestSchema>;
export type ListFrontPagePostsRequest = z.infer<typeof listFrontPagePostsRequestSchema>;
export type CreateCommunityPostRequest = z.infer<typeof createCommunityPostRequestSchema>;
export type VoteCommunityPostRequest = z.infer<typeof voteCommunityPostRequestSchema>;

/* -- showcase -- */

export const PROJECT_SORTS = ['trending', 'newest', 'stars'] as const;
/** The server's closed set: a project's cover is one of these, nothing else. */
export const PROJECT_EMOJIS = ['🚀', '🧩', '🗺️', '🧾', '🤖', '🎨', '📱', '🛠️', '📚', '🎮'] as const;
export const PROJECT_NAME_MAX = 60;
export const PROJECT_TAGLINE_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_TECH_MAX = 6;
export const PROJECT_TECH_NAME_MAX = 24;
export const PROJECT_URL_MAX = 2048;
export const PROJECT_TECH_LIMIT_MAX = 20;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A project link is rendered as an `href`, so it is held to https here too,
 * not only on submit: a `javascript:` or `data:` value that reached the list
 * some other way reads as no link at all (A05).
 */
const projectLinkSchema = z
  .string()
  .max(PROJECT_URL_MAX)
  .nullish()
  .transform((value) =>
    value === null || value === undefined || !isHttpsUrl(value) ? undefined : value,
  );

export const projectSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  tagline: optionalText(500).transform((value) => value ?? ''),
  description: optionalText(PROJECT_DESCRIPTION_MAX * 2).transform((value) => value ?? ''),
  emoji: optionalText(32).transform((value) => value ?? ''),
  tech: textList(64, 20),
  author: authorSchema,
  repoUrl: projectLinkSchema,
  liveUrl: projectLinkSchema,
  /** Null when the repo is not on GitHub, absent, or not checked yet. */
  starCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
  likeCount: nonNegativeCount,
  viewCount: nonNegativeCount,
  createdAt: timestamp,
  isLiked: flag,
  isFeatured: flag,
  isOwner: flag,
});

export const projectPageSchema = lenientPageOf(projectSchema);
export const projectResponseSchema = z.object({ project: projectSchema });

export const projectLikeSchema = z.object({
  id: z.string().min(1).max(64),
  likeCount: z.number().int().nonnegative(),
  isLiked: z.boolean(),
});

export const techCountSchema = z.object({
  name: z.string().min(1).max(64),
  projectCount: nonNegativeCount,
});

/** The wire answer is a bare array; this reads it row by row in the main process. */
export const techCountRowsSchema = rowsOf(techCountSchema, PROJECT_TECH_LIMIT_MAX);
/** What crosses to the renderer: the rows, wrapped. */
export const techCountListSchema = z.object({
  items: z.array(techCountSchema).max(PROJECT_TECH_LIMIT_MAX),
});

export const listProjectsRequestSchema = z.object({
  sort: z.enum(PROJECT_SORTS),
  /** Exact tech name, case-insensitive. */
  tech: z.string().trim().min(1).max(PROJECT_TECH_NAME_MAX).optional(),
  featured: z.boolean().optional(),
  page: pageNumber,
  size: pageSize,
});

export const listProjectTechRequestSchema = z.object({
  limit: z.number().int().min(1).max(PROJECT_TECH_LIMIT_MAX),
});

export const projectIdRequestSchema = z.object({
  projectId: z.string().min(1).max(64),
});

const projectUrlRequestSchema = z
  .url({ protocol: /^https$/ })
  .max(PROJECT_URL_MAX)
  .optional();

export const publishProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX),
  tagline: z.string().trim().min(1).max(PROJECT_TAGLINE_MAX),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX),
  emoji: z.enum(PROJECT_EMOJIS),
  tech: z.array(z.string().trim().min(1).max(PROJECT_TECH_NAME_MAX)).max(PROJECT_TECH_MAX),
  repoUrl: projectUrlRequestSchema,
  liveUrl: projectUrlRequestSchema,
});

export type ProjectSort = (typeof PROJECT_SORTS)[number];
export type ProjectEmoji = (typeof PROJECT_EMOJIS)[number];
export type Project = z.infer<typeof projectSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ProjectLike = z.infer<typeof projectLikeSchema>;
export type TechCount = z.infer<typeof techCountSchema>;
export type TechCountList = z.infer<typeof techCountListSchema>;
export type ListProjectsRequest = z.infer<typeof listProjectsRequestSchema>;
export type ListProjectTechRequest = z.infer<typeof listProjectTechRequestSchema>;
export type ProjectIdRequest = z.infer<typeof projectIdRequestSchema>;
export type PublishProjectRequest = z.infer<typeof publishProjectRequestSchema>;

/* -- feedback & safety -- */

/**
 * Feature feedback, post reports, mutes and hidden posts.
 *
 * The caller is always the token's owner upstream, so no request here carries
 * a user id of its own — only the id of the thing acted on (OWASP A01). Report
 * reasons and feedback features are the server's closed allowlists, held as
 * enums in both directions; free text is length-capped to the server's own
 * limits (A05/A06).
 */
export const FEEDBACK_FEATURE_IDS = [
  'messages',
  'stories',
  'communities',
  'showcase',
  'compact-mode',
  'in-app-updates',
  'other',
] as const;
export const FEEDBACK_NOTE_MAX = 500;
export const FEEDBACK_DIAGNOSTIC_MAX = 32;

export const REPORT_REASON_IDS = [
  'SPAM',
  'HARASSMENT',
  'HATE',
  'VIOLENCE',
  'SEXUAL',
  'MISINFORMATION',
  'OTHER',
] as const;
export const REPORT_STATUSES = ['UNDER_REVIEW', 'ACTION_TAKEN', 'NO_VIOLATION'] as const;
export const REPORT_DETAILS_MAX = 300;

/** The server caps every page here at 50. */
export const SAFETY_PAGE_SIZE_MAX = 50;

const safetyId = z.string().min(1).max(64);

export const feedbackSchema = z.object({
  id: safetyId,
  featureId: z.enum(FEEDBACK_FEATURE_IDS),
  rating: z.number().int().min(1).max(5),
  note: optionalText(FEEDBACK_NOTE_MAX).transform((value) => value ?? ''),
  createdAt: timestamp,
});

export const feedbackPageSchema = lenientPageOf(feedbackSchema);
export const feedbackResponseSchema = z.object({ feedback: feedbackSchema });

export const submitFeedbackRequestSchema = z.object({
  featureId: z.enum(FEEDBACK_FEATURE_IDS),
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(FEEDBACK_NOTE_MAX),
  /** App version and OS only — never messages, contacts or tokens. */
  diagnostics: z
    .object({
      appVersion: z.string().max(FEEDBACK_DIAGNOSTIC_MAX),
      platform: z.string().max(FEEDBACK_DIAGNOSTIC_MAX),
    })
    .nullable(),
});

export const postReportSchema = z.object({
  id: safetyId,
  /** Null once the post has been deleted. */
  postId: optionalText(64).transform((value) => value ?? null),
  reason: z.enum(REPORT_REASON_IDS),
  status: z.enum(REPORT_STATUSES),
  createdAt: timestamp,
  resolvedAt: optionalText(64).transform((value) => value ?? null),
  /** Taken when the report was made, so it stays readable after a hide or delete. */
  post: z
    .object({
      authorName: optionalText(200).transform((value) => value ?? null),
      excerpt: optionalText(500).transform((value) => value ?? null),
    })
    .nullish()
    .transform((value) => value ?? null),
});

export const postReportPageSchema = lenientPageOf(postReportSchema);
export const postReportResponseSchema = z.object({ report: postReportSchema });

export const submitReportRequestSchema = z.object({
  postId: safetyId,
  reason: z.enum(REPORT_REASON_IDS),
  details: z.string().trim().max(REPORT_DETAILS_MAX),
});

export const mutedUserSchema = z.object({
  user: authorSchema,
  since: timestamp,
});

export const mutedUserPageSchema = lenientPageOf(mutedUserSchema);

export const safetyPageRequestSchema = z.object({
  page: pageNumber,
  size: z.number().int().min(1).max(SAFETY_PAGE_SIZE_MAX),
});

export const muteUserRequestSchema = z.object({ userId: safetyId });

export type FeedbackFeatureId = (typeof FEEDBACK_FEATURE_IDS)[number];
export type ReportReason = (typeof REPORT_REASON_IDS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type Feedback = z.infer<typeof feedbackSchema>;
export type FeedbackPage = z.infer<typeof feedbackPageSchema>;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
export type SubmitFeedbackRequest = z.infer<typeof submitFeedbackRequestSchema>;
export type PostReport = z.infer<typeof postReportSchema>;
export type PostReportPage = z.infer<typeof postReportPageSchema>;
export type PostReportResponse = z.infer<typeof postReportResponseSchema>;
export type SubmitReportRequest = z.infer<typeof submitReportRequestSchema>;
export type MutedUser = z.infer<typeof mutedUserSchema>;
export type MutedUserPage = z.infer<typeof mutedUserPageSchema>;
export type SafetyPageRequest = z.infer<typeof safetyPageRequestSchema>;
export type MuteUserRequest = z.infer<typeof muteUserRequestSchema>;

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
});

/* -- app updates -- */

/**
 * How this install can be updated, decided in the main process from how it
 * was installed:
 *   - `installer` — the Windows .exe (NSIS) install, a Linux AppImage, or a
 *     Linux deb/rpm/pacman package: checks, downloads and installs in place;
 *   - `store` — the Microsoft Store package: the Store owns it and its files
 *     are read-only, so the app only says a newer version exists;
 *   - `notify` — every other packaged install (macOS, an unpacked Linux
 *     tarball): told, not updated, from here;
 *   - `unavailable` — a development or unpackaged run.
 */
export const UPDATE_MODES = ['installer', 'store', 'notify', 'unavailable'] as const;

export const UPDATE_STATUSES = [
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready',
  'installing',
  'error',
] as const;

export const updateStateSchema = z.object({
  mode: z.enum(UPDATE_MODES),
  status: z.enum(UPDATE_STATUSES),
  currentVersion: z.string().max(64),
  /** The newer version, once one is known. */
  latestVersion: z.string().max(64).nullable(),
  /** 0–100 while downloading. */
  progress: z.number().min(0).max(100).nullable(),
  /** Operator-safe text for the `error` status. */
  error: z.string().max(300).nullable(),
  /**
   * Installing will show the system's password prompt (a Linux package is
   * installed as root through pkexec); the UI says so before the click.
   */
  asksForPassword: z.boolean(),
  /** Whether a check runs at launch and every few hours. */
  autoCheck: z.boolean(),
  /** When the last check finished, epoch ms. */
  checkedAt: z.number().int().nonnegative().nullable(),
});

export const setAutoCheckRequestSchema = z.object({ enabled: z.boolean() });

/** Pushed from the main process whenever the update state changes. */
export const updateEventSchema = z.object({ event: z.literal('state'), data: updateStateSchema });

export type UpdateMode = (typeof UPDATE_MODES)[number];
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];
export type UpdateState = z.infer<typeof updateStateSchema>;
export type SetAutoCheckRequest = z.infer<typeof setAutoCheckRequestSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;

export const windowStateSchema = z.object({
  isMaximized: z.boolean(),
  isFullScreen: z.boolean(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResendOtpRequest = z.infer<typeof resendOtpRequestSchema>;
export type VerifyResetOtpRequest = z.infer<typeof verifyResetOtpRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type ChangePasswordOtpRequest = z.infer<typeof changePasswordOtpRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
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
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];
export type StageImagesResponse = z.infer<typeof stageImagesResponseSchema>;
export type DiscardImagesRequest = z.infer<typeof discardImagesRequestSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type SaveState = z.infer<typeof saveStateSchema>;
export type SavedPostsRequest = z.infer<typeof savedPostsRequestSchema>;
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
    requestChangePasswordCode(
      request: ChangePasswordOtpRequest,
    ): Promise<IpcResult<AcknowledgedResponse>>;
    changePassword(request: ChangePasswordRequest): Promise<IpcResult<AcknowledgedResponse>>;
    listAccounts(): Promise<IpcResult<AccountListResponse>>;
    switchAccount(request: AccountIdRequest): Promise<IpcResult<SessionResponse>>;
    forgetAccount(request: AccountIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
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
    /** Saves the post if it is not saved, removes the save if it is. */
    toggleSave(request: PostIdRequest): Promise<IpcResult<SaveState>>;
    listSaved(request: SavedPostsRequest): Promise<IpcResult<UserPostsResponse>>;
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
    update(request: UpdateProfileRequest): Promise<IpcResult<ProfileResponse>>;
    searchUsers(request: SearchUsersRequest): Promise<IpcResult<FriendEntryPage>>;
  };
  readonly chat: {
    listConversations(request: ListConversationsRequest): Promise<IpcResult<ConversationPage>>;
    createConversation(
      request: CreateConversationRequest,
    ): Promise<IpcResult<ConversationResponse>>;
    getConversation(request: ConversationIdRequest): Promise<IpcResult<ConversationResponse>>;
    listMessages(request: ListMessagesRequest): Promise<IpcResult<MessagePage>>;
    sendMessage(request: SendChatMessageRequest): Promise<IpcResult<ChatMessageResponse>>;
    editMessage(request: EditChatMessageRequest): Promise<IpcResult<ChatMessageResponse>>;
    deleteMessage(request: ChatMessageRef): Promise<IpcResult<DeletedResponse>>;
    react(request: ReactChatMessageRequest): Promise<IpcResult<MessageReactions>>;
    unreact(request: ChatMessageRef): Promise<IpcResult<MessageReactions>>;
    markRead(request: MarkReadRequest): Promise<IpcResult<AcknowledgedResponse>>;
    typing(request: TypingRequest): Promise<IpcResult<AcknowledgedResponse>>;
    socketState(): Promise<IpcResult<ChatSocketState>>;
    attachFiles(request: AttachChatFilesRequest): Promise<IpcResult<AttachChatFilesResponse>>;
    uploadLocalFiles(request: UploadLocalFilesRequest): Promise<IpcResult<AttachChatFilesResponse>>;
    getAttachment(request: AttachmentIdRequest): Promise<IpcResult<AttachmentResponse>>;
    saveAttachment(request: AttachmentIdRequest): Promise<IpcResult<SavedFileResponse>>;
    renameGroup(request: RenameGroupRequest): Promise<IpcResult<GroupRecordResponse>>;
    setGroupPhoto(request: ConversationIdRequest): Promise<IpcResult<GroupRecordResponse>>;
    removeGroupPhoto(request: ConversationIdRequest): Promise<IpcResult<GroupRecordResponse>>;
    addMembers(request: AddGroupMembersRequest): Promise<IpcResult<GroupParticipants>>;
    removeMember(request: GroupMemberRequest): Promise<IpcResult<AcknowledgedResponse>>;
    changeRole(request: ChangeMemberRoleRequest): Promise<IpcResult<GroupParticipants>>;
    leaveGroup(request: ConversationIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
    invite(request: GroupMemberRequest): Promise<IpcResult<GroupInviteResult>>;
    acceptInvite(request: InviteIdRequest): Promise<IpcResult<ConversationResponse>>;
    declineInvite(request: InviteIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
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
  readonly communities: {
    list(request: ListCommunitiesRequest): Promise<IpcResult<CommunityPage>>;
    get(request: CommunitySlugRequest): Promise<IpcResult<CommunityResponse>>;
    join(request: CommunitySlugRequest): Promise<IpcResult<CommunityResponse>>;
    leave(request: CommunitySlugRequest): Promise<IpcResult<CommunityResponse>>;
    listPosts(request: ListCommunityPostsRequest): Promise<IpcResult<CommunityPostPage>>;
    frontPage(request: ListFrontPagePostsRequest): Promise<IpcResult<CommunityPostPage>>;
    createPost(request: CreateCommunityPostRequest): Promise<IpcResult<CommunityPostResponse>>;
    vote(request: VoteCommunityPostRequest): Promise<IpcResult<CommunityPostVote>>;
  };
  readonly showcase: {
    list(request: ListProjectsRequest): Promise<IpcResult<ProjectPage>>;
    tech(request: ListProjectTechRequest): Promise<IpcResult<TechCountList>>;
    get(request: ProjectIdRequest): Promise<IpcResult<ProjectResponse>>;
    recordView(request: ProjectIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
    publish(request: PublishProjectRequest): Promise<IpcResult<ProjectResponse>>;
    like(request: ProjectIdRequest): Promise<IpcResult<ProjectLike>>;
    unlike(request: ProjectIdRequest): Promise<IpcResult<ProjectLike>>;
  };
  readonly feedback: {
    submit(request: SubmitFeedbackRequest): Promise<IpcResult<FeedbackResponse>>;
    listMine(request: SafetyPageRequest): Promise<IpcResult<FeedbackPage>>;
  };
  readonly safety: {
    report(request: SubmitReportRequest): Promise<IpcResult<PostReportResponse>>;
    listMyReports(request: SafetyPageRequest): Promise<IpcResult<PostReportPage>>;
    mute(request: MuteUserRequest): Promise<IpcResult<AcknowledgedResponse>>;
    unmute(request: MuteUserRequest): Promise<IpcResult<AcknowledgedResponse>>;
    listMuted(request: SafetyPageRequest): Promise<IpcResult<MutedUserPage>>;
    hidePost(request: PostIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
    unhidePost(request: PostIdRequest): Promise<IpcResult<AcknowledgedResponse>>;
  };
  readonly links: {
    preview(request: LinkPreviewRequest): Promise<IpcResult<LinkPreviewResponse>>;
  };
  readonly files: {
    exportPosts(request: ExportPostsRequest): Promise<IpcResult<ExportPostsResponse>>;
    readAppInfo(): Promise<IpcResult<AppInfoResponse>>;
  };
  readonly updates: {
    state(): Promise<IpcResult<UpdateState>>;
    check(): Promise<IpcResult<UpdateState>>;
    /** Downloads, verifies, installs and restarts; answers only if it stopped. */
    updateNow(): Promise<IpcResult<UpdateState>>;
    /** Restarts into the downloaded update; answers only if it could not. */
    install(): Promise<IpcResult<UpdateState>>;
    setAutoCheck(request: SetAutoCheckRequest): Promise<IpcResult<UpdateState>>;
    /** Opens the newer version's release notes in the browser. */
    openReleaseNotes(): Promise<IpcResult<AcknowledgedResponse>>;
    /** Subscribes to state pushes; the listener parses against `updateEventSchema`. */
    onEvent(listener: (event: unknown) => void): () => void;
  };
  readonly window: {
    minimize(): Promise<IpcResult<WindowState>>;
    toggleMaximize(): Promise<IpcResult<WindowState>>;
    close(): Promise<IpcResult<WindowState>>;
    getState(): Promise<IpcResult<WindowState>>;
  };
}
