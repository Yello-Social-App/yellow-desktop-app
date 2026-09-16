import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A panel anchored to the control that opened it.
 *
 * Extracted when the second one appeared, not the first: the notification bell
 * carried this logic inline while it was the only dropdown in the app, and an
 * account switcher wanting the same dismissal behaviour is what made it a
 * shared thing rather than a guess about the future.
 *
 * It owns dismissal and nothing else. Open state stays with the caller, because
 * the caller is what draws the trigger and usually needs to know anyway — a
 * pressed button, a rotated chevron, a paused poll.
 *
 * Deliberately not a library: two dropdowns with a click-outside and an Escape
 * key do not justify a dependency, and positioning here is a corner anchor
 * rather than the collision-aware placement a floating-element library exists
 * to solve.
 */
export type PopoverAlign = 'left' | 'right';
export type PopoverSide = 'below' | 'above';

interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** The control that toggles the panel; stays in normal flow. */
  trigger: ReactNode;
  children: ReactNode;
  /** Which edge the panel lines up with. */
  align?: PopoverAlign;
  /** Panels near the bottom of the window open upward. */
  side?: PopoverSide;
  label: string;
  className?: string;
  panelClassName?: string;
}

export function Popover({
  isOpen,
  onClose,
  trigger,
  children,
  align = 'left',
  side = 'below',
  label,
  className,
  panelClassName,
}: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Bound to the document only while open, so a closed popover costs nothing
  // on every click and keystroke in the app.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === false) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {trigger}
      {isOpen && (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            'bg-surface-container-lowest border-outline-variant shadow-floating absolute z-50 flex flex-col overflow-hidden rounded-2xl border',
            side === 'below' ? 'top-full mt-2' : 'bottom-full mb-2',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
