import { memo } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { useCommunitiesStore } from '@/features/communities/store';
import { useSampleRelationship } from '@/features/people/hooks';
import type { DirectoryPerson } from '@/features/people/types';
import { relativeTime } from '@/lib/relative-time';
import { FriendshipControls } from '@/routes/profile/components/FriendshipControls';
import { displayName, handleOf } from '@/lib/user-display';

interface DirectoryRowProps {
  person: DirectoryPerson;
}

/** The second line's context: the relationship first, then how you are connected. */
function useContextLine(person: DirectoryPerson): string {
  const communityName = useCommunitiesStore((state) =>
    person.sharedCommunitySlug === undefined
      ? undefined
      : state.communities[person.sharedCommunitySlug]?.name,
  );
  const count = person.mutualFriends.length;

  switch (person.friendStatus) {
    case 'FRIENDS':
      return person.since === undefined ? 'friends' : `friends since ${relativeTime(person.since)}`;
    case 'REQUEST_RECEIVED':
      return 'wants to be your friend';
    case 'REQUEST_SENT':
      return person.since === undefined
        ? 'request sent'
        : `request sent ${relativeTime(person.since)}`;
  }
  if (count > 0) {
    return `${String(count)} mutual ${count === 1 ? 'friend' : 'friends'}`;
  }
  if (communityName !== undefined) {
    return `member of ${communityName}`;
  }
  return 'no mutual friends';
}

/**
 * One suggested person from the sample directory, in the anatomy of `FriendRow`. Names
 * are not links yet: sample ids have no profile to open, and there is no chat
 * to start with them, so Message is not offered.
 */
export const DirectoryRow = memo(function DirectoryRow({ person }: DirectoryRowProps) {
  const user = person.user;
  const control = useSampleRelationship(person);
  const line = useContextLine(person);

  return (
    <article className="gap-md px-lg py-md hover:bg-surface-container-lowest/60 transition-tone flex items-center">
      <UserAvatar user={user} />

      <div className="min-w-0 flex-1">
        <p className="text-on-surface truncate text-[15px] font-bold">{displayName(user)}</p>
        <p className="text-on-surface-variant truncate text-[13px]">
          {handleOf(user)} · {line}
        </p>
      </div>

      <div className="shrink-0">
        <FriendshipControls control={control} name={displayName(user)} />
      </div>
    </article>
  );
});
