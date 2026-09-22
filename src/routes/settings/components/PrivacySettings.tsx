import type { AppInfoResponse } from '@shared/ipc-types';
import { Download, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { SignOutDialog } from '@/components/layout/SignOutDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useCurrentUser } from '@/features/auth/hooks';
import { useLoadedPosts } from '@/features/feed/hooks';
import { useFriendsStore } from '@/features/friends/store';
import { useRestrictions } from '@/features/moderation/hooks';
import { useModerationStore } from '@/features/moderation/store';
import {
  REPORT_STATUS_LABELS,
  reasonLabel,
  type ReportStatus,
  type RestrictedAccount,
} from '@/features/moderation/types';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { PaneHeader, SettingsSection } from './SettingsSection';

const log = createLogger('settings.privacy');

const EXPORT_FILE_NAME = 'yello-posts';

const STATUS_TONES: Record<ReportStatus, string> = {
  UNDER_REVIEW: 'bg-primary-fixed-dim text-on-primary-fixed',
  ACTION_TAKEN: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  NO_VIOLATION: 'bg-surface-container-high text-on-surface-variant',
};

interface PrivacySettingsProps {
  appInfo: AppInfoResponse | null;
}

export function PrivacySettings({ appInfo }: PrivacySettingsProps) {
  const user = useCurrentUser();
  const posts = useLoadedPosts();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const muted = useModerationStore((state) => state.muted);
  const mutedStatus = useModerationStore((state) => state.mutedStatus);
  const reports = useModerationStore((state) => state.reports);
  const reportsStatus = useModerationStore((state) => state.reportsStatus);
  const loadReports = useModerationStore((state) => state.loadReports);
  const loadMuted = useModerationStore((state) => state.loadMuted);
  const blockedList = useFriendsStore((state) => state.lists.blocked);
  const loadFriendList = useFriendsStore((state) => state.load);
  const restrictions = useRestrictions();

  // Opening the pane re-reads all three, so a report decided or a mute made
  // on another device shows here without a restart.
  useEffect(() => {
    void loadReports();
    void loadMuted();
    void loadFriendList('blocked');
  }, [loadReports, loadMuted, loadFriendList]);

  const blocked = useMemo<RestrictedAccount[]>(
    () =>
      blockedList.entries.map((entry) => ({
        id: entry.user.id,
        name: displayName(entry.user),
        username: entry.user.username,
        since: entry.since ?? '',
      })),
    [blockedList.entries],
  );

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

  return (
    <>
      <PaneHeader
        title="Privacy & safety"
        description="Your account, who you’ve muted or blocked, and the posts you’ve reported."
      />

      <SettingsSection title="Account">
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
      </SettingsSection>

      <SettingsSection title="Security">
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
      </SettingsSection>

      <AccountList
        title="Muted accounts"
        empty="Nobody muted. Mute someone from the ⋯ menu on their post to stop seeing their posts."
        accounts={muted}
        status={mutedStatus}
        actionLabel="Unmute"
        onAction={(id) => {
          void restrictions.unmute(id);
        }}
      />

      <AccountList
        title="Blocked accounts"
        empty="Nobody blocked. You can block someone when you report their post."
        accounts={blocked}
        status={blockedList.status}
        actionLabel="Unblock"
        onAction={(id) => {
          void restrictions.unblock(id);
        }}
      />

      <SettingsSection title="Your reports">
        <Card className="divide-outline-variant flex flex-col divide-y">
          <div className="px-lg py-md flex items-center justify-between gap-3">
            <span className="text-on-surface-variant text-[13px]">
              Reports are anonymous. We tell you what we decided here.
            </span>
          </div>
          {reports.length === 0 ? (
            <p className="text-on-surface-variant px-lg py-md text-[14px]">
              {emptyText(reportsStatus, 'You haven’t reported anything.')}
            </p>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="px-lg py-md flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-on-surface text-[14px] font-medium">
                    {reasonLabel(report.reason)}
                    {report.post?.authorName != null && (
                      <span className="text-outline font-normal"> · {report.post.authorName}</span>
                    )}
                  </span>
                  {report.post?.excerpt != null && (
                    <span className="text-on-surface-variant truncate text-[13px]">
                      “{report.post.excerpt}”
                    </span>
                  )}
                  <span className="text-outline text-[12px]">{relativeTime(report.createdAt)}</span>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
                    STATUS_TONES[report.status],
                  )}
                >
                  {REPORT_STATUS_LABELS[report.status]}
                </span>
              </div>
            ))
          )}
        </Card>
      </SettingsSection>
    </>
  );
}

type ListStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What an empty list says: it may be empty, or not read yet, or unreadable. */
function emptyText(status: ListStatus, empty: string): string {
  if (status === 'error') {
    return 'This list couldn’t be loaded. Open this page again to retry.';
  }
  return status === 'ready' ? empty : 'Loading…';
}

interface AccountListProps {
  title: string;
  empty: string;
  accounts: RestrictedAccount[];
  status: ListStatus;
  actionLabel: string;
  onAction: (userId: string) => void;
}

function AccountList({ title, empty, accounts, status, actionLabel, onAction }: AccountListProps) {
  return (
    <SettingsSection title={title}>
      <Card className="divide-outline-variant flex flex-col divide-y">
        {accounts.length === 0 ? (
          <p className="text-on-surface-variant px-lg py-md text-[14px]">
            {emptyText(status, empty)}
          </p>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="px-lg py-md flex items-center gap-3">
              <Avatar
                initials={initialsOf({ username: account.username, fullName: account.name })}
                name={account.name}
                size="sm"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-on-surface truncate text-[14px] font-medium">
                  {account.name}
                </span>
                <span className="text-outline truncate text-[13px]">
                  {handleOf({ username: account.username, fullName: undefined })}
                  {account.since !== '' && <> · since {relativeTime(account.since)}</>}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onAction(account.id);
                }}
              >
                {actionLabel}
              </Button>
            </div>
          ))
        )}
      </Card>
    </SettingsSection>
  );
}
