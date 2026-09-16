import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
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
 * Dismissal is written here rather than reached for from a library: the app has
 * no popover primitive, and one panel does not justify introducing one. If a
 * second dropdown appears, this is the thing to extract.
 */
export function NotificationsBell() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = useUnreadNotificationCount();
  // Rows are fetched when the panel is first opened, not at every app start.
  const list = useNotificationList('all', isOpen);
  const { open, dismiss, markAllRead, isPending } = useNotificationActions();

  // Bound to the document only while the panel is open, so a closed panel costs
  // nothing on every click in the app.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === false) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const rows = list.items.slice(0, NOTIFICATIONS_PANEL_SIZE);
  const isLoading = list.status === 'loading' || list.status === 'idle';

  return (
    <div ref={containerRef} className="relative">
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

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="bg-surface-container-lowest border-outline-variant shadow-floating absolute top-full right-0 z-50 mt-2 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-2xl border"
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
        </div>
      )}
    </div>
  );
}
