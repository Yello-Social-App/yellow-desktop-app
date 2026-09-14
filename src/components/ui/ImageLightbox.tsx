import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { createLogger } from '@/lib/logger';

import { IconButton } from './IconButton';

const log = createLogger('ui.lightbox');

export interface LightboxImage {
  url: string;
  alt?: string;
}

interface ImageLightboxProps {
  images: readonly LightboxImage[];
  /** Which image opens first; clamped to the list. */
  initialIndex: number;
  onClose: () => void;
}

/**
 * A full-window image viewer.
 *
 * Built on the native `<dialog>` like Modal, for the same reasons — focus
 * trapping, Esc, the top layer — but not *on* Modal: that panel is sized for
 * a form, and a photo wants the whole window. Moving between images works
 * three ways, all landing on the same state: the arrow buttons, the keyboard
 * arrows, and the thumbnail strip, which scrolls sideways when there are more
 * than fit.
 *
 * Mounted only while open, so the index is fresh on each opening.
 */
export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, images.length - 1)),
  );

  const count = images.length;
  const current = images[index];
  const hasMany = count > 1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    try {
      if (!dialog.open) {
        dialog.showModal();
      }
    } catch (error) {
      log.error('lightbox_open_failed', { error });
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  // Keep the selected thumbnail in view as the index moves.
  useEffect(() => {
    const selected = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  const step = (delta: number): void => {
    if (!hasMany) {
      return;
    }
    // Wraps, so the arrows never dead-end.
    setIndex((value) => (value + delta + count) % count);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={`Photo ${String(index + 1)} of ${String(count)}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          step(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          step(1);
        }
      }}
      className={cn(
        'text-inverse-on-surface m-auto h-dvh max-h-none w-dvw max-w-none bg-transparent p-0',
        'backdrop:bg-on-surface/90',
      )}
    >
      <div
        className="gap-md p-md flex h-full flex-col"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-label text-label">
            {index + 1} / {count}
          </span>
          <IconButton
            label="Close"
            icon={<X className="size-5" />}
            className="text-inverse-on-surface hover:bg-inverse-surface/60 hover:text-inverse-on-surface"
            onClick={onClose}
          />
        </div>

        <div className="gap-sm flex min-h-0 flex-1 items-center">
          {hasMany && (
            <IconButton
              label="Previous photo"
              icon={<ChevronLeft className="size-6" />}
              className="text-inverse-on-surface hover:bg-inverse-surface/60 hover:text-inverse-on-surface shrink-0"
              onClick={() => {
                step(-1);
              }}
            />
          )}

          {/* The backdrop click-to-close still works around the image: the
              figure only stops clicks that land on it. */}
          <figure
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }}
          >
            {current !== undefined && (
              <img
                key={current.url}
                src={current.url}
                alt={current.alt ?? ''}
                className="animate-scale-in max-h-full max-w-full rounded-lg object-contain"
              />
            )}
          </figure>

          {hasMany && (
            <IconButton
              label="Next photo"
              icon={<ChevronRight className="size-6" />}
              className="text-inverse-on-surface hover:bg-inverse-surface/60 hover:text-inverse-on-surface shrink-0"
              onClick={() => {
                step(1);
              }}
            />
          )}
        </div>

        {hasMany && (
          <div
            ref={stripRef}
            role="tablist"
            aria-label="Photos"
            className="gap-sm flex shrink-0 justify-start overflow-x-auto pb-1 sm:justify-center"
          >
            {images.map((image, position) => {
              const isCurrent = position === index;
              return (
                <button
                  key={image.url}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  aria-current={isCurrent}
                  aria-label={`Photo ${String(position + 1)}`}
                  onClick={() => {
                    setIndex(position);
                  }}
                  className={cn(
                    'transition-tone size-16 shrink-0 overflow-hidden rounded-md border-2',
                    isCurrent
                      ? 'border-primary-container opacity-100'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  )}
                >
                  <img src={image.url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
