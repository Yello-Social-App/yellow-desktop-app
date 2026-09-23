import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Avatar } from '@/components/ui/Avatar';
import { useStoriesStore, type Origin } from '@/features/stories/store';
import { STORY_SLIDE_MS, type Story } from '@/features/stories/types';
import { prefersReducedMotion } from '@/lib/appearance';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, initialsOf } from '@/lib/user-display';

const TICK_MS = 50;

/** One curve for everything that moves here: decelerates, never bounces. */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';
const OPEN_MS = 460;
const CLOSE_MS = 320;
const SWAP_MS = 380;

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

/**
 * Full-screen story playback. Opens by growing out of the ring that was
 * tapped and closes by shrinking back into it; stories swing in from the
 * side they came from; slides crossfade. Segmented progress on top, tap the
 * left third to go back, the right to go forward, hold to pause.
 */
export function StoryViewer() {
  const stories = useStoriesStore((state) => state.stories);
  const mine = useStoriesStore((state) => state.mine);
  const openId = useStoriesStore((state) => state.openId);
  const origin = useStoriesStore((state) => state.origin);
  const close = useStoriesStore((state) => state.close);
  const markSeen = useStoriesStore((state) => state.markSeen);

  const sequence = useMemo<Story[]>(() => {
    const all = mine === null ? stories : [mine, ...stories];
    const startAt = all.findIndex((s) => s.id === openId);
    return startAt === -1 ? [] : all.slice(startAt);
  }, [stories, mine, openId]);

  const [storyIndex, setStoryIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  /** Which way the last move went; the crossfade base and the swing read it. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const story = sequence[storyIndex];
  const slide = story?.slides[slideIndex];

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
  }, [isClosing, origin, close]);

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
   * Playback
   * ---------------------------------------------------------------- */
  const resetClock = (): void => {
    elapsedRef.current = 0;
    setElapsed(0);
  };

  const advance = useCallback(() => {
    resetClock();
    if (story === undefined) {
      return;
    }
    if (slideIndex + 1 < story.slides.length) {
      setDirection(1);
      setSlideIndex((i) => i + 1);
      return;
    }
    markSeen(story.id);
    if (storyIndex + 1 < sequence.length) {
      setDirection(1);
      setStoryIndex((i) => i + 1);
      setSlideIndex(0);
    } else {
      requestClose();
    }
  }, [story, slideIndex, storyIndex, sequence.length, markSeen, requestClose]);

  const rewind = useCallback(() => {
    resetClock();
    if (slideIndex > 0) {
      setDirection(-1);
      setSlideIndex((i) => i - 1);
      return;
    }
    if (storyIndex > 0) {
      const previous = sequence[storyIndex - 1];
      setDirection(-1);
      setStoryIndex((i) => i - 1);
      setSlideIndex(previous === undefined ? 0 : Math.max(0, previous.slides.length - 1));
    }
  }, [slideIndex, storyIndex, sequence]);

  const skipToNextStory = useCallback(() => {
    if (story === undefined) {
      return;
    }
    resetClock();
    markSeen(story.id);
    setDirection(1);
    setStoryIndex((i) => i + 1);
    setSlideIndex(0);
  }, [story, markSeen]);

  // The clock lives in a ref and is mirrored to state for the progress bar,
  // so the tick decides to move on without a state updater doing side work.
  useEffect(() => {
    if (isPaused || isClosing || slide === undefined) {
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
  }, [isPaused, isClosing, slide, advance]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestClose();
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
  }, [advance, rewind, requestClose]);

  if (story === undefined || slide === undefined) {
    return null;
  }

  // The cover underneath the crossfade is the one we just came from, so a
  // slide change fades new over old rather than new over itself.
  const cameFrom =
    direction === 1
      ? (story.slides[slideIndex - 1] ?? sequence[storyIndex - 1]?.slides.at(-1))
      : (story.slides[slideIndex + 1] ?? sequence[storyIndex + 1]?.slides[0]);
  const baseCover = cameFrom?.cover ?? slide.cover;

  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal
      aria-label={`${displayName(story.author)}'s story`}
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
          baseCover,
        )}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onMouseDown={() => {
          setIsPaused(true);
        }}
        onMouseUp={() => {
          setIsPaused(false);
        }}
        onMouseLeave={() => {
          setIsPaused(false);
        }}
      >
        {/* Keyed by slide: a new one fades in over the card's current cover. */}
        <div key={slide.id} className={cn('animate-fade-in absolute inset-0', slide.cover)} />

        <div className="absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
          {story.slides.map((item, index) => (
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
            initials={initialsOf(story.author)}
            name={displayName(story.author)}
            imageUrl={story.author.avatarUrl}
            size="sm"
          />
          <span className="text-[14px] font-semibold drop-shadow">{displayName(story.author)}</span>
          <span className="text-[12px] text-white/80">{relativeTime(slide.createdAt)}</span>
          <span
            className={cn(
              'ml-auto text-white/80 transition-opacity',
              isPaused ? 'opacity-100' : 'opacity-0',
            )}
          >
            {isPaused ? <Pause className="size-4" /> : <Play className="size-4" />}
          </span>
        </div>

        <p
          key={`${slide.id}-text`}
          className="animate-fade-up relative m-auto px-8 text-center text-[26px] leading-snug font-bold text-white drop-shadow-lg"
        >
          {slide.text}
        </p>

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
      </div>
    </div>,
    document.body,
  );
}
