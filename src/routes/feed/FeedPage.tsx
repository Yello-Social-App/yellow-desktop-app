import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
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

import { useCommunitiesStore } from '@/features/communities/store';
import { cn } from '@/lib/cn';
import { CommunityPostCard } from '@/routes/communities/components/CommunityPostCard';
import { StoriesBar } from '@/routes/home/components/StoriesBar';

import { PostComposer } from './components/PostComposer';
import { PostList } from './components/PostList';

type HomeTab = 'feed' | 'communities';

/**
 * Home: stories across the top, the composer, then either the timeline of
 * your friends' posts or the posts from communities you joined.
 */
export default function FeedPage() {
  const { searchQuery } = useOutletContext<AppShellContext>();
  const { status, error, loadMore, hasMore, isLoadingMore } = useFeed();
  const posts = useVisiblePosts(searchQuery);
  const actions = useFeedPostActions();
  const adjustCommentCount = useFeedCommentCount();
  const viewer = useCurrentUser();
  const [tab, setTab] = useState<HomeTab>('feed');
  const communities = useCommunitiesStore((state) => state.communities);
  const communityPosts = useCommunitiesStore((state) => state.posts);
  const joinedPosts = useMemo(() => {
    const joined = new Set(communities.filter((c) => c.isJoined).map((c) => c.slug));
    return communityPosts.filter((p) => joined.has(p.communitySlug));
  }, [communities, communityPosts]);
  const bySlug = useMemo(() => new Map(communities.map((c) => [c.slug, c])), [communities]);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg pt-3 pb-1">Home</h1>
        <div role="tablist" className="flex px-2">
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
                'hover:bg-surface-container-low transition-tone relative flex-1 py-2.5 text-[14px]',
                tab === value ? 'text-on-surface font-bold' : 'text-on-surface-variant font-medium',
              )}
            >
              {label}
              {tab === value && (
                <span
                  aria-hidden
                  className="bg-primary-container absolute inset-x-10 bottom-0 h-1 rounded-full"
                />
              )}
            </button>
          ))}
        </div>
      </header>

      <StoriesBar />

      {tab === 'communities' && (
        <ul className="stagger flex flex-col gap-3 p-4">
          {joinedPosts.length === 0 && (
            <li className="text-on-surface-variant py-10 text-center text-[14px]">
              Join a community to see its posts here.
            </li>
          )}
          {joinedPosts.map((post) => (
            <li key={post.id} className="animate-fade-up">
              <CommunityPostCard post={post} community={bySlug.get(post.communitySlug)} />
            </li>
          ))}
        </ul>
      )}

      {tab === 'feed' && (
        <>
          <div className="border-outline-variant border-b">
            <PostComposer />
          </div>

          {(status === 'loading' || status === 'idle') && (
            <div className="divide-hairline flex flex-col" aria-busy>
              <PostSkeleton />
              <PostSkeleton />
              <PostSkeleton />
            </div>
          )}

          {status === 'error' && (
            <p
              role="alert"
              className="text-on-error-container bg-error-container/40 m-lg gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
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
