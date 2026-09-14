import { PenLine, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PostSkeleton } from '@/components/ui/Skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePostActions } from '@/features/feed/post-actions';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useProfilePosts } from '@/features/profile/hooks';
import { PostCard } from '@/routes/feed/components/PostCard';

import { ProfileHeader } from './components/ProfileHeader';

/**
 * The signed-in user's own profile: identity and their timeline. The API has
 * no profile edit, so there is nothing here to change.
 */
export default function ProfilePage() {
  const user = useCurrentUser();
  useFriendsLoader();
  const friends = useFriendList('friends');
  const {
    posts,
    status,
    error,
    totalPosts,
    hasMore,
    isLoadingMore,
    loadMore,
    sink,
    adjustCommentCount,
  } = useProfilePosts(user?.id, { isOwnProfile: true });
  const actions = usePostActions(sink);

  if (user === null) {
    return (
      <div className="divide-hairline flex flex-col" aria-busy>
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg py-3">Profile</h1>
      </header>

      <ProfileHeader user={user} postCount={totalPosts} friendCount={friends.total} />

      <section className="flex flex-col">
        <h2 className="text-on-surface-variant px-lg text-caption pt-md pb-sm font-semibold tracking-wider uppercase">
          Posts
        </h2>

        {status === 'loading' && (
          <div className="divide-hairline flex flex-col" aria-busy>
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
            {error ?? 'Your posts could not be loaded.'}
          </p>
        )}

        {status === 'ready' && posts.length === 0 && (
          <EmptyState
            icon={<PenLine className="size-6" />}
            title="You haven't posted yet"
            description="Anything you write on the home feed shows up here."
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
                  viewerId={user.id}
                  onCommentCountChange={adjustCommentCount}
                />
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <div className="py-lg flex justify-center">
            <Button variant="secondary" isLoading={isLoadingMore} onClick={loadMore}>
              {isLoadingMore ? 'Loading…' : 'Show more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
