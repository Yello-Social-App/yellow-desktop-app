import { ArrowLeft, Check, PenLine, Plus, ScrollText, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useCommunitiesStore } from '@/features/communities/store';
import { coverClass } from '@/mocks/people';
import { calendarDay } from '@/lib/relative-time';

import { formatCount } from '@/lib/format';
import { CommunityPostCard } from './components/CommunityPostCard';
import { NewCommunityPostDialog } from './components/NewCommunityPostDialog';

/** One community: its banner and about block, then its posts. */
export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const community = useCommunitiesStore((state) => state.communities.find((c) => c.slug === slug));
  const posts = useCommunitiesStore((state) => state.posts);
  const toggleJoin = useCommunitiesStore((state) => state.toggleJoin);
  const [isComposing, setIsComposing] = useState(false);

  if (community === undefined) {
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

  const own = posts.filter((p) => p.communitySlug === community.slug);

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
        <SampleBadge />
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
              variant={community.isJoined ? 'outline' : 'primary'}
              leadingIcon={
                community.isJoined ? <Check className="size-4" /> : <Plus className="size-4" />
              }
              onClick={() => {
                toggleJoin(community.slug);
              }}
            >
              {community.isJoined ? 'Joined' : 'Join'}
            </Button>
          </div>
        </div>
        <h2 className="text-on-surface mt-3 text-[22px] font-extrabold tracking-tight">
          {community.name}
        </h2>
        <p className="text-on-surface-variant text-[14px]">
          c/{community.slug} · {formatCount(community.members)} members ·{' '}
          <span className="text-tertiary">{community.online} online</span>
        </p>
        <p className="text-on-surface mt-3 text-[15px] leading-relaxed">{community.description}</p>
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
        <details className="group mt-3">
          <summary className="text-on-surface-variant hover:text-on-surface flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold">
            <ScrollText aria-hidden className="size-4" />
            Rules ({community.rules.length})
          </summary>
          <ol className="text-on-surface-variant mt-2 list-decimal space-y-1 pl-6 text-[13px]">
            {community.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
        </details>
      </div>

      {own.length === 0 ? (
        <EmptyState
          icon={<PenLine className="size-6" />}
          title="Nothing posted yet"
          description="Be the first to start a thread here."
        />
      ) : (
        <ul className="stagger flex flex-col gap-3 p-4">
          {own.map((post) => (
            <li key={post.id} className="animate-fade-up">
              <CommunityPostCard post={post} community={community} inCommunity />
            </li>
          ))}
        </ul>
      )}

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
