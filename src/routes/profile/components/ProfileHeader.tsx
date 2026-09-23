import { CalendarDays } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { User } from '@shared/ipc-types';

import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { calendarDay } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

interface ProfileHeaderProps {
  user: User;
  postCount: number;
  friendCount?: number;
  isOnline?: boolean;
  /** What sits on the right of the avatar row: relationship controls, elsewhere. */
  action?: ReactNode;
  /**
   * Someone the viewer blocked: who they are stays (avatar, name, handle), and
   * what they wrote about themselves goes — cover, bio, stats and presence —
   * the way Discord shows a blocked profile.
   */
  isBlocked?: boolean;
  /** Set when they have a story you may watch: the avatar wears a ring and opens it. */
  story?: { hasUnseen: boolean; onOpen: (origin: DOMRect) => void };
}

/**
 * The cover image, over the brand gradient it replaces — which also shows
 * through when the image fails to load, as the avatar falls back to initials.
 */
function Cover({ url }: { url: string | undefined }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== undefined && failedUrl !== url;

  return (
    <div
      aria-hidden
      className="from-primary-fixed-dim via-surface-container to-surface-container-low relative h-36 w-full overflow-hidden bg-gradient-to-br"
    >
      {showImage && (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => {
            setFailedUrl(url);
          }}
        />
      )}
    </div>
  );
}

/**
 * The banner-and-identity block: the cover (or a brand gradient), the avatar
 * overlapping it, then name, handle, bio and the joined date.
 */
export function ProfileHeader({
  user,
  postCount,
  friendCount,
  isOnline,
  action,
  isBlocked = false,
  story,
}: ProfileHeaderProps) {
  const avatar = (
    <Avatar
      initials={initialsOf(user)}
      name={displayName(user)}
      imageUrl={user.avatarUrl}
      size="xl"
      isOnline={isBlocked ? undefined : isOnline}
    />
  );

  return (
    <header className="border-outline-variant border-b">
      <Cover url={isBlocked ? undefined : user.coverUrl} />

      <div className="px-lg pb-lg">
        {/* The avatar overlaps the cover, which is positioned; the avatar's
            wrapper is positioned too, or the cover paints over its top half. */}
        <div className="gap-md -mt-12 flex items-end justify-between">
          {story === undefined || isBlocked ? (
            <div className="ring-background relative rounded-full ring-4">{avatar}</div>
          ) : (
            <button
              type="button"
              aria-haspopup="dialog"
              title={`${displayName(user)}'s story`}
              onClick={(event) => {
                story.onOpen(event.currentTarget.getBoundingClientRect());
              }}
              className={cn(
                'ring-background relative flex rounded-full p-1 ring-4 transition-transform hover:scale-[1.03]',
                story.hasUnseen ? 'story-ring' : 'story-ring-seen',
              )}
            >
              {avatar}
            </button>
          )}
          <div className="pb-1">{action}</div>
        </div>

        <div className="mt-md flex flex-col">
          <h1 className="font-heading text-on-surface text-[22px] font-extrabold tracking-tight">
            {displayName(user)}
          </h1>
          <p className="text-on-surface-variant text-[15px]">{handleOf(user)}</p>
        </div>

        {!isBlocked && user.bio !== undefined && (
          <p className="text-on-surface mt-md text-[15px] leading-relaxed whitespace-pre-wrap">
            {user.bio}
          </p>
        )}

        <div
          hidden={isBlocked}
          className="text-on-surface-variant mt-md flex flex-wrap gap-x-5 gap-y-1 text-[14px]"
        >
          {user.createdAt !== undefined && (
            <span className="gap-xs flex items-center">
              <CalendarDays aria-hidden className="size-4" />
              Joined {calendarDay(user.createdAt)}
            </span>
          )}
          <span>
            <strong className="text-on-surface font-bold">{postCount}</strong> posts
          </span>
          {friendCount !== undefined && (
            <span>
              <strong className="text-on-surface font-bold">{friendCount}</strong> friends
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
