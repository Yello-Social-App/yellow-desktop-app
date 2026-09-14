import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { createLogger } from '@/lib/logger';

import { IconButton } from './IconButton';

const log = createLogger('ui.modal');

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** A line under the title, and the dialog's accessible description. */
  description?: string;
  children?: ReactNode;
  /** Buttons for the bottom row; they sit right-aligned. */
  footer?: ReactNode;
  size?: 'sm' | 'md';
}

// Named widths, not Tailwind's `max-w-sm`: the theme's spacing scale owns the
// bare sm/md names, so `max-w-sm` here would be 8px — a dialog one sliver wide.
const SIZE_CLASSES = {
  sm: 'max-w-dialog-sm',
  md: 'max-w-dialog-md',
} as const;

/**
 * A modal dialog.
 *
 * Built on the native `<dialog>` element: the platform gives focus trapping,
 * focus restore on close, Esc-to-dismiss and the top layer — all things a
 * hand-rolled overlay gets subtly wrong. It also needs no inline styles, which
 * the strict CSP would reject anyway.
 *
 * Three details are load-bearing:
 *
 * 1. **It renders through a portal to `document.body`.** A post card sits in a
 *    `.list-windowed` row, which carries `content-visibility` and therefore
 *    containment; hoisting the dialog out keeps it clear of any ancestor that
 *    could clip it or skip rendering its subtree.
 * 2. **The native `close` event is not wired to `onClose`.** `close` fires
 *    whether the user dismissed the dialog or the code called `close()`, so
 *    binding it makes every programmatic close call back into the parent and
 *    tell it to close again — including the close in this effect's cleanup.
 *    Dismissal has exactly two sources instead: `onCancel` (Esc) and a click
 *    landing on the backdrop, both of which are the user actually asking.
 * 3. **`showModal()` is guarded.** It throws if the element is already open or
 *    not yet connected, and an uncaught throw here would leave a button that
 *    silently does nothing (A10). A failure is logged and the dialog is left
 *    closed rather than half-opened.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    try {
      if (isOpen && !dialog.open) {
        dialog.showModal();
      } else if (!isOpen && dialog.open) {
        dialog.close();
      }
    } catch (error) {
      log.error('dialog_toggle_failed', { isOpen, error });
    }

    // Closing before the node goes hands focus back where it came from; an
    // element removed while still open leaves focus on nothing.
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isOpen]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      // Esc: prevented so the close goes through the caller's state rather than
      // behind its back, leaving the two out of step.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click landing on the dialog element itself is a click on the
      // backdrop — the panel below stops anything inside from reaching here.
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className={cn(
        'bg-surface-container-lowest text-on-surface border-outline-variant shadow-canvas',
        'm-auto w-[calc(100vw-2rem)] rounded-2xl border p-0',
        'backdrop:bg-on-surface/40',
        SIZE_CLASSES[size],
      )}
    >
      <div
        className="gap-md p-lg flex flex-col"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="gap-md flex items-start">
          <div className="gap-xs flex min-w-0 flex-1 flex-col">
            <h2 id={titleId} className="font-heading text-h3 text-on-surface">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="font-body-sm text-body-sm text-on-surface-variant">
                {description}
              </p>
            )}
          </div>
          <IconButton
            label="Close"
            icon={<X className="size-4" />}
            className="-mt-1 -mr-2 shrink-0"
            onClick={onClose}
          />
        </div>

        {children}

        {footer !== undefined && <div className="gap-sm flex justify-end">{footer}</div>}
      </div>
    </dialog>,
    document.body,
  );
}
