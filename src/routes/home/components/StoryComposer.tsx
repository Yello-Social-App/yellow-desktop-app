import { Globe, ImagePlus, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StagedImage } from '@shared/ipc-types';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { discardStoryImage, stageStoryImage, storyErrorMessage } from '@/features/stories/api';
import { useStoriesStore } from '@/features/stories/store';
import {
  STORY_COVERS,
  STORY_TEXT_MAX,
  STORY_VISIBILITY_OPTIONS,
  type StoryBackground,
  type StoryVisibility,
} from '@/features/stories/types';
import { cn } from '@/lib/cn';

type Mode = 'TEXT' | 'IMAGE';

const MODES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'IMAGE', label: 'Photo' },
] as const;

interface StoryComposerProps {
  onClose: () => void;
}

/**
 * Add to your story: a line of text on a backdrop, or a photo with an optional
 * caption, for friends or for everyone. It lasts 24 hours and then moves to
 * the author's archive.
 *
 * The photo is staged in the main process (the picker runs there, the bytes
 * stay there) and shown here as a thumbnail; it is only uploaded on Share. A
 * staged photo that is replaced, removed or abandoned is discarded.
 */
export function StoryComposer({ onClose }: StoryComposerProps) {
  const post = useStoriesStore((state) => state.post);
  const [mode, setMode] = useState<Mode>('TEXT');
  const [cover, setCover] = useState<StoryBackground>(STORY_COVERS[0]);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<StoryVisibility>('FRIENDS');
  const [image, setImage] = useState<StagedImage | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The staged photo outlives a re-render but not the dialog: whatever is
  // still held when it closes, without having been posted, is let go.
  const heldToken = useRef<string | null>(null);
  const holdImage = (next: StagedImage | null): void => {
    heldToken.current = next?.token ?? null;
    setImage(next);
  };
  useEffect(
    () => () => {
      if (heldToken.current !== null) {
        void discardStoryImage(heldToken.current);
      }
    },
    [],
  );

  const pickPhoto = async (): Promise<void> => {
    setIsPicking(true);
    setError(null);
    const result = await stageStoryImage();
    setIsPicking(false);
    if (!result.ok) {
      setError(storyErrorMessage(result.error));
      return;
    }
    if (result.data === null) {
      return;
    }
    if (image !== null) {
      void discardStoryImage(image.token);
    }
    holdImage(result.data);
  };

  const removePhoto = (): void => {
    if (image !== null) {
      void discardStoryImage(image.token);
    }
    holdImage(null);
  };

  const canPost = mode === 'TEXT' ? text.trim() !== '' : image !== null;

  const share = async (): Promise<void> => {
    if (!canPost || isPosting) {
      return;
    }
    setIsPosting(true);
    setError(null);
    const trimmedCaption = caption.trim();
    const result =
      mode === 'TEXT'
        ? await post({ type: 'TEXT', text: text.trim(), background: cover, visibility })
        : image === null
          ? null
          : await post({
              type: 'IMAGE',
              imageToken: image.token,
              visibility,
              ...(trimmedCaption === '' ? {} : { text: trimmedCaption }),
            });
    setIsPosting(false);
    if (result === null) {
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Posted: the main process has already let the photo go.
    holdImage(null);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add to your story"
      description={
        visibility === 'PUBLIC'
          ? 'Anyone on Yello can see it for 24 hours. After that, only you can, in your story archive.'
          : 'Your friends can see it for 24 hours. After that, only you can, in your story archive.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canPost}
            isLoading={isPosting}
            onClick={() => {
              void share();
            }}
          >
            Share to story
          </Button>
        </>
      }
    >
      <div className="gap-md flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            label="Story type"
            options={MODES}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            size="sm"
          />
          <Select
            aria-label="Who can see it"
            options={STORY_VISIBILITY_OPTIONS}
            value={visibility}
            onValueChange={setVisibility}
            leadingIcon={
              visibility === 'PUBLIC' ? (
                <Globe aria-hidden className="size-4" />
              ) : (
                <Users aria-hidden className="size-4" />
              )
            }
            className="w-40"
          />
        </div>

        {mode === 'TEXT' ? (
          <>
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
                {STORY_COVERS.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={option === cover}
                    aria-label={`Backdrop ${String(index + 1)}`}
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
          </>
        ) : image === null ? (
          <button
            type="button"
            onClick={() => {
              void pickPhoto();
            }}
            disabled={isPicking}
            className="border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-tone flex aspect-[9/14] max-h-72 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed disabled:opacity-60"
          >
            <ImagePlus aria-hidden className="size-8" />
            <span className="text-[14px] font-semibold">Choose a photo</span>
            <span className="text-[12px]">JPEG, PNG, GIF or WebP · up to 5 MB</span>
          </button>
        ) : (
          <>
            <div className="relative flex aspect-[9/14] max-h-72 w-full items-center justify-center overflow-hidden rounded-2xl bg-black">
              <img
                src={image.previewDataUrl}
                alt="Your story photo"
                className="max-h-full max-w-full object-contain"
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={removePhoto}
                className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void pickPhoto();
                }}
                disabled={isPicking}
                className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold text-white hover:bg-black/80"
              >
                Change photo
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-on-surface-variant flex justify-between text-[12px]">
                Caption (optional)
                <span className="tabular-nums">{STORY_TEXT_MAX - caption.length}</span>
              </span>
              <input
                type="text"
                value={caption}
                maxLength={STORY_TEXT_MAX}
                placeholder="Add a caption…"
                onChange={(event) => {
                  setCaption(event.target.value);
                }}
                className="bg-surface-container-lowest border-outline-strong text-on-surface placeholder:text-outline focus:border-primary h-10 rounded-lg border px-3 text-[14px] outline-none"
              />
            </label>
          </>
        )}

        {error !== null && (
          <p role="alert" className="text-error text-[13px]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
