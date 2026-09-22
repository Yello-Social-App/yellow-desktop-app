import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import type { ConversationRow } from '@/features/messages/hooks';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

import { GroupAvatar } from './GroupAvatar';

interface ConversationListProps {
  rows: ConversationRow[];
  activeId: string | null;
}

/** A group's avatar is its photo or its members (GroupAvatar); a direct one is the peer. */
function ConversationAvatar({ row }: { row: ConversationRow }) {
  const [first] = row.peers;
  if (row.conversation.type === 'GROUP' || first === undefined) {
    return <GroupAvatar row={row} />;
  }
  return (
    <Avatar
      initials={initialsOf(first)}
      name={displayName(first)}
      imageUrl={first.avatarUrl}
      isOnline={row.isOnline || undefined}
    />
  );
}

/** The left rail of the messages screen. */
export function ConversationList({ rows, activeId }: ConversationListProps) {
  return (
    <ul className="stagger divide-hairline flex flex-col">
      {rows.map((row) => {
        const { conversation } = row;
        const isActive = conversation.id === activeId;
        const isUnread = row.unreadCount > 0;
        const when = conversation.lastMessageAt ?? conversation.createdAt;

        return (
          <li key={conversation.id} className="animate-fade-up">
            <Link
              to={`/messages/${encodeURIComponent(conversation.id)}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'gap-md px-lg transition-tone relative flex w-full items-center py-3 text-left',
                isActive ? 'bg-surface-container-low' : 'hover:bg-surface-container-lowest',
              )}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="bg-primary-container absolute inset-y-3 left-0 w-1 rounded-r-full"
                />
              )}
              <ConversationAvatar row={row} />

              <span className="min-w-0 flex-1">
                <span className="mb-0.5 flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'text-on-surface truncate text-[15px]',
                      isUnread ? 'font-bold' : 'font-semibold',
                    )}
                  >
                    {row.title}
                  </span>
                  <span className="text-on-surface-variant shrink-0 text-[12px]">
                    {relativeTime(when)}
                  </span>
                </span>
                <span
                  className={cn(
                    'block truncate text-[13px]',
                    isUnread ? 'text-on-surface font-medium' : 'text-on-surface-variant',
                  )}
                >
                  {row.previewIsMine && <span className="text-on-surface-variant">You: </span>}
                  {row.preview}
                </span>
              </span>

              {isUnread && <Badge tone="count">{String(row.unreadCount)}</Badge>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
