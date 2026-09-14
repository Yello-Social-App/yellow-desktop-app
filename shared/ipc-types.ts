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
 * Domain — mirrors the Yello API (openapi 3.1, /v3/api-docs)
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

export const FRIENDSHIP_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED'] as const;

export const friendshipSchema = z.object({
  id: z.string().min(1).max(64),
  /** Always the other party, never the caller — the same shape works both ways. */
  user: authorSchema,
  status: z
    .string()
    .max(32)
    .nullish()
    .transform((value) => value ?? 'PENDING'),
  createdAt: timestamp,
  respondedAt: optionalText(64),
});

export const NOTIFICATION_TYPES = [
  'FRIEND_REQUEST',
  'FRIEND_ACCEPTED',
  'COMMENT',
  'REPOST',
] as const;

export const notificationSchema = z.object({
  id: z.string().min(1).max(64),
  /**
   * Held as text rather than an enum on purpose: a type the server adds later
   * must not make the whole list unparseable (A10). Compare against
   * NOTIFICATION_TYPES and fall through to a generic row.
   */
  type: z.string().min(1).max(64),
  /** Null only for system-raised notifications. */
  actor: authorSchema.nullish(),
  /** A friendship, comment or post id, depending on `type`. */
  targetId: optionalText(64),
  read: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  readAt: optionalText(64),
  createdAt: timestamp,
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
export type Friendship = z.infer<typeof friendshipSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
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

export const shareLinkResponseSchema = z.object({ url: z.string().max(2048) });

/**
 * Copying is done in the main process, from a URL the *server* returned for a
 * post id — the renderer never supplies the text that lands on the clipboard,
 * so a compromised renderer cannot plant arbitrary content there (A01). It also
 * sidesteps the default-deny permission policy, which refuses clipboard access
 * to the page.
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

export const FRIEND_STATUSES = [
  'SELF',
  'FRIENDS',
  'REQUEST_SENT',
  'REQUEST_RECEIVED',
  'NONE',
] as const;

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

/* -- friends -- */

export const pageRequestSchema = z.object({
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

/** Addressed by the other user's id: send, and unfriend. */
export const friendUserRequestSchema = z.object({
  userId: z.string().min(1).max(64),
});

/** Addressed by the friendship id from the requests list: accept, and decline. */
export const friendshipIdRequestSchema = z.object({
  friendshipId: z.string().min(1).max(64),
});

export const friendshipResponseSchema = z.object({ friendship: friendshipSchema });

export const friendshipPageSchema = pageOf(friendshipSchema);

/* -- notifications -- */

export const listNotificationsRequestSchema = z.object({
  unreadOnly: z.boolean(),
  page: z.number().int().min(0).max(1000),
  size: z.number().int().min(1).max(50),
});

export const notificationPageSchema = pageOf(notificationSchema);

export const notificationIdRequestSchema = z.object({
  notificationId: z.string().min(1).max(64),
});

export const notificationResponseSchema = z.object({ notification: notificationSchema });

export const unreadCountSchema = z.object({
  unread: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? 0),
});

/* -- profile -- */

export const PROFILE_LIMITS = {
  fullNameMax: 100,
  bioMax: 500,
  usernameMin: 3,
  usernameMax: 32,
} as const;

/** Every field is optional: omit what is not being changed. */
export const updateProfileRequestSchema = z.object({
  fullName: z.string().max(PROFILE_LIMITS.fullNameMax).optional(),
  bio: z.string().max(PROFILE_LIMITS.bioMax).optional(),
  username: z
    .string()
    .min(PROFILE_LIMITS.usernameMin)
    .max(PROFILE_LIMITS.usernameMax)
    .regex(/^[a-zA-Z0-9_.]+$/)
    .optional(),
});

export const profileResponseSchema = z.object({ user: userSchema });

/**
 * A public profile carries no `email` and no `status`; the shared user schema
 * already marks both optional, so one type covers both reads.
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
 * Avatar change is two steps so the user can preview before committing. The
 * file is chosen through the OS dialog and staged in the main process; the
 * renderer receives only an opaque token and a `data:` URL to preview, never a
 * path (OWASP A01). `commit` uploads the staged bytes for that token.
 */
export const avatarPickResponseSchema = z.object({
  /** Opaque handle to the staged file; null when the picker was cancelled. */
  token: z.string().min(1).max(64).nullable(),
  /** A `data:` URL previewing the choice; null when cancelled. */
  previewDataUrl: z.string().max(10_000_000).nullable(),
  cancelled: z.boolean(),
});

export const avatarCommitRequestSchema = z.object({
  token: z.string().min(1).max(64),
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UserPostsRequest = z.infer<typeof userPostsRequestSchema>;
export type UserPostsResponse = z.infer<typeof userPostsResponseSchema>;
export type AvatarPickResponse = z.infer<typeof avatarPickResponseSchema>;
export type AvatarCommitRequest = z.infer<typeof avatarCommitRequestSchema>;

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
export type ShareLinkResponse = z.infer<typeof shareLinkResponseSchema>;
export type ShareLinkCopiedResponse = z.infer<typeof shareLinkCopiedResponseSchema>;
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;
export type ReactionTargetType = z.infer<typeof reactionTargetTypeSchema>;
export type ReactionTargetRequest = z.infer<typeof reactionTargetRequestSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type CommentResponse = z.infer<typeof commentResponseSchema>;
export type ListCommentsRequest = z.infer<typeof listCommentsRequestSchema>;
export type CommentPage = Page<ThreadComment>;
export type DeleteCommentRequest = z.infer<typeof deleteCommentRequestSchema>;
export type PageRequest = z.infer<typeof pageRequestSchema>;
export type FriendUserRequest = z.infer<typeof friendUserRequestSchema>;
export type FriendshipIdRequest = z.infer<typeof friendshipIdRequestSchema>;
export type FriendshipResponse = z.infer<typeof friendshipResponseSchema>;
export type FriendshipPage = Page<Friendship>;
export type ListNotificationsRequest = z.infer<typeof listNotificationsRequestSchema>;
export type NotificationPage = Page<Notification>;
export type NotificationIdRequest = z.infer<typeof notificationIdRequestSchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
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
export type FriendStatus = (typeof FRIEND_STATUSES)[number];
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
    shareLink(request: PostIdRequest): Promise<IpcResult<ShareLinkResponse>>;
    copyShareLink(request: PostIdRequest): Promise<IpcResult<ShareLinkCopiedResponse>>;
  };
  readonly comments: {
    create(request: CreateCommentRequest): Promise<IpcResult<CommentResponse>>;
    list(request: ListCommentsRequest): Promise<IpcResult<CommentPage>>;
    remove(request: DeleteCommentRequest): Promise<IpcResult<DeletedResponse>>;
  };
  readonly reactions: {
    toggle(request: ToggleReactionRequest): Promise<IpcResult<ReactionSummary>>;
    summary(request: ReactionTargetRequest): Promise<IpcResult<ReactionSummary>>;
    list(request: ListReactorsRequest): Promise<IpcResult<ReactorPage>>;
  };
  readonly friends: {
    list(request: PageRequest): Promise<IpcResult<FriendshipPage>>;
    pendingRequests(request: PageRequest): Promise<IpcResult<FriendshipPage>>;
    sendRequest(request: FriendUserRequest): Promise<IpcResult<FriendshipResponse>>;
    accept(request: FriendshipIdRequest): Promise<IpcResult<FriendshipResponse>>;
    decline(request: FriendshipIdRequest): Promise<IpcResult<FriendshipResponse>>;
    remove(request: FriendUserRequest): Promise<IpcResult<DeletedResponse>>;
  };
  readonly notifications: {
    list(request: ListNotificationsRequest): Promise<IpcResult<NotificationPage>>;
    unreadCount(): Promise<IpcResult<UnreadCount>>;
    markRead(request: NotificationIdRequest): Promise<IpcResult<NotificationResponse>>;
    markAllRead(): Promise<IpcResult<UnreadCount>>;
  };
  readonly profile: {
    update(request: UpdateProfileRequest): Promise<IpcResult<ProfileResponse>>;
    pickAvatar(): Promise<IpcResult<AvatarPickResponse>>;
    commitAvatar(request: AvatarCommitRequest): Promise<IpcResult<ProfileResponse>>;
    listPosts(request: UserPostsRequest): Promise<IpcResult<UserPostsResponse>>;
    getUser(request: PublicUserRequest): Promise<IpcResult<ProfileResponse>>;
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
