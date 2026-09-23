import { PanelLeftClose, PanelLeftOpen, Settings, Wifi, WifiOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { useCurrentUser } from '@/features/auth/hooks';
import { useSocketStatus } from '@/features/messages/hooks';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';
import { useLayoutStore } from '@/stores/layout-store';

import { AccountMenu } from './AccountMenu';
import { NotificationsBell } from './NotificationsBell';
import { QuickSearch } from './QuickSearch';
import { WindowControls } from './WindowControls';

interface TopbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

const SOCKET_LABELS = {
  connected: 'Live',
  connecting: 'Reconnecting…',
  disconnected: 'Offline',
} as const;

/** The page name the compact bar shows beside the logo, by route prefix. */
const PAGE_TITLES: readonly (readonly [string, string])[] = [
  ['/feed', 'Home'],
  ['/posts', 'Post'],
  ['/communities', 'Communities'],
  ['/c/', 'Communities'],
  ['/showcase', 'Showcase'],
  ['/saved', 'Saved'],
  ['/messages', 'Messages'],
  ['/notifications', 'Notifications'],
  ['/friends', 'Friends'],
  ['/profile', 'Profile'],
  ['/users', 'Profile'],
  ['/settings', 'Settings'],
];

function pageTitleOf(pathname: string): string | null {
  return PAGE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}

/**
 * The 56px bar: window chrome, one shade off the app. The whole bar is a drag
 * region except for the controls sitting on it.
 *
 * The logo column is as wide as the nav rail below it, so the two read as one
 * edge: 240px with the wordmark when the rails are labelled, 72px with the
 * page title beside it when they are icon-only (the rail no longer names where
 * you are, so the bar does). The toggle between the two sits by the logo.
 *
 * The live indicator is the chat socket's state: a quiet dot that turns yellow
 * while reconnecting. Signing out lives in the account menu at the rail's foot.
 */
export function Topbar({ searchQuery, onSearchChange }: TopbarProps) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const socket = useSocketStatus();
  const { pathname } = useLocation();
  const railMode = useLayoutStore((state) => state.railMode);
  const toggleRails = useLayoutStore((state) => state.toggleRails);
  const isCompact = railMode === 'compact';
  const title = isCompact ? pageTitleOf(pathname) : null;

  return (
    <header className="app-drag bg-chrome border-outline-variant h-topbar flex shrink-0 items-center justify-between gap-5 border-b pr-4">
      <div className="flex min-w-0 flex-1 items-center gap-5">
        <div
          className={cn(
            'flex shrink-0 items-center',
            isCompact
              ? 'w-nav-width-compact justify-center'
              : 'w-nav-width-side justify-between pr-3 pl-[18px]',
          )}
        >
          <Link
            to="/feed"
            className="app-no-drag flex items-center gap-2.5 rounded-lg select-none"
            aria-label="Home"
          >
            <span className="bg-primary text-on-primary font-display grid size-[26px] place-items-center rounded-[8px] text-[16px] font-bold">
              Y
            </span>
            {!isCompact && (
              <span className="font-display text-on-surface text-[17px] font-bold tracking-tight">
                Yello
              </span>
            )}
          </Link>
          {!isCompact && (
            <IconButton
              label="Collapse sidebars"
              size="sm"
              icon={<PanelLeftClose className="size-4" />}
              onClick={toggleRails}
              className="app-no-drag hidden md:inline-flex"
            />
          )}
        </div>

        {isCompact && (
          <IconButton
            label="Expand sidebars"
            size="sm"
            icon={<PanelLeftOpen className="size-4" />}
            onClick={toggleRails}
            className="app-no-drag -ml-3 hidden md:inline-flex"
          />
        )}
        {title !== null && (
          <h1 className="font-display text-on-surface shrink-0 text-[17px] font-bold tracking-tight">
            {title}
          </h1>
        )}
        <div className="app-no-drag hidden max-w-[420px] min-w-0 flex-1 md:block">
          <QuickSearch query={searchQuery} onQueryChange={onSearchChange} />
        </div>
      </div>

      <div className="app-no-drag gap-xs flex items-center">
        <span
          title={SOCKET_LABELS[socket]}
          className="text-on-surface-variant font-label text-caption mr-2 hidden items-center gap-1.5 uppercase md:flex"
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              socket === 'connected' && 'bg-tertiary',
              socket === 'connecting' && 'bg-primary animate-pulse',
              socket === 'disconnected' && 'bg-outline',
            )}
          />
          {socket === 'disconnected' ? (
            <WifiOff aria-hidden className="size-3.5" />
          ) : (
            <Wifi aria-hidden className="size-3.5" />
          )}
        </span>
        {/* Compact, the icon rail carries Notifications and Settings, and the
            bar keeps only the account pill; labelled, the bar carries them. */}
        {isCompact ? (
          <AccountMenu variant="pill" />
        ) : (
          <>
            <NotificationsBell />
            <IconButton
              label="Settings"
              size="sm"
              icon={<Settings className="size-4" />}
              onClick={() => {
                void navigate('/settings');
              }}
            />
          </>
        )}
        {!isCompact && user !== null && (
          <Link to="/profile" className="ml-1 rounded-full" aria-label="Your profile">
            <Avatar
              initials={initialsOf(user)}
              name={displayName(user)}
              imageUrl={user.avatarUrl}
              size="sm"
            />
          </Link>
        )}
        <span aria-hidden className="bg-outline-variant mx-sm h-5 w-px" />
        <WindowControls />
      </div>
    </header>
  );
}
