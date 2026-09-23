import { Bookmark, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PostSkeleton } from '@/components/ui/Skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePostActions } from '@/features/feed/post-actions';
import { useSavedPosts } from '@/features/saved/hooks';
import { PostCard } from '@/routes/feed/components/PostCard';

/**
 * The posts the viewer bookmarked, most recently saved first.
 *
 * Saves are private: nobody else sees this list, and the author of a post is
 * never told it was saved. A post the viewer can no longer see — made
 * private, the author blocked them, a moderator hid it — drops out of the
 * list on the server's side.
 */
export default function SavedPage() {
  const viewer = useCurrentUser();
  const {
    posts,
    status,
    error,
    hasMore,
    isLoadingMore,
    loadMoreError,
    loadMore,
    reload,
    sink,
    adjustCommentCount,
  } = useSavedPosts();
  const actions = usePostActions(sink);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg py-3">Saved</h1>
      </header>

      {status === 'loading' && (
        <div className="divide-hairline flex flex-col" aria-busy>
          <PostSkeleton />
          <PostSkeleton />
        </div>
      )}

      {status === 'error' && (
        <div className="m-lg gap-sm flex flex-col items-start">
          <p
            role="alert"
            className="text-on-error-container bg-error-container/40 gap-sm px-md py-sm flex w-full items-center rounded-xl text-[14px]"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {error ?? 'Your saved posts could not be loaded.'}
          </p>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {status === 'ready' && posts.length === 0 && !hasMore && (
        <EmptyState
          icon={<Bookmark className="size-6" />}
          title="Nothing saved yet"
          description="Press the bookmark on any post to keep it here. Only you can see what you save."
        />
      )}

      {status === 'ready' && posts.length > 0 && (
        <ul className="stagger flex flex-col gap-3 p-4">
          {posts.map((post) => (
            <li
              key={post.id}
              className="bg-surface-container-lowest border-outline-variant animate-fade-up rounded-2xl border"
            >
              <PostCard
                post={post}
                actions={actions}
                viewerId={viewer?.id}
                onCommentCountChange={adjustCommentCount}
              />
            </li>
          ))}
        </ul>
      )}

      {status === 'ready' && loadMoreError !== null && (
        <p role="alert" className="text-error px-lg text-center text-[13px]">
          {loadMoreError}
        </p>
      )}

      {status === 'ready' && hasMore && (
        <div className="py-lg flex justify-center">
          <Button variant="secondary" isLoading={isLoadingMore} onClick={loadMore}>
            {isLoadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </div>
  );
}
