import { ArrowLeft, Check, PenLine, Plus, ScrollText, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Spinner } from '@/components/ui/Spinner';
import { useCommunity, useCommunityPostFeed, useMembership } from '@/features/communities/hooks';
import { useCommunitiesStore } from '@/features/communities/store';
import {
  communityFeed,
  type Community,
  type CommunityPostSort,
} from '@/features/communities/types';
import { formatCount } from '@/lib/format';
import { calendarDay } from '@/lib/relative-time';
import { coverClass } from '@/mocks/people';

import { NewCommunityPostDialog } from './components/NewCommunityPostDialog';
import { PostFeed, PostSortPicker } from './components/PostFeed';

/** One community: its banner and about block, then its posts. */
export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const { community, lookup, reload } = useCommunity(slug);

  if (lookup.status === 'missing') {
    return (
      <EmptyState
        icon={<Users className="size-6" />}
        title="No such community"
        description="It may have been renamed, or the link is wrong."
        action={
          <Link to="/communities" className="text-primary hover:underline">
            Browse communities
          </Link>
        }
      />
    );
  }

  if (community === undefined) {
    return lookup.status === 'error' ? (
      <InlineAlert
        message={lookup.error ?? 'This community could not be loaded.'}
        actionLabel="Retry"
        onAction={reload}
      />
    ) : (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  // Keyed by slug so moving between communities starts each one fresh.
  return <CommunityView key={community.slug} community={community} />;
}

function CommunityView({ community }: { community: Community }) {
  const [sort, setSort] = useState<CommunityPostSort>('hot');
  const [isComposing, setIsComposing] = useState(false);
  const feed = useCommunityPostFeed(communityFeed(community.slug), sort);
  const { isBusy, toggle } = useMembership(community.slug);
  const error = useCommunitiesStore((state) => state.error);
  const clearError = useCommunitiesStore((state) => state.clearError);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <Link
          to="/communities"
          aria-label="Back"
          className="hover:bg-surface-container-high transition-tone text-on-surface grid size-9 place-items-center rounded-full"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-heading text-h1 text-on-surface truncate">{community.name}</h1>
      </header>

      <div className={`h-28 ${coverClass(community.slug)}`} />
      <div className="border-outline-variant border-b px-5 pb-4">
        <div className="-mt-8 flex items-end justify-between gap-3">
          <span className="bg-surface-container-lowest ring-background shadow-floating grid size-16 place-items-center rounded-2xl text-[34px] ring-4">
            {community.emoji}
          </span>
          <div className="flex gap-2 pb-1">
            <Button
              variant="secondary"
              leadingIcon={<PenLine className="size-4" />}
              onClick={() => {
                setIsComposing(true);
              }}
            >
              Post
            </Button>
            <Button
              variant={community.isMember ? 'outline' : 'primary'}
              isLoading={isBusy}
              leadingIcon={
                community.isMember ? <Check className="size-4" /> : <Plus className="size-4" />
              }
              onClick={() => {
                toggle(!community.isMember);
              }}
            >
              {community.isMember ? 'Joined' : 'Join'}
            </Button>
          </div>
        </div>
        <h2 className="text-on-surface mt-3 text-[22px] font-extrabold tracking-tight">
          {community.name}
        </h2>
        <p className="text-on-surface-variant text-[14px]">
          c/{community.slug} · {formatCount(community.memberCount)} members
          {community.onlineCount !== null && (
            <>
              {' · '}
              <span className="text-tertiary">{community.onlineCount} online</span>
            </>
          )}
        </p>
        {community.tagline !== '' && (
          <p className="text-on-surface-variant mt-1 text-[14px]">{community.tagline}</p>
        )}
        {community.description !== '' && (
          <p className="text-on-surface mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">
            {community.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {community.tags.map((tag) => (
            <span
              key={tag}
              className="bg-info-fixed text-on-info-fixed rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
            >
              #{tag}
            </span>
          ))}
          <span className="text-on-surface-variant ml-auto self-center text-[12px]">
            Since {calendarDay(community.createdAt)}
          </span>
        </div>
        {community.rules.length > 0 && (
          <details className="group mt-3">
            <summary className="text-on-surface-variant hover:text-on-surface flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold">
              <ScrollText aria-hidden className="size-4" />
              Rules ({community.rules.length})
            </summary>
            <ol className="text-on-surface-variant mt-2 list-decimal space-y-1 pl-6 text-[13px]">
              {community.rules.map((rule, index) => (
                <li key={`${String(index)}-${rule}`}>{rule}</li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {error !== null && (
        <InlineAlert message={error} actionLabel="Dismiss" onAction={clearError} />
      )}

      <PostSortPicker value={sort} onChange={setSort} className="mx-4 mt-4" />
      <PostFeed
        feed={feed}
        inCommunity
        empty={
          <EmptyState
            icon={<PenLine className="size-6" />}
            title="Nothing posted yet"
            description="Be the first to start a thread here."
          />
        }
      />

      {isComposing && (
        <NewCommunityPostDialog
          community={community}
          onClose={() => {
            setIsComposing(false);
          }}
        />
      )}
    </div>
  );
}
