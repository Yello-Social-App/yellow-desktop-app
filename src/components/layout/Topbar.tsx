import { LogOut, Settings, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { useCurrentUser } from '@/features/auth/hooks';
import { useSocketStatus } from '@/features/messages/hooks';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';

import { NotificationsBell } from './NotificationsBell';
import { QuickSearch } from './QuickSearch';
import { SignOutDialog } from './SignOutDialog';
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

/**
 * The 56px frosted bar. The whole bar is a drag region except for the
 * controls sitting on it. The live indicator is the chat socket's state: a
 * quiet dot that turns yellow while reconnecting.
 */
export function Topbar({ searchQuery, onSearchChange }: TopbarProps) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const socket = useSocketStatus();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);

  return (
    <header className="app-drag glass border-outline-variant h-topbar gap-lg px-md flex shrink-0 items-center justify-between border-b">
      <div className="gap-lg flex flex-1 items-center">
        <Link
          to="/feed"
          className="app-no-drag flex items-center gap-2 rounded-full pr-2 select-none"
          aria-label="Home"
        >
          <span className="bg-primary-container text-on-primary-container font-display grid size-8 place-items-center rounded-lg text-[15px] font-extrabold">
            Y
          </span>
          <span className="font-display text-on-surface hidden text-[17px] font-bold tracking-tight md:inline">
            Yello
          </span>
        </Link>
        <div className="app-no-drag max-w-search hidden min-w-0 flex-1 md:block">
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
        <NotificationsBell />
        <IconButton
          label="Settings"
          size="sm"
          icon={<Settings className="size-4" />}
          onClick={() => {
            void navigate('/settings');
          }}
        />
        <IconButton
          label="Sign out"
          size="sm"
          aria-haspopup="dialog"
          icon={<LogOut className="size-4" />}
          onClick={() => {
            setIsSignOutOpen(true);
          }}
        />
        {user !== null && (
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

      {isSignOutOpen && (
        <SignOutDialog
          isOpen
          onClose={() => {
            setIsSignOutOpen(false);
          }}
        />
      )}
    </header>
  );
}
