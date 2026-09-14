import { Bell, Check } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import {
  describeNotification,
  linkTargetOf,
  type Notification,
} from '@/features/notifications/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

interface NotificationRowProps {
  notification: Notification;
  isPending: boolean;
  onMarkRead: (notificationId: string) => void;
}

/** One row. An absent actor (system-raised) renders with a neutral bell. */
export const NotificationRow = memo(function NotificationRow({
  notification,
  isPending,
  onMarkRead,
}: NotificationRowProps) {
  const { actor } = notification;
  const message = describeNotification(notification);
  const hasActor = actor !== null && actor !== undefined;
  const name = hasActor ? displayName(actor) : null;
  const target = linkTargetOf(notification);

  return (
    <Card
      elevation={notification.read ? 'flat' : 'floating'}
      as="article"
      className={cn(
        'gap-md p-md flex items-center',
        !notification.read && 'bg-surface-container-lowest',
      )}
    >
      {hasActor ? (
        <Link to={`/users/${actor.id}`} className="shrink-0">
          <Avatar
            initials={initialsOf(actor)}
            name={displayName(actor)}
            imageUrl={actor.avatarUrl}
          />
        </Link>
      ) : (
        <span
          aria-hidden
          className="bg-surface-container-low text-primary flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <Bell className="size-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="font-body-sm text-body-sm text-on-surface">
          {name !== null && hasActor && (
            <Link
              to={`/users/${actor.id}`}
              className="font-heading text-on-surface hover:text-primary transition-tone"
            >
              {name}{' '}
            </Link>
          )}
          {target === null ? (
            <span className={name !== null ? undefined : 'first-letter:uppercase'}>{message}</span>
          ) : (
            <Link
              to={target}
              className={cn(
                'hover:text-primary transition-tone',
                name === null && 'first-letter:uppercase',
              )}
            >
              {message}
            </Link>
          )}
        </p>
        <p className="font-small text-small text-on-surface-variant">
          {relativeTime(notification.createdAt)}
        </p>
      </div>

      {!notification.read ? (
        <div className="gap-sm flex shrink-0 items-center">
          <span aria-hidden className="bg-primary-container size-2 rounded-full" />
          <IconButton
            label="Mark as read"
            icon={<Check className="size-4" />}
            disabled={isPending}
            onClick={() => {
              onMarkRead(notification.id);
            }}
          />
        </div>
      ) : null}
    </Card>
  );
});
