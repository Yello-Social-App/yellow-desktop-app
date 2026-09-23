import { ArrowRight, CornerDownLeft, Search, UserPlus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { HighlightMatch } from '@/components/content/HighlightMatch';
import { UserAvatar } from '@/components/people/UserAvatar';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Popover';
import { usePeopleSearch } from '@/features/people/hooks';
import { normalizeQuery } from '@/features/people/search';
import {
  PEOPLE_QUERY_MAX,
  QUICK_SEARCH_LIMIT,
  type FriendsLocationState,
} from '@/features/people/types';
import { cn } from '@/lib/cn';
import { displayName, handleOf } from '@/lib/user-display';
import type { FriendEntry } from '@shared/ipc-types';

interface QuickSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
}

type Option = { kind: 'posts' } | { kind: 'person'; person: FriendEntry } | { kind: 'people' };

function RelationshipHint({ person }: { person: FriendEntry }) {
  switch (person.friendStatus) {
    case 'SELF':
      return <span className="text-on-surface-variant text-[12px]">You</span>;
    case 'FRIENDS':
      return <Badge tone="success">Friend</Badge>;
    case 'REQUEST_RECEIVED':
      return (
        <span className="text-primary text-[12px] whitespace-nowrap">Wants to be friends</span>
      );
    case 'REQUEST_SENT':
      return <span className="text-on-surface-variant text-[12px]">Requested</span>;
    default:
      return <UserPlus aria-hidden className="text-on-surface-variant size-4" />;
  }
}

/**
 * The top bar's search field and the panel under it.
 *
 * Typing still filters the feed exactly as before — that is the first option,
 * "Search posts" — and the panel adds the people who match, so someone can be
 * found from any screen. Picking a person opens their profile; "See all" hands
 * the search to the Friends screen, where the relationship controls live.
 *
 * The field keeps focus throughout (a combobox): arrows move the highlighted
 * option, Enter picks it, Escape closes the panel. `/` from anywhere that is
 * not already a text field jumps into it, as the hint in the field says.
 */
export function QuickSearch({ query, onQueryChange }: QuickSearchProps) {
  const navigate = useNavigate();
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      // Typing a slash into a message or a post must stay a slash.
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const hasQuery = normalizeQuery(query) !== '';
  const search = usePeopleSearch(query);
  const people = search.results.slice(0, QUICK_SEARCH_LIMIT);

  const options: Option[] = hasQuery
    ? [
        { kind: 'posts' },
        ...people.map((person) => ({ kind: 'person' as const, person })),
        ...(people.length > 0 ? [{ kind: 'people' as const }] : []),
      ]
    : [];
  const isPanelOpen = isOpen && options.length > 0;
  const optionId = (index: number) => `${listId}-option-${String(index)}`;

  function choose(option: Option): void {
    setIsOpen(false);
    if (option.kind === 'posts') {
      void navigate('/feed');
      return;
    }
    // Either way the field clears, so the feed is not left silently filtered
    // by a search that was about people.
    onQueryChange('');
    if (option.kind === 'person') {
      void navigate(`/users/${encodeURIComponent(option.person.user.id)}`);
      return;
    }
    void navigate('/friends', {
      state: { peopleQuery: query.trim() } satisfies FriendsLocationState,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (options.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + options.length) % options.length);
    } else if (event.key === 'Enter' && isPanelOpen) {
      event.preventDefault();
      const option = options[Math.min(activeIndex, options.length - 1)];
      if (option !== undefined) {
        choose(option);
      }
    }
  }

  const optionClass = (index: number) =>
    cn(
      'gap-sm px-md transition-tone flex w-full items-center text-left',
      index === activeIndex ? 'bg-surface-container-low' : 'hover:bg-surface-container-low',
    );

  return (
    <Popover
      isOpen={isPanelOpen}
      onClose={() => {
        setIsOpen(false);
      }}
      label="Search"
      panelClassName="w-[380px]"
      trigger={
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search posts and people"
          aria-expanded={isPanelOpen}
          aria-controls={listId}
          aria-activedescendant={isPanelOpen ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          placeholder="Search people and posts"
          maxLength={PEOPLE_QUERY_MAX}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
          }}
          onKeyDown={onKeyDown}
          leadingIcon={<Search className="size-4" />}
          trailingSlot={
            query === '' ? (
              <kbd
                aria-hidden
                className="border-outline-strong text-outline rounded-[5px] border px-1.5 font-mono text-[11px]"
              >
                /
              </kbd>
            ) : undefined
          }
          className="bg-surface-container-low border-outline-strong h-9 rounded-[10px] pl-10 text-[13.5px]"
        />
      }
    >
      <div id={listId} role="listbox" aria-label="Search suggestions">
        {options.map((option, index) => {
          const common = {
            id: optionId(index),
            role: 'option',
            'aria-selected': index === activeIndex,
            // Keeps focus in the field; the click still lands.
            onMouseDown: (event: { preventDefault: () => void }) => {
              event.preventDefault();
            },
            onMouseEnter: () => {
              setActiveIndex(index);
            },
            onClick: () => {
              choose(option);
            },
          } as const;

          if (option.kind === 'posts') {
            return (
              <button
                key="posts"
                type="button"
                {...common}
                className={cn(optionClass(index), 'border-outline-variant border-b py-2.5')}
              >
                <span className="bg-surface-container text-on-surface-variant grid size-8 shrink-0 place-items-center rounded-full">
                  <Search aria-hidden className="size-4" />
                </span>
                <span className="text-on-surface min-w-0 flex-1 truncate text-[14px]">
                  Search posts for <strong className="font-semibold">“{query.trim()}”</strong>
                </span>
                <CornerDownLeft aria-hidden className="text-outline size-3.5" />
              </button>
            );
          }

          if (option.kind === 'person') {
            const { user } = option.person;
            return (
              <div key={user.id}>
                {index === 1 && (
                  <div className="px-md gap-sm flex items-center pt-3 pb-1">
                    <span className="font-label text-caption text-on-surface-variant uppercase">
                      People
                    </span>
                  </div>
                )}
                <button type="button" {...common} className={cn(optionClass(index), 'py-2')}>
                  <UserAvatar user={user} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface block truncate text-[14px] font-semibold">
                      <HighlightMatch text={displayName(user)} query={query} />
                    </span>
                    <span className="text-on-surface-variant block truncate text-[12px]">
                      <HighlightMatch text={handleOf(user)} query={query} />
                    </span>
                  </span>
                  <RelationshipHint person={option.person} />
                </button>
              </div>
            );
          }

          return (
            <button
              key="people"
              type="button"
              {...common}
              className={cn(
                optionClass(index),
                'border-outline-variant text-primary mt-1 justify-between border-t py-2.5 text-[13px]',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                See all people matching “{query.trim()}”
                <ArrowRight aria-hidden className="size-3.5" />
              </span>
              <span className="text-outline text-[12px]">↑↓ to move · Enter to open</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
