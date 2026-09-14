import { Bell, Bookmark, CircleUser, House, MessagesSquare, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePendingRequestCount } from '@/features/friends/hooks';
import { useNotificationsPolling, useUnreadCount } from '@/features/notifications/hooks';
import { cn } from '@/lib/cn';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Routes that exist in the design but are not part of this build. */
  disabled?: boolean;
}

const ICON_CLASS = 'size-5 shrink-0';

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/feed', label: 'Home', icon: <House className={ICON_CLASS} /> },
  { to: '/messages', label: 'Messages', icon: <MessagesSquare className={ICON_CLASS} /> },
  { to: '/profile', label: 'Profile', icon: <CircleUser className={ICON_CLASS} /> },
  { to: '/settings', label: 'Settings', icon: <Settings className={ICON_CLASS} /> },
  { to: '/friends', label: 'Friends', icon: <Users className={ICON_CLASS} /> },
  {
    to: '/notifications',
    label: 'Notifications',
    icon: <Bell className={ICON_CLASS} />,
  },
  { to: '/saved', label: 'Saved', icon: <Bookmark className={ICON_CLASS} />, disabled: true },
];

/** Active state is the 4px yellow left bar specified by the design system. */
const ITEM_BASE =
  'flex items-center gap-md rounded-r-lg border-l-4 py-3 pl-4 transition-tone duration-200';

function itemClasses(isActive: boolean): string {
  return cn(
    ITEM_BASE,
    isActive
      ? 'border-primary-container bg-surface-container-lowest text-on-surface'
      : 'border-transparent text-on-surface-variant hover:bg-surface-container-low',
  );
}

export function Sidebar() {
  const user = useCurrentUser();
  const unreadCount = useUnreadCount();
  const pendingRequests = usePendingRequestCount();
  useNotificationsPolling();

  return (
    <aside className="border-outline-variant bg-surface w-nav-width-side px-md pt-lg pb-lg hidden shrink-0 flex-col border-r md:flex">
      <div className="mb-xl gap-md flex items-center px-4">
        {user !== null && (
          <Avatar
            initials={initialsOf(user)}
            name={displayName(user)}
            imageUrl={user.avatarUrl}
            size="lg"
          />
        )}
        <div className="min-w-0">
          <h2 className="font-heading text-h3 text-on-surface truncate">
            {user === null ? 'Yello' : displayName(user)}
          </h2>
          <p className="font-small text-small text-on-surface-variant truncate">
            {user === null ? 'Premium Sanctuary' : handleOf(user)}
          </p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-2">
        {NAV_ITEMS.map((item) =>
          item.disabled === true ? (
            <span
              key={item.to}
              aria-disabled
              title="Not part of this build"
              className={cn(ITEM_BASE, 'text-on-surface-variant/40 border-transparent')}
            >
              {item.icon}
              <span className="font-label text-label">{item.label}</span>
            </span>
          ) : (
            (() => {
              // Two badges, one rule: notifications count unread, friends count
              // requests still waiting on an answer.
              const count =
                item.to === '/notifications'
                  ? unreadCount
                  : item.to === '/friends'
                    ? pendingRequests
                    : 0;
              const showBadge = count > 0;
              const badgeLabel = count > 99 ? '99+' : String(count);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-label={showBadge ? `${item.label}, ${String(count)} waiting` : undefined}
                  className={({ isActive }) => itemClasses(isActive)}
                >
                  {item.icon}
                  <span className="font-label text-label">{item.label}</span>
                  {showBadge && (
                    <span className="ml-auto">
                      <Badge tone="brand">{badgeLabel}</Badge>
                    </span>
                  )}
                </NavLink>
              );
            })()
          ),
        )}
      </nav>

      <div className="pt-xl mt-auto px-4">
        <Button fullWidth disabled title="Stories need the live API">
          Add to story
        </Button>
      </div>
    </aside>
  );
}
