import { ArrowLeft, FileQuestion, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { PostSkeleton } from '@/components/ui/Skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { useSinglePost } from '@/features/feed/hooks';
import { usePostActions } from '@/features/feed/post-actions';

import { PostCard } from './components/PostCard';

/**
 * A single post and its thread — reached by clicking a post in a timeline,
 * and what a shared link refers to. The thread is open from the start: this page is where the
 * comments are read in full.
 *
 * `GET /posts/{id}` is readable anonymously but still enforces the post's
 * visibility, so a `PRIVATE` post belonging to someone else answers 403 rather
 * than being filtered here (OWASP A01).
 */
export default function PostPage() {
  const { postId } = useParams<{ postId: string }>();
  const viewer = useCurrentUser();
  const { post, status, error, sink, adjustCommentCount } = useSinglePost(postId);
  const actions = usePostActions(sink);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant gap-sm px-md sticky top-0 z-10 flex items-center border-b py-2">
        <Link
          to="/feed"
          aria-label="Back to feed"
          className="hover:bg-surface-container-high transition-tone text-on-surface flex size-9 items-center justify-center rounded-full"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="font-heading text-h1 text-on-surface">Post</h1>
      </header>

      {status === 'loading' && (
        <div aria-busy>
          <PostSkeleton />
        </div>
      )}

      {status === 'error' && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 m-lg gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error ?? 'That post could not be loaded.'}
        </p>
      )}

      {status === 'ready' && post === null && (
        <EmptyState
          icon={<FileQuestion className="size-6" />}
          title="This post is gone"
          description="It was deleted, or is no longer visible to you."
        />
      )}

      {status === 'ready' && post !== null && (
        <div className="border-outline-variant border-b">
          <PostCard
            post={post}
            actions={actions}
            viewerId={viewer?.id}
            onCommentCountChange={adjustCommentCount}
            isDetail
          />
        </div>
      )}
    </div>
  );
}
