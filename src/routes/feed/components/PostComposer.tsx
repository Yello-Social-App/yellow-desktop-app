import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { useCurrentUser } from '@/features/auth/hooks';
import { discardPostImages, stagePostImages } from '@/features/feed/api';
import { usePostComposer } from '@/features/feed/hooks';
import {
  composePostSchema,
  POST_MAX_LENGTH,
  VISIBILITY_OPTIONS,
  type PostVisibility,
} from '@/features/feed/types';
import { POST_MAX_IMAGES, type StagedImage } from '@shared/ipc-types';
import { displayName, initialsOf } from '@/lib/user-display';

/** Bytes, rounded for a caption under a thumbnail. */
function formatSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? `${megabytes.toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** The "What's on your mind?" composer that opens the home feed. */
export function PostComposer() {
  const user = useCurrentUser();
  const { publish, isPublishing } = usePostComposer();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('PUBLIC');
  const [images, setImages] = useState<StagedImage[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = POST_MAX_LENGTH - body.trim().length;
  const visibilityHint = VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.hint;
  const canAttachMore = images.length < POST_MAX_IMAGES;

  // Bytes staged in the main process outlive this component, so a composer
  // abandoned mid-draft frees what it was holding. The ref exists only so the
  // unmount cleanup can see the final list without re-running on every change.
  const imagesRef = useRef<StagedImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      void discardPostImages(imagesRef.current.map((image) => image.token));
    },
    [],
  );

  /**
   * Attaching is a *preview* step, not a post: the main process opens the OS
   * picker — the renderer cannot name a file, so it cannot make the app read
   * one of its choosing (OWASP A01) — and hands back a thumbnail and a token.
   * Nothing is uploaded until Post is pressed.
   */
  const attach = (): void => {
    setIsPicking(true);
    setError(null);

    void stagePostImages().then((result) => {
      setIsPicking(false);

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      // The limit is applied where the bytes live, so everything returned is
      // attachable and nothing has to be handed back here.
      if (result.data.skipped > 0) {
        setError(`A post takes at most ${String(POST_MAX_IMAGES)} photos.`);
      }

      setImages((current) => [...current, ...result.data.images]);
    });
  };

  const detach = (token: string): void => {
    setImages((current) => current.filter((image) => image.token !== token));
    void discardPostImages([token]);
    setError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (user === null) {
      return;
    }

    const parsed = composePostSchema.safeParse({
      content: body,
      visibility,
      imageCount: images.length,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That post is not valid.');
      return;
    }

    setError(null);
    void publish(
      parsed.data,
      images.map((image) => image.token),
    ).then((published) => {
      if (published) {
        setBody('');
        setVisibility('PUBLIC');
        // The server has the bytes now; nothing left to discard.
        setImages([]);
      }
    });
  };

  return (
    <Card elevation="floating" className="p-md md:p-lg">
      <form className="gap-md flex flex-col" onSubmit={handleSubmit}>
        <div className="gap-md flex items-start">
          {user !== null && (
            <Avatar
              initials={initialsOf(user)}
              name={displayName(user)}
              imageUrl={user.avatarUrl}
            />
          )}
          <label className="sr-only" htmlFor="post-composer">
            Write a post
          </label>
          <textarea
            id="post-composer"
            value={body}
            rows={2}
            maxLength={POST_MAX_LENGTH}
            placeholder="What's on your mind?"
            onChange={(event) => {
              setBody(event.target.value);
              setError(null);
            }}
            className="font-body text-body text-on-surface placeholder:text-on-surface-variant min-h-10 w-full resize-none border-none bg-transparent p-0 focus:outline-none"
          />
        </div>

        {images.length > 0 && (
          <ul aria-label="Photos attached to this post" className="gap-sm flex flex-wrap">
            {images.map((image) => (
              <li key={image.token} className="relative">
                <figure className="border-outline-variant w-28 overflow-hidden rounded-lg border">
                  <img
                    src={image.previewDataUrl}
                    alt={image.fileName}
                    className="h-24 w-full object-cover"
                  />
                  <figcaption className="px-xs text-on-surface-variant font-small text-small truncate py-1">
                    {formatSize(image.byteSize)}
                  </figcaption>
                </figure>
                <button
                  type="button"
                  aria-label={`Remove ${image.fileName}`}
                  title={`Remove ${image.fileName}`}
                  disabled={isPublishing}
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

        <div className="border-outline-variant/50 gap-md pt-md flex flex-wrap items-center justify-between border-t">
          <div className="gap-sm flex items-center">
            <div className="w-40">
              <label className="sr-only" htmlFor="post-visibility">
                Who can see this post
              </label>
              <Select
                id="post-visibility"
                options={VISIBILITY_OPTIONS}
                value={visibility}
                onValueChange={setVisibility}
              />
            </div>

            <Button
              variant="secondary"
              leadingIcon={<ImagePlus className="size-4" />}
              isLoading={isPicking}
              disabled={isPublishing || !canAttachMore}
              title={
                canAttachMore
                  ? `Attach up to ${String(POST_MAX_IMAGES)} photos (JPEG, PNG or GIF, 5 MB each)`
                  : `That is the limit of ${String(POST_MAX_IMAGES)} photos`
              }
              onClick={attach}
            >
              {images.length === 0 ? 'Photos' : `Add more (${String(images.length)})`}
            </Button>
          </div>

          <div className="gap-md flex items-center">
            <span className="font-small text-small text-on-surface-variant">{remaining}</span>
            <Button
              type="submit"
              isLoading={isPublishing}
              disabled={body.trim() === '' && images.length === 0}
            >
              Post
            </Button>
          </div>
        </div>

        {visibilityHint !== undefined && (
          <p className="font-small text-small text-on-surface-variant">{visibilityHint}</p>
        )}
      </form>
    </Card>
  );
}
