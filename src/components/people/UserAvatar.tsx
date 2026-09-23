import type { Author } from '@shared/ipc-types';

import { Avatar } from '@/components/ui/Avatar';
import { useStoryRingState } from '@/features/stories/hooks';
import { displayName, initialsOf } from '@/lib/user-display';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface UserAvatarProps {
  user: Pick<Author, 'id' | 'username' | 'fullName' | 'avatarUrl'>;
  size?: AvatarSize;
  isOnline?: boolean | undefined;
  className?: string;
}

/**
 * A person's avatar, wearing their story ring when they have one — the one
 * component every screen draws a real user with, so the ring shows up
 * everywhere at once. The ring is a badge, like the presence dot: clicking
 * keeps doing whatever the avatar's link or button already does, and the story
 * opens from the Home row or the profile photo.
 */
export function UserAvatar({ user, size, isOnline, className }: UserAvatarProps) {
  const storyRing = useStoryRingState(user.id);
  return (
    <Avatar
      initials={initialsOf(user)}
      name={displayName(user)}
      imageUrl={user.avatarUrl}
      size={size}
      isOnline={isOnline}
      storyRing={storyRing}
      className={className}
    />
  );
}
