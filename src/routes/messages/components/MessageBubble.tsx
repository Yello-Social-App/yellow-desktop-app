import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { memo } from 'react';
import type { Author } from '@shared/ipc-types';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { Avatar } from '@/components/ui/Avatar';
import { useComposer } from '@/features/messages/hooks';
import type { ThreadMessage } from '@/features/messages/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { clockTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

interface MessageBubbleProps {
  message: ThreadMessage;
  isMine: boolean;
  sender: Author | undefined;
  /** Name above the bubble — groups only, on the first line of a run. */
  showSender: boolean;
  /** Part of a run from the same sender: tighter, no avatar. */
  continues: boolean;
  /** Who has read up to exactly this line. */
  readBy: Author[];
}

/**
 * Sent bubbles are filled brand yellow with a squared bottom-right corner;
 * received bubbles are the tonal surface with a squared bottom-left. A run
 * from one sender shares one avatar and closes up.
 *
 * A link gets its card *below* the bubble rather than inside it: the sent
 * bubble is filled brand yellow, and a surface-toned card sitting on that
 * reads as a mistake. Below, it aligns with the bubble and belongs to it
 * without fighting the fill.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  sender,
  showSender,
  continues,
  readBy,
}: MessageBubbleProps) {
  const { retry } = useComposer();
  const isFailed = message.delivery === 'failed';
  // Only the first link, and only once the line has actually been sent: a
  // message still in flight can still fail, and unfurling it would spend a
  // fetch on text that may never exist.
  const [firstLink] = message.delivery === 'sent' ? extractLinks(message.body) : [];

  return (
    <div
      className={cn(
        'group flex max-w-[78%] items-end gap-2',
        isMine ? 'self-end' : 'self-start',
        !continues && 'mt-2',
      )}
    >
      {!isMine && (
        <span className="w-8 shrink-0">
          {!continues && sender !== undefined && (
            <Avatar
              initials={initialsOf(sender)}
              name={displayName(sender)}
              imageUrl={sender.avatarUrl}
              size="sm"
            />
          )}
        </span>
      )}

      <div className={cn('flex min-w-0 flex-col gap-0.5', isMine && 'items-end')}>
        {showSender && sender !== undefined && (
          <span className="text-on-surface-variant ml-1 text-[12px] font-semibold">
            {displayName(sender)}
          </span>
        )}
        <div
          className={cn(
            'px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap',
            isMine
              ? 'bg-primary-container text-on-primary-container rounded-2xl rounded-br-md'
              : 'bg-surface-container-high text-on-surface rounded-2xl rounded-bl-md',
            message.delivery === 'sending' && 'opacity-70',
            isFailed && 'ring-error ring-1',
          )}
        >
          <RichText
            text={message.body}
            className={isMine ? '[&_a]:text-on-primary-container [&_a]:underline' : ''}
          />
        </div>
        {firstLink !== undefined && (
          <span className="mt-1 block w-full max-w-[320px]">
            <LinkPreviewCard url={firstLink} size="sm" />
          </span>
        )}

        <span
          className={cn(
            'text-on-surface-variant flex items-center gap-1 px-1 text-[11px] transition-opacity',
            continues && !isFailed && 'opacity-0 group-hover:opacity-100',
          )}
        >
          {clockTime(message.createdAt)}
          {isMine && message.delivery === 'sending' && (
            <Clock aria-label="Sending" className="size-3" />
          )}
          {isMine && message.delivery === 'sent' && readBy.length === 0 && (
            <Check aria-label="Sent" className="size-3" />
          )}
          {isMine && readBy.length > 0 && (
            <CheckCheck
              aria-label={`Read by ${readBy.map(displayName).join(', ')}`}
              className="text-tertiary size-3.5"
            />
          )}
          {isFailed && (
            <button
              type="button"
              onClick={() => {
                retry(message);
              }}
              className="text-error flex items-center gap-1 font-semibold hover:underline"
            >
              <AlertCircle aria-hidden className="size-3" />
              Not sent · Retry
            </button>
          )}
        </span>
      </div>
    </div>
  );
});
