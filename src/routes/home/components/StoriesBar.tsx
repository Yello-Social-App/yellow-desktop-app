import { ChevronRight, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { useCurrentUser } from '@/features/auth/hooks';
import { useStoriesRow } from '@/features/stories/hooks';
import { useStoriesStore, type Origin } from '@/features/stories/store';
import type { StoryRing } from '@/features/stories/types';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';

import { StoryComposer } from './StoryComposer';

/** The ring's box, so the viewer can grow out of exactly where it was tapped. */
function originOf(element: HTMLElement): Origin {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Rings in the order the viewer walks them: yours first, then everyone else's. */
function sequenceOf(mine: StoryRing | null, rings: readonly StoryRing[]): string[] {
  return [...(mine === null ? [] : [mine.author.id]), ...rings.map((ring) => ring.author.id)];
}

/**
 * The row of story rings across the top of Home. Yours first, with a "+"
 * to add; unwatched rings wear the gradient, watched ones a hairline. The
 * viewer itself is mounted once by the app shell, so a profile can open it too.
 */
export function StoriesBar() {
  const user = useCurrentUser();
  const { mine, rings, status, error, hasMore, isLoadingMore, loadMore, reload } = useStoriesRow();
  const open = useStoriesStore((state) => state.open);
  const [isComposing, setIsComposing] = useState(false);
  const sequence = sequenceOf(mine, rings);

  return (
    <div>
      <ul className="flex gap-3.5 overflow-x-auto py-0.5" aria-label="Stories">
        {user !== null && (
          <li className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <span className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={(event) => {
                  if (mine === null) {
                    setIsComposing(true);
                  } else {
                    open(sequence, originOf(event.currentTarget));
                  }
                }}
                className={cn('flex rounded-full p-0.5', mine === null ? '' : 'story-ring')}
                title={mine === null ? 'Add to your story' : 'Your story'}
              >
                <Avatar
                  initials={initialsOf(user)}
                  name={displayName(user)}
                  imageUrl={user.avatarUrl}
                  size="lg"
                />
              </button>
              <button
                type="button"
                aria-label="Add to your story"
                aria-haspopup="dialog"
                onClick={() => {
                  setIsComposing(true);
                }}
                className="bg-primary-container text-on-primary-container ring-background absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full ring-2 hover:brightness-110"
              >
                <Plus className="size-3.5" strokeWidth={3} />
              </button>
            </span>
            <span className="text-on-surface-variant w-full truncate text-center text-[11px]">
              Your story
            </span>
          </li>
        )}

        {status === 'loading' &&
          rings.length === 0 &&
          [0, 1, 2, 3].map((index) => (
            <li
              key={index}
              aria-hidden
              className="flex w-[68px] shrink-0 flex-col items-center gap-1.5"
            >
              <span className="bg-surface-container-high size-[60px] animate-pulse rounded-full" />
              <span className="bg-surface-container-high h-2.5 w-12 animate-pulse rounded-full" />
            </li>
          ))}

        {rings.map((ring) => (
          <li key={ring.author.id} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => {
                open(
                  sequence.slice(sequence.indexOf(ring.author.id)),
                  originOf(event.currentTarget),
                );
              }}
              className={cn(
                'flex rounded-full p-0.5 transition-transform duration-200 hover:scale-105 active:scale-90',
                ring.hasUnseen ? 'story-ring' : 'story-ring-seen',
              )}
              title={`${displayName(ring.author)}'s story`}
            >
              <Avatar
                initials={initialsOf(ring.author)}
                name={displayName(ring.author)}
                imageUrl={ring.author.avatarUrl}
                size="lg"
              />
            </button>
            <span
              className={cn(
                'w-full truncate text-center text-[11px]',
                ring.hasUnseen ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              {ring.author.username}
            </span>
          </li>
        ))}

        {status === 'ready' && rings.length === 0 && (
          <li className="text-on-surface-variant flex min-w-0 flex-col justify-center gap-0.5 pb-5 text-[12.5px]">
            <span className="text-on-surface font-medium">No stories from friends right now</span>
            <span>Stories from your friends show up here for 24 hours.</span>
          </li>
        )}

        {hasMore && (
          <li className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              aria-label="More stories"
              className="border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-tone grid size-[60px] place-items-center rounded-full border border-dashed disabled:opacity-60"
            >
              <ChevronRight aria-hidden className="size-5" />
            </button>
            <span className="text-on-surface-variant text-[11px]">More</span>
          </li>
        )}

        {status === 'error' && (
          <li className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={reload}
              title={error ?? undefined}
              className="text-on-surface-variant hover:text-on-surface transition-tone flex items-center gap-1.5 text-[12px]"
            >
              <RotateCw aria-hidden className="size-3.5" />
              Couldn’t load stories · Retry
            </button>
          </li>
        )}
      </ul>

      {isComposing && (
        <StoryComposer
          onClose={() => {
            setIsComposing(false);
          }}
        />
      )}
    </div>
  );
}

/** Faces shown in the compact chip before the word "stories" takes over. */
const CHIP_FACES = 3;

/**
 * The stories row folded into a chip, for the compact frame: the first few
 * faces stacked, unwatched first, beside the word "stories". Opening it plays
 * from the first ring in the same viewer the full row uses, and the viewer's
 * own next/previous walks the rest. With nothing to watch, it offers to post one.
 */
export function StoriesChip() {
  const { mine, rings } = useStoriesRow();
  const open = useStoriesStore((state) => state.open);
  const [isComposing, setIsComposing] = useState(false);

  const ordered = mine === null ? rings : [mine, ...rings];
  const unseen = rings.filter((ring) => ring.hasUnseen).length;
  const isEmpty = ordered.length === 0;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={
          isEmpty
            ? 'Add to your story'
            : `Stories, ${String(unseen)} new of ${String(ordered.length)}`
        }
        onClick={(event) => {
          if (isEmpty) {
            setIsComposing(true);
            return;
          }
          // Friends' unwatched rings first; yours only when there is nothing else.
          const sequence = sequenceOf(null, rings);
          open(
            sequence.length > 0 ? sequence : sequenceOf(mine, []),
            originOf(event.currentTarget),
          );
        }}
        className="text-outline hover:text-on-surface-variant transition-tone flex items-center gap-2 pb-2.5 text-[12.5px]"
      >
        {isEmpty ? (
          <Plus aria-hidden className="size-3.5" />
        ) : (
          <span className="flex -space-x-1.5">
            {ordered.slice(0, CHIP_FACES).map((ring) => (
              <span
                key={ring.author.id}
                className={cn(
                  'ring-background rounded-full ring-2',
                  ring.hasUnseen && 'outline-primary outline-1',
                )}
              >
                <Avatar
                  initials={initialsOf(ring.author)}
                  name={displayName(ring.author)}
                  imageUrl={ring.author.avatarUrl}
                  size="xs"
                />
              </span>
            ))}
          </span>
        )}
        stories
      </button>

      {isComposing && (
        <StoryComposer
          onClose={() => {
            setIsComposing(false);
          }}
        />
      )}
    </>
  );
}
