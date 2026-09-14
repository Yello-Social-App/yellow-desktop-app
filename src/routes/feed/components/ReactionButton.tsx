import { Heart } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { REACTION_LABELS } from '@/features/feed/types';
import { REACTION_TYPES, type ReactionType } from '@shared/ipc-types';
import { cn } from '@/lib/cn';

interface ReactionButtonProps {
  /** What the viewer currently holds, if anything. */
  current: ReactionType | null | undefined;
  /** The number shown beside the icon; hidden when zero. */
  count: number;
  disabled?: boolean;
  /** Fires with a type from the strip, or without one for the plain tap. */
  onReact: (type?: ReactionType) => void;
  size?: 'sm' | 'md';
  /** Extra classes for the trigger; the strip styles itself. */
  className?: string;
}

/** Hover has to settle before the strip opens; leaving has to settle before it closes. */
const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 250;

/**
 * The reaction control: a tap toggles a like; hovering (or pressing ↑) opens
 * a strip of all six reactions, each of which springs up under the pointer.
 * The trigger shows whichever reaction is held — ❤️ Love, 😄 Haha — rather
 * than always a heart, so the choice is visible afterwards.
 *
 * The strip is positioned relative to the trigger, not portalled: it only
 * ever needs to sit just above it, and staying in the tree is what lets the
 * hover be one continuous region.
 */
export function ReactionButton({
  current,
  count,
  disabled = false,
  onReact,
  size = 'md',
  className,
}: ReactionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripId = useId();
  const held = current ?? null;
  const heldLabel = held === null ? null : REACTION_LABELS[held];

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleOpen = (): void => {
    if (disabled) {
      return;
    }
    clearTimers();
    openTimer.current = setTimeout(() => {
      setIsOpen(true);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = (): void => {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      setIsOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const choose = (type?: ReactionType): void => {
    clearTimers();
    setIsOpen(false);
    onReact(type);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' && !isOpen) {
      event.preventDefault();
      clearTimers();
      setIsOpen(true);
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onBlur={(event) => {
        // Focus leaving the whole control closes the strip; moving within keeps it.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-pressed={held !== null}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={stripId}
        title={
          heldLabel === null ? 'Like — hold to pick a reaction' : `You reacted ${heldLabel.label}`
        }
        disabled={disabled}
        onClick={() => {
          choose();
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'group transition-tone flex items-center gap-1.5 rounded-full font-medium tabular-nums disabled:opacity-40',
          size === 'md' ? 'py-1.5 pr-3 pl-2 text-[13px]' : 'px-2 py-1 text-[12px] font-semibold',
          held !== null
            ? 'text-secondary'
            : 'text-on-surface-variant hover:bg-secondary-fixed hover:text-secondary',
          className,
        )}
      >
        {heldLabel === null ? (
          <Heart
            aria-hidden
            className={cn(
              'transition-transform group-active:scale-90',
              size === 'md' ? 'size-[18px]' : 'size-3.5',
            )}
          />
        ) : (
          <span
            aria-hidden
            className={cn('leading-none', size === 'md' ? 'text-[17px]' : 'text-[14px]')}
          >
            {heldLabel.emoji}
          </span>
        )}
        {count > 0 ? <span>{count}</span> : size === 'sm' && <span>Like</span>}
      </button>

      <span
        id={stripId}
        role="group"
        aria-label="Pick a reaction"
        // Kept in the tree and toggled by opacity/transform: it can then
        // animate in, and the hover region stays continuous across the gap.
        className={cn(
          'bg-surface-container-highest border-outline-variant shadow-floating absolute bottom-full left-0 z-20 mb-1.5 flex items-center gap-0.5 rounded-full border px-1.5 py-1',
          'origin-bottom-left transition-[opacity,transform] duration-200',
          isOpen
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-1 scale-90 opacity-0',
        )}
      >
        {REACTION_TYPES.map((type, index) => {
          const { emoji, label } = REACTION_LABELS[type];
          const isHeld = type === held;
          return (
            <button
              key={type}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              aria-label={isHeld ? `Remove your ${label}` : label}
              aria-pressed={isHeld}
              title={label}
              onClick={(event) => {
                event.stopPropagation();
                choose(type);
              }}
              className={cn(
                'grid size-9 place-items-center rounded-full text-[24px] leading-none',
                'transition-transform duration-150 ease-out hover:-translate-y-1.5 hover:scale-[1.35] focus-visible:-translate-y-1.5 focus-visible:scale-[1.35]',
                isHeld && 'bg-secondary-fixed ring-secondary ring-2',
                // Each one arrives a beat after the last, left to right.
                isOpen && 'animate-fade-up',
              )}
              // Delays live in classes normally (strict CSP); here it is the
              // one per-index value, and animation-delay is a CSSOM write,
              // which the policy allows.
              ref={(node) => {
                if (node !== null) {
                  node.style.animationDelay = `${String(index * 30)}ms`;
                }
              }}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          );
        })}
      </span>
    </span>
  );
}
