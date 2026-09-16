import {
  Bell,
  CircleUser,
  House,
  LayoutGrid,
  MessagesSquare,
  PenLine,
  Settings,
  Users,
  UsersRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

import { AccountMenu } from './AccountMenu';
import { usePendingRequestCount } from '@/features/friends/hooks';
import { useUnreadNotificationCount } from '@/features/notifications/hooks';
import { useUnreadMessageCount } from '@/features/messages/hooks';
import { cn } from '@/lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const ICON_CLASS = 'size-[22px] shrink-0';

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/feed', label: 'Home', icon: <House className={ICON_CLASS} /> },
  { to: '/communities', label: 'Communities', icon: <UsersRound className={ICON_CLASS} /> },
  { to: '/showcase', label: 'Showcase', icon: <LayoutGrid className={ICON_CLASS} /> },
  { to: '/messages', label: 'Messages', icon: <MessagesSquare className={ICON_CLASS} /> },
  { to: '/notifications', label: 'Notifications', icon: <Bell className={ICON_CLASS} /> },
  { to: '/friends', label: 'Friends', icon: <Users className={ICON_CLASS} /> },
  { to: '/profile', label: 'Profile', icon: <CircleUser className={ICON_CLASS} /> },
  { to: '/settings', label: 'Settings', icon: <Settings className={ICON_CLASS} /> },
];

function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * The navigation rail: large pill links, a live count on Messages (unread),
 * Notifications (unread rows) and Friends (requests waiting), the one filled
 * "Post" button, and the signed-in identity anchored at the bottom — which is
 * also the account switcher.
 */
export function Sidebar() {
  const navigate = useNavigate();
  const unreadMessages = useUnreadMessageCount();
  const pendingRequests = usePendingRequestCount();
  const unreadNotifications = useUnreadNotificationCount();

  const counts: Record<string, number> = {
    '/messages': unreadMessages,
    '/notifications': unreadNotifications,
    '/friends': pendingRequests,
  };

  return (
    <aside className="w-nav-width-side px-sm pt-md pb-md hidden shrink-0 flex-col md:flex">
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const count = counts[item.to] ?? 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={count > 0 ? `${item.label}, ${String(count)} waiting` : undefined}
              className={({ isActive }) =>
                cn(
                  'gap-md transition-tone flex items-center rounded-full py-2.5 pr-4 pl-4',
                  isActive
                    ? 'text-on-surface font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    {item.icon}
                    {count > 0 && (
                      <span
                        aria-hidden
                        className="bg-primary-container border-background absolute -top-1 -right-1 size-2.5 rounded-full border-2"
                      />
                    )}
                  </span>
                  <span className={cn('text-[17px]', isActive ? 'font-bold' : 'font-medium')}>
                    {item.label}
                  </span>
                  {count > 0 && (
                    <span className="ml-auto">
                      <Badge tone="count">{badgeLabel(count)}</Badge>
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-md px-1">
        <Button
          size="lg"
          fullWidth
          leadingIcon={<PenLine className="size-4" />}
          onClick={() => {
            void navigate('/feed', { state: { compose: true } });
          }}
        >
          Post
        </Button>
      </div>

      <AccountMenu />
    </aside>
  );
}
