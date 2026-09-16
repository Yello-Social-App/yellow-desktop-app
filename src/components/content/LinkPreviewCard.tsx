import { GitBranch, Link2, Play } from 'lucide-react';
import { memo } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { useLinkPreview } from '@/features/links/hooks';
import { cn } from '@/lib/cn';

/**
 * How much room the card is being given.
 *
 * This replaced a `compact` boolean once a third context appeared: a boolean
 * can only say "the small one or the big one", and a quoted repost wants
 * neither — it needs a real image without taking over the post that quotes it.
 * A named scale is the local idiom (the UI kit sizes buttons and avatars the
 * same way) and it keeps the decision at the call site, where the surrounding
 * width is actually known.
 *
 *   sm — beside the text, small thumbnail: comments, chat bubbles
 *   md — image on top, 2:1: quoted reposts, community posts
 *   lg — image on top, 1.91:1: a post's own card, full-width screens
 */
export type LinkPreviewSize = 'sm' | 'md' | 'lg';

interface SizeSpec {
  /** Whether the image sits above the text rather than beside it. */
  stacked: boolean;
  /** The image when stacked, and when it falls back to sitting beside the text. */
  stackedImage: string;
  besideImage: string;
  body: string;
  title: string;
  description: string;
  /** The height the skeleton holds while the row layout loads. */
  skeletonRow: string;
}

const SIZES: Record<LinkPreviewSize, SizeSpec> = {
  sm: {
    stacked: false,
    stackedImage: '',
    besideImage: 'w-24',
    body: 'gap-0.5 p-3',
    title: 'line-clamp-1 text-[14px]',
    description: 'line-clamp-1 text-[12px]',
    skeletonRow: 'h-20',
  },
  md: {
    stacked: true,
    stackedImage: 'aspect-[2/1] w-full',
    besideImage: 'w-28',
    body: 'gap-1 p-3.5',
    title: 'line-clamp-2 text-[15px]',
    description: 'line-clamp-2 text-[13px]',
    skeletonRow: 'h-24',
  },
  lg: {
    stacked: true,
    stackedImage: 'aspect-[1.91/1] w-full',
    besideImage: 'w-36',
    body: 'gap-1 p-4',
    title: 'line-clamp-2 text-[15px]',
    description: 'line-clamp-2 text-[13px]',
    skeletonRow: 'h-28',
  },
};

interface LinkPreviewCardProps {
  url: string;
  size?: LinkPreviewSize;
}

/**
 * The unfurled card under a post: image, site, title, description. The whole
 * card is the link. Draws a skeleton while loading and nothing at all when the
 * page had nothing to show, so a plain link stays a plain link.
 *
 * The image is a `data:` URL the main process fetched, validated and
 * downscaled, so no arbitrary host is contacted from the renderer and the CSP
 * `img-src` stays closed (OWASP A01). Previews are cached per URL for the
 * session, so the same link appearing on the feed, a profile and a quote
 * unfurls once however many cards draw it.
 */
export const LinkPreviewCard = memo(function LinkPreviewCard({
  url,
  size = 'lg',
}: LinkPreviewCardProps) {
  const entry = useLinkPreview(url);
  const spec = SIZES[size];

  if (entry === undefined || entry.status === 'none') {
    return null;
  }

  if (entry.status === 'loading') {
    return (
      <div
        aria-busy
        className={cn(
          'border-outline-variant overflow-hidden rounded-2xl border',
          spec.stacked ? '' : cn('flex', spec.skeletonRow),
        )}
      >
        {spec.stacked ? (
          <Skeleton className={cn(spec.stackedImage, 'rounded-none')} />
        ) : (
          <Skeleton className={cn('h-full shrink-0 rounded-none', spec.besideImage)} />
        )}
        <div className={cn('flex flex-1 flex-col', spec.body)}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  const { preview } = entry;
  const Icon =
    preview.provider === 'github' ? GitBranch : preview.provider === 'youtube' ? Play : Link2;
  const hasImage = preview.imageDataUrl !== undefined;
  // GitHub's own card image is a rendered banner that reads badly blown up, so
  // it keeps the side-by-side treatment at every size.
  const isStacked = spec.stacked && hasImage && preview.provider !== 'github';

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      title={preview.url}
      onClick={(event) => {
        event.stopPropagation();
      }}
      className={cn(
        'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low transition-tone group/preview flex overflow-hidden rounded-2xl border no-underline',
        isStacked ? 'flex-col' : 'flex-row',
      )}
    >
      {hasImage && (
        <span
          className={cn(
            'bg-surface-container relative shrink-0 overflow-hidden',
            isStacked ? spec.stackedImage : spec.besideImage,
          )}
        >
          <img
            src={preview.imageDataUrl}
            alt=""
            className="size-full object-cover transition-transform duration-500 group-hover/preview:scale-[1.03]"
          />
          {preview.provider === 'youtube' && (
            <span className="absolute inset-0 grid place-items-center">
              <span
                className={cn(
                  'shadow-floating grid place-items-center rounded-full bg-black/60 text-white',
                  size === 'sm' ? 'size-8' : 'size-12',
                )}
              >
                <Play
                  aria-hidden
                  className={cn('ml-0.5 fill-current', size === 'sm' ? 'size-3.5' : 'size-5')}
                />
              </span>
            </span>
          )}
        </span>
      )}

      <span className={cn('flex min-w-0 flex-1 flex-col', spec.body)}>
        <span className="text-on-surface-variant flex items-center gap-1.5 text-[12px]">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{preview.siteName ?? preview.host}</span>
        </span>
        {preview.title !== undefined && (
          <span className={cn('text-on-surface font-semibold', spec.title)}>{preview.title}</span>
        )}
        {preview.description !== undefined && (
          <span className={cn('text-on-surface-variant', spec.description)}>
            {preview.description}
          </span>
        )}
      </span>
    </a>
  );
});
