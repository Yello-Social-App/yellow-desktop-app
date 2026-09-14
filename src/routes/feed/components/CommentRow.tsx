import { Heart, Reply, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import type { Comment } from '@/features/comments/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

interface CommentRowProps {
  comment: Comment;
  /** Draws the vertical line from this row's avatar down to its replies. */
  hasReplies?: boolean;
  canDelete: boolean;
  isPending: boolean;
  onReply: (commentId: string) => void;
  onToggleReaction: (commentId: string) => void;
  onDelete: (commentId: string) => void;
}

const ACTION_CLASS =
  'font-small text-small gap-xs inline-flex items-center rounded-md px-1.5 py-0.5 transition-tone disabled:opacity-40';

export const CommentRow = memo(function CommentRow({
  comment,
  hasReplies = false,
  canDelete,
  isPending,
  onReply,
  onToggleReaction,
  onDelete,
}: CommentRowProps) {
  const author = displayName(comment.author);
  const hasReacted = comment.viewerReaction !== null && comment.viewerReaction !== undefined;

  return (
    <article className="gap-sm animate-fade-up flex">
      {/* The avatar column: the avatar, then — when replies hang off this
          comment — a line that runs the rest of the row's height, so the
          branch into each reply below has something to come off. */}
      <div className="flex shrink-0 flex-col items-center">
        <Link to={`/users/${comment.author.id}`} className="shrink-0">
          <Avatar
            initials={initialsOf(comment.author)}
            name={author}
            imageUrl={comment.author.avatarUrl}
            size="sm"
          />
        </Link>
        {hasReplies && <span aria-hidden className="bg-outline-variant mt-1 w-px flex-1" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="bg-surface-container-low px-md py-sm rounded-xl">
          <div className="gap-xs flex flex-wrap items-baseline">
            <Link
              to={`/users/${comment.author.id}`}
              className="font-label text-label text-on-surface hover:text-primary transition-tone"
            >
              {author}
            </Link>
            <span className="font-small text-small text-on-surface-variant">
              {handleOf(comment.author)}
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface whitespace-pre-wrap">
            {comment.content}
          </p>
        </div>

        <div className="gap-sm mt-1 flex items-center">
          <button
            type="button"
            aria-pressed={hasReacted}
            disabled={isPending}
            onClick={() => {
              onToggleReaction(comment.id);
            }}
            className={cn(
              ACTION_CLASS,
              hasReacted
                ? 'text-secondary'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
            )}
          >
            <Heart aria-hidden className={cn('size-3.5', hasReacted && 'fill-current')} />
            {comment.reactionCount > 0 ? comment.reactionCount : 'Like'}
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              onReply(comment.id);
            }}
            className={cn(
              ACTION_CLASS,
              'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
            )}
          >
            <Reply aria-hidden className="size-3.5" />
            Reply
          </button>

          {canDelete && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                onDelete(comment.id);
              }}
              className={cn(ACTION_CLASS, 'text-on-surface-variant hover:text-error')}
            >
              <Trash2 aria-hidden className="size-3.5" />
              Delete
            </button>
          )}

          <span className="font-small text-small text-on-surface-variant ml-auto">
            {relativeTime(comment.createdAt)}
          </span>
        </div>
      </div>
    </article>
  );
});
