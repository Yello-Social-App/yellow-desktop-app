import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { PostSkeleton } from '@/components/ui/Skeleton';
import type { CommunityPostSort } from '@/features/communities/types';
import { POST_SORT_LABELS } from '@/features/communities/types';
import type { FeedView } from '@/features/communities/hooks';
import { cn } from '@/lib/cn';

import { CommunityPostCard } from './CommunityPostCard';

interface PostFeedProps {
  feed: FeedView;
  /** Drawn when the list loaded and is empty. */
  empty: ReactNode;
  /** Hide the community chip when every post is from the community on screen. */
  inCommunity?: boolean;
}

/**
 * A cursor-paged list of community posts, in the states a list has: loading
 * with nothing to show yet, failed, empty, and loaded with more to fetch.
 */
export function PostFeed({ feed, empty, inCommunity = false }: PostFeedProps) {
  if (feed.posts.length === 0 && (feed.status === 'loading' || feed.status === 'idle')) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy>
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (feed.posts.length === 0 && feed.status === 'error') {
    return (
      <InlineAlert
        message={feed.error ?? 'These posts could not be loaded.'}
        actionLabel="Retry"
        onAction={feed.reload}
      />
    );
  }

  if (feed.posts.length === 0) {
    return <>{empty}</>;
  }

  return (
    <>
      <ul className="stagger flex flex-col gap-3 p-4">
        {feed.posts.map((post) => (
          <li key={post.id} className="animate-fade-up">
            <CommunityPostCard post={post} inCommunity={inCommunity} />
          </li>
        ))}
      </ul>
      {feed.error !== null && (
        <InlineAlert message={feed.error} actionLabel="Retry" onAction={feed.loadMore} />
      )}
      {feed.hasMore && feed.error === null && (
        <div className="pb-lg flex justify-center">
          <Button variant="secondary" isLoading={feed.isLoadingMore} onClick={feed.loadMore}>
            {feed.isLoadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </>
  );
}

interface PostSortPickerProps {
  value: CommunityPostSort;
  onChange: (sort: CommunityPostSort) => void;
  className?: string;
}

export function PostSortPicker({ value, onChange, className }: PostSortPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort posts"
      className={cn('bg-surface-container-low flex w-fit rounded-full p-0.5', className)}
    >
      {(Object.keys(POST_SORT_LABELS) as CommunityPostSort[]).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => {
            onChange(option);
          }}
          className={cn(
            'transition-tone rounded-full px-3 py-1 text-[13px] font-semibold',
            value === option
              ? 'bg-surface-container-lowest text-on-surface shadow-floating'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
        >
          {POST_SORT_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
