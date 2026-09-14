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
    <div className="border-outline-variant border-b">
      <ul className="flex gap-4 overflow-x-auto px-5 py-4" aria-label="Stories">
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
