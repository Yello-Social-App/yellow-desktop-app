import { Check, UserMinus, X } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Friendship } from '@/features/friends/types';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

interface FriendRowProps {
  friendship: Friendship;
  isPending: boolean;
  /** Requests get accept/decline; accepted friendships get unfriend. */
  variant: 'friend' | 'request';
  onAccept: (friendshipId: string) => void;
  onDecline: (friendshipId: string) => void;
  onRemove: (userId: string) => void;
}

/**
 * One person. `friendship.user` is always the *other* party, never the caller,
 * so the same row works for a sent request, a received one and a friendship.
 */
export const FriendRow = memo(function FriendRow({
  friendship,
  isPending,
  variant,
  onAccept,
  onDecline,
  onRemove,
}: FriendRowProps) {
  const person = friendship.user;
  const name = displayName(person);

  return (
    <Card as="article" className="gap-md p-md flex items-center">
      <Link to={`/users/${person.id}`} className="shrink-0">
        <Avatar initials={initialsOf(person)} name={name} imageUrl={person.avatarUrl} />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/users/${person.id}`}
          className="font-heading text-h3 text-on-surface hover:text-primary transition-tone block truncate"
        >
          {name}
        </Link>
        <p className="font-small text-small text-on-surface-variant truncate">
          {handleOf(person)}
          {friendship.createdAt !== '' && ` · ${relativeTime(friendship.createdAt)}`}
        </p>
      </div>

      {variant === 'request' ? (
        <div className="gap-sm flex shrink-0">
          <Button
            leadingIcon={<Check className="size-4" />}
            isLoading={isPending}
            onClick={() => {
              onAccept(friendship.id);
            }}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<X className="size-4" />}
            disabled={isPending}
            onClick={() => {
              onDecline(friendship.id);
            }}
          >
            Decline
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          leadingIcon={<UserMinus className="size-4" />}
          isLoading={isPending}
          onClick={() => {
            onRemove(person.id);
          }}
          className="shrink-0"
        >
          Unfriend
        </Button>
      )}
    </Card>
  );
});
