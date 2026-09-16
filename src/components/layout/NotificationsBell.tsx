import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Popover } from '@/components/ui/Popover';
import { RowSkeleton } from '@/components/ui/Skeleton';
import {
  useNotificationActions,
  useNotificationList,
  useUnreadNotificationCount,
} from '@/features/notifications/hooks';
import { NOTIFICATIONS_PANEL_SIZE } from '@/features/notifications/types';
import { NotificationRow } from '@/routes/notifications/components/NotificationRow';

const BADGE_CEILING = 99;

function badgeLabel(count: number): string {
  return count > BADGE_CEILING ? `${String(BADGE_CEILING)}+` : String(count);
}

/**
 * The topbar bell and the panel it opens.
 *
 * The panel shows the newest few rows and hands the rest to `/notifications`,
 * rather than being a second, subtly different implementation of the same list:
 * both draw `NotificationRow`, both read the same store slice, so a row
 * acknowledged in one is acknowledged in the other with no plumbing between
 * them.
 *
 * Dismissal comes from the shared `Popover`, which is where this component's
 * inline version ended up once the account switcher needed the same behaviour.
 */
export function NotificationsBell() {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useUnreadNotificationCount();
  // Rows are fetched when the panel is first opened, not at every app start.
  const list = useNotificationList('all', isOpen);
  const { open, dismiss, markAllRead, isPending } = useNotificationActions();

  const rows = list.items.slice(0, NOTIFICATIONS_PANEL_SIZE);
  const isLoading = list.status === 'loading' || list.status === 'idle';

  const trigger = (
    <>
      <IconButton
        label={
          unreadCount > 0 ? `Notifications, ${badgeLabel(unreadCount)} unread` : 'Notifications'
        }
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        isActive={isOpen}
        icon={<Bell className="size-4" />}
        onClick={() => {
          setIsOpen((previous) => !previous);
        }}
      />
      {unreadCount > 0 && (
        <span
          aria-hidden
          className="bg-primary-container text-on-primary-container border-surface font-label pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[10px] font-bold tabular-nums"
        >
          {badgeLabel(unreadCount)}
        </span>
      )}
    </>
  );

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
      }}
      align="right"
      label="Notifications"
      panelClassName="w-[380px] max-h-[70vh]"
      trigger={trigger}
    >
      <header className="border-outline-variant px-lg gap-sm flex shrink-0 items-center justify-between border-b py-3">
        <h2 className="font-heading text-on-surface text-[15px] font-bold">Notifications</h2>
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<CheckCheck className="size-4" />}
            onClick={markAllRead}
          >
            Mark all read
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div aria-busy className="flex flex-col">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {list.status === 'error' && (
          <div className="gap-sm px-lg py-lg flex flex-col items-center text-center">
            <p className="text-on-surface-variant text-[13px]">
              Notifications could not be loaded.
            </p>
            <Button size="sm" variant="secondary" onClick={list.reload}>
              Try again
            </Button>
          </div>
        )}

        {list.status === 'ready' && rows.length === 0 && (
          <div className="gap-sm px-lg py-xl flex flex-col items-center text-center">
            <BellOff aria-hidden className="text-on-surface-variant size-6" />
            <p className="text-on-surface text-[14px] font-semibold">You are all caught up</p>
            <p className="text-on-surface-variant text-[13px]">
              Comments, reactions and friend requests land here.
            </p>
          </div>
        )}

        {list.status === 'ready' && rows.length > 0 && (
          <ul className="divide-hairline flex flex-col">
            {rows.map((notification) => (
              <li key={notification.id}>
                <NotificationRow
                  isCompact
                  notification={notification}
                  isPending={isPending(notification.id)}
                  onDismiss={dismiss}
                  onOpen={(row) => {
                    setIsOpen(false);
                    open(row);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-outline-variant shrink-0 border-t">
        <Link
          to="/notifications"
          onClick={() => {
            setIsOpen(false);
          }}
          className="text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-tone block py-3 text-center text-[14px] font-semibold"
        >
          See all notifications
        </Link>
      </footer>
    </Popover>
  );
}
