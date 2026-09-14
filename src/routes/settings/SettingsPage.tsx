import { Download, LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SignOutDialog } from '@/components/layout/SignOutDialog';
import { useCurrentUser } from '@/features/auth/hooks';
import { useLoadedPosts } from '@/features/feed/hooks';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';
import { useTheme, type Theme } from '@/lib/theme';
import { displayName, handleOf } from '@/lib/user-display';
import type { AppInfoResponse } from '@shared/ipc-types';

const log = createLogger('settings');

const EXPORT_FILE_NAME = 'yello-posts';

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: ReactNode }[] = [
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
  { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
];

export default function SettingsPage() {
  const user = useCurrentUser();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);
  const [theme, setTheme] = useTheme();
  const posts = useLoadedPosts();

  const handleExport = (): void => {
    void ipc
      .exportPosts({
        suggestedName: EXPORT_FILE_NAME,
        entries: posts.map((post) => ({
          id: post.id,
          content: post.content,
          createdAt: post.createdAt,
          author: post.author.username,
        })),
      })
      .then((result) => {
        if (!result.ok && result.error.code !== 'CANCELLED') {
          log.warn('export_failed', { code: result.error.code });
        }
      });
  };

  useEffect(() => {
    let cancelled = false;
    void ipc.readAppInfo().then((result) => {
      if (!cancelled && result.ok) {
        setAppInfo(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <h1 className="font-heading text-h1 text-on-surface px-lg py-3">Settings</h1>
      </header>

      <div className="gap-xl px-lg py-lg flex flex-col">
        <section className="gap-sm flex flex-col">
          <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
            Account
          </h2>
          <Card className="divide-outline-variant flex flex-col divide-y">
            {[
              { label: 'Name', value: user === null ? '—' : displayName(user) },
              { label: 'Username', value: user === null ? '—' : handleOf(user) },
              { label: 'Email', value: user?.email ?? '—' },
            ].map((row) => (
              <div key={row.label} className="px-lg py-md flex items-center justify-between gap-4">
                <span className="text-on-surface text-[15px]">{row.label}</span>
                <span className="text-on-surface-variant truncate text-[14px]">{row.value}</span>
              </div>
            ))}
            <p className="text-on-surface-variant px-lg py-md text-[13px]">
              Profile details are set when you sign up and cannot be changed in this version.
            </p>
          </Card>
        </section>

        <section className="gap-sm flex flex-col">
          <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
            Appearance
          </h2>
          <Card className="p-md">
            <div role="radiogroup" aria-label="Theme" className="gap-sm grid grid-cols-3">
              {THEME_OPTIONS.map((option) => {
                const isSelected = option.value === theme;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setTheme(option.value);
                    }}
                    className={cn(
                      'gap-xs transition-tone flex flex-col items-center rounded-xl border py-4 text-[14px] font-semibold',
                      isSelected
                        ? 'border-primary-container bg-primary-fixed text-on-primary-fixed'
                        : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                    )}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </Card>
        </section>

        <section className="gap-sm flex flex-col">
          <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
            Security
          </h2>
          <Card className="gap-sm p-lg flex flex-col">
            <p className="text-on-surface-variant gap-sm flex items-center text-[14px]">
              <ShieldCheck aria-hidden className="text-tertiary size-4 shrink-0" />
              {appInfo?.secureStorageAvailable === true
                ? 'Remembered sessions are encrypted with your operating system keychain.'
                : 'OS keychain is unavailable, so sessions end when the app closes.'}
            </p>
            <div className="gap-sm mt-sm flex flex-wrap">
              <Button
                variant="secondary"
                leadingIcon={<Download className="size-4" />}
                onClick={handleExport}
                disabled={posts.length === 0}
                title={posts.length === 0 ? 'Open the feed first to load your posts' : undefined}
              >
                Export my posts
              </Button>
              <Button
                variant="outline"
                aria-haspopup="dialog"
                leadingIcon={<LogOut className="size-4" />}
                onClick={() => {
                  setIsSignOutOpen(true);
                }}
              >
                Sign out
              </Button>
              {isSignOutOpen && (
                <SignOutDialog
                  isOpen
                  onClose={() => {
                    setIsSignOutOpen(false);
                  }}
                />
              )}
            </div>
          </Card>
        </section>

        <section className="gap-sm flex flex-col">
          <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
            About
          </h2>
          <Card className="divide-outline-variant flex flex-col divide-y">
            {[
              { label: 'App version', value: appInfo?.appVersion },
              { label: 'API', value: appInfo?.apiBaseUrl },
              { label: 'Electron', value: appInfo?.electronVersion },
              { label: 'Chromium', value: appInfo?.chromeVersion },
              { label: 'Platform', value: appInfo && `${appInfo.platform} (${appInfo.arch})` },
            ].map((row) => (
              <div key={row.label} className="px-lg py-md flex items-center justify-between gap-4">
                <span className="text-on-surface text-[15px]">{row.label}</span>
                <span className="text-on-surface-variant truncate text-[14px]">
                  {row.value ?? '—'}
                </span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
