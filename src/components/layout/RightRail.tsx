import { Check, MessageCircle, MessagesSquare, Send, UserPlus, Users, X } from 'lucide-react';
import type { Author } from '@shared/ipc-types';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useCommunityDirectory } from '@/features/communities/hooks';
import { useCommunitiesStore } from '@/features/communities/store';
import { useFriendsStore } from '@/features/friends/store';
import { useShowcaseStore } from '@/features/showcase/store';
import { useConversationRows, useStartConversation } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';
import { formatCount } from '@/lib/format';

const MAX_ROWS = 4;
/** Popular communities: one small page, read once. */
const RAIL_SUGGESTIONS = 3;

function RailCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="bg-surface-container-lowest border-outline-variant overflow-hidden rounded-2xl border">
      <h2 className="font-heading text-h2 text-on-surface px-md pt-md pb-sm">{title}</h2>
      {children}
      {footer !== undefined && <div className="px-md py-sm text-[13px]">{footer}</div>}
    </section>
  );
}

function PersonRow({
  user,
  line,
  isOnline,
  actions,
}: {
  user: Author;
  line: ReactNode;
  isOnline?: boolean;
  actions: ReactNode;
}) {
  return (
    <li className="gap-sm px-md py-sm flex items-center">
      <Link to={`/users/${user.id}`}>
        <Avatar
          initials={initialsOf(user)}
          name={displayName(user)}
          imageUrl={user.avatarUrl}
          size="sm"
          isOnline={isOnline}
        />
      </Link>
      <span className="min-w-0 flex-1">
        <Link
          to={`/users/${user.id}`}
          className="text-on-surface block truncate text-[14px] font-semibold hover:underline"
        >
          {displayName(user)}
        </Link>
        <span className="text-on-surface-variant block truncate text-[12px]">{line}</span>
      </span>
      {actions}
    </li>
  );
}

/**
 * The context column. Most of it comes from stores the sidebar badges already
 * load, so it costs no extra calls: the caller's own numbers, requests waiting
 * on an answer, who is on the socket now, recent conversations, and requests
 * still out. Popular communities not yet joined are one three-row page, read
 * once per session. Cards that would be empty are not drawn — except the first
 * two, so the column is never blank.
 */
interface RightRailProps {
  /** Folded away, animated, while a screen uses its slot. */
  isCollapsed?: boolean;
}

export function RightRail({ isCollapsed = false }: RightRailProps) {
  useFriendsLoader();
  const user = useCurrentUser();
  const received = useFriendList('received');
  const sent = useFriendList('sent');
  const friends = useFriendList('friends');
  const pendingIds = useFriendsStore((state) => state.pendingIds);
  const accept = useFriendsStore((state) => state.accept);
  const decline = useFriendsStore((state) => state.decline);
  const cancelRequest = useFriendsStore((state) => state.cancelRequest);
  const online = useMessagesStore((state) => state.socket.onlineUserIds);
  const { rows: conversations } = useConversationRows();
  const popular = useCommunityDirectory({
    sort: 'popular',
    membership: 'not_joined',
    size: RAIL_SUGGESTIONS,
  }).items;
  const projects = useShowcaseStore((state) => state.projects);
  const trending = [...projects].sort((a, b) => b.likes - a.likes).slice(0, 3);
  const joinCommunity = useCommunitiesStore((state) => state.setMembership);
  const joiningSlugs = useCommunitiesStore((state) => state.pendingIds);
  const { direct, isStarting } = useStartConversation();

  const onlineFriends = friends.entries.filter((entry) => online.includes(entry.user.id));
  const unread = conversations.reduce((sum, row) => sum + row.unreadCount, 0);

  return (
    <aside
      aria-hidden={isCollapsed}
      className={cn(
        'hidden shrink-0 overflow-x-hidden overflow-y-auto transition-[width,opacity] duration-300 xl:block',
        isCollapsed ? 'pointer-events-none w-0 opacity-0' : 'w-rail-width opacity-100',
      )}
    >
      {/* Fixed inner width, so the cards do not reflow while the aside animates. */}
      <div className="w-rail-width px-md pt-md pb-lg gap-md flex flex-col">
        {user !== null && (
          <section className="bg-surface-container-lowest border-outline-variant p-md rounded-2xl border">
            <div className="gap-sm flex items-center">
              <Avatar
                initials={initialsOf(user)}
                name={displayName(user)}
                imageUrl={user.avatarUrl}
                size="md"
              />
              <span className="min-w-0">
                <span className="text-on-surface block truncate text-[15px] font-bold">
                  {displayName(user)}
                </span>
                <span className="text-on-surface-variant block truncate text-[13px]">
                  {handleOf(user)}
                </span>
              </span>
            </div>
            <dl className="mt-md grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Friends', value: friends.total, to: '/friends' },
                { label: 'Requests', value: received.total, to: '/friends' },
                { label: 'Unread', value: unread, to: '/messages' },
              ].map((stat) => (
                <Link
                  key={stat.label}
                  to={stat.to}
                  className="bg-surface-container-low hover:bg-surface-container transition-tone rounded-xl py-2"
                >
                  <dt className="text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
                    {stat.label}
                  </dt>
                  <dd className="text-on-surface text-[18px] font-bold tabular-nums">
                    {stat.value}
                  </dd>
                </Link>
              ))}
            </dl>
          </section>
        )}

        {received.entries.length > 0 && (
          <RailCard
            title="Friend requests"
            footer={
              received.total > MAX_ROWS ? (
                <Link to="/friends" className="text-primary hover:underline">
                  See all {received.total}
                </Link>
              ) : undefined
            }
          >
            <ul className="divide-hairline">
              {received.entries.slice(0, MAX_ROWS).map(({ user: person }) => (
                <PersonRow
                  key={person.id}
                  user={person}
                  line={handleOf(person)}
                  actions={
                    <>
                      <IconButton
                        label={`Accept ${displayName(person)}`}
                        size="sm"
                        tone="brand"
                        icon={<Check className="size-4" />}
                        disabled={pendingIds.has(person.id)}
                        onClick={() => {
                          void accept(person.id);
                        }}
                      />
                      <IconButton
                        label={`Decline ${displayName(person)}`}
                        size="sm"
                        icon={<X className="size-4" />}
                        disabled={pendingIds.has(person.id)}
                        onClick={() => {
                          void decline(person.id);
                        }}
                      />
                    </>
                  }
                />
              ))}
            </ul>
          </RailCard>
        )}

        <RailCard title="Online now">
          {onlineFriends.length === 0 ? (
            <p className="text-on-surface-variant px-md pb-md text-[13px]">
              {friends.entries.length === 0
                ? 'Add friends to see who is around.'
                : 'None of your friends are online right now.'}
            </p>
          ) : (
            <ul className="divide-hairline">
              {onlineFriends.slice(0, MAX_ROWS).map(({ user: person }) => (
                <PersonRow
                  key={person.id}
                  user={person}
                  isOnline
                  line={<span className="text-tertiary">Active now</span>}
                  actions={
                    <IconButton
                      label={`Message ${displayName(person)}`}
                      size="sm"
                      tone="brand"
                      icon={<MessageCircle className="size-4" />}
                      disabled={isStarting}
                      onClick={() => {
                        void direct(person.id);
                      }}
                    />
                  }
                />
              ))}
            </ul>
          )}
        </RailCard>

        {conversations.length > 0 && (
          <RailCard
            title="Recent chats"
            footer={
              <Link to="/messages" className="text-primary hover:underline">
                All messages
              </Link>
            }
          >
            <ul className="divide-hairline">
              {conversations.slice(0, MAX_ROWS).map((row) => {
                const [peer] = row.peers;
                const when = row.conversation.lastMessageAt ?? row.conversation.createdAt;
                return (
                  <li key={row.conversation.id}>
                    <Link
                      to={`/messages/${encodeURIComponent(row.conversation.id)}`}
                      className="gap-sm px-md py-sm hover:bg-surface-container-low transition-tone flex items-center"
                    >
                      {peer === undefined ? (
                        <span className="bg-surface-container text-on-surface-variant flex size-8 shrink-0 items-center justify-center rounded-full">
                          <Users aria-hidden className="size-4" />
                        </span>
                      ) : (
                        <Avatar
                          initials={initialsOf(peer)}
                          name={displayName(peer)}
                          imageUrl={peer.avatarUrl}
                          size="sm"
                          isOnline={row.isOnline || undefined}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-on-surface truncate text-[14px] font-semibold">
                            {row.title}
                          </span>
                          <span className="text-on-surface-variant shrink-0 text-[11px]">
                            {relativeTime(when)}
                          </span>
                        </span>
                        <span className="text-on-surface-variant block truncate text-[12px]">
                          {row.previewIsMine ? 'You: ' : ''}
                          {row.preview}
                        </span>
                      </span>
                      {row.unreadCount > 0 && (
                        <span className="bg-primary-container size-2 shrink-0 rounded-full" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </RailCard>
        )}

        {sent.entries.length > 0 && (
          <RailCard title="Requests sent">
            <ul className="divide-hairline">
              {sent.entries.slice(0, MAX_ROWS).map(({ user: person, since }) => (
                <PersonRow
                  key={person.id}
                  user={person}
                  line={
                    since === undefined ? 'Waiting for an answer' : `Sent ${relativeTime(since)}`
                  }
                  actions={
                    <IconButton
                      label={`Cancel request to ${displayName(person)}`}
                      size="sm"
                      icon={<X className="size-4" />}
                      disabled={pendingIds.has(person.id)}
                      onClick={() => {
                        void cancelRequest(person.id);
                      }}
                    />
                  }
                />
              ))}
            </ul>
          </RailCard>
        )}

        {popular.length > 0 && (
          <RailCard
            title="Popular communities"
            footer={
              <Link to="/communities" className="text-primary hover:underline">
                Browse all
              </Link>
            }
          >
            <ul className="divide-hairline">
              {popular.map((community) => (
                <li key={community.slug} className="gap-sm px-md py-sm flex items-center">
                  <Link
                    to={`/c/${community.slug}`}
                    className="bg-surface-container grid size-9 shrink-0 place-items-center rounded-xl text-[18px]"
                  >
                    {community.emoji}
                  </Link>
                  <span className="min-w-0 flex-1">
                    <Link
                      to={`/c/${community.slug}`}
                      className="text-on-surface block truncate text-[14px] font-semibold hover:underline"
                    >
                      {community.name}
                    </Link>
                    <span className="text-on-surface-variant block truncate text-[12px]">
                      {formatCount(community.memberCount)} members
                    </span>
                  </span>
                  <Button
                    size="sm"
                    isLoading={joiningSlugs.has(community.slug)}
                    onClick={() => {
                      void joinCommunity(community.slug, true);
                    }}
                  >
                    Join
                  </Button>
                </li>
              ))}
            </ul>
          </RailCard>
        )}

        <RailCard
          title="Trending projects"
          footer={
            <Link to="/showcase" className="text-primary hover:underline">
              Open the showcase
            </Link>
          }
        >
          <ul className="divide-hairline">
            {trending.map((project, index) => (
              <li key={project.id}>
                <Link
                  to={`/showcase/${project.id}`}
                  className="gap-sm px-md py-sm hover:bg-surface-container-low transition-tone flex items-center"
                >
                  <span className="text-on-surface-variant w-4 text-[12px] font-bold tabular-nums">
                    {index + 1}
                  </span>
                  <span className="bg-surface-container grid size-9 shrink-0 place-items-center rounded-xl text-[18px]">
                    {project.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface block truncate text-[14px] font-semibold">
                      {project.name}
                    </span>
                    <span className="text-on-surface-variant block truncate text-[12px]">
                      {project.tagline}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </RailCard>

        {friends.status === 'ready' && friends.entries.length === 0 && (
          <RailCard title="Find people">
            <div className="text-on-surface-variant px-md pb-md flex flex-col gap-2 text-[13px]">
              <p className="flex items-start gap-2">
                <UserPlus aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Open someone's profile from a post or a comment and tap{' '}
                  <strong className="text-on-surface">Add friend</strong>.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Send aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>Your sent requests show here until they answer.</span>
              </p>
              <p className="flex items-start gap-2">
                <MessagesSquare aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>Once you're friends, you can message each other.</span>
              </p>
            </div>
          </RailCard>
        )}
      </div>
    </aside>
  );
}
