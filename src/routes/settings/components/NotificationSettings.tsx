import { NOTIFICATION_TYPES, type NotificationType } from '@shared/ipc-types';
import { BellRing, Info } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import {
  useNotificationPreferences,
  type NotificationPreferencesForm,
} from '@/features/notifications/hooks';
import { labelForType } from '@/features/notifications/types';
import { cn } from '@/lib/cn';

import { CardHeading } from './SettingsSection';

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
interface TypeGroup {
  title: string;
  description: string;
  types: readonly NotificationType[];
}

/** Two columns, as the design lays them out: posts on the left, people and chat on the right. */
const COLUMNS: readonly (readonly TypeGroup[])[] = [
  [
    {
      title: 'Posts & comments',
      description: 'Activity on things you share.',
      types: [
        'POST_CREATED',
        'POST_COMMENTED',
        'COMMENT_REPLIED',
        'POST_REPOSTED',
        'POST_REACTED',
        'COMMENT_REACTED',
      ],
    },
  ],
  [
    {
      title: 'Friends',
      description: 'People connecting with you.',
      types: ['FRIEND_REQUEST_RECEIVED', 'FRIEND_REQUEST_ACCEPTED'],
    },
    {
      title: 'Chat',
      description: 'Only while Yello is in the background. The conversation keeps every message.',
      types: ['CHAT_MESSAGE', 'CHAT_REACTION'],
    },
  ],
];

export function NotificationSettings() {
  const preferences = useNotificationPreferences();
  const { pushEnabled, status, isSaving, setPushEnabled } = preferences;

  if (status === 'loading' || status === 'idle') {
    return (
      <Card className="px-lg py-md">
        <Spinner label="Loading preferences" />
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card className="px-lg py-md">
        <p className="text-on-surface-variant text-[13px]">
          Notification preferences could not be loaded. Alerts fall back to being on.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-4 px-5 py-[18px]">
        <span className="bg-surface-container text-primary flex size-10 shrink-0 items-center justify-center rounded-[10px]">
          <BellRing aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-on-surface text-[15px] font-semibold">Desktop alerts</span>
          <span className="text-on-surface-variant text-[13px]">
            Show a system notification when something happens while Yello is in the background. Your
            inbox fills either way.
          </span>
        </div>
        <Switch
          label="Desktop alerts"
          checked={pushEnabled}
          disabled={isSaving}
          onChange={setPushEnabled}
        />
      </Card>

      <p className="text-on-surface-variant flex items-start gap-2.5 px-1 text-[13px] leading-normal">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {pushEnabled
          ? 'Turning one off stops the alert only — it still appears in your notifications and still counts as unread.'
          : 'Desktop alerts are off. Everything still lands in your notifications inbox.'}
      </p>

      <div
        className={cn(
          'grid items-start gap-4 transition-opacity @2xl:grid-cols-2',
          !pushEnabled && 'opacity-40',
        )}
      >
        {COLUMNS.map((column, index) => (
          <div key={index} className="flex flex-col gap-4">
            {column.map((group) => (
              <GroupCard key={group.title} group={group} preferences={preferences} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface GroupCardProps {
  group: TypeGroup;
  preferences: NotificationPreferencesForm;
}

function GroupCard({ group, preferences }: GroupCardProps) {
  const { pushEnabled, mutedTypes, isSaving, toggleMuted, setMuted } = preferences;
  const isDisabled = isSaving || !pushEnabled;
  const allOn = group.types.every((type) => !mutedTypes.has(type));

  return (
    <Card className="overflow-hidden">
      <CardHeading
        title={group.title}
        description={group.description}
        action={
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
              setMuted(group.types, allOn);
            }}
            className="border-outline-strong text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-tone h-7 shrink-0 rounded-lg border px-2.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {allOn ? 'Turn all off' : 'Turn all on'}
          </button>
        }
      />
      <ul>
        {group.types.map((type, index) => {
          const label = labelForType(type);
          return (
            <li
              key={type}
              className={cn(
                'flex h-[50px] items-center gap-3 px-[18px]',
                index > 0 && 'border-outline-variant border-t',
              )}
            >
              <span className="text-on-surface min-w-0 flex-1 text-[14px]">{label}</span>
              <Switch
                size="sm"
                label={label}
                checked={!mutedTypes.has(type)}
                disabled={isDisabled}
                onChange={() => {
                  toggleMuted(type);
                }}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The page header's count while Notifications is open: how many alerts would fire. */
export function AlertsSummary() {
  const { pushEnabled, mutedTypes, status } = useNotificationPreferences();
  if (status !== 'ready') {
    return null;
  }
  const on = pushEnabled ? NOTIFICATION_TYPES.filter((type) => !mutedTypes.has(type)).length : 0;
  return (
    <p className="text-on-surface-variant flex shrink-0 items-center gap-2 text-[13px]">
      <span className="text-on-surface font-mono tabular-nums">{on}</span>
      of {NOTIFICATION_TYPES.length} alerts on
    </p>
  );
}
