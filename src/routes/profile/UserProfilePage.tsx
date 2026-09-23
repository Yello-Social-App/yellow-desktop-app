import type { Author, User } from '@shared/ipc-types';
import { ArrowLeft, Ban, PenLine, TriangleAlert, UserX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PostSkeleton, RowSkeleton } from '@/components/ui/Skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePostActions } from '@/features/feed/post-actions';
import { useRelationship } from '@/features/friends/hooks';
import { useFriendsStore } from '@/features/friends/store';
import { useIsOnline, useStartConversation } from '@/features/messages/hooks';
import { useProfilePosts, usePublicProfile } from '@/features/profile/hooks';
import { PostCard } from '@/routes/feed/components/PostCard';
import { displayName } from '@/lib/user-display';

import { FriendshipControls } from './components/FriendshipControls';
import { ProfileHeader } from './components/ProfileHeader';

/**
 * Somebody else's profile: `GET /users/{id}` for the identity and the
 * viewer's `friendStatus`, and `GET /users/{id}/posts` for the timeline.
 *
 * Visibility is applied inside the server's query, so the page count matches
 * what arrives — a non-friend simply sees fewer posts, and nothing here has to
 * filter (OWASP A01: the client is not the place that decision is made).
 *
 * Blocks, as Discord shows them. Someone the viewer blocked keeps a face and a
 * name — taken from the blocked list, since the server answers not-found for
 * anyone in a block — and loses everything else, with Unblock as the one way
 * back. Someone who blocked the viewer cannot be told apart from a deleted
 * account (the API never reveals it), so both read as unavailable.
 */
/** A blocked-list row as a profile: who they are, and nothing they wrote. */
function asProfile(author: Author): User {
  return {
    ...author,
    coverUrl: undefined,
    bio: undefined,
    status: undefined,
    createdAt: undefined,
    friendStatus: undefined,
  };
}

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const viewer = useCurrentUser();
  const {
    user,
    status: profileStatus,
    error: profileError,
    isUnavailable,
    reload,
  } = usePublicProfile(userId);
  const relationship = useRelationship(userId, user?.friendStatus);
  const isBlocked = relationship.relationship === 'blocked';
  const blockedAuthor = useFriendsStore(
    (state) => state.lists.blocked.entries.find((entry) => entry.user.id === userId)?.user,
  );
  const blockedListStatus = useFriendsStore((state) => state.lists.blocked.status);
  const blockedIdentity: User | null = isBlocked
    ? (user ?? (blockedAuthor === undefined ? null : asProfile(blockedAuthor)))
    : null;
  // A not-found may yet turn out to be a block of the viewer's own: wait for
  // the blocked list before calling the account unavailable.
  const isResolvingBlock =
    isUnavailable && (blockedListStatus === 'idle' || blockedListStatus === 'loading');
  const isOnline = useIsOnline(userId);
  const { direct, isStarting } = useStartConversation();
  const {
    posts,
    status,
    error,
    totalPosts,
    hasMore,
    isLoadingMore,
    loadMore,
    reload: reloadPosts,
    sink,
    adjustCommentCount,
  } = useProfilePosts(userId);
  const actions = usePostActions(sink);

  // Becoming (or ceasing to be) friends changes which posts are visible and
  // what the server says about the relationship: re-read both.
  const previous = useRef(relationship.relationship);
  useEffect(() => {
    if (previous.current !== relationship.relationship) {
      previous.current = relationship.relationship;
      reload();
      reloadPosts();
    }
  }, [relationship.relationship, reload, reloadPosts]);

  // Your own id in the URL is the same page as /profile.
  if (userId !== undefined && viewer !== null && viewer.id === userId) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant gap-sm px-md sticky top-0 z-10 flex items-center border-b py-2">
        <Link
          to="/feed"
          aria-label="Back"
          className="hover:bg-surface-container-high transition-tone text-on-surface flex size-9 items-center justify-center rounded-full"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-heading text-h1 text-on-surface truncate">
            {blockedIdentity !== null
              ? displayName(blockedIdentity)
              : user === null
                ? 'Profile'
                : displayName(user)}
          </h1>
          {user !== null && !isBlocked && (
            <p className="text-on-surface-variant text-[13px]">{totalPosts} posts</p>
          )}
        </div>
      </header>

      {blockedIdentity !== null && (
        <>
          <ProfileHeader
            user={blockedIdentity}
            postCount={0}
            isBlocked
            action={<FriendshipControls control={relationship} showBlock />}
          />
          <div className="m-lg bg-surface-container-low border-outline-variant gap-sm p-lg flex flex-col items-center rounded-2xl border text-center">
            <span
              aria-hidden
              className="bg-error-container text-on-error-container flex size-11 items-center justify-center rounded-full"
            >
              <Ban className="size-5" />
            </span>
            <h2 className="font-heading text-h3 text-on-surface">
              You blocked {displayName(blockedIdentity)}
            </h2>
            <p className="text-on-surface-variant max-w-copy text-[14px]">
              You won’t see their posts or messages, and they can’t see yours or message you. They
              aren’t told that you blocked them.
            </p>
          </div>
        </>
      )}

      {blockedIdentity === null &&
        (profileStatus === 'loading' || (isResolvingBlock && !isBlocked)) && (
          <div aria-busy>
            <RowSkeleton />
            <PostSkeleton />
          </div>
        )}

      {blockedIdentity === null && isUnavailable && !isResolvingBlock && (
        <EmptyState
          icon={<UserX className="size-6" />}
          title="This account isn’t available"
          description="It may have been deleted, or you can’t view it right now."
        />
      )}

      {blockedIdentity === null &&
        !isUnavailable &&
        (profileStatus === 'error' || (profileStatus === 'ready' && user === null)) && (
          <p
            role="alert"
            className="text-on-error-container bg-error-container/40 m-lg gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {profileError ?? 'That profile could not be loaded.'}
          </p>
        )}

      {blockedIdentity === null && profileStatus === 'ready' && user !== null && (
        <>
          <ProfileHeader
            user={user}
            postCount={totalPosts}
            isOnline={isOnline}
            action={
              <FriendshipControls
                control={relationship}
                showBlock
                isMessaging={isStarting}
                onMessage={
                  relationship.relationship === 'blocked'
                    ? undefined
                    : () => {
                        void direct(user.id);
                      }
                }
              />
            }
          />

          <section className="flex flex-col">
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

            {hasMore && (
              <div className="py-lg flex justify-center">
                <Button variant="secondary" isLoading={isLoadingMore} onClick={loadMore}>
                  {isLoadingMore ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
