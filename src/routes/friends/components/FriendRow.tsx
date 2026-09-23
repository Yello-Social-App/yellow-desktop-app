import { memo } from 'react';
import { Link } from 'react-router-dom';

import { HighlightMatch } from '@/components/content/HighlightMatch';
import { Avatar } from '@/components/ui/Avatar';
import { useRelationship } from '@/features/friends/hooks';
import type { FriendEntry } from '@/features/friends/types';
import { useIsOnline, useStartConversation } from '@/features/messages/hooks';
import { FriendshipControls } from '@/routes/profile/components/FriendshipControls';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

interface FriendRowProps {
  entry: FriendEntry;
  /** What the timestamp means on this list; search rows carry none. */
  sinceLabel?: string;
  /** What was searched for, drawn highlighted in the name and handle. */
  query?: string;
}

/**
 * One person. `entry.user` is always the *other* party, never the caller, and
 * the controls read from the server's `friendStatus` — so the same row
 * serves every tab, and the people search.
 */
export const FriendRow = memo(function FriendRow({
  entry,
  sinceLabel = '',
  query = '',
}: FriendRowProps) {
  const person = entry.user;
  const name = displayName(person);
  const control = useRelationship(person.id, entry.friendStatus);
  const isOnline = useIsOnline(person.id);
  const { direct, isStarting } = useStartConversation();

  return (
    <article className="gap-md px-lg py-md hover:bg-surface-container-lowest/60 transition-tone flex items-center">
      <Link to={`/users/${person.id}`} className="shrink-0">
        <Avatar
          initials={initialsOf(person)}
          name={name}
          imageUrl={person.avatarUrl}
          isOnline={isOnline || undefined}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/users/${person.id}`}
          className="text-on-surface block truncate text-[15px] font-bold hover:underline"
        >
          <HighlightMatch text={name} query={query} />
        </Link>
        <p className="text-on-surface-variant truncate text-[13px]">
          <HighlightMatch text={handleOf(person)} query={query} />
          {entry.since !== undefined && ` · ${sinceLabel} ${relativeTime(entry.since)}`}
        </p>
      </div>

      <div className="shrink-0">
        <FriendshipControls
          control={control}
          name={name}
          isMessaging={isStarting}
          onMessage={
            control.relationship === 'friends'
              ? () => {
                  void direct(person.id);
                }
              : undefined
          }
        />
      </div>
    </article>
  );
});
