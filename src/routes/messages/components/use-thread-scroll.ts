import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { prefersReducedMotion } from '@/lib/appearance';

/** This close to the bottom still counts as reading the newest line. */
const PINNED_SLACK_PX = 80;
/** Scrolled further up than this, the jump-to-latest button shows. */
const JUMP_BUTTON_PX = 300;

interface ScrollLine {
  id: string;
  senderId: string;
}

interface ThreadScrollOptions {
  conversationId: string;
  messages: readonly ScrollLine[];
  viewerId: string | null;
}

export interface ThreadScroll {
  /** The overflow container. */
  scrollRef: RefObject<HTMLDivElement>;
  /** The transcript inside it; its growth (a late image) is followed. */
  contentRef: RefObject<HTMLDivElement>;
  showJump: boolean;
  /** Lines from others that arrived while the reader was scrolled up. */
  unseen: number;
  jumpToLatest: () => void;
}

/**
 * Keeps a transcript on its newest line the way Messenger and Telegram do.
 *
 * Opening a thread starts at the bottom. While the reader is at the bottom,
 * new lines and late-loading media are followed; once they scroll up, the view
 * stays put, a new line from someone else is counted instead, and a button
 * brings them back down. Sending a line always follows it. An older page
 * landing on top holds the view where it was.
 */
export function useThreadScroll({
  conversationId,
  messages,
  viewerId,
}: ThreadScrollOptions): ThreadScroll {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isPinned = useRef(true);
  const height = useRef(0);
  const previous = useRef<{ conversationId: string; firstId?: string; lastId?: string } | null>(
    null,
  );
  const lastIdRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);
  /** The newest line the reader had when they left the bottom; null while pinned. */
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const firstId = messages[0]?.id;
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const lastIsMine = last?.senderId === viewerId;

  const toBottom = useCallback((): void => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const before = previous.current;
    if (before?.conversationId !== conversationId || before.lastId === undefined) {
      // A thread just opened, or its first page just arrived.
      isPinned.current = true;
      toBottom();
    } else if (firstId !== before.firstId && lastId === before.lastId) {
      scroller.scrollTop += scroller.scrollHeight - height.current;
    } else if (isPinned.current || (lastId !== before.lastId && lastIsMine)) {
      isPinned.current = true;
      toBottom();
    }
    previous.current = { conversationId, firstId, lastId };
    lastIdRef.current = lastId;
    height.current = scroller.scrollHeight;
  }, [conversationId, firstId, lastId, lastIsMine, messages.length, toBottom]);

  // The reader's position decides whether to follow, and whether to offer the button.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const onScroll = (): void => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const wasPinned = isPinned.current;
      isPinned.current = distance <= PINNED_SLACK_PX;
      if (isPinned.current) {
        setAnchorId(null);
      } else if (wasPinned) {
        setAnchorId(lastIdRef.current ?? null);
      }
      setShowJump(distance > JUMP_BUTTON_PX);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Stay on the bottom through any change of size: images and link previews
  // growing the transcript after layout, and the viewport itself shrinking
  // under a reply bar, an attachment tray, a taller composer or a window
  // resize — none of which fires a scroll event. The transcript is keyed on
  // the conversation, so a new thread is a new node to watch.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (isPinned.current) {
        toBottom();
      }
      height.current = scroller.scrollHeight;
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, [conversationId, toBottom]);

  const jumpToLatest = useCallback((): void => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    isPinned.current = true;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, []);

  // Counted from the anchor rather than kept as a tally, so a thread switch
  // (whose lines do not contain the anchor) reads as zero on its own.
  let unseen = 0;
  if (anchorId !== null) {
    const from = messages.findIndex((m) => m.id === anchorId);
    if (from !== -1) {
      unseen = messages.slice(from + 1).filter((m) => m.senderId !== viewerId).length;
    }
  }

  return { scrollRef, contentRef, showJump: showJump || unseen > 0, unseen, jumpToLatest };
}
