import type { ChatReaction } from '@shared/ipc-types';
import { SmilePlus } from 'lucide-react';
import { useState } from 'react';

import { Popover } from '@/components/ui/Popover';
import { useUsers } from '@/features/users/hooks';
import { QUICK_REACTIONS } from '@/features/messages/types';
import { cn } from '@/lib/cn';
import { displayName } from '@/lib/user-display';

interface ReactionChipsProps {
  reactions: readonly ChatReaction[];
  viewerId: string | null;
  isMine: boolean;
  onReact: (emoji: string) => void;
}

/**
 * The reactions under a bubble. One reaction per person per message: tapping
 * your own emoji removes it, tapping another moves yours there.
 */
export function ReactionChips({ reactions, viewerId, isMine, onReact }: ReactionChipsProps) {
  const reactorIds = [...new Set(reactions.flatMap((reaction) => reaction.userIds))];
  const people = useUsers(reactorIds);

  if (reactions.length === 0) {
    return null;
  }

  return (
    <ul className={cn('-mt-1 flex flex-wrap gap-1 px-1', isMine && 'justify-end')}>
      {reactions.map((reaction) => {
        const isOwn = viewerId !== null && reaction.userIds.includes(viewerId);
        const names = reaction.userIds.map((id) =>
          id === viewerId ? 'You' : people[id] === undefined ? '…' : displayName(people[id]),
        );
        return (
          <li key={reaction.emoji}>
            <button
              type="button"
              aria-pressed={isOwn}
              title={names.join(', ')}
              aria-label={`${reaction.emoji} ${String(reaction.count)}: ${names.join(', ')}`}
              onClick={() => {
                onReact(reaction.emoji);
              }}
              className={cn(
                'transition-tone flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] tabular-nums',
                isOwn
                  ? 'bg-primary-fixed border-primary-container text-on-primary-fixed'
                  : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:bg-surface-container-low',
              )}
            >
              <span aria-hidden>{reaction.emoji}</span>
              {reaction.count > 1 && <span>{String(reaction.count)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ReactionPickerProps {
  isMine: boolean;
  onReact: (emoji: string) => void;
}

/** The quick-reaction row, opened from a bubble's action bar. */
export function ReactionPicker({ isMine, onReact }: ReactionPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
      }}
      label="React"
      side="above"
      align={isMine ? 'right' : 'left'}
      panelClassName="flex-row p-1"
      trigger={
        <button
          type="button"
          aria-label="React"
          title="React"
          aria-expanded={isOpen}
          onClick={() => {
            setIsOpen((open) => !open);
          }}
          className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-tone flex size-7 items-center justify-center rounded-full"
        >
          <SmilePlus aria-hidden className="size-4" />
        </button>
      }
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          onClick={() => {
            setIsOpen(false);
            onReact(emoji);
          }}
          className="hover:bg-surface-container-high transition-tone flex size-9 items-center justify-center rounded-full text-[20px]"
        >
          {emoji}
        </button>
      ))}
    </Popover>
  );
}
