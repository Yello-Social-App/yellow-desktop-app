/**
 * People hooks: the search, and suggestions with the relationship controls
 * for a sample person.
 */
import type { FriendEntry } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { RelationshipControl } from '@/features/friends/hooks';
import { useFriendsStore } from '@/features/friends/store';
import { LOCAL_BLOCKED_STATUS, relationshipOf } from '@/features/friends/types';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants';

import { searchPeople } from './api';
import { isSearchable, normalizeQuery } from './search';
import { usePeopleStore, type RelationshipAction } from './store';
import type { DirectoryPerson, SearchScope } from './types';

/** `short`: something was typed, but not enough to send. */
export type PeopleSearchStatus = 'idle' | 'short' | 'loading' | 'ready' | 'error';

export interface PeopleSearch {
  status: PeopleSearchStatus;
  results: FriendEntry[];
  /** Everyone: the server's total. Friends: how many of the loaded rows are friends. */
  count: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

interface LoadedSearch {
  needle: string;
  page: number;
  entries: FriendEntry[];
  total: number;
  last: boolean;
}

/**
 * People matching what was typed, from `GET /users/search`, in the server's
 * relevance order. Waits for typing to settle, and drops an answer that
 * arrives for a query no longer showing.
 *
 * The endpoint has no friends filter, so the Friends scope narrows the loaded
 * rows here; "Show more" keeps paging the server either way.
 */
export function usePeopleSearch(query: string, scope: SearchScope = 'everyone'): PeopleSearch {
  const needle = useDebouncedValue(normalizeQuery(query), SEARCH_DEBOUNCE_MS);
  const searchable = isSearchable(needle);
  const [page, setPage] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState<LoadedSearch | null>(null);
  const [failure, setFailure] = useState<{ needle: string; message: string } | null>(null);
  const blocked = useFriendsStore((state) => state.lists.blocked.entries);

  // A new query starts from its first page; adopted during render, as the
  // Friends screen does, so no request goes out for the old page number.
  const [seenNeedle, setSeenNeedle] = useState(needle);
  if (needle !== seenNeedle) {
    setSeenNeedle(needle);
    setPage(0);
  }

  useEffect(() => {
    if (!searchable) {
      return;
    }

    let cancelled = false;

    void searchPeople(needle, page).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setFailure({ needle, message: result.error.message });
        return;
      }
      setFailure(null);
      setLoaded((current) => ({
        needle,
        page,
        entries:
          page === 0 || current?.needle !== needle
            ? result.data.content
            : [...current.entries, ...result.data.content],
        total: result.data.totalElements,
        last: result.data.last,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [needle, page, generation, searchable]);

  const loadMore = useCallback(() => {
    setPage((current) => current + 1);
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setGeneration((current) => current + 1);
  }, []);

  const current = loaded?.needle === needle ? loaded : null;
  const failed = failure?.needle === needle ? failure.message : null;

  const results = useMemo(() => {
    if (current === null) {
      return [];
    }
    // The server never reveals a block, so someone on the blocked list would
    // read as NONE and be offered "Add friend"; say what the lists know.
    const blockedIds = new Set(blocked.map((entry) => entry.user.id));
    const entries = current.entries.map((entry) =>
      blockedIds.has(entry.user.id) ? { ...entry, friendStatus: LOCAL_BLOCKED_STATUS } : entry,
    );
    return scope === 'friends'
      ? entries.filter((entry) => entry.friendStatus === 'FRIENDS')
      : entries;
  }, [current, blocked, scope]);

  const base = { results, loadMore, retry, error: failed };

  if (needle === '') {
    return { ...base, status: 'idle', count: 0, hasMore: false, isLoadingMore: false };
  }
  if (!searchable) {
    return { ...base, status: 'short', count: 0, hasMore: false, isLoadingMore: false };
  }
  if (current === null) {
    return {
      ...base,
      status: failed === null ? 'loading' : 'error',
      count: 0,
      hasMore: false,
      isLoadingMore: false,
    };
  }
  return {
    ...base,
    status: 'ready',
    count: scope === 'friends' ? results.length : current.total,
    hasMore: !current.last,
    isLoadingMore: current.page < page && failed === null,
  };
}

export interface Suggestions {
  /** Friends of friends, most mutual friends first. */
  mutual: DirectoryPerson[];
  /** People met through a joined community, with no friends in common. */
  community: DirectoryPerson[];
}

export function useSuggestions(): Suggestions {
  const people = usePeopleStore((state) => state.people);

  return useMemo(() => {
    // An incoming request already has its own tab, and a block ends everything.
    const open = people.filter(
      (person) =>
        person.isSuggested &&
        (person.friendStatus === 'NONE' || person.friendStatus === 'REQUEST_SENT'),
    );
    return {
      mutual: open
        .filter((person) => person.mutualFriends.length > 0)
        .sort((a, b) => b.mutualFriends.length - a.mutualFriends.length),
      community: open.filter(
        (person) => person.mutualFriends.length === 0 && person.sharedCommunitySlug !== undefined,
      ),
    };
  }, [people]);
}

/**
 * Adapts the sample store to `RelationshipControl`, the shape the real
 * friendship buttons take — so `FriendshipControls` draws sample people
 * unchanged, and switching to the API later means switching to
 * `useRelationship` here.
 */
export function useSampleRelationship(person: DirectoryPerson): RelationshipControl {
  const apply = usePeopleStore((state) => state.apply);
  const userId = person.user.id;
  const relationship = relationshipOf(person.friendStatus);

  return useMemo(() => {
    const run = (action: RelationshipAction) => () => {
      apply(userId, action);
    };
    return {
      relationship,
      isBusy: false,
      sendRequest: run('sendRequest'),
      cancelRequest: run('cancelRequest'),
      accept: run('accept'),
      decline: run('decline'),
      unfriend: run('unfriend'),
      block: run('block'),
      unblock: run('unblock'),
    };
  }, [apply, userId, relationship]);
}
