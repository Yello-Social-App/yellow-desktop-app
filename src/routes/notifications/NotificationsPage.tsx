import { Bell, BellOff, CheckCheck, Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import {
  useNotificationActions,
  useNotificationList,
  useUnreadNotificationCount,
} from '@/features/notifications/hooks';
import { useNotificationsStore } from '@/features/notifications/store';
import type { NotificationFilter } from '@/features/notifications/types';
import { cn } from '@/lib/cn';

import { NotificationRow } from './components/NotificationRow';

const TABS: readonly { name: NotificationFilter; label: string }[] = [
  { name: 'all', label: 'All' },
  { name: 'unread', label: 'Unread' },
];

const EMPTY_COPY: Record<NotificationFilter, { title: string; description: string }> = {
  all: {
    title: 'Nothing here yet',
    description:
      'When someone comments on your posts, reacts to them, reposts them, or sends you a friend request, it shows up here.',
  },
  unread: {
    title: 'You are all caught up',
    description: 'Every notification has been read. New activity will appear here first.',
  },
};

/**
 * The full inbox.
 *
 * Two tabs rather than two routes, and two stored lists rather than one
 * filtered client-side: "unread" is a server-side filter, so the only honest
 * way to page through it is to ask for it — a client filter over an `all` page
 * would show however many unread rows happened to fall in the last 20.
 *
 * Paging is a button rather than a scroll sentinel, matching Friends. Rows can
 * be re-ordered by the service between two fetches (an aggregation bumps a row
 * to the top), and a deliberate press makes that visible instead of surprising.
 */
export default function NotificationsPage() {
  const [active, setActive] = useState<NotificationFilter>('all');
  const list = useNotificationList(active);
  const unreadCount = useUnreadNotificationCount();
  const { open, dismiss, markAllRead, isPending } = useNotificationActions();
  const error = useNotificationsStore((state) => state.error);
  const clearError = useNotificationsStore((state) => state.clearError);

  const isLoading = list.status === 'loading' || list.status === 'idle';

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <div className="px-lg gap-sm flex items-center justify-between pt-3 pb-2">
          <h1 className="font-heading text-h1 text-on-surface">Notifications</h1>
          <span className="gap-xs flex items-center">
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<CheckCheck className="size-4" />}
                onClick={markAllRead}
              >
                Mark all read
              </Button>
            )}
            <IconButton
              label="Check for new notifications"
              size="sm"
              icon={<RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />}
              disabled={isLoading}
              onClick={list.reload}
            />
          </span>
        </div>
        <div role="tablist" aria-label="Notification lists" className="px-sm flex">
          {TABS.map((tab) => {
            const isSelected = tab.name === active;
            const count = tab.name === 'unread' ? unreadCount : 0;
            return (
              <button
                key={tab.name}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setActive(tab.name);
                }}
                className={cn(
                  'hover:bg-surface-container-low transition-tone relative flex flex-1 items-center justify-center gap-1.5 py-3 text-[14px]',
                  isSelected ? 'text-on-surface font-bold' : 'text-on-surface-variant font-medium',
                )}
              >
                {tab.label}
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

      {isLoading && (
        <div className="divide-hairline flex flex-col" aria-busy>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      )}

      {list.status === 'error' && (
        <EmptyState
          icon={<TriangleAlert className="size-6" />}
          title="Notifications could not be loaded"
          description="The notification service could not be reached. Your other activity is unaffected."
          action={
            <Button variant="secondary" onClick={list.reload}>
              Try again
            </Button>
          }
        />
      )}

      {list.status === 'ready' && list.items.length === 0 && (
        <EmptyState
          icon={active === 'unread' ? <BellOff className="size-6" /> : <Inbox className="size-6" />}
          title={EMPTY_COPY[active].title}
          description={EMPTY_COPY[active].description}
        />
      )}

      {list.status === 'ready' && list.items.length > 0 && (
        <>
          <ul className="stagger divide-hairline flex flex-col">
            {list.items.map((notification) => (
              <li key={notification.id} className="animate-fade-up">
                <NotificationRow
                  notification={notification}
                  isPending={isPending(notification.id)}
                  onOpen={open}
                  onDismiss={dismiss}
                />
              </li>
            ))}
          </ul>

          {list.hasMore && (
            <div className="py-lg flex justify-center">
              <Button variant="secondary" isLoading={list.isLoadingMore} onClick={list.loadMore}>
                Load more
              </Button>
            </div>
          )}

          {!list.hasMore && (
            <p className="text-on-surface-variant py-lg gap-sm flex items-center justify-center text-[13px]">
              <Bell aria-hidden className="size-3.5" />
              That is everything.
            </p>
          )}
        </>
      )}
    </div>
  );
}
