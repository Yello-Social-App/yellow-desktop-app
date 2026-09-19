import { Check, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useMembership } from '@/features/communities/hooks';
import type { Community } from '@/features/communities/types';
import { formatCount } from '@/lib/format';
import { coverClass } from '@/mocks/people';

interface CommunityCardProps {
  community: Community;
}

/** One community: a slice of its cover, the emoji mark, name, stats, join. */
export function CommunityCard({ community }: CommunityCardProps) {
  const { isBusy, toggle } = useMembership(community.slug);

  return (
    <article className="bg-surface-container-lowest border-outline-variant hover:border-outline/40 transition-tone flex flex-col overflow-hidden rounded-2xl border">
      <Link to={`/c/${community.slug}`} className={`block h-16 ${coverClass(community.slug)}`} />
      <div className="-mt-6 flex flex-col gap-2 px-4 pb-4">
        <span className="bg-surface-container-lowest ring-surface-container-lowest shadow-floating grid size-12 place-items-center rounded-2xl text-[26px] ring-4">
          {community.emoji}
        </span>
        <div className="min-w-0">
          <Link
            to={`/c/${community.slug}`}
            className="text-on-surface block truncate text-[15px] font-bold hover:underline"
          >
            {community.name}
          </Link>
          <p className="text-on-surface-variant truncate text-[12px]">c/{community.slug}</p>
        </div>
        <p className="text-on-surface-variant line-clamp-2 text-[13px]">{community.tagline}</p>
        <div className="text-on-surface-variant mt-auto flex items-center justify-between gap-2 pt-1 text-[12px]">
          <span className="flex items-center gap-1">
            <Users aria-hidden className="size-3.5" />
            {formatCount(community.memberCount)}
            {/* The service does not count presence yet, and says so with null. */}
            {community.onlineCount !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="text-tertiary">{community.onlineCount} online</span>
              </>
            )}
          </span>
          <Button
            size="sm"
            variant={community.isMember ? 'outline' : 'primary'}
            isLoading={isBusy}
            leadingIcon={
              community.isMember ? <Check className="size-3.5" /> : <Plus className="size-3.5" />
            }
            onClick={() => {
              toggle(!community.isMember);
            }}
          >
            {community.isMember ? 'Joined' : 'Join'}
          </Button>
        </div>
      </div>
    </article>
  );
}
