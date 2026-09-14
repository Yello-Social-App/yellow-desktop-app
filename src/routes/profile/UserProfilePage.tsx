import { PenLine, TriangleAlert } from 'lucide-react';
import { Navigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePostActions } from '@/features/feed/post-actions';
import { useRelationship } from '@/features/friends/hooks';
import { useProfilePosts, usePublicProfile } from '@/features/profile/hooks';
import { PostCard } from '@/routes/feed/components/PostCard';
import { displayName } from '@/lib/user-display';

import { FriendshipControls } from './components/FriendshipControls';
import { ProfileHeader } from './components/ProfileHeader';

/**
 * Somebody else's profile: `GET /users/{id}` for the identity, and
 * `GET /users/{id}/posts` for the timeline.
 *
 * Visibility is applied inside the server's query, so the page count matches
 * what arrives — a non-friend simply sees fewer posts, and nothing here has to
 * filter (OWASP A01: the client is not the place that decision is made).
 */
export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const viewer = useCurrentUser();
  const { user, status: profileStatus, error: profileError } = usePublicProfile(userId);
  const relationship = useRelationship(userId);
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
  } = useProfilePosts(userId);
  const actions = usePostActions(sink);

  // Your own id in the URL is the same page as /profile, which can edit.
  if (userId !== undefined && viewer !== null && viewer.id === userId) {
    return <Navigate to="/profile" replace />;
  }

  if (profileStatus === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading profile…" />
      </div>
    );
  }

  if (profileStatus === 'error' || user === null) {
    return (
      <div className="max-w-content-max px-lg py-lg mx-auto w-full">
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {profileError ?? 'That profile could not be loaded.'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex w-full flex-col">
      <ProfileHeader
        user={user}
        postCount={totalPosts}
        action={<FriendshipControls control={relationship} />}
      />

      <section className="gap-md flex flex-col">
        <h2 className="font-heading text-h3 text-on-surface">Posts</h2>

        {status === 'loading' && (
          <div className="py-xl flex justify-center">
            <Spinner label="Loading posts…" />
          </div>
        )}

        {status === 'error' && (
          <p
            role="alert"
            className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {error ?? 'These posts could not be loaded.'}
          </p>
        )}

        {status === 'ready' && posts.length === 0 && (
          <EmptyState
            icon={<PenLine className="size-6" />}
            title={`Nothing to show from ${displayName(user)}`}
            description={
              relationship.relationship === 'friends'
                ? 'They have not posted anything yet.'
                : 'They may have posts that only their friends can see.'
            }
          />
        )}

        {status === 'ready' && posts.length > 0 && (
          <ul className="stagger gap-lg flex flex-col">
            {posts.map((post) => (
              <li key={post.id} className="animate-fade-up">
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

        {hasMore && (
          <div className="flex justify-center">
            <Button variant="secondary" isLoading={isLoadingMore} onClick={loadMore}>
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
