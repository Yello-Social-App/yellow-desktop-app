import type { AppInfoResponse } from '@shared/ipc-types';
import {
  Archive,
  Bell,
  KeyRound,
  MessageSquareText,
  Palette,
  RefreshCw,
  Search,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';

import { cn } from '@/lib/cn';

import { AppearanceReset, AppearanceSettings } from './components/AppearanceSettings';
import { ChangePasswordSettings } from './components/ChangePasswordSettings';
import { FeedbackSettings } from './components/FeedbackSettings';
import { AlertsSummary, NotificationSettings } from './components/NotificationSettings';
import { PrivacySettings } from './components/PrivacySettings';
import { StoryArchiveSettings } from './components/StoryArchiveSettings';
import { UpdatesPane } from './components/UpdatesPane';
import { useAppInfo } from './use-app-info';

type PaneGroup = 'Preferences' | 'Account' | 'Your activity' | 'About';

interface SettingsPane {
  slug: string;
  group: PaneGroup;
  label: string;
  description: string;
  icon: LucideIcon;
  /** What "Find a setting" also matches: the controls the pane holds. */
  keywords: string;
  render: (appInfo: AppInfoResponse | null) => ReactNode;
  /** Sits at the right of the page header while the pane is open. */
  headerAction?: () => ReactNode;
}

/**
 * Settings as a grouped sub-nav and one pane at a time, each at
 * `/settings/<slug>`, under a header that names the open pane.
 *
 * A plain table of panes rather than a route per pane: they share the frame and
 * the app info read, and adding one is a row here. An unknown slug lands on
 * the first pane instead of a blank screen.
 */
const PANES: readonly SettingsPane[] = [
  {
    slug: 'appearance',
    group: 'Preferences',
    label: 'Appearance',
    description: 'How Yello looks on this computer. Changes apply instantly.',
    icon: Palette,
    keywords:
      'theme dark light system accent colour color density compact comfortable spacing text size font activity sidebar rail reduce motion animation',
    render: () => <AppearanceSettings />,
    headerAction: () => <AppearanceReset />,
  },
  {
    slug: 'notifications',
    group: 'Preferences',
    label: 'Notifications',
    description: 'Choose what Yello alerts you about.',
    icon: Bell,
    keywords:
      'alerts desktop push posts comments replies reposts reactions friends requests chat messages',
    render: () => <NotificationSettings />,
    headerAction: () => <AlertsSummary />,
  },
  {
    slug: 'privacy',
    group: 'Account',
    label: 'Privacy & safety',
    description: 'Your account, who you’ve muted or blocked, and the posts you’ve reported.',
    icon: Shield,
    keywords:
      'account name username email security keychain export posts sign out log out muted mute blocked block unblock reports',
    render: (appInfo) => <PrivacySettings appInfo={appInfo} />,
  },
  {
    slug: 'password',
    group: 'Account',
    label: 'Change password',
    description: 'Use a password you don’t use anywhere else.',
    icon: KeyRound,
    keywords: 'password security code email sign in',
    render: () => <ChangePasswordSettings />,
  },
  {
    slug: 'story-archive',
    group: 'Your activity',
    label: 'Story archive',
    description: 'Every story you’ve posted, kept after its 24 hours. Only you can see them.',
    icon: Archive,
    keywords: 'stories story archive history expired viewers seen by views delete photos',
    render: () => <StoryArchiveSettings />,
  },
  {
    slug: 'updates',
    group: 'About',
    label: 'Updates',
    description: 'Keep Yello current, and see which build you run.',
    icon: RefreshCw,
    keywords: 'version update check install release notes about build electron chromium platform',
    render: (appInfo) => <UpdatesPane appInfo={appInfo} />,
  },
  {
    slug: 'feedback',
    group: 'About',
    label: 'Send feedback',
    description: 'Tell us how a feature is working for you. It takes about 20 seconds.',
    icon: MessageSquareText,
    keywords: 'feedback rate rating stars feature bug suggestion',
    render: (appInfo) => <FeedbackSettings appInfo={appInfo} />,
  },
];

const GROUPS: readonly PaneGroup[] = ['Preferences', 'Account', 'Your activity', 'About'];

const DEFAULT_PANE = 'appearance';

function matches(pane: SettingsPane, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === '' || pane.label.toLowerCase().includes(needle) || pane.keywords.includes(needle)
  );
}

export default function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const appInfo = useAppInfo();
  const [query, setQuery] = useState('');
  const pane = PANES.find((entry) => entry.slug === section);

  if (pane === undefined) {
    return <Navigate to={`/settings/${DEFAULT_PANE}`} replace />;
  }

  const found = PANES.filter((entry) => matches(entry, query));

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col px-10 pt-7">
      <header className="border-outline-variant flex shrink-0 items-end gap-6 border-b pb-[22px]">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-outline flex gap-1.5 text-[12px]">
            <span>Settings</span>
            <span aria-hidden>/</span>
            <span className="text-on-surface-variant">{pane.label}</span>
          </p>
          <h1 className="font-heading text-on-surface text-[26px] font-semibold tracking-[-0.02em]">
            {pane.label}
          </h1>
          <p className="text-on-surface-variant text-[14px]">{pane.description}</p>
        </div>
        {pane.headerAction?.()}
      </header>

      <div className="flex min-h-0 flex-1 gap-9 pt-6">
        <nav aria-label="Settings" className="flex w-[208px] shrink-0 flex-col gap-[18px]">
          <label className="bg-surface-container-lowest border-outline-strong text-outline focus-within:border-outline flex h-[34px] items-center gap-2 rounded-[9px] border px-2.5">
            <Search aria-hidden className="size-4 shrink-0" />
            <input
              type="search"
              value={query}
              placeholder="Find a setting"
              aria-label="Find a setting"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                const first = found[0];
                if (event.key === 'Enter' && first !== undefined) {
                  void navigate(`/settings/${first.slug}`);
                } else if (event.key === 'Escape') {
                  setQuery('');
                }
              }}
              className="text-on-surface placeholder:text-outline w-full min-w-0 bg-transparent text-[13px] outline-none"
            />
          </label>

          {found.length === 0 && (
            <p className="text-on-surface-variant px-2.5 text-[13px]">
              No settings match “{query.trim()}”.
            </p>
          )}

          {GROUPS.map((group) => {
            const entries = found.filter((entry) => entry.group === group);
            if (entries.length === 0) {
              return null;
            }
            return (
              <div key={group} className="flex flex-col gap-0.5">
                <h2 className="text-outline px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {group}
                </h2>
                {entries.map((entry) => (
                  <NavLink
                    key={entry.slug}
                    to={`/settings/${entry.slug}`}
                    className={({ isActive }) =>
                      cn(
                        'transition-tone group flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5 text-[14px]',
                        isActive
                          ? 'bg-surface-container text-on-surface'
                          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                      )
                    }
                  >
                    <entry.icon
                      aria-hidden
                      className="group-aria-[current=page]:text-primary size-[18px] shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.slug === 'updates' && appInfo !== null && (
                      <span className="text-outline font-mono text-[11px]">
                        {appInfo.appVersion}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="@container min-w-0 flex-1 overflow-y-auto pb-8">
          <div key={pane.slug} className="animate-fade-in">
            {pane.render(appInfo)}
          </div>
        </div>
      </div>
    </div>
  );
}
