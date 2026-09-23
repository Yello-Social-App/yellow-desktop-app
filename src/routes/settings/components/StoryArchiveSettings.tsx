import { Archive, Eye, Globe, Trash2, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { useStoryArchive } from '@/features/stories/hooks';
import { useStoriesStore } from '@/features/stories/store';
import { backdropOf, type Story } from '@/features/stories/types';
import { cn } from '@/lib/cn';
import { calendarDay } from '@/lib/relative-time';
import { StoryViewersList } from '@/routes/home/components/StoryViewersList';

import { CardHeading } from './SettingsSection';

type Filter = 'ALL' | 'TEXT' | 'IMAGE';

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'TEXT', label: 'Text' },
  { value: 'IMAGE', label: 'Photos' },
] as const;

/** Newest-first stories under a heading per posting day; the server does not group. */
function byDay(stories: readonly Story[]): { day: string; stories: Story[] }[] {
  const groups: { day: string; stories: Story[] }[] = [];
  for (const story of stories) {
    const day = calendarDay(story.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) {
      last.stories.push(story);
    } else {
      groups.push({ day, stories: [story] });
    }
  }
  return groups;
}

/**
 * Settings → Story archive: every story you have posted, including the ones
 * past their 24 hours, which only you can see. Each shows how many people
 * watched it and opens to the names, while those are still kept; any can be
 * deleted, which also takes it down from your ring if it is still up.
 */
export function StoryArchiveSettings() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const { stories, status, error, hasMore, isLoadingMore, loadMore, reload } = useStoryArchive(
    filter === 'ALL' ? undefined : filter,
  );
  const [viewing, setViewing] = useState<Story | null>(null);
  const [deleting, setDeleting] = useState<Story | null>(null);
  const days = useMemo(() => byDay(stories), [stories]);

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden">
        <CardHeading
          title="Your stories"
          description="Kept after they expire. Only you can see this archive."
          action={
            <SegmentedControl
              label="Story type"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={FILTERS}
            />
          }
        />

        {status === 'loading' && stories.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner label="Loading your stories" />
          </div>
        ) : status === 'error' && stories.length === 0 ? (
          <div className="text-on-surface-variant flex flex-col items-center gap-3 px-5 py-10 text-center text-[13px]">
            <span role="alert">{error ?? 'Your stories could not be loaded.'}</span>
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : stories.length === 0 ? (
          <div className="text-on-surface-variant flex flex-col items-center gap-2 px-5 py-10 text-center text-[13px]">
            <Archive aria-hidden className="size-6" />
            <span className="text-on-surface text-[14px] font-semibold">No stories yet</span>
            <span>
              {filter === 'ALL'
                ? 'Stories you post appear here, and stay after their 24 hours are up.'
                : 'Nothing of this kind yet.'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-[18px] py-4">
            {days.map((group) => (
              <section key={group.day} className="flex flex-col gap-2.5">
                <h3 className="text-outline text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {group.day}
                </h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                  {group.stories.map((story) => (
                    <li key={story.id}>
                      <ArchiveTile
                        story={story}
                        onOpen={() => {
                          setViewing(story);
                        }}
                        onDelete={() => {
                          setDeleting(story);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {hasMore && (
              <Button variant="ghost" size="sm" isLoading={isLoadingMore} onClick={loadMore}>
                Show older stories
              </Button>
            )}
            {error !== null && status === 'ready' && (
              <p role="alert" className="text-error text-[13px]">
                {error}
              </p>
            )}
          </div>
        )}
      </Card>

      {viewing !== null && (
        <Modal
          isOpen
          onClose={() => {
            setViewing(null);
          }}
          title={`Seen by ${String(viewing.viewCount ?? 0)}`}
          description={`Posted ${calendarDay(viewing.createdAt)}`}
          size="sm"
        >
          <StoryViewersList key={viewing.id} story={viewing} />
        </Modal>
      )}

      {deleting !== null && (
        <DeleteStoryDialog
          story={deleting}
          onClose={() => {
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

interface ArchiveTileProps {
  story: Story;
  onOpen: () => void;
  onDelete: () => void;
}

/** One story as a 9:16 thumbnail: its backdrop or photo, whether it is still up, who saw it. */
function ArchiveTile({ story, onOpen, onDelete }: ArchiveTileProps) {
  const refreshStory = useStoriesStore((state) => state.refreshStory);
  const hasRetried = useRef(false);
  const imageUrl = story.type === 'IMAGE' ? (story.image?.url ?? null) : null;

  return (
    <div className="group relative aspect-[9/16] w-full overflow-hidden rounded-xl">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Story from ${calendarDay(story.createdAt)}, seen by ${String(story.viewCount ?? 0)}`}
        onClick={onOpen}
        className={cn(
          'flex size-full items-center justify-center p-2 transition-transform group-hover:scale-[1.02]',
          backdropOf(story),
        )}
      >
        {imageUrl !== null ? (
          <img
            src={imageUrl}
            alt=""
            onError={() => {
              if (!hasRetried.current) {
                hasRetried.current = true;
                void refreshStory(story.id);
              }
            }}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="line-clamp-6 text-center text-[12px] leading-snug font-bold break-words text-white">
            {story.text}
          </span>
        )}
      </button>

      <span
        className={cn(
          'pointer-events-none absolute top-1.5 left-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          story.isExpired
            ? 'bg-black/50 text-white'
            : 'bg-primary-container text-on-primary-container',
        )}
      >
        {story.isExpired ? 'Expired' : 'Active'}
      </span>

      <button
        type="button"
        aria-label="Delete story"
        title="Delete"
        onClick={onDelete}
        className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-black/70"
      >
        <Trash2 aria-hidden className="size-3.5" />
      </button>

      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 pt-4 pb-1.5 text-[11px] font-semibold text-white">
        <span className="flex items-center gap-1">
          <Eye aria-hidden className="size-3" />
          {story.viewCount ?? 0}
        </span>
        {story.visibility === 'PUBLIC' ? (
          <Globe aria-label="Everyone" className="size-3" />
        ) : (
          <Users aria-label="Friends" className="size-3" />
        )}
      </span>
    </div>
  );
}

/** Deleting asks once: it is gone for everyone, and from the archive, for good. */
function DeleteStoryDialog({ story, onClose }: { story: Story; onClose: () => void }) {
  const remove = useStoriesStore((state) => state.remove);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setIsDeleting(true);
    setError(null);
    const result = await remove(story.id);
    setIsDeleting(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Delete this story?"
      description={
        story.isExpired
          ? 'It’s removed from your archive, with its viewer list. This can’t be undone.'
          : 'It disappears for everyone now, and from your archive. This can’t be undone.'
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={isDeleting}
            onClick={() => {
              void confirm();
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      {error !== null && (
        <p role="alert" className="text-error text-[13px]">
          {error}
        </p>
      )}
    </Modal>
  );
}
