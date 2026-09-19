import { Search, Users } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCommunityDirectory, useCommunityPostFeed } from '@/features/communities/hooks';
import { useCommunitiesStore } from '@/features/communities/store';
import type { CommunityPostSort } from '@/features/communities/types';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { COMMUNITY_SEARCH_MAX } from '@shared/ipc-types';
import { cn } from '@/lib/cn';

import { CommunityCard } from './components/CommunityCard';
import { PostFeed, PostSortPicker } from './components/PostFeed';

type View = 'discover' | 'joined' | 'posts';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Communities: the latest posts across all of them Reddit-front-page style,
 * or the directory — every community, or the ones you joined — searched by
 * name, slug or tag on the server.
 */
export default function CommunitiesPage() {
  const [view, setView] = useState<View>('posts');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CommunityPostSort>('hot');
  const q = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const error = useCommunitiesStore((state) => state.error);
  const clearError = useCommunitiesStore((state) => state.clearError);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <div className="flex items-center gap-3 px-5 pt-3 pb-2">
          <h1 className="font-heading text-h1 text-on-surface">Communities</h1>
          {view !== 'posts' && (
            <div className="ml-auto w-56">
              <Input
                type="search"
                aria-label="Search communities"
                placeholder="Name or tag"
                value={query}
                maxLength={COMMUNITY_SEARCH_MAX}
                leadingIcon={<Search className="size-4" />}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                className="h-9 rounded-full pl-10 text-[13px]"
              />
            </div>
          )}
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

      {error !== null && (
        <InlineAlert message={error} actionLabel="Dismiss" onAction={clearError} />
      )}

      {view === 'posts' ? (
        <FrontPage sort={sort} onSortChange={setSort} />
      ) : (
        <Directory joinedOnly={view === 'joined'} q={q} />
      )}
    </div>
  );
}

function FrontPage({
  sort,
  onSortChange,
}: {
  sort: CommunityPostSort;
  onSortChange: (sort: CommunityPostSort) => void;
}) {
  // With a session, posts from joined communities rank first; paging carries on
  // across that boundary on the server, so nothing is re-sorted here.
  const feed = useCommunityPostFeed('all', sort);

  return (
    <>
      <PostSortPicker value={sort} onChange={onSortChange} className="mx-4 mt-4" />
      <PostFeed
        feed={feed}
        empty={
          <div className="text-on-surface-variant flex flex-col items-center gap-2 py-16 text-center text-[14px]">
            <Users className="size-6" />
            No posts in any community yet.
          </div>
        }
      />
    </>
  );
}

function Directory({ joinedOnly, q }: { joinedOnly: boolean; q: string }) {
  const directory = useCommunityDirectory({
    sort: 'popular',
    ...(joinedOnly ? { membership: 'joined' as const } : {}),
    q,
  });

  if (
    directory.items.length === 0 &&
    (directory.status === 'loading' || directory.status === 'idle')
  ) {
    return (
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2" aria-busy>
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
    );
  }

  if (directory.items.length === 0 && directory.status === 'error') {
    return (
      <InlineAlert
        message={directory.error ?? 'Communities could not be loaded.'}
        actionLabel="Retry"
        onAction={directory.reload}
      />
    );
  }

  if (directory.items.length === 0) {
    return (
      <div className="text-on-surface-variant flex flex-col items-center gap-2 py-16 text-center text-[14px]">
        <Users className="size-6" />
        {q !== ''
          ? 'Nothing matches.'
          : joinedOnly
            ? 'You have not joined any community yet.'
            : 'There are no communities yet.'}
      </div>
    );
  }

  return (
    <>
      <ul className="stagger grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {directory.items.map((community) => (
          <li key={community.slug} className="animate-fade-up">
            <CommunityCard community={community} />
          </li>
        ))}
      </ul>
      {directory.error !== null && (
        <InlineAlert message={directory.error} actionLabel="Retry" onAction={directory.loadMore} />
      )}
      {directory.hasMore && directory.error === null && (
        <div className="pb-lg flex justify-center">
          <Button
            variant="secondary"
            isLoading={directory.isLoadingMore}
            onClick={directory.loadMore}
          >
            {directory.isLoadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </>
  );
}
