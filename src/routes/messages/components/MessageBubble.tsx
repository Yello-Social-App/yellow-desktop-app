import {
  AlertCircle,
  Ban,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Pencil,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';
import type { Author } from '@shared/ipc-types';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { UserAvatar } from '@/components/people/UserAvatar';
import { useMessageActions } from '@/features/messages/hooks';
import { messageAnchor, type ThreadMessage } from '@/features/messages/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { clockTime } from '@/lib/relative-time';
import { displayName } from '@/lib/user-display';

import { InviteCard } from './InviteCard';
import { MessageAttachments } from './MessageAttachments';
import { ReactionChips, ReactionPicker } from './MessageReactions';
import { StoryReplyCard } from './StoryReplyCard';

interface MessageBubbleProps {
  message: ThreadMessage;
  isMine: boolean;
  viewerId: string | null;
  sender: Author | undefined;
  /** Who wrote the line this one quotes, when it quotes one. */
  quotedSender: Author | undefined;
  /** Name above the bubble — groups only, on the first line of a run. */
  showSender: boolean;
  /** Part of a run from the same sender: tighter, no avatar. */
  continues: boolean;
  /** Who has read up to exactly this line. */
  readBy: Author[];
  /** For an invite card: whether the viewer is already in that group. */
  isInviteMember: boolean;
}

/**
 * Sent bubbles are filled brand yellow with a squared bottom-right corner;
 * received bubbles are the tonal surface with a squared bottom-left. A run
 * from one sender shares one avatar and closes up.
 *
 * A link gets its card *below* the bubble rather than inside it: the sent
 * bubble is filled brand yellow, and a surface-toned card sitting on that
 * reads as a mistake. Below, it aligns with the bubble and belongs to it
 * without fighting the fill. Files and invite cards follow the same rule.
 *
 * An unsent line stays in place as a tombstone — the history is honest about
 * something having been there — with its text, files and reactions gone.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  viewerId,
  sender,
  quotedSender,
  showSender,
  continues,
  readBy,
  isInviteMember,
}: MessageBubbleProps) {
  const actions = useMessageActions();
  const isFailed = message.delivery === 'failed';
  const isSent = message.delivery === 'sent';
  const isDeleted = message.deletedAt !== null;
  const hasBody = message.body !== '';
  // Only the first link, and only once the line has actually been sent: a
  // message still in flight can still fail, and unfurling it would spend a
  // fetch on text that may never exist.
  const [firstLink] = isSent && !isDeleted ? extractLinks(message.body) : [];

  return (
    <div
      id={messageAnchor(message.id)}
      className={cn(
        'group flex max-w-[78%] scroll-mt-4 items-end gap-2',
        isMine ? 'self-end' : 'self-start',
        !continues && 'mt-2',
      )}
    >
      {!isMine && (
        <span className="w-8 shrink-0">
          {!continues && sender !== undefined && <UserAvatar user={sender} size="sm" />}
        </span>
      )}

      <div className={cn('flex min-w-0 flex-col gap-1', isMine && 'items-end')}>
        {showSender && sender !== undefined && (
          <span className="text-on-surface-variant ml-1 text-[12px] font-semibold">
            {displayName(sender)}
          </span>
        )}

        {message.storyReply !== null && !isDeleted && (
          <StoryReplyCard reply={message.storyReply} isMine={isMine} viewerId={viewerId} />
        )}

        {message.replyTo !== null && !isDeleted && (
          <ReplyQuote
            replyTo={message.replyTo}
            sender={quotedSender}
            isOwnQuote={message.replyTo.senderId === viewerId}
            isMine={isMine}
          />
        )}

        <div className={cn('flex items-center gap-1', isMine && 'flex-row-reverse')}>
          <div className={cn('flex min-w-0 flex-col gap-1', isMine && 'items-end')}>
            {isDeleted ? (
              <div className="border-outline-variant text-on-surface-variant flex items-center gap-1.5 rounded-2xl border border-dashed px-3.5 py-2 text-[14px] italic">
                <Ban aria-hidden className="size-3.5" />
                {isMine ? 'You unsent a message' : 'Message deleted'}
              </div>
            ) : (
              <>
                {message.groupInvite !== null && (
                  <InviteCard
                    invite={message.groupInvite}
                    viewerId={viewerId}
                    isMember={isInviteMember}
                    onRespond={actions.respondToInvite}
                    onOpen={actions.openConversation}
                  />
                )}
                {message.attachments.length > 0 && (
                  <MessageAttachments
                    attachments={message.attachments}
                    isMine={isMine}
                    onExpired={actions.refreshAttachment}
                    onSave={actions.saveAttachment}
                  />
                )}
                {hasBody && (
                  <div
                    className={cn(
                      'text-content px-3.5 py-2 leading-relaxed break-words whitespace-pre-wrap',
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
                )}
              </>
            )}
          </div>

          {isSent && !isDeleted && (
            <MessageActions message={message} isMine={isMine} canEdit={isMine && hasBody} />
          )}
        </div>

        {firstLink !== undefined && (
          <span className="block w-full max-w-[320px]">
            <LinkPreviewCard url={firstLink} size="sm" />
          </span>
        )}

        {!isDeleted && (
          <ReactionChips
            reactions={message.reactions}
            viewerId={viewerId}
            isMine={isMine}
            onReact={(emoji) => {
              actions.react(message.id, emoji);
            }}
          />
        )}

        <span
          className={cn(
            'text-on-surface-variant flex items-center gap-1 px-1 text-[11px] transition-opacity',
            continues && !isFailed && 'opacity-0 group-hover:opacity-100',
          )}
        >
          {clockTime(message.createdAt)}
          {message.editedAt !== null && !isDeleted && <span>· edited</span>}
          {isMine && message.delivery === 'sending' && (
            <Clock aria-label="Sending" className="size-3" />
          )}
          {isMine && isSent && readBy.length === 0 && (
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
                actions.retry(message);
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

interface ReplyQuoteProps {
  replyTo: NonNullable<ThreadMessage['replyTo']>;
  sender: Author | undefined;
  isOwnQuote: boolean;
  isMine: boolean;
}

/** The quoted line above a reply; clicking it scrolls to the original if it is loaded. */
function ReplyQuote({ replyTo, sender, isOwnQuote, isMine }: ReplyQuoteProps) {
  const who = isOwnQuote ? 'You' : sender === undefined ? '…' : displayName(sender);
  const text = replyTo.deleted
    ? 'Message deleted'
    : replyTo.body !== ''
      ? replyTo.body
      : replyTo.hasAttachments
        ? 'Attachment'
        : 'Message';

  return (
    <button
      type="button"
      onClick={() => {
        document
          .getElementById(messageAnchor(replyTo.id))
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }}
      className={cn(
        'border-outline-variant bg-surface-container-low hover:bg-surface-container transition-tone flex max-w-[320px] min-w-0 flex-col rounded-xl border-l-4 px-3 py-1.5 text-left',
        isMine && 'self-end',
      )}
    >
      <span className="text-on-surface-variant flex items-center gap-1 text-[11px] font-semibold">
        <CornerUpLeft aria-hidden className="size-3" />
        {who}
      </span>
      <span
        className={cn(
          'text-on-surface-variant line-clamp-2 text-[13px]',
          replyTo.deleted && 'italic',
        )}
      >
        {text}
      </span>
    </button>
  );
}

interface MessageActionsProps {
  message: ThreadMessage;
  isMine: boolean;
  canEdit: boolean;
}

/**
 * The hover bar beside a bubble. Unsend asks once, inline, rather than in a
 * dialog: it is for everyone and cannot be taken back, but a modal over the
 * thread for a two-word question is heavier than the decision.
 */
function MessageActions({ message, isMine, canEdit }: MessageActionsProps) {
  const actions = useMessageActions();
  const [isConfirming, setIsConfirming] = useState(false);

  if (isConfirming) {
    return (
      <span className="bg-surface-container-lowest border-outline-variant flex shrink-0 items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-[12px]">
        <span className="text-on-surface-variant">Unsend for everyone?</span>
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
            actions.unsend(message.id);
          }}
          className="text-on-error bg-error rounded-full px-2 py-0.5 font-semibold hover:brightness-110"
        >
          Unsend
        </button>
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
          }}
          className="text-on-surface-variant hover:bg-surface-container-high rounded-full px-2 py-0.5"
        >
          Cancel
        </button>
      </span>
    );
  }

  const iconClass =
    'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-tone flex size-7 items-center justify-center rounded-full';

  return (
    <span
      className={cn(
        'flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
        isMine && 'flex-row-reverse',
      )}
    >
      <ReactionPicker
        isMine={isMine}
        onReact={(emoji) => {
          actions.react(message.id, emoji);
        }}
      />
      <button
        type="button"
        aria-label="Reply"
        title="Reply"
        onClick={() => {
          actions.startReply(message.id);
        }}
        className={iconClass}
      >
        <CornerUpLeft aria-hidden className="size-4" />
      </button>
      {canEdit && (
        <button
          type="button"
          aria-label="Edit"
          title="Edit"
          onClick={() => {
            actions.startEdit(message.id);
          }}
          className={iconClass}
        >
          <Pencil aria-hidden className="size-4" />
        </button>
      )}
      {isMine && (
        <button
          type="button"
          aria-label="Unsend"
          title="Unsend"
          onClick={() => {
            setIsConfirming(true);
          }}
          className={cn(iconClass, 'hover:bg-error-container hover:text-on-error-container')}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      )}
    </span>
  );
}
