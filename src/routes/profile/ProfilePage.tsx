import { PenLine, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePostActions } from '@/features/feed/post-actions';
import { useProfileMutations, useProfilePosts } from '@/features/profile/hooks';
import { PostCard } from '@/routes/feed/components/PostCard';

import { EditProfileForm } from './components/EditProfileForm';
import { ProfileErrorNotice } from './components/ProfileErrorNotice';
import { ProfileHeader } from './components/ProfileHeader';

/** The signed-in user's own profile: identity, editing, and their timeline. */
export default function ProfilePage() {
  const user = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const mutations = useProfileMutations(user);
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
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading your profile…" />
      </div>
    );
  }

  return (
    <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex w-full flex-col">
      <ProfileHeader
        user={user}
        postCount={totalPosts}
        onEdit={() => {
          setIsEditing(true);
        }}
      />

      {!isEditing && mutations.error !== null && <ProfileErrorNotice error={mutations.error} />}

      {isEditing && (
        <EditProfileForm
          user={user}
          mutations={mutations}
          onDone={() => {
            setIsEditing(false);
          }}
        />
      )}

      <section className="gap-md flex flex-col">
        <h2 className="font-heading text-h3 text-on-surface">Posts</h2>

        {status === 'loading' && (
          <div className="py-xl flex justify-center">
            <Spinner label="Loading your posts…" />
          </div>
        )}

        {status === 'error' && (
          <p
            role="alert"
            className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
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
          <ul className="stagger gap-lg flex flex-col">
            {posts.map((post) => (
              <li key={post.id} className="animate-fade-up">
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
