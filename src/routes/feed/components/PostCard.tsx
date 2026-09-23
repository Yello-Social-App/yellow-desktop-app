import {
  Bookmark,
  Ellipsis,
  EyeOff,
  Flag,
  Globe,
  Link2,
  Lock,
  MessageCircle,
  Pencil,
  Repeat2,
  Trash2,
  Users,
  VolumeX,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Popover } from '@/components/ui/Popover';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import type { PostActions, PostEdit } from '@/features/feed/post-actions';
import { canEdit } from '@/features/feed/post-actions';
import { reactionTotal, visibilityOf, type Post } from '@/features/feed/types';
import {
  usePostModeration,
  useRestrictions,
  type CollapseReason,
} from '@/features/moderation/hooks';
import { reasonLabel } from '@/features/moderation/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { relativeTime, shortRelativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

import { CommentThread } from './CommentThread';
import { PostEditor } from './PostEditor';
import { ReportPostDialog } from './ReportPostDialog';
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

type OpenDialog = 'none' | 'repost' | 'delete' | 'share' | 'report';

/** How long "Link copied" and the like stay under the post. */
const NOTICE_MS = 2200;

const MENU_ITEM_CLASS =
  'text-on-surface hover:bg-surface-container-low transition-tone flex items-center gap-2.5 px-3 py-2 text-left text-[13.5px]';

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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  /** A one-line note under the post ("Link copied"), cleared on a timer. */
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const navigate = useNavigate();
  const moderation = usePostModeration(post);
  const restrictions = useRestrictions();

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

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

  if (moderation.collapse !== null) {
    return (
      <CollapsedPost
        reason={moderation.collapse}
        detail={
          moderation.reportedFor === null
            ? null
            : `Reported for ${reasonLabel(moderation.reportedFor).toLowerCase()} · under review`
        }
        handle={handleOf(post.author)}
        onShow={() => {
          void restrictions.showPost(post.id);
        }}
      />
    );
  }

  const closeMenu = (): void => {
    setIsMenuOpen(false);
  };

  return (
    // The design's card: who and when across the top, then the post at full
    // width beneath — not hung off an avatar column, which indents every line.
    <article className="flex flex-col gap-2.5 p-3.5">
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <Link to={`/users/${post.author.id}`} className="shrink-0">
            <Avatar
              initials={initialsOf(post.author)}
              name={author}
              imageUrl={post.author.avatarUrl}
              size="sm"
            />
          </Link>
          <div className="text-outline flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-[13px]">
            <Link
              to={`/users/${post.author.id}`}
              className="text-on-surface truncate text-[14px] font-semibold hover:underline"
            >
              {author}
            </Link>
            <span className="truncate">{handleOf(post.author)}</span>
            <span aria-hidden>·</span>
            {isDetail ? (
              <span>{relativeTime(post.createdAt)}</span>
            ) : (
              <Link to={permalink} title={relativeTime(post.createdAt)} className="hover:underline">
                {shortRelativeTime(post.createdAt)}
              </Link>
            )}
            <VisibilityIcon
              aria-label={`Visibility: ${visibility.toLowerCase()}`}
              className="ml-0.5 size-3.5 self-center"
            />
            {moderation.reportedFor !== null && (
              <span className="bg-error-container text-on-error-container ml-1 self-center rounded-md px-1.5 py-px text-[11px] font-semibold">
                Reported
              </span>
            )}
          </div>

          {isOwn && panel !== 'edit' && (
            <Popover
              isOpen={isMenuOpen}
              onClose={() => {
                setIsMenuOpen(false);
              }}
              label="Post options"
              align="right"
              className="-my-1 shrink-0"
              panelClassName="w-44 py-1"
              trigger={
                <IconButton
                  label="Post options"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  icon={<Ellipsis className="size-4" />}
                  disabled={isBusy}
                  onClick={() => {
                    setIsMenuOpen((open) => !open);
                  }}
                />
              }
            >
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  toggle('edit');
                }}
                className="text-on-surface hover:bg-surface-container-low transition-tone flex items-center gap-2.5 px-3 py-2 text-left text-[13.5px]"
              >
                <Pencil aria-hidden className="size-4" />
                Edit post
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  setDialog('delete');
                }}
                className="text-error hover:bg-error-container transition-tone flex items-center gap-2.5 px-3 py-2 text-left text-[13.5px]"
              >
                <Trash2 aria-hidden className="size-4" />
                Delete post
              </button>
            </Popover>
          )}

          {!isOwn && viewerId !== undefined && (
            <Popover
              isOpen={isMenuOpen}
              onClose={closeMenu}
              label="Post options"
              align="right"
              className="-my-1 shrink-0"
              panelClassName="w-56 py-1"
              trigger={
                <IconButton
                  label="Post options"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  icon={<Ellipsis className="size-4" />}
                  onClick={() => {
                    setIsMenuOpen((open) => !open);
                  }}
                />
              }
            >
              {visibility === 'PUBLIC' && (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    void actions.copyLink(post).then((link) => {
                      if (link !== null) {
                        setNotice({ text: 'Link copied', isError: false });
                      }
                    });
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  <Link2 aria-hidden className="text-on-surface-variant size-4" />
                  Copy link
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  void restrictions.hidePost(post.id);
                }}
                className={MENU_ITEM_CLASS}
              >
                <EyeOff aria-hidden className="text-on-surface-variant size-4" />
                Hide this post
              </button>
              {!moderation.isMuted && (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    void restrictions.mute(post.author);
                  }}
                  className={cn(MENU_ITEM_CLASS, 'min-w-0')}
                >
                  <VolumeX aria-hidden className="text-on-surface-variant size-4 shrink-0" />
                  <span className="truncate">Mute {handleOf(post.author)}</span>
                </button>
              )}
              <div aria-hidden className="bg-outline-variant mx-2 my-1 h-px" />
              {moderation.reportedFor === null ? (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setDialog('report');
                  }}
                  className="text-error hover:bg-error-container transition-tone flex items-center gap-2.5 px-3 py-2 text-left text-[13.5px]"
                >
                  <Flag aria-hidden className="size-4" />
                  Report post
                </button>
              ) : (
                <p className="text-outline flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <Flag aria-hidden className="size-4" />
                  You reported this post
                </p>
              )}
            </Popover>
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
          // The whole quote opens the original, as the text of a post opens the
          // post; a link inside it (the author, a URL, a link card) keeps its
          // own destination, and selecting text is not a click. The timestamp
          // is the keyboard's link to the same place.
          <blockquote
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('a') === null && window.getSelection()?.toString() === '') {
                void navigate(`/posts/${post.originalPost?.id ?? ''}`);
              }
            }}
            className="border-outline-variant hover:bg-surface-container-low transition-tone gap-xs p-md flex cursor-pointer flex-col rounded-2xl border"
          >
            <span className="gap-xs flex items-center text-[13px]">
              <Avatar
                initials={initialsOf(post.originalPost.author)}
                name={displayName(post.originalPost.author)}
                imageUrl={post.originalPost.author.avatarUrl}
                size="xs"
              />
              <Link
                to={`/users/${post.originalPost.author.id}`}
                className="text-on-surface font-semibold hover:underline"
              >
                {displayName(post.originalPost.author)}
              </Link>
              <span className="text-on-surface-variant">
                {handleOf(post.originalPost.author)} ·{' '}
                <Link to={`/posts/${post.originalPost.id}`} className="hover:underline">
                  {relativeTime(post.originalPost.createdAt)}
                </Link>
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

        {notice !== null && (
          <p
            role={notice.isError ? 'alert' : 'status'}
            className={cn('text-[13px]', notice.isError ? 'text-error' : 'text-tertiary')}
          >
            {notice.text}
          </p>
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

          {viewerId !== undefined && (
            <button
              type="button"
              aria-pressed={post.isSaved}
              aria-label={post.isSaved ? 'Remove from saved' : 'Save post'}
              title={post.isSaved ? 'Remove from saved' : 'Save post'}
              disabled={actions.savingPostIds.has(post.id)}
              onClick={() => {
                void actions.toggleSaved(post).then((outcome) => {
                  if (outcome === 'failed') {
                    setNotice({ text: 'That didn’t go through. Try again.', isError: true });
                  }
                });
              }}
              className={cn(
                ACTION_CLASS,
                'ml-auto',
                post.isSaved
                  ? 'text-primary hover:bg-primary-fixed'
                  : 'text-on-surface-variant hover:bg-primary-fixed hover:text-primary',
              )}
            >
              <Bookmark aria-hidden className={cn('size-[18px]', post.isSaved && 'fill-current')} />
            </button>
          )}

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
              'text-on-surface-variant hover:bg-primary-fixed hover:text-primary',
              viewerId === undefined && 'ml-auto',
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

        {dialog === 'report' && (
          <ReportPostDialog
            post={post}
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

const COLLAPSED_TITLES: Record<Exclude<CollapseReason, null>, string> = {
  reported: 'You reported this post',
  hidden: 'Post hidden',
  muted: 'Post from an account you muted',
  blocked: 'Post from an account you blocked',
};

interface CollapsedPostProps {
  reason: Exclude<CollapseReason, null>;
  detail: string | null;
  handle: string;
  onShow: () => void;
}

/** What a hidden, reported or muted post folds down to — always one click from back. */
function CollapsedPost({ reason, detail, handle, onShow }: CollapsedPostProps) {
  const sub =
    detail ??
    (reason === 'hidden'
      ? 'You won’t see this post in your feed.'
      : `${handle} · manage this in Settings → Privacy & safety`);

  return (
    <article className="flex items-center gap-3 p-3.5">
      <EyeOff aria-hidden className="text-outline size-[18px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-on-surface text-[14px] font-medium">{COLLAPSED_TITLES[reason]}</span>
        <span className="text-outline truncate text-[13px]">{sub}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onShow}>
        Show post
      </Button>
    </article>
  );
}
