/**
 * The Saved screen's list.
 *
 * Unsaving from this screen keeps the row in state with `isSaved: false` and
 * hides it at render, rather than dropping it: the toggle is optimistic, and a
 * failed request rolls the row back into view where it was.
 *
 * Paging has to allow for that. The list is offset-paged, and every unsave
 * shifts the rows after it forward, so asking for "page + 1" after removing
 * two would skip the two that slid onto the page already read. The rows held
 * here that are still saved are exactly the server's first N, so the next read
 * starts from N — the page containing it — and drops any row already held.
 */
import type { Post } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PostSink } from '@/features/feed/post-actions';
import { mirrorCommentCountToFeed, mirroredToFeed } from '@/features/feed/store';

import { fetchSavedPosts, SAVED_PAGE_SIZE } from './api';

export type SavedPostsStatus = 'loading' | 'ready' | 'error';

interface SavedPostsState {
  /** Only the posts still saved. */
  posts: Post[];
  status: SavedPostsStatus;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  loadMore: () => void;
  reload: () => void;
  sink: PostSink;
  adjustCommentCount: (postId: string, delta: number) => void;
}

/** Appends the rows not already held, in the order the server gave them. */
function mergeNew(held: Post[], incoming: Post[]): Post[] {
  const known = new Set(held.map((post) => post.id));
  return [...held, ...incoming.filter((post) => !known.has(post.id))];
}

export function useSavedPosts(): SavedPostsState {
  const [rows, setRows] = useState<Post[]>([]);
  const [status, setStatus] = useState<SavedPostsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isLast, setIsLast] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetchSavedPosts(0).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        setStatus('error');
        return;
      }
      setRows(result.data.posts);
      setIsLast(result.data.last);
      setStatus('ready');
    });

    return () => {
      cancelled = true;
    };
  }, [generation]);

  const posts = useMemo(() => rows.filter((post) => post.isSaved), [rows]);
  const savedCount = posts.length;

  const loadMore = useCallback(() => {
    if (isLoadingMore || isLast) {
      return;
    }
    setIsLoadingMore(true);
    setLoadMoreError(null);

    void fetchSavedPosts(Math.floor(savedCount / SAVED_PAGE_SIZE)).then((result) => {
      setIsLoadingMore(false);
      if (!result.ok) {
        setLoadMoreError(result.error.message);
        return;
      }
      setRows((current) => mergeNew(current, result.data.posts));
      setIsLast(result.data.last);
    });
  }, [isLoadingMore, isLast, savedCount]);

  const reload = useCallback(() => {
    setStatus('loading');
    setError(null);
    setGeneration((current) => current + 1);
  }, []);

  // Mirrored to the feed, which keeps its posts for the session: unsaving here
  // has to clear the bookmark on the feed's copy as well.
  const sink = useMemo<PostSink>(
    () =>
      mirroredToFeed({
        replace: (updated) => {
          setRows((current) => current.map((post) => (post.id === updated.id ? updated : post)));
        },
        remove: (postId) => {
          setRows((current) => current.filter((post) => post.id !== postId));
        },
        // No `prepend`: a repost made from here is a new post, not a saved one.
      }),
    [],
  );

  const adjustCommentCount = useMemo(
    () =>
      mirrorCommentCountToFeed((postId, delta) => {
        setRows((current) =>
          current.map((post) =>
            post.id === postId
              ? { ...post, commentCount: Math.max(0, post.commentCount + delta) }
              : post,
          ),
        );
      }),
    [],
  );

  return {
    posts,
    status,
    error,
    hasMore: !isLast,
    isLoadingMore,
    loadMoreError,
    loadMore,
    reload,
    sink,
    adjustCommentCount,
  };
}
