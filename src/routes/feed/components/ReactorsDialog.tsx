import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { fetchReactionSummary, fetchReactors } from '@/features/feed/api';
import { REACTION_LABELS, type Post } from '@/features/feed/types';
import { useRelationship } from '@/features/friends/hooks';
import { REACTION_TYPES, type ReactionType, type Reactor } from '@shared/ipc-types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';
import { FriendshipControls } from '@/routes/profile/components/FriendshipControls';

interface ReactorsDialogProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
}

interface ReactorsPage {
  /** Which tab this page belongs to, so a tab switch reads as loading. */
  tab: string;
  items: Reactor[];
  page: number;
  hasMore: boolean;
}

const ALL_TAB = 'all';

/**
 * The "who reacted" sheet: a tab per reaction type, with counts from the
 * summary, and the people behind the selected one.
 *
 * Two endpoints, each doing what it is for. The summary gives the tab counts
 * in one call; the list gives the rows, newest first, and carries the viewer's
 * friendship with each so a row can offer Add friend without a call per row.
 * Both are read fresh on open rather than from the post's own counts, which
 * may be minutes old.
 *
 * Mounted only while open, so every opening starts from the server's state.
 */
export function ReactorsDialog({ post, isOpen, onClose }: ReactorsDialogProps) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [selected, setSelected] = useState<ReactionType | undefined>(undefined);
  // Keyed by tab, the way useSinglePost keys by id: switching tabs reads as
  // "loading" without an effect having to reset anything.
  const [loaded, setLoaded] = useState<ReactorsPage | null>(null);
  const [failure, setFailure] = useState<{ tab: string; message: string } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const tab = selected ?? ALL_TAB;
  const page = loaded?.tab === tab ? loaded : null;
  const error = failure?.tab === tab ? failure.message : null;
  const isLoading = page === null && error === null;

  useEffect(() => {
    let cancelled = false;
    void fetchReactionSummary(post.id).then((result) => {
      if (!cancelled && result.ok) {
        setCounts({ ...result.data.counts, total: result.data.total });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  // Page 0 of whichever tab is selected; a tab change starts the list over.
  useEffect(() => {
    let cancelled = false;

    void fetchReactors(post.id, 0, selected).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLoaded({ tab, items: result.data.content, page: 0, hasMore: !result.data.last });
      } else {
        setFailure({ tab, message: result.error.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [post.id, selected, tab]);

  const loadMore = (): void => {
    if (page === null || isLoadingMore || !page.hasMore) {
      return;
    }
    setIsLoadingMore(true);
    void fetchReactors(post.id, page.page + 1, selected).then((result) => {
      setIsLoadingMore(false);
      if (result.ok) {
        setLoaded((current) =>
          current === null
            ? current
            : {
                ...current,
                items: [...current.items, ...result.data.content],
                page: result.data.page,
                hasMore: !result.data.last,
              },
        );
      } else {
        setFailure({ tab, message: result.error.message });
      }
    });
  };

  const tabs = [
    { type: undefined, label: 'All', count: counts?.total ?? null },
    ...REACTION_TYPES.map((type) => ({
      type,
      label: `${REACTION_LABELS[type].emoji} ${REACTION_LABELS[type].label}`,
      count: counts?.[type] ?? 0,
    })).filter((tab) => tab.count > 0),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reactions">
      <div role="tablist" aria-label="Reaction type" className="gap-xs flex flex-wrap">
        {tabs.map((tab) => {
          const isSelected = tab.type === selected;
          return (
            <button
              key={tab.type ?? 'all'}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => {
                setSelected(tab.type);
              }}
              className={cn(
                'font-label text-label px-sm transition-tone rounded-full py-1',
                isSelected
                  ? 'bg-primary-container text-on-primary-container'
                  : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface',
              )}
            >
              {tab.label}
              {tab.count !== null && ` ${String(tab.count)}`}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="py-md flex justify-center">
          <Spinner label="Loading reactions…" />
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}

      {page !== null && page.items.length === 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">No reactions yet.</p>
      )}

      {page !== null && page.items.length > 0 && (
        <ul className="stagger gap-md flex max-h-96 flex-col overflow-y-auto">
          {page.items.map((reactor) => (
            <ReactorRow key={reactor.user.id} reactor={reactor} />
          ))}
        </ul>
      )}

      {page?.hasMore === true && (
        <Button variant="ghost" isLoading={isLoadingMore} onClick={loadMore} className="self-start">
          {isLoadingMore ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </Modal>
  );
}

interface ReactorRowProps {
  reactor: Reactor;
}

/**
 * One person: who, what they sent, when, and where the viewer stands with
 * them. The row's `friendStatus` is the server's fresh answer; a mutation
 * made here is answered with the next status, so nothing needs re-reading.
 */
function ReactorRow({ reactor }: ReactorRowProps) {
  const name = displayName(reactor.user);
  const reaction = REACTION_LABELS[reactor.type];
  const control = useRelationship(reactor.user.id, reactor.friendStatus);

  return (
    <li className="gap-md animate-fade-up flex items-center">
      <Link to={`/users/${reactor.user.id}`}>
        <Avatar initials={initialsOf(reactor.user)} name={name} imageUrl={reactor.user.avatarUrl} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={`/users/${reactor.user.id}`}
          className="font-label text-label text-on-surface hover:text-primary transition-tone block truncate"
        >
          {name}
        </Link>
        <p className="font-small text-small text-on-surface-variant truncate">
          {handleOf(reactor.user)} · <span title={reaction.label}>{reaction.emoji}</span>{' '}
          {relativeTime(reactor.reactedAt)}
        </p>
      </div>
      <div className="shrink-0">
        <FriendshipControls control={control} />
      </div>
    </li>
  );
}
