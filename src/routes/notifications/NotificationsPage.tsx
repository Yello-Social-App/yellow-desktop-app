import { BellOff, CheckCheck, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useNotificationsStore } from '@/features/notifications/store';

import { NotificationRow } from './components/NotificationRow';

/** The activity feed: newest first, an unread-only filter, and mark-read. */
export default function NotificationsPage() {
  const {
    items,
    status,
    error,
    hasMore,
    isLoadingMore,
    unreadOnly,
    unreadCount,
    isMarkingAll,
    pendingIds,
    load,
    loadMore,
    setUnreadOnly,
    markRead,
    markAllRead,
  } = useNotificationsStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex w-full flex-col">
      <header className="gap-md flex flex-wrap items-center justify-between">
        <h1 className="font-heading text-h3 text-on-surface">Notifications</h1>
        <Button
          variant="secondary"
          leadingIcon={<CheckCheck className="size-4" />}
          disabled={unreadCount === 0}
          isLoading={isMarkingAll}
          onClick={() => {
            void markAllRead();
          }}
        >
          Mark all read
        </Button>
      </header>

      <Checkbox
        label="Unread only"
        checked={unreadOnly}
        onChange={(event) => {
          void setUnreadOnly(event.target.checked);
        }}
      />

      {(status === 'loading' || status === 'idle') && (
        <div className="py-xl flex justify-center">
          <Spinner label="Loading your notifications…" />
        </div>
      )}

      {status === 'error' && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error ?? 'Your notifications could not be loaded.'}
        </p>
      )}

      {status === 'ready' && items.length === 0 && (
        <EmptyState
          icon={<BellOff className="size-6" />}
          title={unreadOnly ? "You're all caught up" : 'No notifications yet'}
          description={
            unreadOnly
              ? 'Every notification has been read. Turn off the filter to see them all.'
              : 'Reactions, comments, reposts and friend requests will show up here.'
          }
        />
      )}

      {status === 'ready' && items.length > 0 && (
        <>
          <ul className="stagger gap-md flex flex-col">
            {items.map((notification) => (
              <li key={notification.id} className="animate-fade-up">
                <NotificationRow
                  notification={notification}
                  isPending={pendingIds.has(notification.id)}
                  onMarkRead={(id) => {
                    void markRead(id);
                  }}
                />
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                isLoading={isLoadingMore}
                onClick={() => {
                  void loadMore();
                }}
              >
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
