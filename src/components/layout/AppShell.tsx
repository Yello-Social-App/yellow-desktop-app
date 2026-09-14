import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * The three-part desktop frame: a fixed top bar, a 280px sidebar and the
 * routed content column.
 *
 * The search query lives here because the top bar owns the input while the
 * dashboard owns the filtering; it reaches the route through the outlet
 * context rather than through a global store, since nothing else needs it.
 *
 * The routed column is keyed by path so each screen enters with the shared
 * fade-up rather than snapping into place.
 */
export interface AppShellContext {
  searchQuery: string;
}

export function AppShell() {
  const [searchQuery, setSearchQuery] = useState('');
  const { pathname } = useLocation();

  return (
    <div className="bg-background flex h-full flex-col">
      <Topbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div key={pathname} className="animate-fade-up min-h-full">
            <Outlet context={{ searchQuery } satisfies AppShellContext} />
          </div>
        </main>
      </div>
    </div>
  );
}
