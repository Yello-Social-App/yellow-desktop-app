import { CircleSlash, CornerUpLeft } from 'lucide-react';
import { useRef } from 'react';
import type { StoryReply } from '@shared/ipc-types';

import { useStoryPreview } from '@/features/stories/hooks';
import { useStoriesStore } from '@/features/stories/store';
import { backdropOf, hasExpired } from '@/features/stories/types';
import { cn } from '@/lib/cn';

interface StoryReplyCardProps {
  reply: StoryReply;
  isMine: boolean;
  viewerId: string | null;
}

/**
 * The story a message replied to, above its bubble. Chat keeps only a
 * reference, so the preview is read from the API — once per story, however
 * many replies point at it — and says "unavailable" when that answers 404, or
 * when someone else's story has passed its 24 hours. The author can still see
 * their own after that: it lives on in their archive.
 */
export function StoryReplyCard({ reply, isMine, viewerId }: StoryReplyCardProps) {
  const { status, story } = useStoryPreview(reply, viewerId);
  const refreshStory = useStoriesStore((state) => state.refreshStory);
  const hasRetried = useRef(false);

  const isAuthor = reply.storyAuthorId === viewerId;
  const label = isAuthor
    ? 'Replied to your story'
    : isMine
      ? 'You replied to their story'
      : 'Replied to a story';
  const isGone =
    status === 'unavailable' ||
    (!isAuthor && hasExpired(reply.storyExpiresAt)) ||
    (status === 'ready' && story === undefined);

  return (
    <div className={cn('flex flex-col gap-1', isMine && 'items-end')}>
      <span className="text-on-surface-variant flex items-center gap-1 px-1 text-[11px] font-semibold">
        <CornerUpLeft aria-hidden className="size-3" />
        {label}
      </span>

      {isGone ? (
        <span className="border-outline-variant text-on-surface-variant flex items-center gap-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] italic">
          <CircleSlash aria-hidden className="size-3.5" />
          Story unavailable
        </span>
      ) : story === undefined || status !== 'ready' ? (
        <span
          aria-label="Loading story"
          className="bg-surface-container-high block aspect-[9/16] w-16 animate-pulse rounded-lg"
        />
      ) : story.type === 'IMAGE' && story.image !== null && story.image.url !== null ? (
        <img
          src={story.image.url}
          alt={story.text ?? 'Story photo'}
          onError={() => {
            // Once: the signed link has most likely lapsed.
            if (!hasRetried.current) {
              hasRetried.current = true;
              void refreshStory(story.id);
            }
          }}
          className="border-outline-variant aspect-[9/16] w-16 rounded-lg border bg-black object-cover"
        />
      ) : (
        <span
          className={cn(
            'flex aspect-[9/16] w-16 items-center justify-center overflow-hidden rounded-lg p-1.5',
            backdropOf(story),
          )}
        >
          <span className="line-clamp-5 text-center text-[9px] leading-tight font-bold break-words text-white">
            {story.text}
          </span>
        </span>
      )}
    </div>
  );
}
