import { Ban, Send, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useFriendsStore, type ListName } from '@/features/friends/store';
import { cn } from '@/lib/cn';

import { FriendRow } from './components/FriendRow';

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

/**
 * Friends, the requests in both directions, and blocks.
 *
 * Four tabs rather than four routes: every list comes from one store —
 * accepting a request moves a row from one to another — and a tab keeps that
 * visible without a navigation.
 */
export default function FriendsPage() {
  useFriendsLoader();
  const [active, setActive] = useState<ListName>('friends');
  const error = useFriendsStore((state) => state.error);
  const clearError = useFriendsStore((state) => state.clearError);
  const loadMore = useFriendsStore((state) => state.loadMore);
  const received = useFriendList('received');
  const list = useFriendList(active);
  const tab = TABS.find((item) => item.name === active) ?? TABS[0];

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg pt-3 pb-2">Friends</h1>
        <div role="tablist" aria-label="Friends lists" className="px-sm flex">
          {TABS.map((item) => {
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
                  isSelected ? 'text-on-surface font-bold' : 'text-on-surface-variant font-medium',
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

      {(list.status === 'loading' || list.status === 'idle') && (
        <div className="divide-hairline flex flex-col" aria-busy>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      )}

      {list.status === 'ready' && list.entries.length === 0 && tab !== undefined && (
        <EmptyState icon={tab.icon} title={tab.empty.title} description={tab.empty.description} />
      )}

      {list.status === 'ready' && list.entries.length > 0 && tab !== undefined && (
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
                  void loadMore(active);
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
