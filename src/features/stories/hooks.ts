/**
 * Story hooks: the only way screens read stories. The rings are kept loaded
 * app-wide by `useStoriesSync` (mounted once, in the app shell), because any
 * avatar may wear one; it refreshes when the window regains focus and on a
 * slow timer, since the API pushes no "story posted" event.
 */
import type { StoryReply, StoryType, StoryViewer } from '@shared/ipc-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';

import { fetchStoryViewers, storyErrorMessage } from './api';
import { useStoriesStore, type LoadStatus, type PreviewStatus, type RingEntry } from './store';
import { hasExpired, type Story, type StoryRing } from './types';

/** A focus within this long of the last load does not load again. */
const FOCUS_REFRESH_AFTER_MS = 60_000;
/** Rings drop out at exactly 24 hours; this keeps a long-open window honest. */
const BACKGROUND_REFRESH_MS = 5 * 60_000;
/** How often a drawn ring re-checks which of its slides have passed their 24 hours. */
const EXPIRY_TICK_MS = 60_000;

/** The time, re-read once a minute: enough to drop a slide the moment it expires. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, EXPIRY_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

/**
 * A ring's playable slides. Someone else's slide past its 24 hours is left out
 * even before a refresh drops it: its image would no longer load anyway.
 */
function ringOf(
  entry: RingEntry | undefined,
  records: Record<string, Story>,
  now: number,
): StoryRing | null {
  if (entry === undefined) {
    return null;
  }
  const slides = entry.storyIds.flatMap((id) => {
    const story = records[id];
    if (story === undefined || (!story.isOwner && hasExpired(story.expiresAt, now))) {
      return [];
    }
    return [story];
  });
  if (slides.length === 0) {
    return null;
  }
  return { author: entry.author, slides, hasUnseen: slides.some((slide) => !slide.isSeen) };
}

export interface StoriesRowView {
  /** The viewer's own ring, or null with nothing active. */
  mine: StoryRing | null;
  /** Friends' rings, unwatched first. */
  rings: StoryRing[];
  status: LoadStatus;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Loads the rings and keeps them current for the whole session. Mount once,
 * in the app shell: the Home row, profiles and every avatar read what it loads.
 */
export function useStoriesSync(): void {
  const isSignedIn = useCurrentUser() !== null;
  const feedStatus = useStoriesStore((state) => state.feed.status);
  const mineStatus = useStoriesStore((state) => state.mineStatus);
  const loadFeed = useStoriesStore((state) => state.loadFeed);
  const loadMine = useStoriesStore((state) => state.loadMine);

  useEffect(() => {
    if (isSignedIn && feedStatus === 'idle') {
      void loadFeed();
    }
  }, [isSignedIn, feedStatus, loadFeed]);

  useEffect(() => {
    if (isSignedIn && mineStatus === 'idle') {
      void loadMine();
    }
  }, [isSignedIn, mineStatus, loadMine]);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    const reload = (): void => {
      void loadFeed();
      void loadMine();
    };
    const onFocus = (): void => {
      const { feed: latest } = useStoriesStore.getState();
      if (latest.status !== 'loading' && Date.now() - latest.loadedAt > FOCUS_REFRESH_AFTER_MS) {
        reload();
      }
    };
    window.addEventListener('focus', onFocus);
    const timer = setInterval(reload, BACKGROUND_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [isSignedIn, loadFeed, loadMine]);
}

/**
 * Whether a person has a story, for the ring on their avatar anywhere in the
 * app: `unseen`, `seen`, or undefined for none. Read from rings already loaded
 * — the friends feed, your own, and profiles opened — never by a request per
 * avatar. Returns a string so an avatar re-renders only when its ring changes.
 */
export function useStoryRingState(userId: string | undefined): 'unseen' | 'seen' | undefined {
  return useStoriesStore((state) => {
    const entry = userId === undefined ? undefined : state.rings[userId];
    if (entry === undefined) {
      return undefined;
    }
    const now = Date.now();
    let hasAny = false;
    for (const id of entry.storyIds) {
      const story = state.stories[id];
      if (story === undefined || (!story.isOwner && hasExpired(story.expiresAt, now))) {
        continue;
      }
      // Your own is always "seen" upstream, but an active story of yours wears
      // the accent, as the "Your story" ring on Home does.
      if (!story.isSeen || story.isOwner) {
        return 'unseen';
      }
      hasAny = true;
    }
    return hasAny ? 'seen' : undefined;
  });
}

export function useStoriesRow(): StoriesRowView {
  const user = useCurrentUser();
  const records = useStoriesStore((state) => state.stories);
  const rings = useStoriesStore((state) => state.rings);
  const feed = useStoriesStore((state) => state.feed);
  const loadFeed = useStoriesStore((state) => state.loadFeed);
  const loadMoreFeed = useStoriesStore((state) => state.loadMoreFeed);
  const loadMine = useStoriesStore((state) => state.loadMine);
  const now = useMinuteClock();

  const reload = useCallback(() => {
    void loadFeed();
    void loadMine();
  }, [loadFeed, loadMine]);

  const myId = user?.id;
  const view = useMemo(() => {
    const friends = feed.authorIds
      .filter((id) => id !== myId)
      .flatMap((id) => {
        const ring = ringOf(rings[id], records, now);
        return ring === null ? [] : [ring];
      });
    // Stable: within each half the server's order (newest first) holds.
    friends.sort((a, b) => Number(b.hasUnseen) - Number(a.hasUnseen));
    return {
      mine: myId === undefined ? null : ringOf(rings[myId], records, now),
      rings: friends,
    };
  }, [feed.authorIds, rings, records, myId, now]);

  return {
    ...view,
    status: feed.status,
    error: feed.error,
    hasMore: feed.hasMore,
    isLoadingMore: feed.isLoadingMore,
    loadMore: () => {
      void loadMoreFeed();
    },
    reload,
  };
}

/**
 * One person's ring for their profile avatar: null while loading, with nothing
 * to watch, or behind a block. `reload` re-reads it, for when a friendship
 * change widens or narrows what the viewer may see.
 */
export function useUserStoryRing(userId: string | undefined): {
  ring: StoryRing | null;
  reload: () => void;
} {
  const entry = useStoriesStore((state) =>
    userId === undefined ? undefined : state.rings[userId],
  );
  const records = useStoriesStore((state) => state.stories);
  const lookup = useStoriesStore((state) =>
    userId === undefined ? undefined : state.userLookups[userId],
  );
  const loadUser = useStoriesStore((state) => state.loadUser);
  const now = useMinuteClock();

  useEffect(() => {
    if (userId !== undefined && lookup === undefined) {
      void loadUser(userId);
    }
  }, [userId, lookup, loadUser]);

  const ring = useMemo(() => ringOf(entry, records, now), [entry, records, now]);
  const reload = useCallback(() => {
    if (userId !== undefined) {
      void loadUser(userId);
    }
  }, [userId, loadUser]);
  return { ring, reload };
}

/** The rings the open viewer walks, resolved live so seen flips and fresh links reach it. */
export function useViewerRings(): StoryRing[] {
  const sequence = useStoriesStore((state) => state.viewer?.sequence);
  const rings = useStoriesStore((state) => state.rings);
  const records = useStoriesStore((state) => state.stories);
  const now = useMinuteClock();

  return useMemo(() => {
    return (sequence ?? []).flatMap((authorId) => {
      const ring = ringOf(rings[authorId], records, now);
      return ring === null ? [] : [ring];
    });
  }, [sequence, rings, records, now]);
}

/** What a chat reply's bubble shows: the story while it can be read, else "unavailable". */
export function useStoryPreview(
  reply: StoryReply | null,
  viewerId: string | null,
): { status: PreviewStatus | 'idle'; story: Story | undefined } {
  const storyId = reply?.storyId;
  const status = useStoriesStore((state) =>
    storyId === undefined ? undefined : state.previews[storyId],
  );
  const story = useStoriesStore((state) =>
    storyId === undefined ? undefined : state.stories[storyId],
  );
  const ensurePreview = useStoriesStore((state) => state.ensurePreview);

  useEffect(() => {
    if (reply !== null) {
      ensurePreview(reply, viewerId);
    }
  }, [reply, viewerId, ensurePreview]);

  return { status: status ?? 'idle', story };
}

export interface ArchiveView {
  stories: Story[];
  status: LoadStatus;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/** The viewer's own stories, expired ones included, newest first; optionally one type. */
export function useStoryArchive(type: StoryType | undefined): ArchiveView {
  const archive = useStoriesStore((state) => state.archive);
  const records = useStoriesStore((state) => state.stories);
  const loadArchive = useStoriesStore((state) => state.loadArchive);
  const loadMoreArchive = useStoriesStore((state) => state.loadMoreArchive);

  const isCurrent = archive.type === type;
  useEffect(() => {
    if (!isCurrent || archive.status === 'idle') {
      void loadArchive(type);
    }
  }, [isCurrent, archive.status, type, loadArchive]);

  const stories = useMemo(
    () =>
      archive.ids.flatMap((id) => {
        const story = records[id];
        return story === undefined ? [] : [story];
      }),
    [archive.ids, records],
  );

  return {
    stories: isCurrent ? stories : [],
    status: isCurrent ? archive.status : 'loading',
    error: isCurrent ? archive.error : null,
    hasMore: isCurrent && archive.hasMore,
    isLoadingMore: archive.isLoadingMore,
    loadMore: () => {
      void loadMoreArchive();
    },
    reload: () => {
      void loadArchive(type);
    },
  };
}

export interface ViewersView {
  viewers: StoryViewer[];
  status: LoadStatus;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * Who watched one of the viewer's own stories, newest first. Held here rather
 * than in the store: only the dialog that asked draws it, and it is read fresh
 * each time that dialog opens. Callers key the component by story id, so
 * another story is a fresh mount rather than a list reset in place.
 */
export function useStoryViewers(storyId: string): ViewersView {
  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    void fetchStoryViewers(storyId, 0).then((result) => {
      if (!isCurrent) {
        return;
      }
      if (!result.ok) {
        setStatus('error');
        setError(storyErrorMessage(result.error));
        return;
      }
      setViewers(result.data.content);
      setPage(result.data.page);
      setHasMore(!result.data.last);
      setStatus('ready');
    });
    return () => {
      isCurrent = false;
    };
  }, [storyId]);

  const loadMore = (): void => {
    if (status !== 'ready' || !hasMore || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void fetchStoryViewers(storyId, page + 1).then((result) => {
      setIsLoadingMore(false);
      if (!result.ok) {
        setError(storyErrorMessage(result.error));
        return;
      }
      setViewers((held) => {
        const seen = new Set(held.map((row) => row.user.id));
        return [...held, ...result.data.content.filter((row) => !seen.has(row.user.id))];
      });
      setPage(result.data.page);
      setHasMore(!result.data.last);
    });
  };

  return { viewers, status, error, hasMore, isLoadingMore, loadMore };
}
