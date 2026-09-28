import type { ImageExportSource } from '@shared/ipc-types';
import { Check, ChevronLeft, ChevronRight, Copy, Download, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { copyImage, saveImage } from '@/lib/image-export';
import { createLogger } from '@/lib/logger';

import { IconButton } from './IconButton';

const log = createLogger('ui.lightbox');

export interface LightboxImage {
  url: string;
  alt?: string;
  /**
   * Where Save and Copy fetch it from. A chat photo passes its attachment, so
   * a fresh link is read for it; anything else is fetched by its `url`.
   */
  source?: ImageExportSource;
  /** Suggested in the save dialog; the extension comes from the image itself. */
  fileName?: string;
}

/** How long "Copied" or "Saved" stays on screen. */
const STATUS_MS = 2400;
/**
 * The viewer is dark in both themes, as photo viewers are, so its controls are
 * fixed white on a dark disc rather than theme tokens — readable over any
 * photo. `!` because IconButton's own tone classes would otherwise compete:
 * `cn` joins classes, it does not merge them.
 */
const VIEWER_BUTTON =
  'bg-black/40! text-white! hover:bg-white/20! hover:text-white! disabled:opacity-50';

function sourceOf(image: LightboxImage): ImageExportSource {
  return image.source ?? { kind: 'url', url: image.url };
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
 * The photo on screen can be saved to disk or copied to the clipboard, from
 * the toolbar or with Ctrl/⌘+S and Ctrl/⌘+C. The main process fetches it
 * either way — the page cannot — so each shows a moment of progress, then
 * a word on how it went.
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
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    if (status === null) {
      return;
    }
    const timer = setTimeout(() => {
      setStatus(null);
    }, STATUS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const save = (): void => {
    if (current === undefined || busy !== null) {
      return;
    }
    setBusy('save');
    void saveImage(sourceOf(current), current.fileName).then((result) => {
      setBusy(null);
      if (!result.ok) {
        setStatus({ text: result.error, isError: true });
      } else if (result.data === 'saved') {
        setStatus({ text: 'Saved', isError: false });
      }
    });
  };

  const copy = (): void => {
    if (current === undefined || busy !== null) {
      return;
    }
    setBusy('copy');
    void copyImage(sourceOf(current)).then((result) => {
      setBusy(null);
      setStatus(
        result.ok
          ? { text: 'Copied to clipboard', isError: false }
          : { text: result.error, isError: true },
      );
    });
  };

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
        const withModifier = event.ctrlKey || event.metaKey;
        if (withModifier && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
        } else if (
          withModifier &&
          event.key.toLowerCase() === 'c' &&
          window.getSelection()?.isCollapsed !== false
        ) {
          event.preventDefault();
          copy();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          step(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          step(1);
        }
      }}
      className={cn(
        'm-auto h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 text-white',
        // Dark and blurred in both themes: the app behind stays a soft hint, and
        // the photo and its controls stand out. (The theme's on-surface token
        // used here before is near-white in the dark theme.)
        'backdrop:bg-black/75 backdrop:backdrop-blur-xl',
      )}
    >
      <div
        className="gap-md p-md flex h-full flex-col"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <span className="font-label text-label shrink-0">
              {index + 1} / {count}
            </span>
            <span
              role="status"
              className={cn(
                'truncate text-[13px]',
                status?.isError === true ? 'text-[#ffb4ab]' : 'text-white',
              )}
            >
              {status !== null && (
                <span className="animate-fade-in inline-flex items-center gap-1.5">
                  {!status.isError && <Check aria-hidden className="size-4" />}
                  {status.text}
                </span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <IconButton
              label="Save image"
              aria-keyshortcuts="Control+S Meta+S"
              icon={
                busy === 'save' ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <Download className="size-5" />
                )
              }
              disabled={current === undefined || busy !== null}
              className={VIEWER_BUTTON}
              onClick={save}
            />
            <IconButton
              label="Copy image"
              aria-keyshortcuts="Control+C Meta+C"
              icon={
                busy === 'copy' ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <Copy className="size-5" />
                )
              }
              disabled={current === undefined || busy !== null}
              className={VIEWER_BUTTON}
              onClick={copy}
            />
            <IconButton
              label="Close"
              icon={<X className="size-5" />}
              className={VIEWER_BUTTON}
              onClick={onClose}
            />
          </span>
        </div>

        <div className="gap-sm flex min-h-0 flex-1 items-center">
          {hasMany && (
            <IconButton
              label="Previous photo"
              icon={<ChevronLeft className="size-6" />}
              className={cn(VIEWER_BUTTON, 'shrink-0')}
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
              className={cn(VIEWER_BUTTON, 'shrink-0')}
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
