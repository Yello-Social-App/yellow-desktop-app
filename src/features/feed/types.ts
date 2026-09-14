/**
 * Feed shapes.
 *
 * Posts come from the API (see @shared/ipc-types); what lives here is the
 * composer contract and the reaction the UI treats as "like".
 */
import {
  postVisibilitySchema,
  type Post,
  type PostVisibility,
  type ReactionType,
} from '@shared/ipc-types';
import { z } from 'zod';

export const POST_MAX_LENGTH = 5000;
export const FEED_PAGE_SIZE = 20;
export const COMMENT_PAGE_SIZE = 20;
export const REACTORS_PAGE_SIZE = 20;

/** The heart button maps to one reaction type; the API supports six. */
export const PRIMARY_REACTION: ReactionType = 'LIKE';

/** How each of the six reaction types reads on screen. */
export const REACTION_LABELS: Record<ReactionType, { emoji: string; label: string }> = {
  LIKE: { emoji: '👍', label: 'Like' },
  LOVE: { emoji: '❤️', label: 'Love' },
  HAHA: { emoji: '😄', label: 'Haha' },
  WOW: { emoji: '😮', label: 'Wow' },
  SAD: { emoji: '😢', label: 'Sad' },
  ANGRY: { emoji: '😠', label: 'Angry' },
};

/** `reactionCounts` also carries a `total` key, which is not a reaction type. */
const TOTAL_KEY = 'total';

/**
 * Content may be empty only when images are attached, which is the rule the API
 * itself enforces — so the attachment count is part of the draft rather than a
 * separate argument the schema cannot see.
 */
export const composePostSchema = z
  .object({
    content: z
      .string()
      .trim()
      .max(POST_MAX_LENGTH, `Keep it under ${String(POST_MAX_LENGTH)} characters.`),
    /** The composer defaults to PUBLIC; the API also accepts FRIENDS and PRIVATE. */
    visibility: postVisibilitySchema.optional(),
    imageCount: z.number().int().nonnegative().default(0),
  })
  .refine((values) => values.content.length > 0 || values.imageCount > 0, {
    message: 'Write something, or attach a photo.',
    path: ['content'],
  });

export type ComposePostInput = z.infer<typeof composePostSchema>;

export const REPOST_MAX_LENGTH = POST_MAX_LENGTH;

/** How the API's three visibilities are worded, and what each actually does. */
export const VISIBILITY_OPTIONS: readonly {
  value: PostVisibility;
  label: string;
  hint: string;
}[] = [
  { value: 'PUBLIC', label: 'Public', hint: 'Anyone can see this, signed in or not.' },
  { value: 'FRIENDS', label: 'Friends', hint: 'Only people you have accepted as friends.' },
  { value: 'PRIVATE', label: 'Only me', hint: 'Nobody else can open it.' },
];

/** The visibility a post was stored with, defaulted the way the API does. */
export function visibilityOf(post: Post): PostVisibility {
  const parsed = postVisibilitySchema.safeParse(post.visibility);
  return parsed.success ? parsed.data : 'PUBLIC';
}

export function reactionTotal(post: Post): number {
  const explicitTotal = post.reactionCounts[TOTAL_KEY];
  if (typeof explicitTotal === 'number') {
    return explicitTotal;
  }

  return Object.entries(post.reactionCounts)
    .filter(([key]) => key !== TOTAL_KEY)
    .reduce((sum, [, count]) => sum + count, 0);
}

export function viewerHasReacted(post: Post): boolean {
  return post.viewerReaction !== null && post.viewerReaction !== undefined;
}

export type { Post, PostVisibility };
