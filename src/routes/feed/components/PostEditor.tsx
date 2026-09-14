import { ImagePlus, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { discardPostImages, stagePostImages } from '@/features/feed/api';
import type { PostEdit } from '@/features/feed/post-actions';
import {
  POST_MAX_LENGTH,
  VISIBILITY_OPTIONS,
  visibilityOf,
  type Post,
  type PostVisibility,
} from '@/features/feed/types';
import { POST_MAX_IMAGES, type StagedImage } from '@shared/ipc-types';
import { cn } from '@/lib/cn';

interface PostEditorProps {
  post: Post;
  isSaving: boolean;
  onSave: (changes: PostEdit) => void;
  onCancel: () => void;
}

/**
 * In-place editing of a post: text, visibility, and its images.
 *
 * Every field on `PUT /posts/{id}` is optional, so only what actually changed
 * is sent — the same rule the profile form follows. Images change in two
 * directions at once: existing ones are marked for removal by id and stay
 * visible (struck through) until Save, so a slip can be undone; new ones are
 * staged in the main process exactly as the composer does, and appended after
 * the survivors. The server caps a post at ten images after the edit, so the
 * picker is offered whatever room is left.
 */
export function PostEditor({ post, isSaving, onSave, onCancel }: PostEditorProps) {
  const [content, setContent] = useState(post.content);
  const [visibility, setVisibility] = useState<PostVisibility>(visibilityOf(post));
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<StagedImage[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bytes staged in the main process outlive this component, so an editor
  // closed without saving frees what it was holding. The ref exists only so
  // the unmount cleanup can see the final list without re-running on change.
  const addedRef = useRef<StagedImage[]>([]);
  useEffect(() => {
    addedRef.current = added;
  }, [added]);
  useEffect(
    () => () => {
      void discardPostImages(addedRef.current.map((image) => image.token));
    },
    [],
  );

  const trimmed = content.trim();
  const originalVisibility = visibilityOf(post);
  const surviving = post.images.length - removedIds.size;
  const room = Math.max(0, POST_MAX_IMAGES - surviving - added.length);

  const contentChanged = trimmed !== post.content.trim();
  const visibilityChanged = visibility !== originalVisibility;
  const imagesChanged = removedIds.size > 0 || added.length > 0;
  const isChanged = contentChanged || visibilityChanged || imagesChanged;
  // The API's own rule: a post keeps text or at least one image.
  const wouldBeEmpty = trimmed === '' && surviving + added.length === 0;

  const toggleRemoved = (imageId: string): void => {
    setRemovedIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
    setError(null);
  };

  const attach = (): void => {
    setIsPicking(true);
    setError(null);

    void stagePostImages(room).then((result) => {
      setIsPicking(false);

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      if (result.data.skipped > 0) {
        setError(`A post takes at most ${String(POST_MAX_IMAGES)} photos.`);
      }

      setAdded((current) => [...current, ...result.data.images]);
    });
  };

  const detach = (token: string): void => {
    setAdded((current) => current.filter((image) => image.token !== token));
    void discardPostImages([token]);
    setError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (wouldBeEmpty) {
      setError('A post needs text or at least one photo.');
      return;
    }

    const changes: PostEdit = {};
    if (contentChanged) {
      changes.content = trimmed;
    }
    if (visibilityChanged) {
      changes.visibility = visibility;
    }
    if (removedIds.size > 0) {
      changes.removeImageIds = [...removedIds];
    }
    if (added.length > 0) {
      changes.imageTokens = added.map((image) => image.token);
    }

    onSave(changes);
  };

  return (
    <form className="gap-sm animate-expand flex flex-col" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`edit-post-${post.id}`}>
        Edit your post
      </label>
      <textarea
        id={`edit-post-${post.id}`}
        rows={3}
        value={content}
        maxLength={POST_MAX_LENGTH}
        onChange={(event) => {
          setContent(event.target.value);
          setError(null);
        }}
        className="font-body text-body text-on-surface bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 px-md py-sm w-full resize-none rounded-xl border focus:ring-2 focus:outline-none"
      />

      {(post.images.length > 0 || added.length > 0) && (
        <ul aria-label="Photos on this post" className="gap-sm flex flex-wrap">
          {post.images.map((image) => {
            const isRemoved = image.id !== undefined && removedIds.has(image.id);
            return (
              <li key={image.id ?? image.url} className="relative">
                <figure
                  className={cn(
                    'border-outline-variant w-28 overflow-hidden rounded-lg border',
                    isRemoved && 'opacity-40',
                  )}
                >
                  <img src={image.url} alt="" className="h-24 w-full object-cover" />
                  <figcaption className="px-xs text-on-surface-variant font-small text-small truncate py-1">
                    {isRemoved ? 'Will be removed' : 'On the post'}
                  </figcaption>
                </figure>
                {/* An image without an id predates the edit endpoint and cannot be addressed. */}
                {image.id !== undefined && (
                  <button
                    type="button"
                    aria-label={isRemoved ? 'Keep this photo' : 'Remove this photo'}
                    title={isRemoved ? 'Keep this photo' : 'Remove this photo'}
                    disabled={isSaving}
                    onClick={() => {
                      toggleRemoved(image.id ?? '');
                    }}
                    className="bg-inverse-surface text-inverse-on-surface transition-tone absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full hover:opacity-80 disabled:opacity-40"
                  >
                    {isRemoved ? (
                      <Undo2 aria-hidden className="size-3.5" />
                    ) : (
                      <X aria-hidden className="size-3.5" />
                    )}
                  </button>
                )}
              </li>
            );
          })}

          {added.map((image) => (
            <li key={image.token} className="relative">
              <figure className="border-primary-container w-28 overflow-hidden rounded-lg border">
                <img
                  src={image.previewDataUrl}
                  alt={image.fileName}
                  className="h-24 w-full object-cover"
                />
                <figcaption className="px-xs text-on-surface-variant font-small text-small truncate py-1">
                  New
                </figcaption>
              </figure>
              <button
                type="button"
                aria-label={`Remove ${image.fileName}`}
                title={`Remove ${image.fileName}`}
                disabled={isSaving}
                onClick={() => {
                  detach(image.token);
                }}
                className="bg-inverse-surface text-inverse-on-surface transition-tone absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full hover:opacity-80 disabled:opacity-40"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p role="alert" className="font-small text-small text-error">
          {error}
        </p>
      )}

      <div className="gap-sm flex flex-wrap items-center justify-between">
        <div className="gap-sm flex items-center">
          <div className="w-44">
            <label className="sr-only" htmlFor={`edit-visibility-${post.id}`}>
              Who can see this post
            </label>
            <Select
              id={`edit-visibility-${post.id}`}
              options={VISIBILITY_OPTIONS}
              value={visibility}
              onValueChange={setVisibility}
            />
          </div>

          <Button
            variant="secondary"
            leadingIcon={<ImagePlus className="size-4" />}
            isLoading={isPicking}
            disabled={isSaving || room === 0}
            title={
              room > 0
                ? `Add up to ${String(room)} more (JPEG, PNG, GIF or WebP, 5 MB each)`
                : `That is the limit of ${String(POST_MAX_IMAGES)} photos`
            }
            onClick={attach}
          >
            Add photos
          </Button>
        </div>

        <div className="gap-sm flex">
          <Button variant="ghost" disabled={isSaving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving} disabled={!isChanged || wouldBeEmpty}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
