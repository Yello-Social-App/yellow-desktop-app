import type { AppInfoResponse } from '@shared/ipc-types';
import type { ReactNode } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';

import { cn } from '@/lib/cn';

import { AppearanceSettings } from './components/AppearanceSettings';
import { ChangePasswordSettings } from './components/ChangePasswordSettings';
import { FeedbackSettings } from './components/FeedbackSettings';
import { NotificationSettings } from './components/NotificationSettings';
import { PrivacySettings } from './components/PrivacySettings';
import { PaneHeader } from './components/SettingsSection';
import { UpdatesPane } from './components/UpdatesPane';
import { useAppInfo } from './use-app-info';

interface SettingsPane {
  slug: string;
  label: string;
  render: (appInfo: AppInfoResponse | null) => ReactNode;
}

/**
 * Settings as a sub-nav and one pane at a time, each at `/settings/<slug>`.
 *
 * A plain table of panes rather than a route per pane: they share the frame and
 * the app info read, and adding one is a row here. An unknown slug lands on
 * the first pane instead of a blank screen.
 */
const PANES: readonly SettingsPane[] = [
  { slug: 'appearance', label: 'Appearance', render: () => <AppearanceSettings /> },
  {
    slug: 'notifications',
    label: 'Notifications',
    render: () => (
      <>
        <PaneHeader title="Notifications" description="Choose what Yello alerts you about." />
        <NotificationSettings />
      </>
    ),
  },
  {
    slug: 'privacy',
    label: 'Privacy & safety',
    render: (appInfo) => <PrivacySettings appInfo={appInfo} />,
  },
  { slug: 'password', label: 'Change password', render: () => <ChangePasswordSettings /> },
  { slug: 'updates', label: 'Updates', render: (appInfo) => <UpdatesPane appInfo={appInfo} /> },
  {
    slug: 'feedback',
    label: 'Send feedback',
    render: (appInfo) => <FeedbackSettings appInfo={appInfo} />,
  },
];

const DEFAULT_PANE = 'appearance';

export default function SettingsPage() {
  const { section } = useParams();
  const appInfo = useAppInfo();
  const pane = PANES.find((entry) => entry.slug === section);

  if (pane === undefined) {
    return <Navigate to={`/settings/${DEFAULT_PANE}`} replace />;
  }

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Settings"
        className="border-outline-variant flex w-[220px] shrink-0 flex-col gap-0.5 border-r px-3 py-6"
      >
        <h1 className="text-outline text-caption px-3 pb-2.5 font-semibold tracking-wider uppercase">
          Settings
        </h1>
        {PANES.map((entry) => (
          <NavLink
            key={entry.slug}
            to={`/settings/${entry.slug}`}
            className={({ isActive }) =>
              cn(
                'transition-tone flex h-10 items-center rounded-[10px] px-3 text-[14px] font-medium',
                isActive
                  ? 'bg-surface-container text-on-surface'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
              )
            }
          >
            {entry.label}
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div
          key={pane.slug}
          className="animate-fade-in flex max-w-[640px] flex-col gap-8 px-12 py-10"
        >
          {pane.render(appInfo)}
        </div>
      </div>
    </div>
  );
}
