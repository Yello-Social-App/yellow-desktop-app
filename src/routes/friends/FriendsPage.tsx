import { Ban, Compass, Search, Send, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { useFriendList, useFriendsLoader, useFriendsRefreshOnShow } from '@/features/friends/hooks';
import { useFriendsStore, type ListName } from '@/features/friends/store';
import { usePeopleSearch } from '@/features/people/hooks';
import { normalizeQuery } from '@/features/people/search';
import { PEOPLE_QUERY_MAX, type SearchScope } from '@/features/people/types';
import { cn } from '@/lib/cn';

import { DiscoverPanel } from './components/DiscoverPanel';
import { FriendRow } from './components/FriendRow';
import { PeopleSearchResults, SearchScopeBar } from './components/PeopleSearchResults';

/** A list tab, or the suggestions. */
type FriendsTab = ListName | 'discover';

function peopleQueryFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('peopleQuery' in state)) {
    return null;
  }
  const { peopleQuery } = state;
  return typeof peopleQuery === 'string' ? peopleQuery.slice(0, PEOPLE_QUERY_MAX) : null;
}

interface Tab {
  name: ListName;
  label: string;
  icon: ReactNode;
  sinceLabel: string;
  empty: { title: string; description: string };
}

const TABS: readonly Tab[] = [
  {
    name: 'friends',
    label: 'Friends',
    icon: <Users className="size-4" />,
    sinceLabel: 'friends since',
    empty: {
      title: 'No friends yet',
      description:
        'Open someone’s profile from a post and send them a request. Friends see each other’s friends-only posts and can message each other.',
    },
  },
  {
    name: 'received',
    label: 'Requests',
    icon: <UserPlus className="size-4" />,
    sinceLabel: 'sent',
    empty: {
      title: 'No requests waiting',
      description: 'When someone asks to be your friend, their request lands here.',
    },
  },
  {
    name: 'sent',
    label: 'Sent',
    icon: <Send className="size-4" />,
    sinceLabel: 'sent',
    empty: {
      title: 'Nothing pending',
      description: 'Requests you have sent and that are still unanswered show up here.',
    },
  },
  {
    name: 'blocked',
    label: 'Blocked',
    icon: <Ban className="size-4" />,
    sinceLabel: 'blocked',
    empty: {
      title: 'Nobody blocked',
      description: 'People you block cannot see your posts, message you, or find your profile.',
    },
  },
];

const DISCOVER_TAB = {
  name: 'discover',
  label: 'Discover',
  icon: <Compass className="size-4" />,
} as const;

/**
 * Friends, the requests in both directions, and blocks.
 *
 * Four tabs rather than four routes: every list comes from one store —
 * accepting a request moves a row from one to another — and a tab keeps that
 * visible without a navigation.
 *
 * The people search runs on `GET /users/search`; Discover stays on the sample
 * directory until a suggestions endpoint exists. While a search has text, its
 * results take over the screen and the tabs give way to the scope chips;
 * clearing it brings the tab back.
 */
export default function FriendsPage() {
  useFriendsLoader();
  useFriendsRefreshOnShow();
  const location = useLocation();
  const [active, setActive] = useState<FriendsTab>('friends');
  const [query, setQuery] = useState(() => peopleQueryFrom(location.state) ?? '');
  const [scope, setScope] = useState<SearchScope>('everyone');
  // A handed-over search can arrive while this screen is already open, which
  // does not remount it; adopting it during render avoids a flash of the old one.
  const [seenLocationKey, setSeenLocationKey] = useState(location.key);
  if (location.key !== seenLocationKey) {
    setSeenLocationKey(location.key);
    const handedOver = peopleQueryFrom(location.state);
    if (handedOver !== null) {
      setQuery(handedOver);
    }
  }

  const error = useFriendsStore((state) => state.error);
  const clearError = useFriendsStore((state) => state.clearError);
  const loadMore = useFriendsStore((state) => state.loadMore);
  const received = useFriendList('received');
  const tab = TABS.find((item) => item.name === active);
  const list = useFriendList(tab?.name ?? 'friends');
  const isSearching = normalizeQuery(query) !== '';
  const search = usePeopleSearch(query, scope);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg pt-3 pb-2">Friends</h1>
        <div className="px-lg pb-3">
          <Input
            type="search"
            aria-label="Search people"
            placeholder="Search people by name or @username"
            maxLength={PEOPLE_QUERY_MAX}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            leadingIcon={<Search className="size-4" />}
          />
        </div>
        {isSearching ? (
          <SearchScopeBar search={search} scope={scope} onScopeChange={setScope} />
        ) : (
          <div role="tablist" aria-label="Friends lists" className="px-sm flex">
            {[...TABS, DISCOVER_TAB].map((item) => {
              const isSelected = item.name === active;
              const count = item.name === 'received' ? received.total : 0;
              return (
                <button
                  key={item.name}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActive(item.name);
                  }}
                  className={cn(
                    'hover:bg-surface-container-low transition-tone relative flex flex-1 items-center justify-center gap-1.5 py-3 text-[14px]',
                    isSelected
                      ? 'text-on-surface font-bold'
                      : 'text-on-surface-variant font-medium',
                  )}
                >
                  {item.icon}
                  {item.label}
                  {count > 0 && <Badge tone="count">{String(count)}</Badge>}
                  {isSelected && (
                    <span
                      aria-hidden
                      className="bg-primary-container absolute inset-x-6 bottom-0 h-1 rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {error !== null && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 m-lg gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </p>
      )}

      {isSearching && <PeopleSearchResults search={search} query={query} scope={scope} />}

      {!isSearching && active === 'discover' && <DiscoverPanel />}

      {!isSearching &&
        tab !== undefined &&
        (list.status === 'loading' || list.status === 'idle') && (
          <div className="divide-hairline flex flex-col" aria-busy>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

      {!isSearching &&
        list.status === 'ready' &&
        list.entries.length === 0 &&
        tab !== undefined && (
          <EmptyState icon={tab.icon} title={tab.empty.title} description={tab.empty.description} />
        )}

      {!isSearching && list.status === 'ready' && list.entries.length > 0 && tab !== undefined && (
        <>
          <ul className="stagger divide-hairline flex flex-col">
            {list.entries.map((entry) => (
              <li key={entry.user.id} className="animate-fade-up">
                <FriendRow entry={entry} sinceLabel={tab.sinceLabel} />
              </li>
            ))}
          </ul>

          {list.hasMore && (
            <div className="py-lg flex justify-center">
              <Button
                variant="secondary"
                isLoading={list.isLoadingMore}
                onClick={() => {
                  void loadMore(tab.name);
                }}
              >
                {list.isLoadingMore ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
