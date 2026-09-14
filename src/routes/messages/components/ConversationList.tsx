import { Avatar } from '@/components/ui/Avatar';
import type { ConversationSummary } from '@/features/messages/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';

interface ConversationListProps {
  summaries: ConversationSummary[];
  activeId: string | null;
  onSelect: (conversationId: string) => void;
}

/** The left rail of the messages screen. */
export function ConversationList({ summaries, activeId, onSelect }: ConversationListProps) {
  return (
    <ul className="stagger flex flex-col">
      {summaries.map(({ conversation, participantName, participantInitials, preview }) => {
        const isActive = conversation.id === activeId;

        return (
          <li key={conversation.id} className="animate-fade-up">
            <button
              type="button"
              aria-current={isActive}
              onClick={() => {
                onSelect(conversation.id);
              }}
              className={cn(
                'gap-md px-md py-sm transition-tone flex w-full items-center border-l-4 text-left',
                isActive
                  ? 'border-primary-container bg-surface-container-lowest'
                  : 'hover:bg-surface-container-low border-transparent',
              )}
            >
              <span className="relative shrink-0">
                <Avatar initials={participantInitials} name={participantName} />
                {conversation.isOnline && (
                  <span
                    aria-label="Online"
                    className="bg-tertiary border-surface absolute right-0 bottom-0 size-3 rounded-full border-2"
                  />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="gap-sm mb-1 flex items-baseline justify-between">
                  <span className="font-heading text-h3 text-on-surface truncate">
                    {participantName}
                  </span>
                  <span className="font-small text-small text-outline shrink-0">
                    {relativeTime(conversation.lastMessageAt)}
                  </span>
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant block truncate">
                  {preview}
                </span>
              </span>

              {conversation.unreadCount > 0 && (
                <span className="bg-primary-container text-on-primary-container font-label text-label flex size-5 shrink-0 items-center justify-center rounded-full">
                  {conversation.unreadCount}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
