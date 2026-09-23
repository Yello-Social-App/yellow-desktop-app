/**
 * Profile hooks: one user's timeline, another user's public profile, and
 * saving an edit of your own.
 */
import type { Post, UpdateProfileRequest, User } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAccountsStore } from '@/features/auth/accounts-store';
import { useAuthStore } from '@/features/auth/store';
import type { PostSink } from '@/features/feed/post-actions';
import { mirrorCommentCountToFeed, mirroredToFeed } from '@/features/feed/store';
import { useUsersStore } from '@/features/users/store';
import { PROFILE_POSTS_PAGE_SIZE } from '@/lib/constants';
import type { Result } from '@/lib/result';

import { fetchUser, fetchUserPosts, updateProfile, type ProfileError } from './api';

export type ProfilePostsStatus = 'loading' | 'ready' | 'error';

interface ProfilePostsState {
  posts: Post[];
  status: ProfilePostsStatus;
  error: string | null;
  totalPosts: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  /** Re-reads from the first page — after the viewer's access to the posts changed. */
  reload: () => void;
  /**
   * Where post mutations land for this timeline. A profile's posts live in
   * local state rather than the feed store, so the shared actions in
   * feed/post-actions.ts are pointed here instead — which is what makes the
   * card's buttons work on a profile at all.
   */
  sink: PostSink;
  adjustCommentCount: (postId: string, delta: number) => void;
}

/** One user's timeline — the caller's own, or anyone else's — offset-paginated. */
export function useProfilePosts(
  userId: string | undefined,
  options: { isOwnProfile?: boolean } = {},
): ProfilePostsState {
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<ProfilePostsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [totalPosts, setTotalPosts] = useState(0);
  const [page, setPage] = useState(0);
  const [isLast, setIsLast] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }

    let cancelled = false;

    void fetchUserPosts(userId, page, PROFILE_POSTS_PAGE_SIZE).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setError(result.error.message);
        setStatus('error');
        setIsLoadingMore(false);
        return;
      }

      // Page 0 replaces; later pages append.
      setPosts((current) => (page === 0 ? result.data.posts : [...current, ...result.data.posts]));
      setTotalPosts(result.data.totalElements);
      setIsLast(result.data.last);
      setStatus('ready');
      setIsLoadingMore(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId, page, generation]);

  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setPage((current) => current + 1);
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setPage(0);
    setGeneration((current) => current + 1);
  }, []);

  const isOwnProfile = options.isOwnProfile ?? false;

  // Mirrored to the feed: a timeline is fetched fresh each visit, the feed is
  // not, so what changes here has to reach the feed's copy of the post too.
  const sink = useMemo<PostSink>(
    () =>
      mirroredToFeed({
        replace: (updated) => {
          setPosts((current) => current.map((post) => (post.id === updated.id ? updated : post)));
        },
        remove: (postId) => {
          setPosts((current) => current.filter((post) => post.id !== postId));
          setTotalPosts((current) => Math.max(0, current - 1));
        },
        // A repost is the viewer's own post, so it belongs at the top of their
        // own timeline and nowhere on someone else's.
        ...(isOwnProfile
          ? {
              prepend: (post: Post) => {
                setPosts((current) => [post, ...current]);
                setTotalPosts((current) => current + 1);
              },
            }
          : {}),
      }),
    [isOwnProfile],
  );

  const adjustCommentCount = useMemo(
    () =>
      mirrorCommentCountToFeed((postId, delta) => {
        setPosts((current) =>
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
    totalPosts,
    hasMore: !isLast,
    isLoadingMore,
    loadMore,
    reload,
    sink,
    adjustCommentCount,
  };
}

export type PublicProfileStatus = 'loading' | 'ready' | 'error';

interface PublicProfileState {
  user: User | null;
  status: PublicProfileStatus;
  error: string | null;
  /**
   * The server answered not-found: a deleted account, or one in a block with
   * the viewer. The API never says which, so neither does the screen.
   */
  isUnavailable: boolean;
  reload: () => void;
}

/**
 * Another user's public profile. Narrower than `/users/me` — the API omits
 * `email` and `status` — but carries `friendStatus`. The same `User` type
 * covers both, because those fields are optional on it. Reloads when asked,
 * so a friendship action can re-read the server's answer.
 */
export function usePublicProfile(userId: string | undefined): PublicProfileState {
  // Keyed by the id it was fetched for: switching profiles reads as loading
  // rather than briefly showing the previous person, and the effect never has
  // to reset state synchronously.
  const [loaded, setLoaded] = useState<{ id: string; user: User } | null>(null);
  const [failure, setFailure] = useState<{
    id: string;
    message: string;
    notFound: boolean;
  } | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }

    let cancelled = false;

    void fetchUser(userId).then((result) => {
      if (cancelled) {
        return;
      }
      // Each answer replaces the other: a profile that 404'd while blocked
      // has to read as loaded again after the unblock, and the reverse.
      if (result.ok) {
        setLoaded({ id: userId, user: result.data });
        setFailure(null);
      } else {
        setLoaded(null);
        setFailure({
          id: userId,
          message: result.error.message,
          notFound: result.error.apiCode === 'RESOURCE_NOT_FOUND',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId, generation]);

  const reload = useCallback(() => {
    // A failure is not kept up while the re-read runs: after an unblock, the
    // old not-found would otherwise show until the profile arrives. A loaded
    // profile stays up instead, so a friendship change does not blink.
    setFailure(null);
    setGeneration((current) => current + 1);
  }, []);

  if (userId === undefined) {
    return {
      user: null,
      status: 'error',
      error: 'No profile was requested.',
      isUnavailable: false,
      reload,
    };
  }
  if (failure?.id === userId) {
    return {
      user: null,
      status: 'error',
      error: failure.message,
      isUnavailable: failure.notFound,
      reload,
    };
  }
  if (loaded?.id === userId) {
    return { user: loaded.user, status: 'ready', error: null, isUnavailable: false, reload };
  }
  return { user: null, status: 'loading', error: null, isUnavailable: false, reload };
}

/**
 * Saves an edit of the caller's own profile, then hands the server's answer to
 * every copy of it: the session (top bar, own profile), the user directory
 * (chat names and faces), and the account switcher.
 */
export function useSaveProfile(): (
  request: UpdateProfileRequest,
) => Promise<Result<User, ProfileError>> {
  const adoptUser = useAuthStore((state) => state.adoptUser);

  return useCallback(
    async (request) => {
      const result = await updateProfile(request);
      if (result.ok) {
        adoptUser(result.data);
        useUsersStore.getState().prime([result.data]);
        const accounts = useAccountsStore.getState();
        if (accounts.status !== 'idle') {
          void accounts.load();
        }
      }
      return result;
    },
    [adoptUser],
  );
}
