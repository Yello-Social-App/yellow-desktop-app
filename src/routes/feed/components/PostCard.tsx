import { Globe, Link2, Lock, MessageCircle, Pencil, Repeat2, Trash2, Users } from 'lucide-react';
import { memo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import type { PostActions, PostEdit } from '@/features/feed/post-actions';
import { canEdit } from '@/features/feed/post-actions';
import { reactionTotal, visibilityOf, type Post } from '@/features/feed/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

import { CommentThread } from './CommentThread';
import { PostEditor } from './PostEditor';
import { ReactionBreakdown } from './ReactionBreakdown';
import { ReactionButton } from './ReactionButton';
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

/**
 * The action chips: icon plus count, each with its own hover tint the way a
 * timeline's reply / repost / like row does. Counts sit inside the chip so
 * the row reads at a glance.
 */
const ACTION_CLASS =
  'group flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-[13px] font-medium tabular-nums transition-tone disabled:opacity-40';

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
  const navigate = useNavigate();

  const author = displayName(post.author);
  // Media wins: a post with photos gets no link card, the way a timeline does.
  const [firstLink] = post.images.length === 0 ? extractLinks(post.content) : [];
  const original = post.originalPost ?? null;
  // The quoted original gets its own card by the same rule.
  const [originalLink] =
    original !== null && original.images.length === 0 ? extractLinks(original.content) : [];
  const isOwn = canEdit(post, viewerId);
  const isBusy = actions.pendingPostId === post.id;
  const visibility = visibilityOf(post);
  const VisibilityIcon = VISIBILITY_ICONS[visibility];

  const toggle = (next: OpenPanel): void => {
    setPanel((current) => (current === next ? 'none' : next));
  };

  return (
    <article className="gap-md px-lg py-md flex">
      <Link to={`/users/${post.author.id}`} className="shrink-0 self-start">
        <Avatar initials={initialsOf(post.author)} name={author} imageUrl={post.author.avatarUrl} />
      </Link>

      <div className="gap-sm flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1">
          <div className="text-on-surface-variant flex min-w-0 flex-wrap items-baseline gap-x-1 text-[14px]">
            <Link
              to={`/users/${post.author.id}`}
              className="text-on-surface truncate text-[15px] font-bold hover:underline"
            >
              {author}
            </Link>
            <span className="truncate">{handleOf(post.author)}</span>
            <span aria-hidden>·</span>
            {isDetail ? (
              <span>{relativeTime(post.createdAt)}</span>
            ) : (
              <Link to={permalink} className="hover:underline">
                {relativeTime(post.createdAt)}
              </Link>
            )}
            <VisibilityIcon
              aria-label={`Visibility: ${visibility.toLowerCase()}`}
              className="ml-0.5 size-3.5 self-center"
            />
          </div>

          {isOwn && panel !== 'edit' && (
            <div className="-my-1.5 ml-auto flex shrink-0">
              <IconButton
                label="Edit post"
                size="sm"
                icon={<Pencil className="size-4" />}
                disabled={isBusy}
                onClick={() => {
                  toggle('edit');
                }}
              />
              <IconButton
                label="Delete post"
                size="sm"
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
            <p className="text-on-surface text-[17px] leading-relaxed whitespace-pre-wrap">
              <RichText text={post.content} />
            </p>
          ) : (
            // The text is the natural thing to click to open a post. It cannot
            // be a link itself now that links inside it are real anchors, so
            // the paragraph navigates on click while the timestamp link above
            // remains the keyboard's target for the same destination.
            <p
              onClick={(event) => {
                if (window.getSelection()?.toString() === '') {
                  event.preventDefault();
                  void navigate(permalink);
                }
              }}
              className="text-on-surface cursor-pointer text-[15px] leading-relaxed whitespace-pre-wrap"
            >
              <RichText text={post.content} />
            </p>
          ))
        )}

        {post.images.length > 0 && (
          <ul
            className={cn(
              'border-outline-variant grid gap-0.5 overflow-hidden rounded-2xl border',
              post.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            )}
          >
            {post.images.map((image, position) => (
              <li
                key={image.id ?? image.url}
                className={cn(
                  'bg-surface-container overflow-hidden',
                  post.images.length === 1 ? 'max-h-[520px]' : 'aspect-[4/3]',
                )}
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
                  <img
                    src={image.url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {firstLink !== undefined && panel !== 'edit' && <LinkPreviewCard url={firstLink} />}

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
          <blockquote className="border-outline-variant hover:bg-surface-container-low transition-tone gap-xs p-md flex flex-col rounded-2xl border">
            <span className="gap-xs flex items-center text-[13px]">
              <Avatar
                initials={initialsOf(post.originalPost.author)}
                name={displayName(post.originalPost.author)}
                imageUrl={post.originalPost.author.avatarUrl}
                size="xs"
              />
              <span className="text-on-surface font-semibold">
                {displayName(post.originalPost.author)}
              </span>
              <span className="text-on-surface-variant">
                {handleOf(post.originalPost.author)} · {relativeTime(post.originalPost.createdAt)}
              </span>
            </span>
            {post.originalPost.content !== '' && (
              <span className="text-on-surface text-[14px] leading-relaxed whitespace-pre-wrap">
                <RichText text={post.originalPost.content} />
              </span>
            )}
            {post.originalPost.images.length > 0 && (
              <span
                className={cn(
                  'border-outline-variant mt-1 grid gap-0.5 overflow-hidden rounded-xl border',
                  post.originalPost.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
                )}
              >
                {post.originalPost.images.slice(0, 4).map((image) => (
                  <img
                    key={image.id ?? image.url}
                    src={image.url}
                    alt=""
                    loading="lazy"
                    className="bg-surface-container h-40 w-full object-cover"
                  />
                ))}
              </span>
            )}
            {originalLink !== undefined && (
              <span className="mt-1 block">
                <LinkPreviewCard url={originalLink} size="md" />
              </span>
            )}
          </blockquote>
        )}

        {actions.error !== null && actions.pendingPostId === null && (
          <p role="alert" className="text-error text-[13px]">
            {actions.error.message}
          </p>
        )}

        <div className="-ml-2 flex items-center justify-between">
          <button
            type="button"
            aria-expanded={panel === 'comments'}
            onClick={() => {
              toggle('comments');
            }}
            className={cn(
              ACTION_CLASS,
              panel === 'comments'
                ? 'text-primary'
                : 'text-on-surface-variant hover:bg-primary-fixed hover:text-primary',
            )}
          >
            <MessageCircle aria-hidden className="size-[18px]" />
            {post.commentCount > 0 && <span>{post.commentCount}</span>}
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
              'text-on-surface-variant hover:bg-tertiary-fixed hover:text-tertiary',
            )}
          >
            <Repeat2 aria-hidden className="size-[18px]" />
            {post.repostCount > 0 && <span>{post.repostCount}</span>}
          </button>

          <ReactionButton
            current={post.viewerReaction}
            count={reactionTotal(post)}
            onReact={(type) => {
              void actions.toggleReaction(post, type);
            }}
          />

          <ReactionBreakdown post={post} />

          <button
            type="button"
            aria-haspopup="dialog"
            disabled={visibility !== 'PUBLIC'}
            title={
              visibility === 'PUBLIC'
                ? 'Get a link to this post'
                : 'Only public posts can be shared'
            }
            onClick={() => {
              setDialog('share');
            }}
            className={cn(
              ACTION_CLASS,
              'text-on-surface-variant hover:bg-primary-fixed hover:text-primary ml-auto',
            )}
          >
            <Link2 aria-hidden className="size-[18px]" />
          </button>
        </div>

        {panel === 'comments' && (
          <CommentThread
            post={post}
            onCommentCountChange={onCommentCountChange}
            loadAll={isDetail}
          />
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
      </div>
    </article>
  );
});
