import { ArrowLeft, FileQuestion, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import { useSinglePost } from '@/features/feed/hooks';
import { usePostActions } from '@/features/feed/post-actions';

import { PostCard } from './components/PostCard';

/**
 * A single post and its thread — reached by clicking a post in a timeline,
 * where a notification about a comment or a repost lands, and what a shared
 * link refers to. The thread is open from the start: this page is where the
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
    <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex w-full flex-col">
      <Link
        to="/feed"
        className="font-label text-label text-on-surface-variant hover:text-on-surface gap-sm transition-tone flex items-center"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to feed
      </Link>

      {status === 'loading' && (
        <div className="py-xl flex justify-center">
          <Spinner label="Loading the post…" />
        </div>
      )}

      {status === 'error' && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
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
        <PostCard
          post={post}
          actions={actions}
          viewerId={viewer?.id}
          onCommentCountChange={adjustCommentCount}
          isDetail
        />
      )}
    </div>
  );
}
