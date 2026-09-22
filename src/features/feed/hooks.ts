/**
 * Feed hooks. Loading and filtering live here so the components stay
 * presentational.
 */
import type { Post } from '@shared/ipc-types';
import { useEffect, useMemo, useState } from 'react';

import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants';
import { displayName } from '@/lib/user-display';

import { fetchPost } from './api';
import { usePostActions, type PostActions, type PostSink } from './post-actions';
import { feedPostSink, mirrorCommentCountToFeed, mirroredToFeed, useFeedStore } from './store';

export function useFeed() {
  const status = useFeedStore((state) => state.status);
  const error = useFeedStore((state) => state.error);
  const load = useFeedStore((state) => state.load);
  const loadMore = useFeedStore((state) => state.loadMore);
  const hasMore = useFeedStore((state) => state.hasMore);
  const isLoadingMore = useFeedStore((state) => state.isLoadingMore);

  const refresh = useFeedStore((state) => state.refresh);

  useEffect(() => {
    if (status === 'idle') {
      void load();
    }
  }, [status, load]);

  // The feed is kept across screens, so coming back to it — or back to the
  // window — is when it catches up with what others did meanwhile. Both are
  // throttled in the store; a revisit a few seconds later costs nothing.
  useEffect(() => {
    void refresh();
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { status, error, reload: load, loadMore, hasMore, isLoadingMore };
}

/** Client-side filtering of what is already loaded; the API has no search yet. */
export function useVisiblePosts(query: string): Post[] {
  const posts = useFeedStore((state) => state.posts);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  return useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (needle === '') {
      return posts;
    }

    return posts.filter(
      (post) =>
        post.content.toLowerCase().includes(needle) ||
        displayName(post.author).toLowerCase().includes(needle),
    );
  }, [posts, debouncedQuery]);
}

export function usePostComposer() {
  const publish = useFeedStore((state) => state.publish);
  const isPublishing = useFeedStore((state) => state.isPublishing);
  return { publish, isPublishing };
}

/** The feed's own post actions: react, edit, delete, repost, copy link. */
export function useFeedPostActions(): PostActions {
  return usePostActions(feedPostSink);
}

/** Keeps a post's comment count in step with the thread rendered under it. */
export function useFeedCommentCount(): (postId: string, delta: number) => void {
  return useFeedStore((state) => state.adjustCommentCount);
}

export function useLoadedPosts(): Post[] {
  return useFeedStore((state) => state.posts);
}

export type SinglePostStatus = 'loading' | 'ready' | 'error';

interface SinglePostState {
  post: Post | null;
  status: SinglePostStatus;
  error: string | null;
  sink: PostSink;
  adjustCommentCount: (postId: string, delta: number) => void;
}

/**
 * One post on its own, for a permalink or a notification's target.
 *
 * Held locally rather than read out of the feed: the post may never have been
 * in the feed at all — someone else's, reached from a notification — and the
 * server still enforces whether the caller may see it (403 POST_NOT_VISIBLE).
 */
export function useSinglePost(postId: string | undefined): SinglePostState {
  // Keyed by the id it was fetched for, so switching posts reads as "loading"
  // rather than briefly showing the previous one — and so nothing has to be
  // reset from inside the effect.
  // `post: null` on a loaded entry means it was deleted from this very page,
  // which is a different answer from "not fetched yet".
  const [loaded, setLoaded] = useState<{ id: string; post: Post | null } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (postId === undefined) {
      return;
    }

    let cancelled = false;

    void fetchPost(postId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLoaded({ id: postId, post: result.data });
        // This read is the freshest copy there is; the feed's may be from
        // when the app opened, so it adopts this one (a no-op if not held).
        useFeedStore.getState().replacePost(result.data);
      } else {
        setFailure({ id: postId, message: result.error.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Mirrored to the feed: this page is fetched fresh each time, the feed is
  // not, so what changes here has to reach the feed's copy of the post too.
  const sink = useMemo<PostSink>(
    () =>
      mirroredToFeed({
        replace: (updated) => {
          setLoaded((current) =>
            current?.post?.id === updated.id ? { ...current, post: updated } : current,
          );
        },
        remove: () => {
          setLoaded((current) => (current === null ? null : { ...current, post: null }));
        },
      }),
    [],
  );

  const adjustCommentCount = useMemo(
    () =>
      mirrorCommentCountToFeed((_postId, delta) => {
        setLoaded((current) =>
          current?.post == null
            ? current
            : {
                ...current,
                post: {
                  ...current.post,
                  commentCount: Math.max(0, current.post.commentCount + delta),
                },
              },
        );
      }),
    [],
  );

  // Status is derived from which id the state belongs to, so a route change
  // reads as loading without an effect having to reset anything.
  if (postId === undefined) {
    return {
      post: null,
      status: 'error',
      error: 'No post was requested.',
      sink,
      adjustCommentCount,
    };
  }
  if (failure?.id === postId) {
    return { post: null, status: 'error', error: failure.message, sink, adjustCommentCount };
  }
  if (loaded?.id === postId) {
    return { post: loaded.post, status: 'ready', error: null, sink, adjustCommentCount };
  }
  return { post: null, status: 'loading', error: null, sink, adjustCommentCount };
}
