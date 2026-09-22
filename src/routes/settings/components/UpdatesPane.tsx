import type { AppInfoResponse } from '@shared/ipc-types';

import { Card } from '@/components/ui/Card';

import { PaneHeader, SettingsSection } from './SettingsSection';
import { UpdateSettings } from './UpdateSettings';

interface UpdatesPaneProps {
  appInfo: AppInfoResponse | null;
}

/** Updates, with the About rows beside them: both answer "which Yello is this?". */
export function UpdatesPane({ appInfo }: UpdatesPaneProps) {
  return (
    <>
      <PaneHeader title="Updates" description="Keep Yello current, and see which build you run." />
      <UpdateSettings />
      <SettingsSection title="About">
        <Card className="divide-outline-variant flex flex-col divide-y">
          {[
            { label: 'App version', value: appInfo?.appVersion },
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
      </SettingsSection>
    </>
  );
}
