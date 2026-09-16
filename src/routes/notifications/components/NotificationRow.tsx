import {
  AtSign,
  Bell,
  Heart,
  MessageCircle,
  MessageCircleReply,
  Repeat2,
  SmilePlus,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { useUsers } from '@/features/users/hooks';
import { routeFor, type Notification } from '@/features/notifications/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

const ICON_CLASS = 'size-3.5';

/**
 * The glyph badged onto the actor's avatar. An unknown type — one added
 * server-side after this build — falls back to the bell rather than rendering
 * nothing, because the row is still perfectly readable from its title.
 */
const TYPE_ICONS: Readonly<Record<string, ReactNode>> = {
  POST_CREATED: <AtSign className={ICON_CLASS} />,
  POST_COMMENTED: <MessageCircle className={ICON_CLASS} />,
  COMMENT_REPLIED: <MessageCircleReply className={ICON_CLASS} />,
  POST_REPOSTED: <Repeat2 className={ICON_CLASS} />,
  POST_REACTED: <Heart className={ICON_CLASS} />,
  COMMENT_REACTED: <SmilePlus className={ICON_CLASS} />,
  FRIEND_REQUEST_RECEIVED: <UserPlus className={ICON_CLASS} />,
  FRIEND_REQUEST_ACCEPTED: <UserCheck className={ICON_CLASS} />,
  CHAT_MESSAGE: <MessageCircle className={ICON_CLASS} />,
};

interface NotificationRowProps {
  notification: Notification;
  onOpen: (notification: Notification) => void;
  onDismiss: (notificationId: string) => void;
  isPending: boolean;
  /** The panel trims itself; the full page gives each row more room. */
  isCompact?: boolean;
}

/**
 * One inbox row, shared by the topbar panel and the notifications page.
 *
 * `title` and `body` are rendered exactly as the service sent them. They are
 * frozen display text, re-written server-side as rows aggregate ("alice and 3
 * others reacted to your post"), so rebuilding the sentence here from
 * `aggregateCount` would only produce a second, worse version of it — and
 * would go stale the moment the service changes its wording.
 *
 * The row is a button rather than a link because opening it is two things: an
 * acknowledgement and a navigation. A row that points nowhere this build knows
 * is not a button at all, so it never offers a click that would do nothing.
 */
export function NotificationRow({
  notification,
  onOpen,
  onDismiss,
  isPending,
  isCompact = false,
}: NotificationRowProps) {
  const actorId = notification.actorId;
  const people = useUsers(actorId === undefined ? [] : [actorId]);
  const actor = actorId === undefined ? undefined : people[actorId];
  const canOpen = routeFor(notification) !== null;
  const icon = TYPE_ICONS[notification.type] ?? <Bell className={ICON_CLASS} />;

  const content = (
    <>
      <span className="relative shrink-0">
        {actor === undefined ? (
          <span
            aria-hidden
            className="bg-surface-container-high text-on-surface-variant grid size-10 place-items-center rounded-full"
          >
            <Bell className="size-4" />
          </span>
        ) : (
          <Avatar
            initials={initialsOf(actor)}
            name={displayName(actor)}
            imageUrl={actor.avatarUrl}
            size="md"
          />
        )}
        <span
          aria-hidden
          className="bg-primary-container text-on-primary-container border-background absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2"
        >
          {icon}
        </span>
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            'text-on-surface block text-[14px]',
            notification.read ? 'font-normal' : 'font-semibold',
            isCompact && 'line-clamp-2',
          )}
        >
          {notification.title}
        </span>
        {notification.body !== '' && (
          <span
            className={cn(
              'text-on-surface-variant mt-0.5 block text-[13px]',
              isCompact ? 'line-clamp-1' : 'line-clamp-3',
            )}
          >
            {notification.body}
          </span>
        )}
        <span className="text-on-surface-variant mt-1 block text-[12px]">
          {relativeTime(notification.updatedAt)}
        </span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        'group gap-md px-lg flex items-start',
        isCompact ? 'py-sm' : 'py-md',
        // The unread tint is the list's only colour, so scanning for what is
        // new never depends on the weight of the title alone.
        !notification.read && 'bg-primary-fixed/10',
        isPending && 'opacity-60',
      )}
    >
      {canOpen ? (
        <button
          type="button"
          onClick={() => {
            onOpen(notification);
          }}
          className="gap-md hover:bg-surface-container-low/40 transition-tone -mx-2 -my-1 flex min-w-0 flex-1 items-start rounded-xl px-2 py-1 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="gap-md flex min-w-0 flex-1 items-start">{content}</div>
      )}

      <span className="flex shrink-0 items-center gap-1 pt-1">
        {!notification.read && (
          <span
            aria-label="Unread"
            title="Unread"
            className="bg-primary-container size-2 rounded-full"
          />
        )}
        <IconButton
          label="Remove this notification"
          size="sm"
          tone="danger"
          disabled={isPending}
          icon={<X className="size-4" />}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            onDismiss(notification.id);
          }}
        />
      </span>
    </div>
  );
}
