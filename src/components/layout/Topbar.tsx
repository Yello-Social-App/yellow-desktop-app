import { LogOut, Search, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { useCurrentUser } from '@/features/auth/hooks';
import { displayName, initialsOf } from '@/lib/user-display';

import { SignOutDialog } from './SignOutDialog';
import { WindowControls } from './WindowControls';

interface TopbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

/**
 * The 72px translucent bar from the design system. The whole bar is a drag
 * region except for the controls sitting on it.
 */
export function Topbar({ searchQuery, onSearchChange }: TopbarProps) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);

  return (
    <header className="app-drag bg-surface/80 border-outline-variant h-topbar gap-lg px-lg flex shrink-0 items-center justify-between border-b backdrop-blur-md">
      <div className="gap-xl flex flex-1 items-center">
        <span className="font-display text-display text-primary-container select-none">Yello</span>
        <div className="app-no-drag max-w-search hidden min-w-0 flex-1 md:block">
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search Yello…"
            value={searchQuery}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            leadingIcon={<Search className="size-5" />}
            className="rounded-full py-2"
          />
        </div>
      </div>

      <div className="app-no-drag gap-sm flex items-center">
        <IconButton
          label="Settings"
          icon={<Settings className="size-5" />}
          onClick={() => {
            void navigate('/settings');
          }}
        />
        <IconButton
          label="Sign out"
          aria-haspopup="dialog"
          icon={<LogOut className="size-5" />}
          onClick={() => {
            setIsSignOutOpen(true);
          }}
        />
        {user !== null && (
          <Avatar initials={initialsOf(user)} name={displayName(user)} imageUrl={user.avatarUrl} />
        )}
        <span aria-hidden className="bg-outline-variant mx-sm h-6 w-px" />
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
