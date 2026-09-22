import { Users } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import type { ConversationRow } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';

interface GroupAvatarProps {
  row: ConversationRow;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'size-9',
  md: 'size-10',
  lg: 'size-20',
} as const;

/**
 * A group's picture: its photo when it has one, else its first two members
 * stacked, else a group glyph.
 *
 * The photo is a presigned link that expires within the hour; when it fails
 * to load the conversation is re-read (which re-signs it), and until then the
 * stacked fallback shows rather than a broken image.
 */
export function GroupAvatar({ row, size = 'md' }: GroupAvatarProps) {
  const refreshConversation = useMessagesStore((state) => state.refreshConversation);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { photoUrl } = row.conversation;
  const [first, second] = row.peers;

  if (photoUrl !== null && failedUrl !== photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => {
          setFailedUrl(photoUrl);
          void refreshConversation(row.conversation.id);
        }}
        className={cn('shrink-0 rounded-full object-cover', SIZE_CLASSES[size])}
      />
    );
  }

  if (size !== 'lg' && first !== undefined && second !== undefined) {
    // The list's 40px slot fits two 32px faces, as it always has; the header's
    // 36px one fits two 24px ones.
    const face = size === 'md' ? 'sm' : 'xs';
    return (
      <span className={cn('relative shrink-0', SIZE_CLASSES[size])}>
        <Avatar
          initials={initialsOf(first)}
          name={displayName(first)}
          imageUrl={first.avatarUrl}
          size={face}
          className="absolute top-0 left-0"
        />
        <Avatar
          initials={initialsOf(second)}
          name={displayName(second)}
          imageUrl={second.avatarUrl}
          size={face}
          className="ring-background absolute right-0 bottom-0 rounded-full ring-2"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'bg-surface-container text-on-surface-variant flex shrink-0 items-center justify-center rounded-full',
        SIZE_CLASSES[size],
      )}
    >
      <Users aria-hidden className={size === 'lg' ? 'size-8' : 'size-4'} />
    </span>
  );
}
