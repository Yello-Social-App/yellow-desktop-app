import { BellRing } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useNotificationPreferences } from '@/features/notifications/hooks';
import { NOTIFICATION_TYPES, type NotificationType } from '@shared/ipc-types';
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
 * Chat is listed with the rest because this app raises chat alerts itself,
 * from the live socket (the service sends those as phone pushes only), and
 * honours these same mutes when it does. Chat alerts never enter the inbox, so
 * the "still appears" line does not hold for them — the conversation is the
 * record — and the two groups are worded apart for exactly that reason.
 *
 * Each toggle saves on the spot. The endpoint is a replace rather than a patch,
 * so there is no partial state to accumulate behind a Save button and get
 * wrong — and the list redraws from what the server stored, which is sorted and
 * deduplicated rather than the order it was sent.
 */
/** Alerts this app raises from the chat socket rather than from the inbox. */
const CHAT_TYPES: ReadonlySet<NotificationType> = new Set(['CHAT_MESSAGE', 'CHAT_REACTION']);

interface TypeTogglesProps {
  types: readonly NotificationType[];
  mutedTypes: ReadonlySet<string>;
  isDisabled: boolean;
  isDimmed: boolean;
  onToggle: (type: NotificationType) => void;
}

function TypeToggles({ types, mutedTypes, isDisabled, isDimmed, onToggle }: TypeTogglesProps) {
  return (
    <ul className={cn('mt-sm gap-xs flex flex-col', isDimmed && 'opacity-50')}>
      {types.map((type) => (
        <li key={type}>
          <label className="gap-sm hover:bg-surface-container-low transition-tone -mx-2 flex cursor-pointer items-center rounded-lg px-2 py-1.5">
            <input
              type="checkbox"
              checked={!mutedTypes.has(type)}
              disabled={isDisabled}
              onChange={() => {
                onToggle(type);
              }}
              className="accent-primary-container size-4 shrink-0 cursor-pointer"
            />
            <span className="text-on-surface-variant text-[14px]">{labelForType(type)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

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
              <TypeToggles
                types={NOTIFICATION_TYPES.filter((type) => !CHAT_TYPES.has(type))}
                mutedTypes={mutedTypes}
                isDisabled={isSaving || !pushEnabled}
                isDimmed={!pushEnabled}
                onToggle={toggleMuted}
              />
            </div>

            <div className="px-lg py-md gap-sm flex flex-col">
              <p className="text-on-surface text-[15px]">Chat</p>
              <p className="text-on-surface-variant text-[13px]">
                Shown only while Yello is in the background. The conversation keeps every message
                either way.
              </p>
              <TypeToggles
                types={NOTIFICATION_TYPES.filter((type) => CHAT_TYPES.has(type))}
                mutedTypes={mutedTypes}
                isDisabled={isSaving || !pushEnabled}
                isDimmed={!pushEnabled}
                onToggle={toggleMuted}
              />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
