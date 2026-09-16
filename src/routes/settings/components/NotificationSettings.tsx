import { BellRing } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useNotificationPreferences } from '@/features/notifications/hooks';
import { NOTIFICATION_TYPES } from '@shared/ipc-types';
import { labelForType } from '@/features/notifications/types';
import { cn } from '@/lib/cn';

/**
 * Push opt-outs.
 *
 * The wording matters and is deliberate. A mute stops the *alert*, not the
 * notification: the row still arrives in the inbox and still counts toward the
 * badge — the service is explicit that muting a type only suppresses push. So
 * every control here says "Don't alert me about…", never "Hide…", because a
 * user who read it the second way would rightly call the result a bug.
 *
 * Each toggle saves on the spot. The endpoint is a replace rather than a patch,
 * so there is no partial state to accumulate behind a Save button and get
 * wrong — and the list redraws from what the server stored, which is sorted and
 * deduplicated rather than the order it was sent.
 */
export function NotificationSettings() {
  const { pushEnabled, mutedTypes, status, isSaving, setPushEnabled, toggleMuted } =
    useNotificationPreferences();

  return (
    <section className="gap-sm flex flex-col">
      <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
        Notifications
      </h2>
      <Card className="divide-outline-variant flex flex-col divide-y">
        {status === 'loading' && (
          <div className="px-lg py-md">
            <Spinner label="Loading preferences" />
          </div>
        )}

        {status === 'error' && (
          <p className="text-on-surface-variant px-lg py-md text-[13px]">
            Notification preferences could not be loaded. Alerts fall back to being on.
          </p>
        )}

        {status === 'ready' && (
          <>
            <label className="px-lg py-md gap-md flex cursor-pointer items-center justify-between">
              <span className="min-w-0">
                <span className="text-on-surface gap-sm flex items-center text-[15px]">
                  <BellRing aria-hidden className="text-primary size-4 shrink-0" />
                  Desktop alerts
                </span>
                <span className="text-on-surface-variant mt-0.5 block text-[13px]">
                  Show a system notification when something happens while Yello is in the
                  background. Your inbox fills either way.
                </span>
              </span>
              <input
                type="checkbox"
                checked={pushEnabled}
                disabled={isSaving}
                onChange={(event) => {
                  setPushEnabled(event.target.checked);
                }}
                className="accent-primary-container size-4 shrink-0 cursor-pointer"
              />
            </label>

            <div className="px-lg py-md gap-sm flex flex-col">
              <p className="text-on-surface text-[15px]">What to alert me about</p>
              <p className="text-on-surface-variant text-[13px]">
                Turning one off stops the alert only — it still appears in your notifications and
                still counts as unread.
              </p>
              <ul className={cn('mt-sm gap-xs flex flex-col', !pushEnabled && 'opacity-50')}>
                {NOTIFICATION_TYPES.filter((type) => type !== 'CHAT_MESSAGE').map((type) => (
                  <li key={type}>
                    <label className="gap-sm hover:bg-surface-container-low transition-tone -mx-2 flex cursor-pointer items-center rounded-lg px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={!mutedTypes.has(type)}
                        disabled={isSaving || !pushEnabled}
                        onChange={() => {
                          toggleMuted(type);
                        }}
                        className="accent-primary-container size-4 shrink-0 cursor-pointer"
                      />
                      <span className="text-on-surface-variant text-[14px]">
                        {labelForType(type)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-on-surface-variant mt-sm text-[12px]">
                Chat alerts are managed by the messages screen, not here.
              </p>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
