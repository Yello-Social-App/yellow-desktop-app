import { ArrowBigDown, ArrowBigUp, MessageCircle, Share2 } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { UserAvatar } from '@/components/people/UserAvatar';
import { useCommunitiesStore } from '@/features/communities/store';
import type { CommunityPost } from '@/features/communities/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { relativeTime } from '@/lib/relative-time';
import { displayName } from '@/lib/user-display';

interface CommunityPostCardProps {
  post: CommunityPost;
  /** Hide the community chip when the card already sits inside that community. */
  inCommunity?: boolean;
}

/**
 * A Reddit-shaped post: vote column on the left, community chip and author
 * line, a bold title, the body clamped, and a quiet action row.
 */
export const CommunityPostCard = memo(function CommunityPostCard({
  post,
  inCommunity = false,
}: CommunityPostCardProps) {
  const vote = useCommunitiesStore((state) => state.vote);
  const isVoting = useCommunitiesStore((state) => state.pendingIds.has(post.id));
  const { community } = post;
  const [firstLink] = extractLinks(post.body);

  return (
    <article className="bg-surface-container-lowest border-outline-variant hover:border-outline/40 transition-tone flex gap-3 rounded-2xl border p-3 pl-2">
      <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 pt-1">
        <button
          type="button"
          aria-label="Upvote"
          aria-pressed={post.viewerVote === 1}
          disabled={isVoting}
          onClick={() => {
            void vote(post.id, 1);
          }}
          className={cn(
            'transition-tone grid size-8 place-items-center rounded-full',
            post.viewerVote === 1
              ? 'text-coral'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-coral',
          )}
        >
          <ArrowBigUp className={cn('size-5', post.viewerVote === 1 && 'fill-current')} />
        </button>
        <span
          className={cn(
            'text-[13px] font-bold tabular-nums',
            post.viewerVote === 1 && 'text-coral',
            post.viewerVote === -1 && 'text-info',
            post.viewerVote === 0 && 'text-on-surface',
          )}
        >
          {post.score}
        </span>
        <button
          type="button"
          aria-label="Downvote"
          aria-pressed={post.viewerVote === -1}
          disabled={isVoting}
          onClick={() => {
            void vote(post.id, -1);
          }}
          className={cn(
            'transition-tone grid size-8 place-items-center rounded-full',
            post.viewerVote === -1
              ? 'text-info'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-info',
          )}
        >
          <ArrowBigDown className={cn('size-5', post.viewerVote === -1 && 'fill-current')} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
        <div className="text-on-surface-variant flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
          {!inCommunity && (
            <Link
              to={`/c/${community.slug}`}
              className="bg-info-fixed text-on-info-fixed flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold hover:brightness-110"
            >
              {community.emoji !== '' && <span aria-hidden>{community.emoji}</span>}
              c/{community.slug}
            </Link>
          )}
          <UserAvatar user={post.author} size="xs" />
          <span className="text-on-surface font-medium">{displayName(post.author)}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(post.createdAt)}</span>
          <span className="bg-surface-container-high text-on-surface-variant ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase">
            {post.tag}
          </span>
        </div>

        <h3 className="text-on-surface text-[17px] leading-snug font-bold">{post.title}</h3>
        <p className="text-on-surface-variant text-content-sm line-clamp-3 leading-relaxed whitespace-pre-wrap">
          <RichText text={post.body} />
        </p>

        {firstLink !== undefined && <LinkPreviewCard url={firstLink} size="md" />}

        <div className="text-on-surface-variant -ml-2 flex items-center gap-1 pt-1 text-[13px] font-medium">
          <span className="hover:bg-surface-container-high transition-tone flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
            <MessageCircle aria-hidden className="size-4" />
            {post.commentCount} comments
          </span>
          <span className="hover:bg-surface-container-high transition-tone flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
            <Share2 aria-hidden className="size-4" />
            Share
          </span>
        </div>
      </div>
    </article>
  );
});
