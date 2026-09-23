import type { AppInfoResponse } from '@shared/ipc-types';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/Card';
import { ipc } from '@/lib/ipc';

import { CardHeading } from './SettingsSection';
import { UpdateSettings } from './UpdateSettings';

/** How long "Copied" stays before the button reads "Copy details" again. */
const COPIED_MS = 1600;

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyState, string> = {
  idle: 'Copy details',
  copied: 'Copied',
  failed: 'Couldn’t copy',
};

interface UpdatesPaneProps {
  appInfo: AppInfoResponse | null;
}

/** Updates, with the build details beside them: both answer "which Yello is this?". */
export function UpdatesPane({ appInfo }: UpdatesPaneProps) {
  const [copy, setCopy] = useState<CopyState>('idle');

  useEffect(() => {
    if (copy === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopy('idle');
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copy]);

  const rows = [
    { label: 'App version', value: appInfo?.appVersion },
    { label: 'Electron', value: appInfo?.electronVersion },
    { label: 'Chromium', value: appInfo?.chromeVersion },
    { label: 'Platform', value: appInfo && `${appInfo.platform} (${appInfo.arch})` },
  ];

  return (
    <div className="grid items-start gap-5 @3xl:grid-cols-2">
      <UpdateSettings />

      <Card className="overflow-hidden">
        <CardHeading
          title="About this build"
          action={
            <button
              type="button"
              disabled={appInfo === null}
              onClick={() => {
                void ipc.copyAppInfo().then((result) => {
                  setCopy(result.ok && result.data.copied ? 'copied' : 'failed');
                });
              }}
              className="border-outline-strong text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-tone flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] disabled:opacity-60"
            >
              {copy === 'copied' ? (
                <Check aria-hidden className="size-3.5" />
              ) : (
                <Copy aria-hidden className="size-3.5" />
              )}
              <span aria-live="polite">{COPY_LABELS[copy]}</span>
            </button>
          }
        />
        <dl>
          {rows.map((row, index) => (
            <div
              key={row.label}
              className={
                index > 0
                  ? 'border-outline-variant flex h-12 items-center gap-4 border-t px-5'
                  : 'flex h-12 items-center gap-4 px-5'
              }
            >
              <dt className="text-on-surface-variant flex-1 text-[14px]">{row.label}</dt>
              <dd className="text-on-surface truncate font-mono text-[13px]">{row.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
