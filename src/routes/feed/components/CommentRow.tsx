import { Check, Pencil, Reply, Trash2, X } from 'lucide-react';
import { memo, useState } from 'react';
import { Link } from 'react-router-dom';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { COMMENT_MAX_LENGTH, type Comment } from '@/features/comments/types';
import type { ReactionType } from '@shared/ipc-types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf } from '@/lib/user-display';

import { ReactionButton } from './ReactionButton';

interface CommentRowProps {
  comment: Comment;
  /** Draws the vertical line from this row's avatar down to its replies. */
  hasReplies?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isPending: boolean;
  onReply: (commentId: string) => void;
  onToggleReaction: (commentId: string, type?: ReactionType) => void;
  onEdit: (commentId: string, content: string) => Promise<boolean>;
  onDelete: (commentId: string) => void;
}

const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold transition-tone disabled:opacity-40';

export const CommentRow = memo(function CommentRow({
  comment,
  hasReplies = false,
  canEdit,
  canDelete,
  isPending,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: CommentRowProps) {
  const author = displayName(comment.author);
  const [draft, setDraft] = useState<string | null>(null);
  const isEditing = draft !== null;
  const [firstLink] = extractLinks(comment.content);

  const save = (): void => {
    if (draft === null) {
      return;
    }
    const content = draft.trim();
    if (content === '' || content === comment.content) {
      setDraft(null);
      return;
    }
    void onEdit(comment.id, content).then((saved) => {
      if (saved) {
        setDraft(null);
      }
    });
  };

  return (
    <article className="gap-sm animate-fade-up flex">
      {/* The avatar column: the avatar, then — when replies hang off this
          comment — a line that runs the rest of the row's height, so the
          branch into each reply below has something to come off. */}
      <div className="flex shrink-0 flex-col items-center">
        <Link to={`/users/${comment.author.id}`} className="shrink-0">
          <UserAvatar user={comment.author} size="sm" />
        </Link>
        {hasReplies && <span aria-hidden className="bg-outline-variant mt-1 w-px flex-1" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
          <Link
            to={`/users/${comment.author.id}`}
            className="text-on-surface text-[14px] font-bold hover:underline"
          >
            {author}
          </Link>
          <span className="text-on-surface-variant">{handleOf(comment.author)}</span>
          <span aria-hidden className="text-on-surface-variant">
            ·
          </span>
          <span className="text-on-surface-variant">{relativeTime(comment.createdAt)}</span>
        </div>

        {isEditing ? (
          <div className="mt-1 flex flex-col gap-2">
            <label className="sr-only" htmlFor={`edit-comment-${comment.id}`}>
              Edit comment
            </label>
            <textarea
              id={`edit-comment-${comment.id}`}
              value={draft}
              rows={2}
              maxLength={COMMENT_MAX_LENGTH}
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setDraft(null);
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save();
                }
              }}
              className="bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 text-on-surface w-full resize-none rounded-xl border px-3 py-2 text-[14px] focus:ring-2 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<X className="size-3.5" />}
                disabled={isPending}
                onClick={() => {
                  setDraft(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                leadingIcon={<Check className="size-3.5" />}
                isLoading={isPending}
                disabled={draft.trim() === ''}
                onClick={save}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-on-surface text-content-sm mt-0.5 leading-relaxed whitespace-pre-wrap">
              <RichText text={comment.content} />
            </p>
            {firstLink !== undefined && (
              <div className="max-w-dialog-md mt-2">
                <LinkPreviewCard url={firstLink} size="sm" />
              </div>
            )}
          </>
        )}

        {!isEditing && (
          <div className="mt-0.5 -ml-2 flex items-center gap-0.5">
            <ReactionButton
              size="sm"
              current={comment.viewerReaction}
              count={comment.reactionCount}
              disabled={isPending}
              onReact={(type) => {
                onToggleReaction(comment.id, type);
              }}
            />

            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                onReply(comment.id);
              }}
              className={cn(
                ACTION_CLASS,
                'text-on-surface-variant hover:bg-primary-fixed hover:text-primary',
              )}
            >
              <Reply aria-hidden className="size-3.5" />
              Reply
            </button>

            {canEdit && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setDraft(comment.content);
                }}
                className={cn(
                  ACTION_CLASS,
                  'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                )}
              >
                <Pencil aria-hidden className="size-3.5" />
                Edit
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  onDelete(comment.id);
                }}
                className={cn(
                  ACTION_CLASS,
                  'text-on-surface-variant hover:bg-error-container hover:text-on-error-container',
                )}
              >
                <Trash2 aria-hidden className="size-3.5" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
