import {
  Globe,
  Heart,
  Link2,
  Lock,
  MessageCircle,
  Pencil,
  Repeat2,
  Trash2,
  Users,
} from 'lucide-react';
import { memo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import type { PostActions, PostEdit } from '@/features/feed/post-actions';
import { canEdit } from '@/features/feed/post-actions';
import { viewerHasReacted, visibilityOf, type Post } from '@/features/feed/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

import { CommentThread } from './CommentThread';
import { PostEditor } from './PostEditor';
import { ReactionBreakdown } from './ReactionBreakdown';
import { RepostDialog } from './RepostDialog';
import { ShareDialog } from './ShareDialog';

interface PostCardProps {
  post: Post;
  actions: PostActions;
  /** The signed-in user, which decides whether edit and delete are offered. */
  viewerId: string | undefined;
  onCommentCountChange: (postId: string, delta: number) => void;
  /**
   * On the post's own page: the thread opens by default and the card stops
   * linking to itself. In a timeline the text, timestamp and comment count
   * all lead to that page.
   */
  isDetail?: boolean;
}

const ACTION_CLASS =
  'flex flex-1 items-center justify-center gap-sm rounded-lg py-2 font-label text-label transition-tone disabled:opacity-40';

const VISIBILITY_ICONS = {
  PUBLIC: Globe,
  FRIENDS: Users,
  PRIVATE: Lock,
} as const;

/**
 * What is expanded inside the card. Repost, delete and share are dialogs
 * instead — each one is a decision to confirm, and a dialog takes the focus
 * and the Esc key rather than pushing the timeline around.
 */
type OpenPanel = 'none' | 'comments' | 'edit';

type OpenDialog = 'none' | 'repost' | 'delete' | 'share';

/**
 * Memoised: the feed re-renders on every keystroke in the search box, and a
 * post that survives the filter has not changed.
 */
export const PostCard = memo(function PostCard({
  post,
  actions,
  viewerId,
  onCommentCountChange,
  isDetail = false,
}: PostCardProps) {
  const [panel, setPanel] = useState<OpenPanel>(isDetail ? 'comments' : 'none');
  /** Which photo the viewer is open on; null when it is closed. */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const permalink = `/posts/${post.id}`;
  const [dialog, setDialog] = useState<OpenDialog>('none');

  const author = displayName(post.author);
  const hasReacted = viewerHasReacted(post);
  const isOwn = canEdit(post, viewerId);
  const isBusy = actions.pendingPostId === post.id;
  const visibility = visibilityOf(post);
  const VisibilityIcon = VISIBILITY_ICONS[visibility];

  const toggle = (next: OpenPanel): void => {
    setPanel((current) => (current === next ? 'none' : next));
  };

  return (
    <Card elevation="floating" as="article" className="gap-md p-md md:p-lg flex flex-col">
      <div className="gap-md flex items-center">
        <Link to={`/users/${post.author.id}`}>
          <Avatar
            initials={initialsOf(post.author)}
            name={author}
            imageUrl={post.author.avatarUrl}
          />
        </Link>
        <div className="min-w-0">
          <Link
            to={`/users/${post.author.id}`}
            className="font-heading text-h3 text-on-surface hover:text-primary transition-tone block truncate"
          >
            {author}
          </Link>
          <p className="font-small text-small text-on-surface-variant gap-xs flex items-center truncate">
            {handleOf(post.author)} ·{' '}
            {isDetail ? (
              relativeTime(post.createdAt)
            ) : (
              <Link to={permalink} className="hover:text-on-surface hover:underline">
                {relativeTime(post.createdAt)}
              </Link>
            )}
            <VisibilityIcon
              aria-label={`Visibility: ${visibility.toLowerCase()}`}
              className="size-3"
            />
          </p>
        </div>

        {isOwn && panel !== 'edit' && (
          <div className="gap-xs ml-auto flex shrink-0">
            <IconButton
              label="Edit post"
              icon={<Pencil className="size-4" />}
              disabled={isBusy}
              onClick={() => {
                toggle('edit');
              }}
            />
            <IconButton
              label="Delete post"
              tone="danger"
              icon={<Trash2 className="size-4" />}
              disabled={isBusy}
              onClick={() => {
                setDialog('delete');
              }}
            />
          </div>
        )}
      </div>

      {panel === 'edit' ? (
        <PostEditor
          post={post}
          isSaving={isBusy}
          onSave={(changes: PostEdit) => {
            void actions.save(post, changes).then((saved) => {
              if (saved) {
                setPanel('none');
              }
            });
          }}
          onCancel={() => {
            setPanel('none');
          }}
        />
      ) : (
        post.content !== '' &&
        (isDetail ? (
          <p className="font-body text-body text-on-surface leading-relaxed whitespace-pre-wrap">
            {post.content}
          </p>
        ) : (
          // The text is the natural thing to click to open a post; a link
          // rather than a click handler on the card, so buttons inside the
          // card keep their own meaning and the keyboard sees a real target.
          <Link
            to={permalink}
            className="font-body text-body text-on-surface hover:text-on-surface/80 block leading-relaxed whitespace-pre-wrap"
          >
            {post.content}
          </Link>
        ))
      )}

      {post.images.length > 0 && (
        <ul className="gap-sm grid grid-cols-1 sm:grid-cols-2">
          {post.images.map((image, position) => (
            <li
              key={image.id ?? image.url}
              className="border-outline-variant overflow-hidden rounded-lg border"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`Open photo ${String(position + 1)} of ${String(post.images.length)}`}
                onClick={() => {
                  setLightboxIndex(position);
                }}
                className="focus-visible:ring-primary-container block h-full w-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
              >
                <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={post.images.map((image) => ({ url: image.url }))}
          initialIndex={lightboxIndex}
          onClose={() => {
            setLightboxIndex(null);
          }}
        />
      )}

      {post.originalPost !== null && post.originalPost !== undefined && (
        <blockquote className="border-outline-variant gap-xs p-md flex flex-col rounded-lg border">
          <span className="font-small text-small text-on-surface-variant">
            {displayName(post.originalPost.author)} · {relativeTime(post.originalPost.createdAt)}
          </span>
          <span className="font-body-sm text-body-sm text-on-surface">
            {post.originalPost.content}
          </span>
        </blockquote>
      )}

      {actions.error !== null && actions.pendingPostId === null && (
        <p role="alert" className="font-small text-small text-error">
          {actions.error.message}
        </p>
      )}

      <div className="text-on-surface-variant font-small text-small flex items-start justify-between">
        <ReactionBreakdown post={post} />
        <span className="gap-md flex">
          {isDetail ? (
            <span>{post.commentCount} comments</span>
          ) : (
            <Link to={permalink} className="hover:text-on-surface hover:underline">
              {post.commentCount} comments
            </Link>
          )}
          <span>{post.repostCount} reposts</span>
        </span>
      </div>

      <div className="border-outline-variant/50 pt-sm flex items-center justify-between border-t">
        <button
          type="button"
          aria-pressed={hasReacted}
          onClick={() => {
            void actions.toggleReaction(post);
          }}
          className={cn(
            ACTION_CLASS,
            hasReacted
              ? 'text-secondary hover:bg-surface-container-low'
              : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
          )}
        >
          <Heart aria-hidden className={cn('size-5', hasReacted && 'fill-current')} />
          Like
        </button>

        <button
          type="button"
          aria-expanded={panel === 'comments'}
          onClick={() => {
            toggle('comments');
          }}
          className={cn(
            ACTION_CLASS,
            panel === 'comments'
              ? 'text-primary hover:bg-surface-container-low'
              : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
          )}
        >
          <MessageCircle aria-hidden className="size-5" />
          Comment
        </button>

        <button
          type="button"
          aria-haspopup="dialog"
          disabled={isBusy}
          onClick={() => {
            setDialog('repost');
          }}
          className={cn(
            ACTION_CLASS,
            'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
          )}
        >
          <Repeat2 aria-hidden className="size-5" />
          Repost
        </button>

        <button
          type="button"
          aria-haspopup="dialog"
          disabled={visibility !== 'PUBLIC'}
          title={
            visibility === 'PUBLIC' ? 'Get a link to this post' : 'Only public posts can be shared'
          }
          onClick={() => {
            setDialog('share');
          }}
          className={cn(
            ACTION_CLASS,
            'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
          )}
        >
          <Link2 aria-hidden className="size-5" />
          Share
        </button>
      </div>

      {panel === 'comments' && (
        <CommentThread post={post} onCommentCountChange={onCommentCountChange} loadAll={isDetail} />
      )}

      {dialog === 'repost' && (
        <RepostDialog
          post={post}
          isOpen
          isBusy={isBusy}
          onRepost={(content) => {
            void actions.repost(post, content).then((done) => {
              if (done) {
                setDialog('none');
              }
            });
          }}
          onClose={() => {
            setDialog('none');
          }}
        />
      )}

      {dialog === 'share' && (
        <ShareDialog
          post={post}
          isOpen
          onClose={() => {
            setDialog('none');
          }}
        />
      )}

      <Modal
        isOpen={dialog === 'delete'}
        onClose={() => {
          setDialog('none');
        }}
        size="sm"
        title="Delete this post?"
        description="Its images go with it, and this cannot be undone."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isBusy}
              onClick={() => {
                setDialog('none');
              }}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              leadingIcon={<Trash2 className="size-4" />}
              isLoading={isBusy}
              onClick={() => {
                void actions.remove(post).then((deleted) => {
                  if (!deleted) {
                    setDialog('none');
                  }
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </Card>
  );
});
