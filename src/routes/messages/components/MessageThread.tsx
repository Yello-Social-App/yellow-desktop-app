import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_MESSAGE_MAX_ATTACHMENTS } from '@shared/ipc-types';
import { ArrowUp, Info, Paperclip } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendsLoader } from '@/features/friends/hooks';
import {
  useActiveThread,
  useDirectBlock,
  useFileDrop,
  useReadReceipts,
  useSocketStatus,
  useThreadNotices,
  useTypingPeers,
  type ConversationRow,
} from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { describeChange, type ThreadMessage } from '@/features/messages/types';
import { useUsers } from '@/features/users/hooks';
import { calendarDay } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

import { BlockedNotice } from './BlockedNotice';
import { GroupAvatar } from './GroupAvatar';
import { GroupDetailsDialog } from './GroupDetailsDialog';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';

interface MessageThreadProps {
  row: ConversationRow;
}

/** Two lines from the same sender within this window are drawn as one run. */
const RUN_WINDOW_MS = 5 * 60 * 1000;

function dayOf(iso: string): string {
  return new Date(iso).toDateString();
}

/** Header, scrolling transcript and composer for one conversation. */
export function MessageThread({ row }: MessageThreadProps) {
  const viewer = useCurrentUser();
  const thread = useActiveThread();
  const receipts = useReadReceipts();
  const typing = useTypingPeers();
  const socket = useSocketStatus();
  const markActiveRead = useMessagesStore((state) => state.markActiveRead);
  const notices = useThreadNotices();
  const conversations = useMessagesStore((state) => state.conversations);
  const memberOf = useMemo(() => new Set(conversations.map((c) => c.id)), [conversations]);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const drop = useFileDrop();
  // The blocked list is what says a direct chat is one the viewer blocked.
  useFriendsLoader();
  const block = useDirectBlock(row);
  // Senders, the people their lines quote, and whoever a group change names.
  const senderIds = [
    ...new Set([
      ...thread.messages.flatMap((m) =>
        m.replyTo === null ? [m.senderId] : [m.senderId, m.replyTo.senderId],
      ),
      ...notices.flatMap((n) =>
        n.change.actorId === undefined ? n.change.userIds : [...n.change.userIds, n.change.actorId],
      ),
    ]),
  ];
  const people = useUsers(senderIds);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = thread.messages[thread.messages.length - 1]?.id;
  const firstId = thread.messages[0]?.id;
  const previousFirst = useRef<string | undefined>(undefined);
  const previousHeight = useRef(0);

  // New line at the bottom: follow it. Older page at the top: hold the view
  // where it was, so the transcript does not jump under the reader.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    if (previousFirst.current !== undefined && firstId !== previousFirst.current) {
      scroller.scrollTop += scroller.scrollHeight - previousHeight.current;
    } else {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
    previousFirst.current = firstId;
    previousHeight.current = scroller.scrollHeight;
  }, [lastId, firstId, thread.messages.length]);

  // Reading is looking: while the thread is on screen, new lines are read.
  useEffect(() => {
    markActiveRead();
  }, [lastId, markActiveRead]);

  const [peer] = row.peers;
  const isGroup = row.conversation.type === 'GROUP';
  // Once a block stands, the other side's presence and typing are not shown —
  // the service stops sending them, and a stale "Active now" would mislead.
  const showPresence = block === null;
  const subtitle = !showPresence
    ? block === 'you-blocked'
      ? 'Blocked'
      : ''
    : typing.length > 0
      ? `${typing.map(displayName).join(', ')} ${typing.length === 1 ? 'is' : 'are'} typing…`
      : isGroup
        ? `${String(row.conversation.participants.length)} members`
        : row.isOnline
          ? 'Active now'
          : socket === 'connected'
            ? 'Offline'
            : 'Reconnecting…';

  const lines: ReactNode[] = [];
  let previous: ThreadMessage | undefined;
  // Group changes are live-only lines, merged in by time; each one breaks a run.
  const pendingNotices = [...notices];
  const flushNotices = (before: string | null): void => {
    while (
      pendingNotices[0] !== undefined &&
      (before === null || pendingNotices[0].createdAt <= before)
    ) {
      const notice = pendingNotices.shift();
      if (notice === undefined) {
        break;
      }
      lines.push(
        <p
          key={notice.id}
          className="text-on-surface-variant my-sm text-center text-[12px]"
          role="status"
        >
          {describeChange(notice.change, people, viewer?.id ?? null)}
        </p>,
      );
      previous = undefined;
    }
  };
  for (const message of thread.messages) {
    flushNotices(message.createdAt);
    if (previous === undefined || dayOf(previous.createdAt) !== dayOf(message.createdAt)) {
      lines.push(
        <div key={`day-${message.id}`} className="my-sm flex justify-center">
          <span className="bg-surface-container text-on-surface-variant rounded-full px-3 py-1 text-[12px] font-medium">
            {calendarDay(message.createdAt)}
          </span>
        </div>,
      );
    }
    const continues =
      previous?.senderId === message.senderId &&
      dayOf(previous.createdAt) === dayOf(message.createdAt) &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < RUN_WINDOW_MS;
    const readers = receipts[message.id] ?? [];
    lines.push(
      <MessageBubble
        key={message.id}
        message={message}
        isMine={message.senderId === viewer?.id}
        viewerId={viewer?.id ?? null}
        sender={people[message.senderId]}
        quotedSender={message.replyTo === null ? undefined : people[message.replyTo.senderId]}
        showSender={isGroup && !continues}
        continues={continues}
        readBy={readers.map((id) => people[id]).filter((p) => p !== undefined)}
        isInviteMember={
          message.groupInvite !== null && memberOf.has(message.groupInvite.conversationId)
        }
      />,
    );
    previous = message;
  }
  flushNotices(null);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" {...drop.handlers}>
      {drop.isDragging && (
        // Drawn over the whole thread, and deaf to the pointer, so the drag's
        // enter/leave events keep coming from the elements underneath.
        <div
          aria-hidden
          className="bg-background/80 border-primary-container pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed backdrop-blur-sm"
        >
          <Paperclip className="text-primary size-8" />
          <p className="text-on-surface text-[16px] font-semibold">
            {drop.refusal ?? 'Drop to attach'}
          </p>
          {drop.refusal === null && (
            <p className="text-on-surface-variant text-[13px]">
              {`Up to ${String(CHAT_MESSAGE_MAX_ATTACHMENTS)} files, ${String(
                CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024),
              )} MB each`}
            </p>
          )}
        </div>
      )}
      <header className="glass border-outline-variant gap-md px-lg flex h-14 shrink-0 items-center border-b">
        {isGroup || peer === undefined ? (
          <GroupAvatar row={row} size="sm" />
        ) : (
          <Link to={`/users/${peer.id}`}>
            <Avatar
              initials={initialsOf(peer)}
              name={displayName(peer)}
              imageUrl={peer.avatarUrl}
              size="sm"
              isOnline={(showPresence && row.isOnline) || undefined}
            />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-on-surface truncate text-[15px] leading-tight font-bold">
            {row.title}
          </h2>
          {subtitle !== '' && (
            <p
              className={
                showPresence && typing.length > 0
                  ? 'text-primary animate-pulse text-[12px]'
                  : 'text-on-surface-variant text-[12px]'
              }
              aria-live="polite"
            >
              {subtitle}
            </p>
          )}
        </div>
        {isGroup && (
          <IconButton
            label="Group details"
            aria-haspopup="dialog"
            icon={<Info className="size-5" />}
            onClick={() => {
              setIsDetailsOpen(true);
            }}
          />
        )}
      </header>

      <div ref={scrollRef} className="px-lg py-md flex min-h-0 flex-1 flex-col overflow-y-auto">
        {thread.nextCursor !== null && (
          <div className="mb-md flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<ArrowUp className="size-4" />}
              isLoading={thread.isLoadingOlder}
              onClick={thread.loadOlder}
            >
              Older messages
            </Button>
          </div>
        )}

        {thread.status === 'loading' && thread.messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner label="Loading messages…" />
          </div>
        )}

        {thread.status === 'ready' && thread.messages.length === 0 && (
          <p className="text-on-surface-variant m-auto text-center text-[14px]">
            Say hello — this is the start of your conversation.
          </p>
        )}

        {/* Keyed on the conversation: opening another thread fades its
            transcript in, and nothing else on the screen moves. */}
        <div key={row.conversation.id} className="animate-fade-in mt-auto flex flex-col gap-0.5">
          {lines}
        </div>
        <div ref={endRef} />
      </div>

      {block !== null && peer !== undefined ? (
        <BlockedNotice kind={block} conversationId={row.conversation.id} peer={peer} />
      ) : (
        <MessageComposer />
      )}

      {isDetailsOpen && (
        <GroupDetailsDialog
          row={row}
          onClose={() => {
            setIsDetailsOpen(false);
          }}
        />
      )}
    </section>
  );
}
