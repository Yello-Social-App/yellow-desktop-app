import {
  Bell,
  CircleUser,
  House,
  LayoutGrid,
  MessagesSquare,
  PenLine,
  Settings,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { useCurrentUser } from '@/features/auth/hooks';
import { usePendingRequestCount } from '@/features/friends/hooks';
import { useUnreadMessageCount } from '@/features/messages/hooks';
import { useUnreadNotificationCount } from '@/features/notifications/hooks';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';
import { useLayoutStore } from '@/stores/layout-store';

import { AccountMenu } from './AccountMenu';

interface NavItem {
  to: string;
  label: string;
  icon: (className: string) => ReactNode;
}

/**
 * Two groups, as the design splits them: where to go, then who to talk to.
 * Settings lives in the top bar while the rail has labels, and joins the
 * rail's foot when it is icon-only (the top bar gives the space to the title).
 */
const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  [
    { to: '/feed', label: 'Home', icon: (c) => <House className={c} /> },
    { to: '/communities', label: 'Communities', icon: (c) => <UsersRound className={c} /> },
    { to: '/showcase', label: 'Showcase', icon: (c) => <LayoutGrid className={c} /> },
  ],
  [
    { to: '/messages', label: 'Messages', icon: (c) => <MessagesSquare className={c} /> },
    { to: '/notifications', label: 'Notifications', icon: (c) => <Bell className={c} /> },
    { to: '/friends', label: 'Friends', icon: (c) => <UserPlus className={c} /> },
    { to: '/profile', label: 'Profile', icon: (c) => <CircleUser className={c} /> },
  ],
];

/** What is waiting behind an item, for its dot and its accessible name. */
function useWaitingCounts(): Record<string, number> {
  return {
    '/messages': useUnreadMessageCount(),
    '/notifications': useUnreadNotificationCount(),
    '/friends': usePendingRequestCount(),
  };
}

function accessibleName(label: string, count: number): string {
  return count > 0 ? `${label}, ${String(count)} waiting` : label;
}

/**
 * The navigation rail, in the frame's two shapes.
 *
 * Expanded is "quiet rails": 40px rows, one real active state (a raised row,
 * an accent bar and an accent icon), and a dot — not a number — for what is
 * waiting; the counts live in the accessible name and on the screens
 * themselves. Compact is the same list as 46px icon buttons with the label in a
 * tooltip; Profile leaves the list and becomes the avatar at its foot, and
 * Settings joins it there. The filled "Post" button is the rail's one accent
 * block either way.
 */
export function Sidebar() {
  const railMode = useLayoutStore((state) => state.railMode);
  return railMode === 'compact' ? <IconRail /> : <LabelledRail />;
}

function usePostButton(): () => void {
  const navigate = useNavigate();
  return () => {
    void navigate('/feed', { state: { compose: true } });
  };
}

function LabelledRail() {
  const counts = useWaitingCounts();
  const startPost = usePostButton();

  return (
    <aside className="w-nav-width-side border-outline-variant hidden shrink-0 flex-col border-r pt-3.5 pr-3 pb-3.5 pl-2.5 md:flex">
      <nav aria-label="Primary" className="flex flex-col">
        {NAV_GROUPS.map((group, index) => (
          <Fragment key={group[0]?.to ?? index}>
            {index > 0 && <span aria-hidden className="bg-outline-variant mx-3 my-3 h-px" />}
            <div className="flex flex-col gap-0.5">
              {group.map((item) => {
                const count = counts[item.to] ?? 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    aria-label={count > 0 ? accessibleName(item.label, count) : undefined}
                    className={({ isActive }) =>
                      cn(
                        'transition-tone relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px]',
                        isActive
                          ? 'bg-surface-container text-on-surface font-semibold'
                          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface font-medium',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            aria-hidden
                            className="bg-primary absolute top-[11px] left-0 h-[18px] w-[3px] rounded-r-[3px]"
                          />
                        )}
                        {item.icon(cn('size-[18px] shrink-0', isActive && 'text-primary'))}
                        <span className="flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                          <span aria-hidden className="bg-primary size-[7px] rounded-full" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </Fragment>
        ))}
      </nav>

      <button
        type="button"
        onClick={startPost}
        className="bg-primary text-on-primary mx-0.5 mt-4 flex h-11 items-center justify-center gap-2 rounded-xl text-[14.5px] font-semibold hover:brightness-110 active:brightness-95"
      >
        <PenLine aria-hidden className="size-4" />
        Post
      </button>

      <span aria-hidden className="bg-outline-variant mx-3 mt-auto mb-2.5 h-px" />
      <AccountMenu />
    </aside>
  );
}

/** A tooltip for an icon-only item: the label, shown beside it on hover or focus. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="bg-surface-container-high border-outline-strong text-on-surface shadow-floating pointer-events-none absolute top-1/2 left-14 z-50 -translate-y-1/2 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function IconRail() {
  const user = useCurrentUser();
  const counts = useWaitingCounts();
  const startPost = usePostButton();

  const iconLink = ({ isActive }: { isActive: boolean }): string =>
    cn(
      'group transition-tone relative flex size-[46px] items-center justify-center rounded-[14px]',
      isActive
        ? 'bg-primary-fixed text-primary'
        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
    );

  return (
    <aside className="w-nav-width-compact border-outline-variant hidden shrink-0 flex-col items-center gap-1.5 border-r py-3.5 md:flex">
      <nav aria-label="Primary" className="flex flex-col items-center gap-1.5">
        {NAV_GROUPS.map((group, index) => (
          <Fragment key={group[0]?.to ?? index}>
            {index > 0 && <span aria-hidden className="bg-outline-variant my-1.5 h-px w-6" />}
            {group
              .filter((item) => item.to !== '/profile')
              .map((item) => {
                const count = counts[item.to] ?? 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    aria-label={accessibleName(item.label, count)}
                    className={iconLink}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            aria-hidden
                            className="bg-primary absolute top-[13px] -left-[13px] h-5 w-[3px] rounded-r-[3px]"
                          />
                        )}
                        {item.icon('size-[21px]')}
                        {count > 0 && (
                          <span
                            aria-hidden
                            className="bg-primary border-background absolute top-2 right-2 size-2.5 rounded-full border-2"
                          />
                        )}
                        <RailTooltip label={item.label} />
                      </>
                    )}
                  </NavLink>
                );
              })}
          </Fragment>
        ))}
      </nav>

      <button
        type="button"
        aria-label="Create a post"
        onClick={startPost}
        className="group bg-primary text-on-primary relative mt-2.5 flex size-12 items-center justify-center rounded-[15px] hover:brightness-110 active:brightness-95"
      >
        <PenLine aria-hidden className="size-5" />
        <RailTooltip label="Post" />
      </button>

      <div className="flex-1" />

      <NavLink to="/settings" aria-label="Settings" className={iconLink}>
        <Settings aria-hidden className="size-[21px]" />
        <RailTooltip label="Settings" />
      </NavLink>
      {/* Here the avatar is your profile; the account menu is the top bar's pill. */}
      {user !== null && (
        <NavLink
          to="/profile"
          aria-label="Your profile"
          className={({ isActive }) =>
            cn(
              'group relative mt-1 rounded-full ring-1 transition-shadow hover:ring-2',
              isActive ? 'ring-primary ring-2' : 'ring-outline-strong',
            )
          }
        >
          <Avatar
            initials={initialsOf(user)}
            name={displayName(user)}
            imageUrl={user.avatarUrl}
            size="sm"
          />
          <RailTooltip label="Your profile" />
        </NavLink>
      )}
    </aside>
  );
}
