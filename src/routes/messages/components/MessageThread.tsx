import { ArrowUp, Users } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentUser } from '@/features/auth/hooks';
import {
  useActiveThread,
  useReadReceipts,
  useSocketStatus,
  useTypingPeers,
  type ConversationRow,
} from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import type { ThreadMessage } from '@/features/messages/types';
import { useUsers } from '@/features/users/hooks';
import { calendarDay } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

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
  const senderIds = [...new Set(thread.messages.map((m) => m.senderId))];
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
  const subtitle =
    typing.length > 0
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
  for (const message of thread.messages) {
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
        sender={people[message.senderId]}
        showSender={isGroup && !continues}
        continues={continues}
        readBy={readers.map((id) => people[id]).filter((p) => p !== undefined)}
      />,
    );
    previous = message;
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="glass border-outline-variant gap-md px-lg flex h-14 shrink-0 items-center border-b">
        {isGroup || peer === undefined ? (
          <span className="bg-surface-container text-on-surface-variant flex size-9 items-center justify-center rounded-full">
            <Users aria-hidden className="size-4" />
          </span>
        ) : (
          <Link to={`/users/${peer.id}`}>
            <Avatar
              initials={initialsOf(peer)}
              name={displayName(peer)}
              imageUrl={peer.avatarUrl}
              size="sm"
              isOnline={row.isOnline || undefined}
            />
          </Link>
        )}
        <div className="min-w-0">
          <h2 className="text-on-surface truncate text-[15px] leading-tight font-bold">
            {row.title}
          </h2>
          <p
            className={
              typing.length > 0
                ? 'text-primary animate-pulse text-[12px]'
                : 'text-on-surface-variant text-[12px]'
            }
            aria-live="polite"
          >
            {subtitle}
          </p>
        </div>
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

      <MessageComposer />
    </section>
  );
}
