import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useChatSubscription } from '@/features/messages/hooks';
import { cn } from '@/lib/cn';

import { RightRail } from './RightRail';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * The desktop frame: a slim glass top bar, a navigation rail on the left, a
 * centred content column with hairlines on both sides, and a context rail on
 * the right — the three-column shape of a modern timeline app.
 *
 * The search query lives here because the top bar owns the input while the
 * feed owns the filtering; it reaches the route through the outlet context
 * rather than through a global store, since nothing else needs it.
 *
 * Chat is subscribed here, not on the messages screen, so a message arriving
 * on any screen still moves its conversation and bumps the badge.
 *
 * The messages screen needs two panes, so on it the column widens into the
 * rail's slot. The frame itself never moves: the nav stays put, the column's
 * max-width and the rail's width are what animate, so the change reads as
 * the page opening up rather than the layout being swapped.
 */
export interface AppShellContext {
  searchQuery: string;
}

/** The column plus the rail, so the widened column ends where the rail did. */
const WIDE_COLUMN_CLASS = 'max-w-[calc(var(--spacing-content-max)+var(--spacing-rail-width))]';

export function AppShell() {
  const [searchQuery, setSearchQuery] = useState('');
  const { pathname } = useLocation();
  const isWide = pathname.startsWith('/messages');

  useChatSubscription();

  return (
    <div className="bg-background flex h-full flex-col">
      <Topbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1">
        <Sidebar />
        <main
          className={cn(
            'border-outline-variant min-w-0 flex-1 overflow-y-auto border-x',
            'transition-[max-width] duration-300',
            isWide ? WIDE_COLUMN_CLASS : 'max-w-content-max',
          )}
        >
          <div key={pathname} className="animate-fade-up flex min-h-full flex-col">
            <Outlet context={{ searchQuery } satisfies AppShellContext} />
          </div>
        </main>
        <RightRail isCollapsed={isWide} />
      </div>
    </div>
  );
}
