import type { Author } from '@shared/ipc-types';

import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';

const MAX_FACES = 3;

interface MutualFriendsProps {
  friends: readonly Author[];
}

/** Up to three overlapping faces and the count, e.g. "4 mutual friends". */
export function MutualFriends({ friends }: MutualFriendsProps) {
  if (friends.length === 0) {
    return null;
  }

  const label = `${String(friends.length)} mutual ${friends.length === 1 ? 'friend' : 'friends'}`;

  return (
    <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-[12px]">
      <span aria-hidden className="flex">
        {friends.slice(0, MAX_FACES).map((friend, index) => (
          <span
            key={friend.id}
            className={cn(
              'ring-surface-container-lowest rounded-full ring-2',
              index > 0 && '-ml-1.5',
            )}
          >
            <Avatar
              initials={initialsOf(friend)}
              name={displayName(friend)}
              imageUrl={friend.avatarUrl}
              size="xs"
            />
          </span>
        ))}
      </span>
      <span title={friends.map(displayName).join(', ')}>{label}</span>
    </span>
  );
}
