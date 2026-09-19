import { SearchX, Type } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { RowSkeleton } from '@/components/ui/Skeleton';
import type { PeopleSearch } from '@/features/people/hooks';
import type { SearchScope } from '@/features/people/types';
import { cn } from '@/lib/cn';
import { USER_SEARCH_QUERY_MIN } from '@shared/ipc-types';

import { FriendRow } from './FriendRow';

const SCOPES: readonly { value: SearchScope; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
];

interface SearchScopeBarProps {
  search: PeopleSearch;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
}

function countLabel({ status, count }: PeopleSearch): string {
  if (status === 'ready') {
    return `People · ${String(count)} ${count === 1 ? 'result' : 'results'}`;
  }
  return status === 'loading' ? 'People · searching…' : 'People';
}

/** Takes the tabs' place in the header while a search is showing. */
export function SearchScopeBar({ search, scope, onScopeChange }: SearchScopeBarProps) {
  return (
    <div className="px-lg gap-sm flex items-center pb-3">
      <span
        className="font-label text-caption text-on-surface-variant uppercase"
        aria-live="polite"
      >
        {countLabel(search)}
      </span>
      <div role="group" aria-label="Search in" className="ml-auto flex gap-2">
        {SCOPES.map((item) => {
          const isSelected = item.value === scope;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                onScopeChange(item.value);
              }}
              className={cn(
                'font-label transition-tone h-7 rounded-full px-3 text-[13px] font-semibold',
                isSelected
                  ? 'bg-primary-fixed text-on-primary-fixed'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PeopleSearchResultsProps {
  search: PeopleSearch;
  query: string;
  scope: SearchScope;
}

export function PeopleSearchResults({ search, query, scope }: PeopleSearchResultsProps) {
  const { status, results, error } = search;

  if (status === 'short') {
    return (
      <EmptyState
        icon={<Type className="size-6" />}
        title="Keep typing"
        description={`Search needs at least ${String(USER_SEARCH_QUERY_MIN)} characters of a name or @username.`}
      />
    );
  }

  if (status === 'loading') {
    return (
      <div className="divide-hairline flex flex-col" aria-busy>
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <InlineAlert
        message={error ?? 'People search is unavailable right now.'}
        actionLabel="Retry"
        onAction={search.retry}
      />
    );
  }

  if (results.length === 0 && !search.hasMore) {
    return (
      <EmptyState
        icon={<SearchX className="size-6" />}
        title={scope === 'friends' ? 'None of your friends match' : 'No one matches that'}
        description={`Nothing for “${query.trim()}”. Check the spelling, or search by @username.`}
      />
    );
  }

  return (
    <>
      <ul className="stagger divide-hairline flex flex-col">
        {results.map((entry) => (
          <li key={entry.user.id} className="animate-fade-up">
            <FriendRow entry={entry} query={query} />
          </li>
        ))}
      </ul>

      {error !== null && (
        <InlineAlert message={error} actionLabel="Retry" onAction={search.retry} />
      )}

      {search.hasMore && error === null && (
        <div className="py-lg flex justify-center">
          <Button variant="secondary" isLoading={search.isLoadingMore} onClick={search.loadMore}>
            {search.isLoadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </>
  );
}
