import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import type { AppShellContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { PostSkeleton } from '@/components/ui/Skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import {
  useFeed,
  useFeedCommentCount,
  useFeedPostActions,
  useVisiblePosts,
} from '@/features/feed/hooks';

import { cn } from '@/lib/cn';
import { CommunityFeedTab } from '@/routes/communities/components/CommunityFeedTab';
import { StoriesBar, StoriesChip } from '@/routes/home/components/StoriesBar';
import { useLayoutStore } from '@/stores/layout-store';

import { PostComposer } from './components/PostComposer';
import { PostList } from './components/PostList';

type HomeTab = 'feed' | 'communities';

/**
 * Home: stories across the top, the composer, then either the timeline of
 * your friends' posts or the posts from communities you joined.
 *
 * Laid out as the "quiet rails" design has it: no page heading (the rail's
 * active item, or the compact bar's title, already says where you are), text
 * tabs with an accent underline, and the composer and every post as separate
 * cards on the canvas rather than rows between hairlines. In the compact
 * frame the stories row folds into a chip at the end of the tab row, which
 * gives the timeline the height back.
 */
export default function FeedPage() {
  const { searchQuery } = useOutletContext<AppShellContext>();
  const { status, error, loadMore, hasMore, isLoadingMore } = useFeed();
  const posts = useVisiblePosts(searchQuery);
  const actions = useFeedPostActions();
  const adjustCommentCount = useFeedCommentCount();
  const viewer = useCurrentUser();
  const [tab, setTab] = useState<HomeTab>('feed');
  const isCompact = useLayoutStore((state) => state.railMode === 'compact');

  return (
    <div className="flex w-full flex-col gap-3.5 px-7 pt-5 pb-8">
      <h1 className="sr-only">Home</h1>
      <header className="bg-background border-outline-variant sticky top-0 z-10 border-b pt-1">
        <div className="flex items-end">
          <div role="tablist" aria-label="Home feeds" className="flex flex-1 gap-[22px]">
            {(
              [
                ['feed', 'For you'],
                ['communities', 'Communities'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                }}
                className={cn(
                  'transition-tone -mb-px border-b-2 pt-1 pb-2.5 text-[14px]',
                  tab === value
                    ? 'border-primary text-on-surface font-semibold'
                    : 'text-outline hover:text-on-surface-variant border-transparent font-medium',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isCompact && <StoriesChip />}
        </div>
      </header>

      {!isCompact && <StoriesBar />}

      {tab === 'communities' && <CommunityFeedTab />}

      {tab === 'feed' && (
        <>
          <div className="bg-surface-container-lowest border-outline-variant rounded-[14px] border">
            <PostComposer />
          </div>

          {(status === 'loading' || status === 'idle') && (
            <div className="flex flex-col gap-3.5" aria-busy>
              <PostSkeleton />
              <PostSkeleton />
              <PostSkeleton />
            </div>
          )}

          {status === 'error' && (
            <p
              role="alert"
              className="text-on-error-container bg-error-container/40 gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
            >
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {error ?? 'The feed could not be loaded.'}
            </p>
          )}

          {status === 'ready' && (
            <>
              <PostList
                posts={posts}
                isFiltered={searchQuery.trim() !== ''}
                actions={actions}
                viewerId={viewer?.id}
                onCommentCountChange={adjustCommentCount}
              />

              {hasMore && searchQuery.trim() === '' && (
                <div className="py-lg flex justify-center">
                  <Button
                    variant="secondary"
                    isLoading={isLoadingMore}
                    onClick={() => {
                      void loadMore();
                    }}
                  >
                    {isLoadingMore ? 'Loading…' : 'Show more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
