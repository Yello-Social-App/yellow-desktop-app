import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { useCurrentUser } from '@/features/auth/hooks';
import { useStoriesStore, type Origin } from '@/features/stories/store';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from '@/lib/user-display';

import { StoryComposer } from './StoryComposer';
import { StoryViewer } from './StoryViewer';

/**
 * The row of story rings across the top of Home. Yours first, with a "+"
 * to add; unseen rings wear the gradient, seen ones a hairline.
 */
export function StoriesBar() {
  const user = useCurrentUser();
  const stories = useStoriesStore((state) => state.stories);
  const mine = useStoriesStore((state) => state.mine);
  const openId = useStoriesStore((state) => state.openId);
  const open = useStoriesStore((state) => state.open);
  const [isComposing, setIsComposing] = useState(false);

  const ordered = [...stories].sort((a, b) => Number(a.isSeen) - Number(b.isSeen));

  /** The ring's box, so the viewer can grow out of exactly where it was tapped. */
  const originOf = (element: HTMLElement): Origin => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };

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
                    open(mine.id, originOf(event.currentTarget));
                  }
                }}
                className={cn('block rounded-full p-0.5', mine === null ? '' : 'story-ring')}
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

        {ordered.map((story) => (
          <li key={story.id} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => {
                open(story.id, originOf(event.currentTarget));
              }}
              className={cn(
                'rounded-full p-0.5 transition-transform duration-200 hover:scale-105 active:scale-90',
                story.isSeen ? 'story-ring-seen' : 'story-ring',
              )}
              title={`${displayName(story.author)}'s story`}
            >
              <Avatar
                initials={initialsOf(story.author)}
                name={displayName(story.author)}
                imageUrl={story.author.avatarUrl}
                size="lg"
              />
            </button>
            <span
              className={cn(
                'w-full truncate text-center text-[11px]',
                story.isSeen ? 'text-on-surface-variant' : 'text-on-surface',
              )}
            >
              {story.author.username}
            </span>
          </li>
        ))}
      </ul>

      {openId !== null && <StoryViewer />}
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
 * faces stacked, unseen first, beside the word "stories". Opening it plays the
 * first story in the same viewer the full row uses, and the viewer's own
 * next/previous walks the rest. With nothing to watch, it offers to post one.
 */
export function StoriesChip() {
  const stories = useStoriesStore((state) => state.stories);
  const openId = useStoriesStore((state) => state.openId);
  const open = useStoriesStore((state) => state.open);
  const [isComposing, setIsComposing] = useState(false);

  const ordered = [...stories].sort((a, b) => Number(a.isSeen) - Number(b.isSeen));
  const [first] = ordered;
  const unseen = ordered.filter((story) => !story.isSeen).length;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={
          first === undefined
            ? 'Add to your story'
            : `Stories, ${String(unseen)} new of ${String(ordered.length)}`
        }
        onClick={(event) => {
          if (first === undefined) {
            setIsComposing(true);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          open(first.id, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        }}
        className="text-outline hover:text-on-surface-variant transition-tone flex items-center gap-2 pb-2.5 text-[12.5px]"
      >
        {first === undefined ? (
          <Plus aria-hidden className="size-3.5" />
        ) : (
          <span className="flex -space-x-1.5">
            {ordered.slice(0, CHIP_FACES).map((story) => (
              <span
                key={story.id}
                className={cn(
                  'ring-background rounded-full ring-2',
                  !story.isSeen && 'outline-primary outline-1',
                )}
              >
                <Avatar
                  initials={initialsOf(story.author)}
                  name={displayName(story.author)}
                  imageUrl={story.author.avatarUrl}
                  size="xs"
                />
              </span>
            ))}
          </span>
        )}
        stories
      </button>

      {openId !== null && <StoryViewer />}
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
