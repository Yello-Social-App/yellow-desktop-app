import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useFriendsSync } from '@/features/friends/hooks';
import { useChatSubscription } from '@/features/messages/hooks';
import { useSafetySync } from '@/features/moderation/hooks';
import { useNotificationSubscription } from '@/features/notifications/hooks';
import { useStoriesSync } from '@/features/stories/hooks';
import { useStoriesStore } from '@/features/stories/store';
import { useAppearance } from '@/lib/appearance';
import { cn } from '@/lib/cn';
import { StoryViewer } from '@/routes/home/components/StoryViewer';

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
 * The rails come in two shapes — labelled ("quiet rails") and icon-only with
 * one activity panel — switched from the top bar and remembered per machine
 * (stores/layout-store.ts). Each rail draws its own shape; the shell only
 * places them.
 *
 * The messages and settings screens need two panes, so on them the column
 * fills the space between the rails and the right rail folds away — as it
 * does everywhere when the activity sidebar is turned off in Settings →
 * Appearance. The nav never moves; the rail's width is what animates, so the
 * change reads as the page opening up rather than the layout being swapped.
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
  if (pathname.startsWith('/messages')) {
    return '/messages';
  }
  // Moving between settings panes swaps the pane, not the whole page.
  return pathname.startsWith('/settings') ? '/settings' : pathname;
}

export function AppShell() {
  const [searchQuery, setSearchQuery] = useState('');
  const { pathname } = useLocation();
  // Messages and Settings are two-pane screens: they fill the window and
  // scroll inside their panes.
  const isWide = pathname.startsWith('/messages') || pathname.startsWith('/settings');
  const [{ showActivityRail }] = useAppearance();
  // Home lays its composer and posts out as cards on the canvas, so its column
  // has no side hairlines; the other screens are lists that rely on them.
  const isCanvas = pathname === '/feed' || pathname === '/';

  useChatSubscription();
  useNotificationSubscription();
  useFriendsSync();
  useSafetySync();
  useStoriesSync();
  // One story viewer for the whole app: Home's rings and a profile's avatar both open it.
  const isStoryOpen = useStoriesStore((state) => state.viewer !== null);

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
              isWide
                ? 'h-full'
                : // Every other screen shares Home's column: it fills between the
                  // rails, capped so a very wide window does not stretch content
                  // into one long line, and keeps its width between screens.
                  cn('max-w-feed-max min-h-full', !isCanvas && 'border-outline-variant border-x'),
            )}
          >
            <Outlet context={{ searchQuery } satisfies AppShellContext} />
          </div>
        </main>
        <RightRail isCollapsed={isWide || !showActivityRail} />
      </div>
      {isStoryOpen && <StoryViewer />}
    </div>
  );
}
