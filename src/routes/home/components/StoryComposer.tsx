import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useCurrentUser } from '@/features/auth/hooks';
import { useStoriesStore } from '@/features/stories/store';
import { STORY_COVERS, STORY_TEXT_MAX } from '@/features/stories/types';
import { cn } from '@/lib/cn';

interface StoryComposerProps {
  onClose: () => void;
}

/** Pick a backdrop, write a line, post it to your story for the session. */
export function StoryComposer({ onClose }: StoryComposerProps) {
  const user = useCurrentUser();
  const addSlide = useStoriesStore((state) => state.addSlide);
  const [cover, setCover] = useState<string>(STORY_COVERS[0]);
  const [text, setText] = useState('');

  const post = (): void => {
    if (user === null || text.trim() === '') {
      return;
    }
    addSlide(user, { cover, text: text.trim() });
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add to your story"
      description="Visible for 24 hours. Photos arrive with the media API."
      footer={
        <>
          <span className="mr-auto self-center">
            <SampleBadge />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={text.trim() === ''} onClick={post}>
            Share to story
          </Button>
        </>
      }
    >
      <div className="gap-md flex flex-col">
        <div
          className={cn(
            'flex aspect-[9/14] max-h-72 w-full items-center justify-center rounded-2xl p-6',
            cover,
          )}
        >
          <label className="sr-only" htmlFor="story-text">
            Story text
          </label>
          <textarea
            id="story-text"
            value={text}
            maxLength={STORY_TEXT_MAX}
            rows={3}
            autoFocus
            placeholder="Say something…"
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="w-full resize-none bg-transparent text-center text-[22px] leading-snug font-bold text-white placeholder:text-white/70 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <div role="radiogroup" aria-label="Backdrop" className="flex gap-2">
            {STORY_COVERS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === cover}
                aria-label={option}
                onClick={() => {
                  setCover(option);
                }}
                className={cn(
                  'size-7 rounded-full transition-transform hover:scale-110',
                  option,
                  option === cover &&
                    'ring-on-surface ring-offset-surface-container-lowest ring-2 ring-offset-2',
                )}
              />
            ))}
          </div>
          <span className="text-on-surface-variant text-[12px] tabular-nums">
            {STORY_TEXT_MAX - text.length}
          </span>
        </div>
      </div>
    </Modal>
  );
}
