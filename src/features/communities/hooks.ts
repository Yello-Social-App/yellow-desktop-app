/**
 * Community hooks: the only way screens read community lists.
 *
 * Each hook loads its list the first time it is drawn, and again whenever the
 * store has marked it stale, then resolves the list's keys into the records.
 * A list filtered by membership is also filtered here, against the records, so
 * a join is reflected on the spot rather than after the refetch it triggers.
 */
import { useEffect, useMemo } from 'react';

import {
  directoryKey,
  feedKey,
  useCommunitiesStore,
  type DirectorySlice,
  type FeedSlice,
  type Lookup,
} from './store';
import type {
  Community,
  CommunityMembership,
  CommunityPost,
  CommunityPostSort,
  CommunitySort,
  PostFeedSource,
} from './types';

const IDLE_LOOKUP: Lookup = { status: 'idle', error: null };

export interface DirectoryView extends Omit<DirectorySlice, 'query' | 'slugs'> {
  items: Community[];
  loadMore: () => void;
  reload: () => void;
}

export function useCommunityDirectory(query: {
  sort: CommunitySort;
  membership?: CommunityMembership;
  q?: string;
  size?: number;
}): DirectoryView {
  const { sort, membership, q = '', size } = query;
  const key = directoryKey({ sort, membership, q, ...(size === undefined ? {} : { size }) });
  const slice = useCommunitiesStore((state) => state.directories[key]);
  const communities = useCommunitiesStore((state) => state.communities);
  const loadDirectory = useCommunitiesStore((state) => state.loadDirectory);
  const loadMoreDirectory = useCommunitiesStore((state) => state.loadMoreDirectory);
  const status = slice?.status ?? 'idle';

  useEffect(() => {
    if (status === 'idle') {
      void loadDirectory({ sort, membership, q, ...(size === undefined ? {} : { size }) });
    }
  }, [status, loadDirectory, sort, membership, q, size]);

  const slugs = slice?.slugs;
  const items = useMemo(
    () =>
      (slugs ?? []).flatMap((slug) => {
        const community = communities[slug];
        if (community === undefined) {
          return [];
        }
        if (membership === 'joined' && !community.isMember) {
          return [];
        }
        if (membership === 'not_joined' && community.isMember) {
          return [];
        }
        return [community];
      }),
    [slugs, communities, membership],
  );

  return useMemo(() => {
    const current = { sort, membership, q, ...(size === undefined ? {} : { size }) };
    return {
      items,
      status,
      page: slice?.page ?? 0,
      hasMore: slice?.hasMore ?? false,
      isLoadingMore: slice?.isLoadingMore ?? false,
      error: slice?.error ?? null,
      loadMore: () => {
        void loadMoreDirectory(current);
      },
      reload: () => {
        void loadDirectory(current);
      },
    };
  }, [items, status, slice, sort, membership, q, size, loadDirectory, loadMoreDirectory]);
}

export interface FeedView extends Omit<FeedSlice, 'source' | 'sort' | 'ids' | 'cursor'> {
  posts: CommunityPost[];
  loadMore: () => void;
  reload: () => void;
}

export function useCommunityPostFeed(source: PostFeedSource, sort: CommunityPostSort): FeedView {
  const key = feedKey(source, sort);
  const slice = useCommunitiesStore((state) => state.feeds[key]);
  const records = useCommunitiesStore((state) => state.posts);
  const loadFeed = useCommunitiesStore((state) => state.loadFeed);
  const loadMoreFeed = useCommunitiesStore((state) => state.loadMoreFeed);
  const status = slice?.status ?? 'idle';

  useEffect(() => {
    if (status === 'idle') {
      void loadFeed(source, sort);
    }
  }, [status, loadFeed, source, sort]);

  const ids = slice?.ids;
  const posts = useMemo(
    () =>
      (ids ?? []).flatMap((id) => {
        const post = records[id];
        return post === undefined ? [] : [post];
      }),
    [ids, records],
  );

  return useMemo(
    () => ({
      posts,
      status,
      hasMore: slice?.hasMore ?? false,
      isLoadingMore: slice?.isLoadingMore ?? false,
      error: slice?.error ?? null,
      loadMore: () => {
        void loadMoreFeed(source, sort);
      },
      reload: () => {
        void loadFeed(source, sort);
      },
    }),
    [posts, status, slice, source, sort, loadFeed, loadMoreFeed],
  );
}

/**
 * One community by slug. A copy already held (from a list) is drawn at once;
 * the page still reads it fresh once per session, since a list can be old.
 */
export function useCommunity(slug: string | undefined): {
  community: Community | undefined;
  lookup: Lookup;
  reload: () => void;
} {
  const community = useCommunitiesStore((state) =>
    slug === undefined ? undefined : state.communities[slug],
  );
  const lookup = useCommunitiesStore((state) =>
    slug === undefined ? IDLE_LOOKUP : (state.lookups[slug] ?? IDLE_LOOKUP),
  );
  const loadCommunity = useCommunitiesStore((state) => state.loadCommunity);

  useEffect(() => {
    if (slug !== undefined && lookup.status === 'idle') {
      void loadCommunity(slug);
    }
  }, [slug, lookup.status, loadCommunity]);

  return {
    community,
    lookup,
    reload: () => {
      if (slug !== undefined) {
        void loadCommunity(slug);
      }
    },
  };
}

/** Join or leave, and whether that is already under way for this community. */
export function useMembership(slug: string): { isBusy: boolean; toggle: (join: boolean) => void } {
  const isBusy = useCommunitiesStore((state) => state.pendingIds.has(slug));
  const setMembership = useCommunitiesStore((state) => state.setMembership);
  return {
    isBusy,
    toggle: (join) => {
      void setMembership(slug, join);
    },
  };
}
