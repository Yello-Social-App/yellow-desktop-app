import { Inbox } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import type { PostActions } from '@/features/feed/post-actions';
import type { Post } from '@/features/feed/types';
import { cn } from '@/lib/cn';
import { FEED_ROW_HEIGHT_PX, VIRTUALIZATION_THRESHOLD } from '@/lib/constants';

import { PostCard } from './PostCard';

interface PostListProps {
  posts: Post[];
  isFiltered: boolean;
  actions: PostActions;
  viewerId: string | undefined;
  onCommentCountChange: (postId: string, delta: number) => void;
}

/**
 * The home timeline.
 *
 * Deliberately windowing-ready: uniform keyed rows with no per-row measurement,
 * and an estimated row height the browser uses to skip off-screen work. Past
 * VIRTUALIZATION_THRESHOLD rows this shape hands over to a windowing renderer
 * without the components changing — see README.
 */
export function PostList({
  posts,
  isFiltered,
  actions,
  viewerId,
  onCommentCountChange,
}: PostListProps) {
  if (posts.length === 0) {
    return isFiltered ? (
      <EmptyState
        icon={<Inbox className="size-6" />}
        title="Nothing matches that search"
        description="Try a shorter search, or clear it to see the whole timeline again."
      />
    ) : (
      <EmptyState
        icon={<Inbox className="size-6" />}
        title="Your feed is quiet"
        description="Your feed shows your own posts and your friends'. Write the first one above, or add some friends."
      />
    );
  }

  return (
    <ul
      // Lazy rendering of off-screen rows only earns its keep on a long list;
      // below the threshold its height estimates make the scrollbar jump.
      className={cn(
        'stagger flex flex-col gap-3 p-4',
        posts.length > VIRTUALIZATION_THRESHOLD && 'list-windowed',
      )}
      data-row-height={FEED_ROW_HEIGHT_PX}
      data-windowing-threshold={VIRTUALIZATION_THRESHOLD}
    >
      {posts.map((post) => (
        <li
          key={post.id}
          className="bg-surface-container-lowest border-outline-variant hover:border-outline/40 transition-tone animate-fade-up rounded-2xl border"
        >
          <PostCard
            post={post}
            actions={actions}
            viewerId={viewerId}
            onCommentCountChange={onCommentCountChange}
          />
        </li>
      ))}
    </ul>
  );
}
