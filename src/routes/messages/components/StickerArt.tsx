import type { StickerBackground, StickerImage } from '@shared/ipc-types';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/cn';

export type StickerArtSize = 'tile' | 'message' | 'preview';

interface StickerArtProps {
  image: StickerImage;
  background: StickerBackground;
  size: StickerArtSize;
  alt: string;
  /** The presigned link failed to load: most likely it expired. */
  onError?: () => void;
  className?: string;
}

/**
 * One sticker picture, at one of three sizes. A cut-out (REMOVED) carries its
 * white outline in its own pixels and is drawn as it is; a KEPT sticker is the
 * whole square, which the service leaves unframed and the app gives rounded
 * corners and a white frame — the same look on every surface it appears on.
 */
const SIZES: Record<StickerArtSize, { removed: string; kept: string; missing: string }> = {
  tile: {
    removed: 'size-16',
    kept: 'size-14 rounded-xl border-[3px]',
    missing: 'size-14 rounded-xl',
  },
  message: {
    removed: 'size-36',
    kept: 'size-32 rounded-[22px] border-4',
    missing: 'size-32 rounded-[22px]',
  },
  preview: {
    removed: 'size-56',
    kept: 'size-52 rounded-[26px] border-[5px]',
    missing: 'size-52 rounded-[26px]',
  },
};

export function StickerArt({ image, background, size, alt, onError, className }: StickerArtProps) {
  const sizes = SIZES[size];

  if (image.url === null) {
    return (
      <span
        role="img"
        aria-label={`${alt} (unavailable)`}
        className={cn(
          'bg-surface-container-high text-on-surface-variant flex items-center justify-center',
          sizes.missing,
          className,
        )}
      >
        <ImageOff aria-hidden className="size-5" />
      </span>
    );
  }

  return (
    <img
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      draggable={false}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={onError}
      className={cn(
        'block shrink-0 select-none',
        background === 'KEPT'
          ? cn('border-white object-cover shadow-[0_2px_8px_rgb(0_0_0/0.25)]', sizes.kept)
          : cn('object-contain', sizes.removed),
        className,
      )}
    />
  );
}
