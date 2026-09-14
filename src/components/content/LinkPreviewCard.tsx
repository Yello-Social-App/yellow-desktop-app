import { GitBranch, Link2, Play } from 'lucide-react';
import { memo } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { useLinkPreview } from '@/features/links/hooks';
import { cn } from '@/lib/cn';

interface LinkPreviewCardProps {
  url: string;
  /** A tighter, side-by-side card for comments and quotes. */
  compact?: boolean;
}

/**
 * The unfurled card under a post: image, site, title, description. The whole
 * card is the link. Draws a skeleton while loading and nothing at all when
 * the page had nothing to show, so a plain link stays a plain link.
 */
export const LinkPreviewCard = memo(function LinkPreviewCard({
  url,
  compact = false,
}: LinkPreviewCardProps) {
  const entry = useLinkPreview(url);

  if (entry === undefined || entry.status === 'none') {
    return null;
  }

  if (entry.status === 'loading') {
    return (
      <div
        aria-busy
        className={cn(
          'border-outline-variant overflow-hidden rounded-2xl border',
          compact ? 'flex h-20' : '',
        )}
      >
        {!compact && <Skeleton className="aspect-[1.91/1] w-full rounded-none" />}
        {compact && <Skeleton className="h-full w-20 shrink-0 rounded-none" />}
        <div className="gap-xs p-md flex flex-1 flex-col">
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
  const isWide = !compact && hasImage && preview.provider !== 'github';

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
        isWide ? 'flex-col' : 'flex-row',
      )}
    >
      {hasImage && (
        <span
          className={cn(
            'bg-surface-container relative shrink-0 overflow-hidden',
            isWide ? 'aspect-[1.91/1] w-full' : compact ? 'w-24' : 'w-36',
          )}
        >
          <img
            src={preview.imageDataUrl}
            alt=""
            className="size-full object-cover transition-transform duration-500 group-hover/preview:scale-[1.03]"
          />
          {preview.provider === 'youtube' && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="shadow-floating grid size-12 place-items-center rounded-full bg-black/60 text-white">
                <Play aria-hidden className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
          )}
        </span>
      )}

      <span className={cn('flex min-w-0 flex-1 flex-col', compact ? 'gap-0.5 p-3' : 'gap-1 p-4')}>
        <span className="text-on-surface-variant flex items-center gap-1.5 text-[12px]">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{preview.siteName ?? preview.host}</span>
        </span>
        {preview.title !== undefined && (
          <span
            className={cn(
              'text-on-surface font-semibold',
              compact ? 'line-clamp-1 text-[14px]' : 'line-clamp-2 text-[15px]',
            )}
          >
            {preview.title}
          </span>
        )}
        {preview.description !== undefined && (
          <span
            className={cn(
              'text-on-surface-variant',
              compact ? 'line-clamp-1 text-[12px]' : 'line-clamp-2 text-[13px]',
            )}
          >
            {preview.description}
          </span>
        )}
      </span>
    </a>
  );
});
