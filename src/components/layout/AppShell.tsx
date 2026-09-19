import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useChatSubscription } from '@/features/messages/hooks';
import { useNotificationSubscription } from '@/features/notifications/hooks';
import { cn } from '@/lib/cn';

import { RightRail } from './RightRail';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * The desktop frame: a slim glass top bar, a navigation rail pinned to the
 * window's left edge, a context rail pinned to its right edge, and between
 * them a content column centred in whatever space is left — Substack's
 * shape, so a wide window grows the margins around the reading column rather
 * than the gap between the rails and the window edge.
 *
 * The search query lives here because the top bar owns the input while the
 * feed owns the filtering; it reaches the route through the outlet context
 * rather than through a global store, since nothing else needs it.
 *
 * Chat is subscribed here, not on the messages screen, so a message arriving
 * on any screen still moves its conversation and bumps the badge. Notifications
 * are subscribed for the same reason, and for one more: a clicked OS
 * notification has to be able to navigate from wherever the user was.
 *
 * The messages screen needs two panes, so on it the column fills the space
 * between the rails and the right rail folds away. The nav never moves; the
 * rail's width is what animates, so the change reads as the page opening up
 * rather than the layout being swapped.
 */
export interface AppShellContext {
  searchQuery: string;
}

/**
 * What the page-enter animation is keyed on. Every path is its own page,
 * except the messages screen: switching threads is a change inside one page,
 * and replaying the enter on the whole screen (the list included) would read
 * as the app navigating away. The thread animates its own transcript instead.
 */
function pageKeyOf(pathname: string): string {
  return pathname.startsWith('/messages') ? '/messages' : pathname;
}

export function AppShell() {
  const [searchQuery, setSearchQuery] = useState('');
  const { pathname } = useLocation();
  const isWide = pathname.startsWith('/messages');

  useChatSubscription();
  useNotificationSubscription();

  return (
    <div className="bg-background flex h-full flex-col">
      <Topbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex min-h-0 w-full flex-1">
        <Sidebar />
        <main
          className={cn(
            'min-w-0 flex-1',
            // Messages scroll inside their own panes, so the composer stays put.
            isWide ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <div
            key={pageKeyOf(pathname)}
            className={cn(
              'animate-fade-up mx-auto flex w-full flex-col',
              isWide ? 'h-full' : 'max-w-content-max border-outline-variant min-h-full border-x',
            )}
          >
            <Outlet context={{ searchQuery } satisfies AppShellContext} />
          </div>
        </main>
        <RightRail isCollapsed={isWide} />
      </div>
    </div>
  );
}
