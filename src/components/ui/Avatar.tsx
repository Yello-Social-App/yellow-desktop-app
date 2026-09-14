import { useState } from 'react';

import { cn } from '@/lib/cn';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'size-6 text-caption',
  sm: 'size-8 text-small',
  md: 'size-10 text-body-sm',
  lg: 'size-14 text-body',
  xl: 'size-24 text-h1',
};

const DOT_CLASSES: Record<AvatarSize, string> = {
  xs: 'size-2 border',
  sm: 'size-2.5 border-2',
  md: 'size-3 border-2',
  lg: 'size-3.5 border-2',
  xl: 'size-5 border-4',
};

interface AvatarProps {
  initials: string;
  name: string;
  imageUrl?: string | undefined;
  size?: AvatarSize;
  /** A presence dot: green when true, nothing when undefined. */
  isOnline?: boolean | undefined;
  className?: string;
}

/**
 * Shows the profile image when the API has one, and falls back to initials —
 * also the fallback when the image fails to load, so a broken or CSP-blocked
 * URL never leaves an empty circle.
 */
export function Avatar({
  initials,
  name,
  imageUrl,
  size = 'md',
  isOnline,
  className,
}: AvatarProps) {
  // Track the URL that failed rather than a bare flag, so a new imageUrl retries
  // instead of inheriting the previous one's failure.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = imageUrl !== undefined && failedUrl !== imageUrl;

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        title={name}
        aria-label={name}
        role="img"
        className={cn(
          'bg-primary-fixed text-on-primary-fixed font-label inline-flex items-center justify-center',
          'ring-outline-variant overflow-hidden rounded-full uppercase ring-1',
          SIZE_CLASSES[size],
        )}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            className="size-full object-cover"
            onError={() => {
              setFailedUrl(imageUrl);
            }}
          />
        ) : (
          initials
        )}
      </span>
      {isOnline === true && (
        <span
          aria-label="Online"
          className={cn(
            'bg-tertiary border-surface absolute right-0 bottom-0 rounded-full',
            DOT_CLASSES[size],
          )}
        />
      )}
    </span>
  );
}
