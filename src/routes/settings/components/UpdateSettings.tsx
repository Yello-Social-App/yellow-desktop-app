import type { UpdateMode, UpdateState } from '@shared/ipc-types';
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { useAppUpdates, type AppUpdates } from '@/features/updates/hooks';
import { relativeTime } from '@/lib/relative-time';

/**
 * Updates: where this install stands, and whether to look automatically.
 *
 * What the buttons can do depends on how Yello was installed, and the copy
 * says so rather than offering something that cannot happen. The .exe install
 * and every Linux package (AppImage, deb, rpm, pacman) update in place from
 * one "Update now" click — download, verify, install, restart — with the
 * system's password prompt for the Linux packages that install as root.
 * Nothing is uninstalled first. A Microsoft Store install is updated
 * by the Store alone, so it is told a newer version exists and that the Store
 * will deliver it after Microsoft's review — never offered an installer from
 * elsewhere, which would put a second, separate copy on the machine.
 */
const BUILD_KINDS: Record<UpdateMode, string> = {
  installer: 'Installed build',
  store: 'Microsoft Store build',
  notify: 'Installed build',
  unavailable: 'Development build',
};

export function UpdateSettings() {
  const updates = useAppUpdates();
  const { state } = updates;

  return (
    <Card className="flex flex-col gap-[18px] p-[22px]">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="bg-primary-container text-on-primary-container flex size-12 shrink-0 items-center justify-center rounded-xl text-[22px] font-bold"
        >
          Y
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-[18px] font-semibold">
            Yello {state?.currentVersion ?? ''}
          </span>
          <span className="text-on-surface-variant text-[13px]">
            {state === null ? '—' : BUILD_KINDS[state.mode]}
          </span>
        </div>
      </div>

      {state === null ? (
        <Spinner label="Reading update status" />
      ) : (
        <>
          <StatusRow state={state} updates={updates} />
          {state.mode !== 'unavailable' && (
            <div className="border-outline-variant flex items-center gap-4 border-t pt-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-on-surface text-[14px] font-medium">
                  Check for updates automatically
                </span>
                <span className="text-on-surface-variant text-[12px]">
                  When Yello opens and every few hours after. Nothing is downloaded until you choose
                  to.
                </span>
              </div>
              <Switch
                label="Check for updates automatically"
                checked={state.autoCheck}
                onChange={updates.setAutoCheck}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

interface StatusRowProps {
  state: UpdateState;
  updates: AppUpdates;
}

/** Where a newer version comes from when this app cannot install it itself. */
function elsewhereHint(state: UpdateState): string {
  if (state.mode === 'store') {
    return 'It will arrive through the Microsoft Store once Microsoft has reviewed it.';
  }
  // macOS, or Linux as an unpacked tarball (no package to upgrade); every
  // packaged Linux install updates from the button instead.
  return 'Download it from the release page.';
}

function StatusRow({ state, updates }: StatusRowProps) {
  const checkedLine =
    state.checkedAt === null
      ? `You have version ${state.currentVersion}.`
      : `You have version ${state.currentVersion}. Checked ${relativeTime(new Date(state.checkedAt).toISOString())}.`;

  const checkButton = (label: string) => (
    <Button size="sm" leadingIcon={<RefreshCw className="size-4" />} onClick={updates.check}>
      {label}
    </Button>
  );
  const notesButton = (
    <Button
      size="sm"
      variant="ghost"
      leadingIcon={<ExternalLink className="size-4" />}
      onClick={updates.openReleaseNotes}
    >
      Release notes
    </Button>
  );

  switch (state.status) {
    case 'checking':
      return (
        <Row
          icon={<Spinner label="Checking" />}
          title="Checking for updates…"
          detail={checkedLine}
        />
      );

    case 'available': {
      const version = state.latestVersion ?? 'A newer version';
      if (state.mode === 'installer') {
        return (
          <Row
            icon={<Sparkles aria-hidden className="text-primary size-4" />}
            title={`Version ${version} is available`}
            detail={`You have ${state.currentVersion}. ${
              state.asksForPassword
                ? 'Update now installs it over this one — your system asks for your password — then Yello restarts. Your settings and sign-ins are kept.'
                : 'Update now installs it over this one and restarts Yello. Your settings and sign-ins are kept.'
            }`}
            actions={
              <>
                {notesButton}
                <Button
                  size="sm"
                  leadingIcon={<Download className="size-4" />}
                  onClick={updates.updateNow}
                >
                  Update now
                </Button>
              </>
            }
          />
        );
      }
      return (
        <Row
          icon={<Sparkles aria-hidden className="text-primary size-4" />}
          title={`Version ${version} is out`}
          detail={`You have ${state.currentVersion}. ${elsewhereHint(state)}`}
          actions={
            <>
              {notesButton}
              {checkButton('Check again')}
            </>
          }
        />
      );
    }

    case 'downloading':
      return (
        <div
          role="status"
          className="bg-surface-container-low border-outline-variant flex flex-col gap-2 rounded-[10px] border px-3.5 py-3"
        >
          <span className="text-on-surface text-[13px]">
            {`Downloading version ${state.latestVersion ?? ''}…`}
          </span>
          {/* Native, because the production CSP refuses inline width styles. */}
          <progress
            aria-label="Download progress"
            max={100}
            value={state.progress ?? 0}
            className="[&::-webkit-progress-bar]:bg-surface-container-high [&::-webkit-progress-value]:bg-primary block h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full"
          />
          <span className="text-on-surface-variant font-mono text-[12px]">
            {`${String(state.progress ?? 0)}%`}
          </span>
        </div>
      );

    case 'ready':
      // Reached only when Update now stopped short of installing — on Linux,
      // most often a password prompt that was dismissed.
      return (
        <Row
          icon={<CircleCheck aria-hidden className="text-tertiary size-4" />}
          title={`Version ${state.latestVersion ?? ''} is downloaded`}
          detail={
            state.asksForPassword
              ? 'Install it when you are ready; your system will ask for your password, then Yello restarts.'
              : 'Restart Yello to finish updating. It also installs the next time you quit.'
          }
          actions={
            <Button
              size="sm"
              leadingIcon={<RefreshCw className="size-4" />}
              onClick={updates.install}
            >
              Install and restart
            </Button>
          }
        />
      );

    case 'installing':
      return (
        <Row
          icon={<Spinner label="Installing" />}
          title={`Installing version ${state.latestVersion ?? ''}…`}
          detail={
            state.asksForPassword
              ? 'Enter your password in the system prompt. Yello restarts when it is done.'
              : 'Yello restarts when it is done.'
          }
        />
      );

    case 'error':
      return (
        <Row
          icon={<CircleAlert aria-hidden className="text-error size-4" />}
          title={state.error ?? 'Something went wrong with the update.'}
          detail={checkedLine}
          actions={checkButton('Try again')}
        />
      );

    case 'up-to-date':
    case 'idle':
      if (state.mode === 'unavailable') {
        return (
          <Row
            icon={<CircleCheck aria-hidden className="text-tertiary size-4" />}
            title="You’re running a development build."
            detail="Updates are checked in installed builds, not in development."
          />
        );
      }
      return (
        <Row
          icon={<CircleCheck aria-hidden className="text-tertiary size-4" />}
          title={state.status === 'up-to-date' ? 'Yello is up to date' : 'Updates'}
          detail={checkedLine}
          actions={checkButton('Check now')}
        />
      );
  }
}

/** The status box, then what can be done about it beneath. */
function Row({
  icon,
  title,
  detail,
  actions,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        className="bg-surface-container-low border-outline-variant flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-[13px] font-medium">{title}</span>
          <span className="text-on-surface-variant text-[12px]">{detail}</span>
        </span>
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
