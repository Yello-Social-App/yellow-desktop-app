import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  Pause,
  Play,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { storyErrorMessage } from '@/features/stories/api';
import { useViewerRings } from '@/features/stories/hooks';
import { useStoriesStore, type Origin } from '@/features/stories/store';
import {
  STORY_SLIDE_MS,
  backdropOf,
  firstUnseenIndex,
  isImageUrlStale,
} from '@/features/stories/types';
import { STORY_REPLY_MAX } from '@shared/ipc-types';
import { prefersReducedMotion } from '@/lib/appearance';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

import { StoryViewersList } from './StoryViewersList';

const TICK_MS = 50;
/** How long "Reply sent" stays before the reply box is back to empty. */
const SENT_NOTICE_MS = 2000;

/** One curve for everything that moves here: decelerates, never bounces. */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';
const OPEN_MS = 460;
const CLOSE_MS = 320;
const SWAP_MS = 380;

type Panel = 'none' | 'viewers' | 'delete';

type ReplyState =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string };

/**
 * The transform that puts the card exactly over its origin ring: translate
 * the centres together, scale to the ring's width. Applied as the *from*
 * of the open animation and the *to* of the close — the FLIP technique, so
 * layout never changes, only transforms.
 */
function transformToOrigin(card: DOMRect, origin: Origin): string {
  const dx = origin.x + origin.width / 2 - (card.left + card.width / 2);
  const dy = origin.y + origin.height / 2 - (card.top + card.height / 2);
  const scale = origin.width / card.width;
  return `translate(${String(dx)}px, ${String(dy)}px) scale(${String(scale)})`;
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Full-screen story playback, mounted once by the app shell whenever a ring is
 * open. Opens by growing out of the ring that was tapped and closes by
 * shrinking back into it; rings swing in from the side they came from; slides
 * crossfade. Segmented progress on top, tap the left third to go back, the
 * right to go forward, hold to pause.
 *
 * A ring starts at its first slide you have not watched. A slide is reported
 * seen when it finishes or is skipped — never merely for being loaded. A photo
 * slide's clock waits for the photo, and a signed link that has lapsed is
 * re-read before it is drawn.
 *
 * Someone else's story has a reply box (a reply becomes a DM); your own has
 * "Seen by" and delete instead. Typing, the viewer list and the delete
 * question all hold playback.
 */
export function StoryViewer() {
  const sequence = useViewerRings();
  const origin = useStoriesStore((state) => state.viewer?.origin ?? null);
  const close = useStoriesStore((state) => state.close);
  const markSeen = useStoriesStore((state) => state.markSeen);
  const refreshStory = useStoriesStore((state) => state.refreshStory);
  const removeStory = useStoriesStore((state) => state.remove);
  const replyToStory = useStoriesStore((state) => state.reply);

  const [storyIndex, setStoryIndex] = useState(0);
  const [slideCursor, setSlideIndex] = useState(() => firstUnseenIndex(sequence[0]?.slides ?? []));
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  /** Which way the last move went; the crossfade base and the swing read it. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const [panel, setPanel] = useState<Panel>('none');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [replyState, setReplyState] = useState<ReplyState>({ kind: 'idle' });
  /** The reply's idempotency key: kept across a retry of the same text, new for new text. */
  const clientIdRef = useRef<string | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  /** Photo slides whose image has drawn, or has failed for good. */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const retriedIds = useRef(new Set<string>());

  const ring = sequence[storyIndex];
  // The ring can shrink under the viewer — a slide deleted, a refresh dropping
  // an expired one — so the cursor is clamped to what is there now.
  const slideIndex = ring === undefined ? 0 : Math.min(slideCursor, ring.slides.length - 1);
  const slide = ring?.slides[slideIndex];

  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const previousStoryRef = useRef(0);

  /* ---------------------------------------------------------------- *
   * Open: grow out of the ring
   * ---------------------------------------------------------------- */
  useLayoutEffect(() => {
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    const chrome = chromeRef.current;
    if (card === null || backdrop === null) {
      return;
    }
    if (prefersReducedMotion()) {
      return;
    }

    const from =
      origin === null
        ? 'translateY(24px) scale(0.92)'
        : transformToOrigin(card.getBoundingClientRect(), origin);

    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: OPEN_MS * 0.7,
      easing: 'ease-out',
      fill: 'both',
    });
    card.animate(
      [
        { transform: from, opacity: 0.4, borderRadius: '9999px' },
        { transform: 'none', opacity: 1, borderRadius: '24px' },
      ],
      { duration: OPEN_MS, easing: EASE_OUT, fill: 'both' },
    );
    // The buttons around the card arrive a beat later, once it has landed.
    chrome?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 240,
      delay: OPEN_MS * 0.6,
      easing: 'ease-out',
      fill: 'both',
    });
    // Runs once, on mount: `origin` is fixed for the life of the viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- *
   * Close: shrink back into the ring, then unmount
   * ---------------------------------------------------------------- */
  const requestClose = useCallback(() => {
    if (isClosing) {
      return;
    }
    // Closing skips the rest of this slide, which counts as having seen it.
    if (slide !== undefined) {
      markSeen(slide.id);
    }
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    if (card === null || backdrop === null || prefersReducedMotion()) {
      close();
      return;
    }
    setIsClosing(true);

    const to =
      origin === null
        ? 'translateY(24px) scale(0.92)'
        : transformToOrigin(card.getBoundingClientRect(), origin);

    chromeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 120,
      fill: 'both',
    });
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CLOSE_MS,
      delay: 60,
      easing: 'ease-in',
      fill: 'both',
    });
    const shrink = card.animate(
      [
        { transform: 'none', opacity: 1, borderRadius: '24px' },
        { transform: to, opacity: 0.2, borderRadius: '9999px' },
      ],
      { duration: CLOSE_MS, easing: EASE_IN, fill: 'both' },
    );
    shrink.onfinish = close;
    shrink.oncancel = close;
  }, [isClosing, slide, origin, close, markSeen]);

  // Nothing left to show (every ring emptied, or the last one deleted): leave.
  useEffect(() => {
    if (ring === undefined) {
      close();
    }
  }, [ring, close]);

  /* ---------------------------------------------------------------- *
   * Story swaps: swing in from the side travelled from
   * ---------------------------------------------------------------- */
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card === null || storyIndex === previousStoryRef.current) {
      return;
    }
    previousStoryRef.current = storyIndex;
    if (prefersReducedMotion()) {
      return;
    }
    const sign = direction;
    card.animate(
      [
        {
          transform: `translateX(${String(sign * 90)}px) rotateY(${String(-sign * 14)}deg) scale(0.94)`,
          opacity: 0.35,
        },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SWAP_MS, easing: EASE_OUT, fill: 'both' },
    );
    // `direction` is set in the same handler as `storyIndex`; the swing
    // belongs to the story change alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyIndex]);

  /* ---------------------------------------------------------------- *
   * Photo slides: fresh links, and a clock that waits for the image
   * ---------------------------------------------------------------- */
  const slideId = slide?.id;
  const isStale = slide !== undefined && isImageUrlStale(slide);
  useEffect(() => {
    if (slideId !== undefined && isStale) {
      void refreshStory(slideId);
    }
  }, [slideId, isStale, refreshStory]);

  const onImageError = (): void => {
    if (slide === undefined) {
      return;
    }
    // Once: the link may simply have lapsed. A second failure is final.
    if (!retriedIds.current.has(slide.id)) {
      retriedIds.current.add(slide.id);
      void refreshStory(slide.id);
      return;
    }
    const id = slide.id;
    setFailedIds((held) => new Set(held).add(id));
  };

  const imageUrl = slide?.type === 'IMAGE' ? (slide.image?.url ?? null) : null;
  const hasImageFailed = slide?.type === 'IMAGE' && (imageUrl === null || failedIds.has(slide.id));
  const isReady =
    slide !== undefined && (slide.type === 'TEXT' || hasImageFailed || loadedId === slide.id);

  /* ---------------------------------------------------------------- *
   * Playback
   * ---------------------------------------------------------------- */
  const resetClock = (): void => {
    elapsedRef.current = 0;
    setElapsed(0);
  };

  /**
   * Moves to another ring. A reply is to one person's story, so the reply box
   * and any open panel start over there.
   */
  const goToRing = useCallback((index: number, slideAt: number, way: 1 | -1) => {
    setDirection(way);
    setStoryIndex(index);
    setSlideIndex(slideAt);
    setDraft('');
    setReplyState({ kind: 'idle' });
    clientIdRef.current = null;
    setPanel('none');
  }, []);

  const advance = useCallback(() => {
    resetClock();
    if (ring === undefined || slide === undefined) {
      return;
    }
    markSeen(slide.id);
    if (slideIndex + 1 < ring.slides.length) {
      setDirection(1);
      setSlideIndex(slideIndex + 1);
      return;
    }
    const next = sequence[storyIndex + 1];
    if (next !== undefined) {
      goToRing(storyIndex + 1, firstUnseenIndex(next.slides), 1);
    } else {
      requestClose();
    }
  }, [ring, slide, slideIndex, storyIndex, sequence, markSeen, requestClose, goToRing]);

  const rewind = useCallback(() => {
    resetClock();
    if (slideIndex > 0) {
      setDirection(-1);
      setSlideIndex(slideIndex - 1);
      return;
    }
    const previous = sequence[storyIndex - 1];
    if (previous !== undefined) {
      goToRing(storyIndex - 1, previous.slides.length - 1, -1);
    }
  }, [slideIndex, storyIndex, sequence, goToRing]);

  const skipToNextStory = useCallback(() => {
    const next = sequence[storyIndex + 1];
    if (slide === undefined || next === undefined) {
      return;
    }
    resetClock();
    markSeen(slide.id);
    goToRing(storyIndex + 1, firstUnseenIndex(next.slides), 1);
  }, [slide, storyIndex, sequence, markSeen, goToRing]);

  const isHeld = isPaused || isTyping || panel !== 'none';

  // The clock lives in a ref and is mirrored to state for the progress bar,
  // so the tick decides to move on without a state updater doing side work.
  useEffect(() => {
    if (isHeld || isClosing || !isReady) {
      return;
    }
    const timer = setInterval(() => {
      elapsedRef.current += TICK_MS;
      if (elapsedRef.current >= STORY_SLIDE_MS) {
        elapsedRef.current = 0;
        advance();
      } else {
        setElapsed(elapsedRef.current);
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isHeld, isClosing, isReady, advance]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target)) {
        // Typing a reply: Escape leaves the box, every other key is the text's.
        if (event.key === 'Escape') {
          event.preventDefault();
          replyInputRef.current?.blur();
        }
        return;
      }
      if (event.key === 'Escape') {
        if (panel === 'none') {
          requestClose();
        } else {
          setPanel('none');
        }
      } else if (panel !== 'none') {
        return;
      } else if (event.key === 'ArrowRight') {
        advance();
      } else if (event.key === 'ArrowLeft') {
        rewind();
      } else if (event.key === ' ') {
        event.preventDefault();
        setIsPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [advance, rewind, requestClose, panel]);

  /* ---------------------------------------------------------------- *
   * Reply and delete
   * ---------------------------------------------------------------- */
  const sendReply = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const text = draft.trim();
    if (slide === undefined || text === '' || replyState.kind === 'sending') {
      return;
    }
    clientIdRef.current ??= `c-${crypto.randomUUID()}`;
    setReplyState({ kind: 'sending' });
    const result = await replyToStory(slide.id, text, clientIdRef.current);
    if (!result.ok) {
      // The same key goes again on a retry, so it can never land twice.
      setReplyState({ kind: 'failed', message: storyErrorMessage(result.error) });
      return;
    }
    // Accepted; the DM itself arrives over the chat socket in a moment.
    clientIdRef.current = null;
    setDraft('');
    setReplyState({ kind: 'sent' });
    replyInputRef.current?.blur();
    setTimeout(() => {
      setReplyState((state) => (state.kind === 'sent' ? { kind: 'idle' } : state));
    }, SENT_NOTICE_MS);
  };

  const confirmDelete = async (): Promise<void> => {
    if (ring === undefined || slide === undefined) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    const result = await removeStory(slide.id);
    setIsDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setPanel('none');
    resetClock();
    // The ring loses this slide. When it was the last one the whole ring goes
    // and the next one slides into this index; the effect above closes the
    // viewer when there is no next one.
    if (ring.slides.length === 1) {
      const next = sequence[storyIndex + 1];
      goToRing(storyIndex, next === undefined ? 0 : firstUnseenIndex(next.slides), 1);
    } else {
      setSlideIndex(Math.min(slideIndex, ring.slides.length - 2));
    }
  };

  if (ring === undefined || slide === undefined) {
    return null;
  }

  // The backdrop underneath the crossfade is the one we just came from, so a
  // slide change fades new over old rather than new over itself.
  const cameFrom =
    direction === 1
      ? (ring.slides[slideIndex - 1] ?? sequence[storyIndex - 1]?.slides.at(-1))
      : (ring.slides[slideIndex + 1] ?? sequence[storyIndex + 1]?.slides[0]);
  const baseBackdrop = backdropOf(cameFrom ?? slide);
  const isOwn = slide.isOwner;
  const authorName = displayName(ring.author);

  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal
      aria-label={`${authorName}'s story`}
      className="bg-surface-dim/85 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md [perspective:1200px]"
      onClick={requestClose}
    >
      <div ref={chromeRef} className="contents">
        <button
          type="button"
          aria-label="Close"
          onClick={requestClose}
          className="absolute top-5 right-5 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-transform hover:scale-110 hover:bg-white/20"
        >
          <X className="size-5" />
        </button>

        {storyIndex > 0 && (
          <button
            type="button"
            aria-label="Previous story"
            onClick={(event) => {
              event.stopPropagation();
              rewind();
            }}
            className="absolute left-[calc(50%-300px)] hidden size-11 place-items-center rounded-full bg-white/10 text-white transition-transform hover:scale-110 hover:bg-white/20 md:grid"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {storyIndex + 1 < sequence.length && (
          <button
            type="button"
            aria-label="Next story"
            onClick={(event) => {
              event.stopPropagation();
              skipToNextStory();
            }}
            className="absolute right-[calc(50%-300px)] hidden size-11 place-items-center rounded-full bg-white/10 text-white transition-transform hover:scale-110 hover:bg-white/20 md:grid"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      <div
        ref={cardRef}
        className={cn(
          'shadow-canvas relative flex aspect-[9/16] h-[min(86vh,780px)] flex-col overflow-hidden rounded-3xl will-change-transform select-none',
          baseBackdrop,
        )}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          if (!isTextEntry(event.target)) {
            setIsPaused(true);
          }
        }}
        onMouseUp={() => {
          setIsPaused(false);
        }}
        onMouseLeave={() => {
          setIsPaused(false);
        }}
      >
        {/* Keyed by slide: a new one fades in over the card's current backdrop. */}
        <div key={slide.id} className={cn('animate-fade-in absolute inset-0', backdropOf(slide))} />

        {slide.type === 'IMAGE' && imageUrl !== null && !hasImageFailed && (
          <img
            key={`${slide.id}-image`}
            src={imageUrl}
            alt={slide.text ?? `Photo from ${authorName}`}
            width={slide.image !== null && slide.image.width > 0 ? slide.image.width : undefined}
            height={slide.image !== null && slide.image.height > 0 ? slide.image.height : undefined}
            onLoad={() => {
              setLoadedId(slide.id);
            }}
            onError={onImageError}
            className="animate-fade-in absolute inset-0 size-full object-contain"
          />
        )}
        {slide.type === 'IMAGE' && !isReady && (
          <span className="absolute inset-0 grid place-items-center text-white">
            <Spinner label="Loading photo" />
          </span>
        )}
        {hasImageFailed && (
          <p className="absolute inset-0 m-auto grid place-items-center px-8 text-center text-[15px] text-white/80">
            This photo can’t be shown right now.
          </p>
        )}

        <div className="absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
          {ring.slides.map((item, index) => (
            <span key={item.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <span
                className="block h-full bg-white"
                ref={(node) => {
                  if (node === null) {
                    return;
                  }
                  const fill =
                    index < slideIndex ? 1 : index === slideIndex ? elapsed / STORY_SLIDE_MS : 0;
                  node.style.width = `${String(fill * 100)}%`;
                }}
              />
            </span>
          ))}
        </div>

        <div className="absolute inset-x-0 top-6 z-10 flex items-center gap-2 px-4 text-white">
          <Avatar
            initials={initialsOf(ring.author)}
            name={authorName}
            imageUrl={ring.author.avatarUrl}
            size="sm"
          />
          <span className="text-[14px] font-semibold drop-shadow">{authorName}</span>
          <span className="text-[12px] text-white/80">{relativeTime(slide.createdAt)}</span>
          {isOwn && (
            <span className="flex items-center gap-1 text-[12px] text-white/80">
              {slide.visibility === 'PUBLIC' ? (
                <Globe aria-hidden className="size-3" />
              ) : (
                <Users aria-hidden className="size-3" />
              )}
              {slide.visibility === 'PUBLIC' ? 'Everyone' : 'Friends'}
            </span>
          )}
          <span
            className={cn(
              'ml-auto text-white/80 transition-opacity',
              isHeld ? 'opacity-100' : 'opacity-0',
            )}
          >
            {isHeld ? <Pause className="size-4" /> : <Play className="size-4" />}
          </span>
        </div>

        {slide.type === 'TEXT' ? (
          <p
            key={`${slide.id}-text`}
            className="animate-fade-up relative m-auto px-8 text-center text-[26px] leading-snug font-bold break-words text-white drop-shadow-lg"
          >
            {slide.text}
          </p>
        ) : (
          slide.text !== undefined && (
            <p
              key={`${slide.id}-caption`}
              className="animate-fade-up absolute inset-x-0 bottom-20 z-10 px-6 text-center text-[16px] leading-snug font-semibold break-words text-white drop-shadow-lg"
            >
              {slide.text}
            </p>
          )
        )}

        {/* Tap zones: back on the left third, forward elsewhere. */}
        <button
          type="button"
          aria-label="Previous"
          onClick={rewind}
          className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={advance}
          className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize"
        />

        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
          {isOwn ? (
            <div className="flex items-center justify-between gap-2 text-white">
              <button
                type="button"
                onClick={() => {
                  setPanel('viewers');
                }}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-white/15"
              >
                <Eye aria-hidden className="size-4" />
                Seen by {slide.viewCount ?? 0}
              </button>
              <button
                type="button"
                aria-label="Delete this story"
                title="Delete"
                onClick={() => {
                  setDeleteError(null);
                  setPanel('delete');
                }}
                className="grid size-9 place-items-center rounded-full hover:bg-white/15"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                void sendReply(event);
              }}
              className="flex flex-col gap-1.5"
            >
              {replyState.kind === 'sent' && (
                <span role="status" className="flex items-center gap-1 px-2 text-[12px] text-white">
                  <Check aria-hidden className="size-3.5" />
                  Reply sent
                </span>
              )}
              {replyState.kind === 'failed' && (
                <span role="alert" className="px-2 text-[12px] text-white">
                  {replyState.message} Press Enter to try again.
                </span>
              )}
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="story-reply">
                  Reply to {authorName}
                </label>
                <input
                  ref={replyInputRef}
                  id="story-reply"
                  type="text"
                  value={draft}
                  maxLength={STORY_REPLY_MAX}
                  placeholder={`Reply to ${authorName}…`}
                  autoComplete="off"
                  onFocus={() => {
                    setIsTyping(true);
                  }}
                  onBlur={() => {
                    setIsTyping(false);
                  }}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    // New words are a new message; only an unchanged retry reuses the key.
                    clientIdRef.current = null;
                    if (replyState.kind !== 'sending') {
                      setReplyState({ kind: 'idle' });
                    }
                  }}
                  className="h-10 min-w-0 flex-1 rounded-full border border-white/50 bg-black/20 px-4 text-[14px] text-white outline-none placeholder:text-white/70 focus:border-white"
                />
                <button
                  type="submit"
                  aria-label="Send reply"
                  disabled={draft.trim() === '' || replyState.kind === 'sending'}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 disabled:opacity-50"
                >
                  <SendHorizontal aria-hidden className="size-5" />
                </button>
              </div>
            </form>
          )}
        </div>

        {panel === 'viewers' && (
          <div
            role="dialog"
            aria-label="Viewers"
            className="animate-fade-up absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col rounded-t-3xl bg-black/85 p-4 text-white backdrop-blur"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Seen by {slide.viewCount ?? 0}</h2>
              <button
                type="button"
                aria-label="Close viewers"
                onClick={() => {
                  setPanel('none');
                }}
                className="grid size-8 place-items-center rounded-full hover:bg-white/15"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <StoryViewersList key={slide.id} story={slide} tone="dark" />
            </div>
          </div>
        )}

        {panel === 'delete' && (
          <div
            role="alertdialog"
            aria-label="Delete this story?"
            className="animate-fade-up absolute inset-x-0 bottom-0 z-30 flex flex-col gap-3 rounded-t-3xl bg-black/85 p-5 text-white backdrop-blur"
          >
            <h2 className="text-[15px] font-semibold">Delete this story?</h2>
            <p className="text-[13px] text-white/80">
              It disappears for everyone now, and from your story archive. This can’t be undone.
            </p>
            {deleteError !== null && (
              <p role="alert" className="text-[13px] text-white">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPanel('none');
                }}
                className="rounded-full px-4 py-2 text-[13px] font-semibold hover:bg-white/15"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  void confirmDelete();
                }}
                className="bg-error text-on-error rounded-full px-4 py-2 text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
