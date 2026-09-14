import { CircleUser, Download, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SignOutDialog } from '@/components/layout/SignOutDialog';
import { useCurrentUser } from '@/features/auth/hooks';
import { useLoadedPosts } from '@/features/feed/hooks';
import { ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';
import type { AppInfoResponse } from '@shared/ipc-types';

const log = createLogger('settings');

const EXPORT_FILE_NAME = 'yello-posts';

export default function SettingsPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const emailFieldId = useId();
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);
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
    <div className="max-w-content-max gap-xl px-lg py-lg mx-auto flex w-full flex-col">
      <header>
        <h1 className="font-heading text-h1 text-on-surface">Settings</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Your account and this installation.
        </p>
      </header>

      <section className="gap-md flex flex-col">
        <h2 className="font-heading text-h3 text-on-surface">Profile</h2>
        <Card elevation="floating" className="gap-md p-lg flex flex-col">
          <FormField id={emailFieldId} label="Email" hint="Your address cannot be changed here.">
            <Input id={emailFieldId} value={user?.email ?? ''} readOnly disabled />
          </FormField>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Your display name, username, bio and photo are edited on your profile.
          </p>
          <div>
            <Button
              variant="secondary"
              leadingIcon={<CircleUser className="size-4" />}
              onClick={() => {
                void navigate('/profile');
              }}
            >
              Go to profile
            </Button>
          </div>
        </Card>
      </section>

      <section className="gap-md flex flex-col">
        <h2 className="font-heading text-h3 text-on-surface">Security</h2>
        <Card elevation="floating" className="gap-sm p-lg flex flex-col">
          <p className="font-body-sm text-body-sm text-on-surface-variant gap-sm flex items-center">
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
              variant="secondary"
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

      <section className="gap-md flex flex-col">
        <h2 className="font-heading text-h3 text-on-surface">About</h2>
        <Card elevation="floating" className="divide-outline-variant flex flex-col divide-y">
          {[
            { label: 'App version', value: appInfo?.appVersion },
            { label: 'Electron', value: appInfo?.electronVersion },
            { label: 'Chromium', value: appInfo?.chromeVersion },
            { label: 'Platform', value: appInfo && `${appInfo.platform} (${appInfo.arch})` },
          ].map((row) => (
            <div key={row.label} className="px-lg py-md flex items-center justify-between">
              <span className="font-body text-body text-on-surface">{row.label}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {row.value ?? '—'}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
