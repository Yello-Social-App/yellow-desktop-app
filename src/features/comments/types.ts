/**
 * Comment shapes.
 *
 * The records come from the API (see @shared/ipc-types); what lives here is the
 * composer contract and the two directions of the reply tree. The list
 * endpoint nests each comment's replies under it; the store holds the thread
 * flat, because every mutation — add, delete, react — is a lookup by id, and
 * a flat list makes each of those one `find`. `toThread` puts the nesting back
 * for display.
 */
import { COMMENT_MAX_LENGTH, type Comment, type ThreadComment } from '@shared/ipc-types';
import { z } from 'zod';

export const COMMENTS_PAGE_SIZE = 20;

export const composeCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(COMMENT_MAX_LENGTH, `Keep it under ${String(COMMENT_MAX_LENGTH)} characters.`),
  /** Set to reply to an existing comment rather than to the post itself. */
  parentCommentId: z.string().min(1).max(64).optional(),
});

export type ComposeCommentInput = z.infer<typeof composeCommentSchema>;

/** A top-level comment with the replies that pointed at it. */
export interface CommentNode {
  comment: Comment;
  replies: Comment[];
}

function isReply(comment: Comment): boolean {
  return comment.parentCommentId !== undefined;
}

/**
 * Where a reply to `target` attaches. Replies are one level deep server-side
 * ("Replies are only one level deep"), so answering a reply joins the same
 * thread under its parent rather than starting a deeper one.
 */
export function replyRootOf(target: Comment | null): string | undefined {
  if (target === null) {
    return undefined;
  }
  return target.parentCommentId ?? target.id;
}

/** A page as the server sends it, flattened: each parent, then its replies. */
export function flattenThread(comments: readonly ThreadComment[]): Comment[] {
  return comments.flatMap(({ replies, ...comment }) => [comment, ...replies]);
}

/**
 * Groups a flat list into one level of nesting, in list order. Replies whose
 * parent is not in the list are kept as roots rather than dropped, so a row
 * the server sent is never lost to a shape it did not expect (A10).
 */
export function toThread(comments: readonly Comment[]): CommentNode[] {
  const roots = new Map<string, CommentNode>();

  for (const comment of comments) {
    if (!isReply(comment)) {
      roots.set(comment.id, { comment, replies: [] });
    }
  }

  const orphans: CommentNode[] = [];

  for (const comment of comments) {
    if (!isReply(comment)) {
      continue;
    }
    const parent = roots.get(comment.parentCommentId ?? '');
    if (parent === undefined) {
      orphans.push({ comment, replies: [] });
    } else {
      parent.replies.push(comment);
    }
  }

  return [...roots.values(), ...orphans];
}

/** Whether the signed-in user may delete this comment. */
export function canDelete(
  comment: Comment,
  viewerId: string | undefined,
  postAuthorId: string,
): boolean {
  if (viewerId === undefined) {
    return false;
  }
  // The server permits the comment's author and the post's author; mirroring
  // that here only decides whether to *show* the control — the check that
  // matters is the server's (A01).
  return comment.author.id === viewerId || postAuthorId === viewerId;
}

export { COMMENT_MAX_LENGTH };
export type { Comment };
