import { Eye } from 'lucide-react';
import { useState } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useStoryViewers } from '@/features/stories/hooks';
import { STORY_VIEWERS_RETENTION_MS, type Story } from '@/features/stories/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName } from '@/lib/user-display';

interface StoryViewersListProps {
  story: Story;
  /** On the viewer's dark card rather than a surface: white text. */
  tone?: 'surface' | 'dark';
}

/**
 * Who watched one of your stories, newest first. The names are kept for 48
 * hours after posting and then deleted upstream, while `viewCount` keeps the
 * number — so an older story says how many, and why there are no names.
 */
export function StoryViewersList({ story, tone = 'surface' }: StoryViewersListProps) {
  const { viewers, status, error, hasMore, isLoadingMore, loadMore } = useStoryViewers(story.id);
  // Read once, when the list opens: it only decides which empty-state line to show.
  const [openedAt] = useState(() => Date.now());
  const postedAt = Date.parse(story.createdAt);
  const isPastRetention =
    !Number.isNaN(postedAt) && openedAt - postedAt > STORY_VIEWERS_RETENTION_MS;
  const count = story.viewCount ?? 0;
  const muted = tone === 'dark' ? 'text-white/70' : 'text-on-surface-variant';

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-6">
        <Spinner label="Loading viewers" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <p role="alert" className={cn('py-4 text-center text-[13px]', muted)}>
        {error ?? 'Viewers could not be loaded.'}
      </p>
    );
  }

  if (viewers.length === 0) {
    return (
      <div className={cn('flex flex-col items-center gap-1.5 py-6 text-center text-[13px]', muted)}>
        <Eye aria-hidden className="size-5" />
        {count > 0 && isPastRetention ? (
          <>
            <span>Seen by {count}.</span>
            <span>Names are kept for 48 hours after posting.</span>
          </>
        ) : (
          <span>No one has seen this yet.</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {viewers.map((row) => (
          <li key={row.user.id} className="flex items-center gap-3 py-2">
            <UserAvatar user={row.user} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'truncate text-[14px] font-semibold',
                  tone === 'dark' ? 'text-white' : 'text-on-surface',
                )}
              >
                {displayName(row.user)}
              </span>
              <span className={cn('truncate text-[12px]', muted)}>@{row.user.username}</span>
            </span>
            <span className={cn('shrink-0 text-[12px]', muted)}>{relativeTime(row.viewedAt)}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          isLoading={isLoadingMore}
          onClick={loadMore}
          className={tone === 'dark' ? 'text-white hover:bg-white/10' : undefined}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
