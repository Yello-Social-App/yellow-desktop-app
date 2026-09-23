import type { AppInfoResponse } from '@shared/ipc-types';
import { Ban, Download, Flag, Info, LogOut, ShieldCheck, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { SignOutDialog } from '@/components/layout/SignOutDialog';
import { UnblockDialog } from '@/components/people/UnblockDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
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

import { CardHeading } from './SettingsSection';

const log = createLogger('settings.privacy');

const EXPORT_FILE_NAME = 'yello-posts';

const STATUS_TONES: Record<ReportStatus, string> = {
  UNDER_REVIEW: 'bg-primary-fixed-dim text-on-primary-fixed',
  ACTION_TAKEN: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  NO_VIOLATION: 'bg-surface-container-high text-on-surface-variant',
};

type PeopleTab = 'muted' | 'blocked' | 'reports';
type ListStatus = 'idle' | 'loading' | 'ready' | 'error';

const EMPTY_STATES: Record<PeopleTab, { icon: ReactNode; title: string; text: string }> = {
  muted: {
    icon: <VolumeX aria-hidden className="size-5" />,
    title: 'No muted accounts',
    text: 'Muted people can still see your posts. You just won’t see theirs. Mute someone from the ⋯ menu on their post.',
  },
  blocked: {
    icon: <Ban aria-hidden className="size-5" />,
    title: 'Nobody blocked',
    text: 'You can block someone from their profile, or when you report their post.',
  },
  reports: {
    icon: <Flag aria-hidden className="size-5" />,
    title: 'No reports yet',
    text: 'Reports are anonymous. We tell you what we decided here.',
  },
};

interface PrivacySettingsProps {
  appInfo: AppInfoResponse | null;
}

export function PrivacySettings({ appInfo }: PrivacySettingsProps) {
  const user = useCurrentUser();
  const posts = useLoadedPosts();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const [unblocking, setUnblocking] = useState<RestrictedAccount | null>(null);
  const [tab, setTab] = useState<PeopleTab>('muted');
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

  const tabStatus: ListStatus =
    tab === 'muted' ? mutedStatus : tab === 'blocked' ? blockedList.status : reportsStatus;
  const tabCount =
    tab === 'muted' ? muted.length : tab === 'blocked' ? blocked.length : reports.length;

  return (
    <div className="grid items-start gap-5 @3xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <div className="border-outline-variant flex items-center gap-3.5 border-b px-5 py-[18px]">
            <Avatar
              initials={user === null ? '?' : initialsOf(user)}
              name={user === null ? 'You' : displayName(user)}
              imageUrl={user?.avatarUrl}
              size="md"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-on-surface truncate text-[16px] font-semibold">
                {user === null ? '—' : displayName(user)}
              </span>
              <span className="text-on-surface-variant truncate text-[13px]">
                {user === null ? '' : handleOf(user)}
              </span>
            </div>
          </div>
          {[
            { label: 'Name', value: user === null ? '—' : displayName(user) },
            { label: 'Username', value: user === null ? '—' : handleOf(user) },
            { label: 'Email', value: user?.email ?? '—' },
          ].map((row) => (
            <div
              key={row.label}
              className="border-outline-variant flex h-12 items-center gap-4 border-b px-5 text-[14px]"
            >
              <span className="text-on-surface-variant flex-1">{row.label}</span>
              <span className="text-on-surface min-w-0 truncate">{row.value}</span>
            </div>
          ))}
          <p className="bg-surface text-outline flex items-center gap-2 px-5 py-3 text-[12px]">
            <Info aria-hidden className="size-3.5 shrink-0" />
            <span>
              Change your name and username on{' '}
              <Link to="/profile" className="text-primary hover:underline">
                your profile
              </Link>
              . Your email is set at sign-up.
            </span>
          </p>
        </Card>

        <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
          <div className="flex items-start gap-3">
            <span className="bg-tertiary-fixed text-tertiary flex size-8 shrink-0 items-center justify-center rounded-[9px]">
              <ShieldCheck aria-hidden className="size-4" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-on-surface text-[14px] font-semibold">Security</span>
              <span className="text-on-surface-variant text-[13px] leading-snug">
                {appInfo?.secureStorageAvailable === true
                  ? 'Remembered sessions are encrypted with your operating system keychain.'
                  : 'The OS keychain is unavailable, so sessions end when the app closes.'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download className="size-4" />}
              onClick={handleExport}
              disabled={posts.length === 0}
              title={posts.length === 0 ? 'Open the feed first to load your posts' : undefined}
            >
              Export my posts
            </Button>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setIsSignOutOpen(true);
              }}
              className="border-error/40 text-error hover:bg-error-container transition-tone flex h-8 items-center gap-2 rounded-[9px] border px-3 text-[13px] font-semibold"
            >
              <LogOut aria-hidden className="size-4" />
              Sign out
            </button>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeading
          title="People & reports"
          action={
            <SegmentedControl
              label="People and reports"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'muted', label: 'Muted', count: muted.length },
                { value: 'blocked', label: 'Blocked', count: blocked.length },
                { value: 'reports', label: 'Reports', count: reports.length },
              ]}
            />
          }
        />

        {tabCount === 0 ? (
          <EmptyState tab={tab} status={tabStatus} />
        ) : tab === 'reports' ? (
          <ul className="divide-outline-variant divide-y">
            <li className="text-on-surface-variant px-[18px] py-3 text-[13px]">
              Reports are anonymous. We tell you what we decided here.
            </li>
            {reports.map((report) => (
              <li key={report.id} className="flex items-start gap-3 px-[18px] py-3.5">
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
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-outline-variant divide-y">
            {(tab === 'muted' ? muted : blocked).map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-[18px] py-3.5">
                <Avatar
                  initials={initialsOf({ username: account.username, fullName: account.name })}
                  name={account.name}
                  size="md"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-on-surface truncate text-[14px] font-medium">
                    {account.name}
                  </span>
                  <span className="text-outline truncate text-[12px]">
                    {handleOf({ username: account.username, fullName: undefined })}
                    {account.since !== '' &&
                      ` · ${tab === 'muted' ? 'muted' : 'blocked'} ${relativeTime(account.since)}`}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (tab === 'muted') {
                      void restrictions.unmute(account.id);
                    } else {
                      setUnblocking(account);
                    }
                  }}
                >
                  {tab === 'muted' ? 'Unmute' : 'Unblock'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isSignOutOpen && (
        <SignOutDialog
          isOpen
          onClose={() => {
            setIsSignOutOpen(false);
          }}
        />
      )}
      {unblocking !== null && (
        <UnblockDialog
          name={unblocking.name}
          onConfirm={() => restrictions.unblock(unblocking.id)}
          onClose={() => {
            setUnblocking(null);
          }}
        />
      )}
    </div>
  );
}

/** What an empty tab says: it may be empty, or not read yet, or unreadable. */
function EmptyState({ tab, status }: { tab: PeopleTab; status: ListStatus }) {
  const empty = EMPTY_STATES[tab];
  const title =
    status === 'error'
      ? 'This list couldn’t be loaded'
      : status === 'ready'
        ? empty.title
        : 'Loading…';
  const text =
    status === 'error' ? 'Open this page again to retry.' : status === 'ready' ? empty.text : '';

  return (
    <div className="flex flex-col items-center gap-2.5 px-8 py-12 text-center">
      <span className="bg-surface-container text-outline flex size-11 items-center justify-center rounded-full">
        {empty.icon}
      </span>
      <span className="text-on-surface text-[14px] font-medium">{title}</span>
      {text !== '' && (
        <span className="text-on-surface-variant max-w-[320px] text-[13px] leading-normal">
          {text}
        </span>
      )}
    </div>
  );
}
