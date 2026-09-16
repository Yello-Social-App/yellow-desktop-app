import { Repeat2 } from 'lucide-react';
import { useState } from 'react';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { REPOST_MAX_LENGTH, type Post } from '@/features/feed/types';
import { extractLinks } from '@/lib/links';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

interface RepostDialogProps {
  post: Post;
  isOpen: boolean;
  isBusy: boolean;
  onRepost: (content?: string) => void;
  onClose: () => void;
}

/**
 * Quote-repost, in a dialog so the post being quoted stays visible while the
 * commentary is written.
 *
 * The commentary is optional — `POST /posts/{id}/repost` accepts an empty body
 * — so submitting with nothing typed is a plain repost.
 *
 * Mounted only while open, so each opening starts on a blank draft rather than
 * resuming one the user walked away from. A failed repost keeps what was typed,
 * because the dialog stays open.
 */
export function RepostDialog({ post, isOpen, isBusy, onRepost, onClose }: RepostDialogProps) {
  const [content, setContent] = useState('');
  // The quoted post's own link, so the dialog shows what is being quoted
  // rather than dropping it. The composer's text is deliberately not
  // unfurled: that would fetch on a half-typed URL.
  const [quotedLink] = post.images.length === 0 ? extractLinks(post.content) : [];
  const trimmed = content.trim();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Repost this"
      description="Add a comment, or repost it as it is."
      footer={
        <>
          <Button variant="ghost" disabled={isBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            leadingIcon={<Repeat2 className="size-4" />}
            isLoading={isBusy}
            onClick={() => {
              onRepost(trimmed === '' ? undefined : trimmed);
            }}
          >
            Repost
          </Button>
        </>
      }
    >
      <label className="sr-only" htmlFor={`repost-${post.id}`}>
        Add a comment to this repost
      </label>
      <textarea
        id={`repost-${post.id}`}
        rows={3}
        value={content}
        maxLength={REPOST_MAX_LENGTH}
        placeholder="Say something about this…"
        onChange={(event) => {
          setContent(event.target.value);
        }}
        className="font-body-sm text-body-sm text-on-surface placeholder:text-outline-variant bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 px-md py-sm w-full resize-none rounded-xl border focus:ring-2 focus:outline-none"
      />

      <blockquote className="border-outline-variant gap-xs p-md flex flex-col rounded-lg border">
        <div className="gap-sm flex items-center">
          <Avatar
            initials={initialsOf(post.author)}
            name={displayName(post.author)}
            imageUrl={post.author.avatarUrl}
            size="sm"
          />
          <span className="font-small text-small text-on-surface-variant truncate">
            {displayName(post.author)} · {relativeTime(post.createdAt)}
          </span>
        </div>
        {post.content !== '' && (
          <p className="font-body-sm text-body-sm text-on-surface line-clamp-4 whitespace-pre-wrap">
            {post.content}
          </p>
        )}
        {post.images.length > 0 && (
          <p className="font-small text-small text-on-surface-variant">
            {post.images.length} photo{post.images.length > 1 ? 's' : ''}
          </p>
        )}
        {quotedLink !== undefined && <LinkPreviewCard url={quotedLink} size="sm" />}
      </blockquote>
    </Modal>
  );
}
