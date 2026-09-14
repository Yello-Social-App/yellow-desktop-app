import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/Input';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useCommunitiesStore } from '@/features/communities/store';
import { cn } from '@/lib/cn';

import { CommunityCard } from './components/CommunityCard';
import { CommunityPostCard } from './components/CommunityPostCard';

type View = 'discover' | 'joined' | 'posts';

/**
 * Communities: discover them as a grid, see the ones you joined, or read
 * the latest posts across all of them Reddit-front-page style.
 */
export default function CommunitiesPage() {
  const communities = useCommunitiesStore((state) => state.communities);
  const posts = useCommunitiesStore((state) => state.posts);
  const [view, setView] = useState<View>('posts');
  const [query, setQuery] = useState('');

  const bySlug = useMemo(() => new Map(communities.map((c) => [c.slug, c])), [communities]);
  const needle = query.trim().toLowerCase();
  const visible = communities.filter(
    (c) =>
      (view !== 'joined' || c.isJoined) &&
      (needle === '' ||
        c.name.toLowerCase().includes(needle) ||
        c.tags.some((t) => t.includes(needle))),
  );
  const joinedSlugs = new Set(communities.filter((c) => c.isJoined).map((c) => c.slug));
  const feed = posts
    .filter((p) => needle === '' || p.title.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        Number(joinedSlugs.has(b.communitySlug)) - Number(joinedSlugs.has(a.communitySlug)) ||
        b.score - a.score,
    );

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <div className="flex items-center gap-3 px-5 pt-3 pb-2">
          <h1 className="font-heading text-h1 text-on-surface">Communities</h1>
          <SampleBadge />
          <div className="ml-auto w-56">
            <Input
              type="search"
              aria-label="Search communities"
              placeholder="Search"
              value={query}
              leadingIcon={<Search className="size-4" />}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="h-9 rounded-full pl-10 text-[13px]"
            />
          </div>
        </div>
        <div role="tablist" className="flex px-2">
          {(
            [
              ['posts', 'Latest posts'],
              ['discover', 'Discover'],
              ['joined', 'Joined'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => {
                setView(value);
              }}
              className={cn(
                'hover:bg-surface-container-low transition-tone relative flex-1 py-3 text-[14px]',
                view === value
                  ? 'text-on-surface font-bold'
                  : 'text-on-surface-variant font-medium',
              )}
            >
              {label}
              {view === value && (
                <span
                  aria-hidden
                  className="bg-info absolute inset-x-8 bottom-0 h-1 rounded-full"
                />
              )}
            </button>
          ))}
        </div>
      </header>

      {view === 'posts' ? (
        <ul className="stagger flex flex-col gap-3 p-4">
          {feed.map((post) => (
            <li key={post.id} className="animate-fade-up">
              <CommunityPostCard post={post} community={bySlug.get(post.communitySlug)} />
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="text-on-surface-variant flex flex-col items-center gap-2 py-16 text-center text-[14px]">
          <Users className="size-6" />
          {view === 'joined' ? 'You have not joined any community yet.' : 'Nothing matches.'}
        </div>
      ) : (
        <ul className="stagger grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {visible.map((community) => (
            <li key={community.slug} className="animate-fade-up">
              <CommunityCard community={community} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
