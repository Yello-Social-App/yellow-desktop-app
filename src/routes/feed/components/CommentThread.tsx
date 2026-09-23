import { SendHorizonal, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCommentActions, useCommentThread } from '@/features/comments/hooks';
import {
  canDelete,
  canEdit,
  composeCommentSchema,
  COMMENT_MAX_LENGTH,
} from '@/features/comments/types';
import { useCommentsStore } from '@/features/comments/store';
import { cn } from '@/lib/cn';
import { handleOf } from '@/lib/user-display';
import type { Post } from '@/features/feed/types';
import { displayName } from '@/lib/user-display';

import { CommentRow } from './CommentRow';

interface CommentThreadProps {
  post: Post;
  /** Carries the +1/-1 back to whichever list holds this post. */
  onCommentCountChange: (postId: string, delta: number) => void;
  /** Keep paging until the whole thread is in — for the post's own page. */
  loadAll?: boolean;
}

/**
 * The thread under one post: the comments, the replies grouped under them, and
 * the box that adds either.
 *
 * `parentCommentId` is what makes a reply a reply — the composer sends it when
 * a row's Reply button has set a target, and omits it otherwise. Every row
 * has a Reply button; answering a reply joins the same thread (the API nests
 * one level) and starts the draft with that person's handle so it is clear
 * who is being answered.
 *
 * The thread line — a trunk down from the parent's avatar, and a branch into
 * each reply — is drawn in CSS on the list: the trunk lives in CommentRow's
 * avatar column, each reply's `li` draws its own branch, and every reply but
 * the last carries the trunk on down to the next.
 */
export function CommentThread({ post, onCommentCountChange, loadAll = false }: CommentThreadProps) {
  const viewer = useCurrentUser();
  const thread = useCommentThread(post.id, true);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleCountChange = useCallback(
    (delta: number) => {
      onCommentCountChange(post.id, delta);
    },
    [onCommentCountChange, post.id],
  );

  const actions = useCommentActions(post.id, handleCountChange);

  const startReply = (commentId: string): void => {
    actions.setReplyTo(commentId);
    // Answering a reply: address them, since the new comment will sit under
    // the thread's root rather than directly beneath theirs.
    const target = useCommentsStore
      .getState()
      .threads[post.id]?.items.find((item) => item.id === commentId);
    if (target?.parentCommentId !== undefined && draft.trim() === '') {
      setDraft(`${handleOf(target.author)} `);
    }
  };

  // One page at a time, each requested once the last has landed, so a long
  // thread streams in rather than blocking on a single huge read.
  const { loadMore } = actions;
  useEffect(() => {
    if (loadAll && thread.status === 'ready' && thread.hasMore && !thread.isLoadingMore) {
      loadMore();
    }
  }, [loadAll, thread.status, thread.hasMore, thread.isLoadingMore, loadMore]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = composeCommentSchema.safeParse({ content: draft });
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'That comment is not valid.');
      return;
    }

    setDraftError(null);
    void actions.submit(parsed.data.content).then((added) => {
      if (added) {
        setDraft('');
      }
    });
  };

  return (
    <section
      aria-label={`Comments on ${displayName(post.author)}'s post`}
      className="border-outline-variant/50 gap-md pt-md animate-expand flex flex-col border-t"
    >
      {thread.status === 'loading' && (
        <div className="py-md flex justify-center">
          <Spinner label="Loading comments…" />
        </div>
      )}

      {thread.status === 'error' && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {thread.error ?? 'The comments could not be loaded.'}
        </p>
      )}

      {thread.status === 'ready' && thread.nodes.length === 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          No comments yet. Write the first one.
        </p>
      )}

      {thread.nodes.length > 0 && (
        <ul className="gap-md flex flex-col">
          {/* Rows animate themselves (CommentRow), so a reply arriving under
              an existing comment fades in on its own. */}
          {thread.nodes.map((node) => (
            <li key={node.comment.id} className="gap-sm flex flex-col">
              <CommentRow
                comment={node.comment}
                hasReplies={node.replies.length > 0}
                canEdit={canEdit(node.comment, viewer?.id)}
                canDelete={canDelete(node.comment, viewer?.id, post.author.id)}
                isPending={thread.pendingIds.has(node.comment.id)}
                onReply={startReply}
                onToggleReaction={actions.toggleReaction}
                onEdit={actions.edit}
                onDelete={(commentId) => {
                  void actions.remove(commentId);
                }}
              />
              {node.replies.length > 0 && (
                // ml-4 puts the list's left edge under the parent avatar's
                // centre (a 32px avatar); pl-6 is the branch's reach.
                <ul className="gap-sm ml-4 flex flex-col pl-6">
                  {node.replies.map((reply, position) => (
                    <li
                      key={reply.id}
                      className={cn(
                        'relative',
                        // The branch: from the trunk, across and down into
                        // this reply's avatar. -top-2 bridges the list gap.
                        'before:border-outline-variant before:absolute before:-top-2 before:-left-6 before:h-6 before:w-6 before:rounded-bl-xl before:border-b before:border-l',
                        // The trunk continues past every reply but the last.
                        position < node.replies.length - 1 &&
                          'after:bg-outline-variant after:absolute after:-top-2 after:-bottom-2 after:-left-6 after:w-px',
                      )}
                    >
                      <CommentRow
                        comment={reply}
                        canEdit={canEdit(reply, viewer?.id)}
                        canDelete={canDelete(reply, viewer?.id, post.author.id)}
                        isPending={thread.pendingIds.has(reply.id)}
                        onReply={startReply}
                        onToggleReaction={actions.toggleReaction}
                        onEdit={actions.edit}
                        onDelete={(commentId) => {
                          void actions.remove(commentId);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {thread.hasMore && loadAll && (
        <div className="py-sm flex justify-center">
          <Spinner label="Loading the rest of the thread…" />
        </div>
      )}

      {thread.hasMore && !loadAll && (
        <Button
          variant="ghost"
          isLoading={thread.isLoadingMore}
          onClick={actions.loadMore}
          className="self-start"
        >
          {thread.isLoadingMore ? 'Loading…' : 'Load more comments'}
        </Button>
      )}

      {thread.replyTo !== null && (
        <p className="bg-surface-container-low font-small text-small text-on-surface-variant gap-sm px-md py-xs flex items-center rounded-lg">
          Replying to {displayName(thread.replyTo.author)}
          {thread.replyTo.parentCommentId !== undefined && ' in this thread'}
          <button
            type="button"
            aria-label="Cancel reply"
            className="hover:text-on-surface ml-auto"
            onClick={() => {
              actions.setReplyTo(null);
            }}
          >
            <X aria-hidden className="size-4" />
          </button>
        </p>
      )}

      <form className="gap-sm flex items-start" onSubmit={handleSubmit}>
        {viewer !== null && <UserAvatar user={viewer} size="sm" />}
        <div className="gap-xs flex min-w-0 flex-1 flex-col">
          <label className="sr-only" htmlFor={`comment-${post.id}`}>
            {thread.replyTo === null ? 'Write a comment' : 'Write a reply'}
          </label>
          <textarea
            id={`comment-${post.id}`}
            rows={1}
            value={draft}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder={thread.replyTo === null ? 'Write a comment…' : 'Write a reply…'}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(null);
            }}
            className="font-body-sm text-body-sm text-on-surface placeholder:text-outline-variant bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 px-md w-full resize-none rounded-xl border py-2 focus:ring-2 focus:outline-none"
          />
          {(draftError ?? thread.error) !== null && thread.status !== 'error' && (
            <p role="alert" className="font-small text-small text-error">
              {draftError ?? thread.error}
            </p>
          )}
        </div>
        <Button
          type="submit"
          aria-label={thread.replyTo === null ? 'Post comment' : 'Post reply'}
          isLoading={thread.isSubmitting}
          disabled={draft.trim() === ''}
          className="shrink-0"
        >
          <SendHorizonal aria-hidden className="size-4" />
        </Button>
      </form>
    </section>
  );
}
