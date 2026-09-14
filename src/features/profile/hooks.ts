/**
 * Profile hooks.
 *
 * A successful edit or avatar change writes the fresh profile straight back
 * into the auth store, so the sidebar, top bar and composer all repaint from
 * one source rather than each holding a stale copy.
 */
import type { Post, User } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';
import type { PostSink } from '@/features/feed/post-actions';
import { mirrorCommentCountToFeed, mirroredToFeed } from '@/features/feed/store';
import { PROFILE_POSTS_PAGE_SIZE } from '@/lib/constants';

import {
  commitAvatar,
  fetchUser,
  fetchUserPosts,
  pickAvatar,
  updateProfile,
  type ProfileError,
} from './api';
import type { EditProfileValues } from './types';

export type ProfilePostsStatus = 'loading' | 'ready' | 'error';

interface ProfilePostsState {
  posts: Post[];
  status: ProfilePostsStatus;
  error: string | null;
  totalPosts: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
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
  }, [userId, page]);

  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setPage((current) => current + 1);
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
    sink,
    adjustCommentCount,
  };
}

export type PublicProfileStatus = 'loading' | 'ready' | 'error';

interface PublicProfileState {
  user: User | null;
  status: PublicProfileStatus;
  error: string | null;
}

/**
 * Another user's public profile. Narrower than `/users/me` — the API omits
 * `email` and `status` — but the same `User` type covers both, because those
 * two fields are optional on it.
 */
export function usePublicProfile(userId: string | undefined): PublicProfileState {
  // Keyed by the id it was fetched for: switching profiles reads as loading
  // rather than briefly showing the previous person, and the effect never has
  // to reset state synchronously.
  const [loaded, setLoaded] = useState<{ id: string; user: User } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }

    let cancelled = false;

    void fetchUser(userId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLoaded({ id: userId, user: result.data });
      } else {
        setFailure({ id: userId, message: result.error.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (userId === undefined) {
    return { user: null, status: 'error', error: 'No profile was requested.' };
  }
  if (failure?.id === userId) {
    return { user: null, status: 'error', error: failure.message };
  }
  if (loaded?.id === userId) {
    return { user: loaded.user, status: 'ready', error: null };
  }
  return { user: null, status: 'loading', error: null };
}

/** A photo chosen but not yet uploaded: a token to commit and a preview to show. */
export interface StagedAvatar {
  token: string;
  previewDataUrl: string;
}

export interface ProfileMutation {
  /** Saves the fields, and — when `avatarToken` is set — the staged photo too. */
  save: (values: EditProfileValues, avatarToken?: string | null) => Promise<boolean>;
  /** Opens the OS picker and stages the choice; null when cancelled. */
  pickAvatar: () => Promise<StagedAvatar | null>;
  isSaving: boolean;
  isPicking: boolean;
  error: ProfileError | null;
}

export function useProfileMutations(user: User | null): ProfileMutation {
  const adoptUser = useAuthStore((state) => state.adoptUser);
  const [isSaving, setIsSaving] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<ProfileError | null>(null);

  const save = useCallback(
    async (values: EditProfileValues, avatarToken?: string | null) => {
      if (user === null) {
        return false;
      }

      setIsSaving(true);
      setError(null);

      // Commit the photo first, so the profile update below returns a user that
      // already carries the new avatar URL.
      if (avatarToken !== undefined && avatarToken !== null) {
        const avatar = await commitAvatar(avatarToken);
        if (!avatar.ok) {
          setError(avatar.error);
          setIsSaving(false);
          return false;
        }
        adoptUser(avatar.data);
      }

      const result = await updateProfile(values, user);
      setIsSaving(false);

      if (!result.ok) {
        setError(result.error);
        return false;
      }

      adoptUser(result.data);
      return true;
    },
    [user, adoptUser],
  );

  const pick = useCallback(async () => {
    setIsPicking(true);
    setError(null);
    const result = await pickAvatar();
    setIsPicking(false);

    if (!result.ok) {
      setError(result.error);
      return null;
    }

    const { token, previewDataUrl, cancelled } = result.data;
    if (cancelled || token === null || previewDataUrl === null) {
      return null;
    }

    return { token, previewDataUrl };
  }, []);

  return { save, pickAvatar: pick, isSaving, isPicking, error };
}
