import { TriangleAlert, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useFriendsStore } from '@/features/friends/store';
import { cn } from '@/lib/cn';

import { FriendRow } from './components/FriendRow';

type Tab = 'friends' | 'requests';

const TAB_BASE =
  'font-label text-label gap-sm px-md flex items-center rounded-lg py-2 transition-tone';

/**
 * Friends, and the requests waiting on an answer.
 *
 * Two tabs rather than two routes: both lists come from one store — accepting a
 * request moves a row from one to the other — and a tab keeps that visible
 * without a navigation.
 */
export default function FriendsPage() {
  const {
    friends,
    requests,
    status,
    requestsStatus,
    error,
    friendsHasMore,
    requestsHasMore,
    isLoadingMore,
    pendingIds,
    load,
    loadMoreFriends,
    loadMoreRequests,
    accept,
    decline,
    unfriend,
  } = useFriendsStore();
  const [tab, setTab] = useState<Tab>('friends');

  useEffect(() => {
    void load();
  }, [load]);

  const activeStatus = tab === 'friends' ? status : requestsStatus;
  const rows = tab === 'friends' ? friends : requests;
  const hasMore = tab === 'friends' ? friendsHasMore : requestsHasMore;

  return (
    <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex w-full flex-col">
      <header className="gap-md flex flex-wrap items-center justify-between">
        <h1 className="font-heading text-h3 text-on-surface">Friends</h1>
      </header>

      <div role="tablist" aria-label="Friends and requests" className="gap-sm flex">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'friends'}
          onClick={() => {
            setTab('friends');
          }}
          className={cn(
            TAB_BASE,
            tab === 'friends'
              ? 'bg-surface-container-lowest text-on-surface border-outline-variant border'
              : 'text-on-surface-variant hover:bg-surface-container-low',
          )}
        >
          <Users aria-hidden className="size-4" />
          All friends
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'requests'}
          onClick={() => {
            setTab('requests');
          }}
          className={cn(
            TAB_BASE,
            tab === 'requests'
              ? 'bg-surface-container-lowest text-on-surface border-outline-variant border'
              : 'text-on-surface-variant hover:bg-surface-container-low',
          )}
        >
          <UserPlus aria-hidden className="size-4" />
          Requests
          {requests.length > 0 && <Badge tone="brand">{String(requests.length)}</Badge>}
        </button>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}

      {(activeStatus === 'loading' || activeStatus === 'idle') && (
        <div className="py-xl flex justify-center">
          <Spinner label={tab === 'friends' ? 'Loading your friends…' : 'Loading requests…'} />
        </div>
      )}

      {activeStatus === 'ready' && rows.length === 0 && (
        <EmptyState
          icon={tab === 'friends' ? <Users className="size-6" /> : <UserPlus className="size-6" />}
          title={tab === 'friends' ? 'No friends yet' : 'No requests waiting'}
          description={
            tab === 'friends'
              ? 'Open someone’s profile from a post and send them a request. Friends see each other’s friends-only posts, and appear in each other’s feed.'
              : 'When someone asks to be your friend, their request lands here.'
          }
        />
      )}

      {activeStatus === 'ready' && rows.length > 0 && (
        <>
          <ul className="stagger gap-md flex flex-col">
            {rows.map((friendship) => (
              <li key={friendship.id} className="animate-fade-up">
                <FriendRow
                  friendship={friendship}
                  variant={tab === 'friends' ? 'friend' : 'request'}
                  isPending={pendingIds.has(friendship.id) || pendingIds.has(friendship.user.id)}
                  onAccept={(friendshipId) => {
                    void accept(friendshipId);
                  }}
                  onDecline={(friendshipId) => {
                    void decline(friendshipId);
                  }}
                  onRemove={(userId) => {
                    void unfriend(userId);
                  }}
                />
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                isLoading={isLoadingMore}
                onClick={() => {
                  void (tab === 'friends' ? loadMoreFriends() : loadMoreRequests());
                }}
              >
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
