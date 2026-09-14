import { Globe, ImagePlus, Lock, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
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

const VISIBILITY_ICONS = {
  PUBLIC: Globe,
  FRIENDS: Users,
  PRIVATE: Lock,
} as const;

/** Past this share of the limit the counter turns from quiet to warning. */
const COUNTER_WARN_RATIO = 0.9;

/** The "What's happening?" composer that opens the home feed. */
export function PostComposer() {
  const user = useCurrentUser();
  const { publish, isPublishing } = usePostComposer();
  const location = useLocation();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('PUBLIC');
  const [images, setImages] = useState<StagedImage[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remaining = POST_MAX_LENGTH - body.trim().length;
  const visibilityHint = VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.hint;
  const canAttachMore = images.length < POST_MAX_IMAGES;
  const isEmpty = body.trim() === '' && images.length === 0;
  const VisibilityIcon = VISIBILITY_ICONS[visibility];

  // The sidebar's Post button lands here asking for focus.
  useEffect(() => {
    const state = location.state as { compose?: boolean } | null;
    if (state?.compose === true) {
      textareaRef.current?.focus();
    }
  }, [location.state]);

  // Grows with its text rather than scrolling inside a two-line box.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${String(textarea.scrollHeight)}px`;
  }, [body]);

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
    <form className="gap-md px-lg py-md flex" onSubmit={handleSubmit}>
      {user !== null && (
        <Avatar
          initials={initialsOf(user)}
          name={displayName(user)}
          imageUrl={user.avatarUrl}
          className="self-start"
        />
      )}

      <div className="gap-sm flex min-w-0 flex-1 flex-col">
        <label className="sr-only" htmlFor="post-composer">
          Write a post
        </label>
        <textarea
          id="post-composer"
          ref={textareaRef}
          value={body}
          rows={1}
          maxLength={POST_MAX_LENGTH}
          placeholder="What's happening?"
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          className="text-on-surface placeholder:text-on-surface-variant min-h-10 w-full resize-none border-none bg-transparent py-2 text-[18px] leading-relaxed focus:outline-none"
        />

        {images.length > 0 && (
          <ul aria-label="Photos attached to this post" className="gap-sm flex flex-wrap">
            {images.map((image) => (
              <li key={image.token} className="relative">
                <figure className="border-outline-variant w-28 overflow-hidden rounded-xl border">
                  <img
                    src={image.previewDataUrl}
                    alt={image.fileName}
                    className="h-24 w-full object-cover"
                  />
                  <figcaption className="px-xs text-on-surface-variant truncate py-1 text-[11px]">
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
          <p role="alert" className="text-error text-[13px]">
            {error}
          </p>
        )}

        {/* Visibility as a row of chips: one tap, and the choice stays visible. */}
        <div
          role="radiogroup"
          aria-label="Who can see this post"
          className="-ml-1 flex flex-wrap items-center gap-1"
        >
          {VISIBILITY_OPTIONS.map((option) => {
            const Icon = VISIBILITY_ICONS[option.value];
            const isSelected = option.value === visibility;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                title={option.hint}
                onClick={() => {
                  setVisibility(option.value);
                }}
                className={cn(
                  'transition-tone flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
                  isSelected
                    ? 'bg-primary-fixed text-on-primary-fixed'
                    : 'text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="border-outline-variant gap-md pt-sm flex items-center justify-between border-t">
          <div className="-ml-2 flex items-center gap-1">
            <IconButton
              label={
                canAttachMore
                  ? `Attach up to ${String(POST_MAX_IMAGES)} photos (JPEG, PNG, GIF or WebP, 5 MB each)`
                  : `That is the limit of ${String(POST_MAX_IMAGES)} photos`
              }
              tone="brand"
              icon={<ImagePlus className="size-5" />}
              disabled={isPublishing || isPicking || !canAttachMore}
              onClick={attach}
            />
            {images.length > 0 && (
              <span className="text-on-surface-variant text-[12px] tabular-nums">
                {images.length}/{POST_MAX_IMAGES}
              </span>
            )}
          </div>

          <div className="gap-md flex items-center">
            {body.trim().length > 0 && (
              <span
                className={cn(
                  'text-[12px] tabular-nums',
                  remaining < POST_MAX_LENGTH * (1 - COUNTER_WARN_RATIO)
                    ? 'text-error'
                    : 'text-on-surface-variant',
                )}
                aria-live="polite"
              >
                {remaining}
              </span>
            )}
            <span className="text-on-surface-variant sr-only">{visibilityHint}</span>
            <Button
              type="submit"
              isLoading={isPublishing}
              disabled={isEmpty}
              leadingIcon={<VisibilityIcon aria-hidden className="size-3.5" />}
            >
              Post
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
