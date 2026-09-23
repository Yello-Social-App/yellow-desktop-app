import { FolderKanban, SquarePen } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { UserAvatar } from '@/components/people/UserAvatar';
import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useConversationRows, type ConversationRow } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { useProjectList } from '@/features/showcase/hooks';
import { cn } from '@/lib/cn';
import { relativeTime, shortRelativeTime } from '@/lib/relative-time';
import { displayName, handleOf } from '@/lib/user-display';
import { GroupAvatar } from '@/routes/messages/components/GroupAvatar';
import { NewChatDialog } from '@/routes/messages/components/NewChatDialog';
import { useLayoutStore, type CompactPanelTab } from '@/stores/layout-store';

/** Recent chats shown before "All" takes over. */
const CHAT_ROWS = 4;
/** Trending projects: one small page, read once per session. */
const TRENDING_ROWS = 3;

interface RightRailProps {
  /** Folded away, animated, while a screen uses its slot. */
  isCollapsed?: boolean;
}

/**
 * The context column, in the frame's two shapes.
 *
 * Expanded ("quiet rails") is two sections and an identity card, not a stack
 * of boxes: who you are with your numbers as one line, your recent chats, and
 * trending projects. Compact is one panel with a Chats / Trending switch, so
 * the column costs the same width but asks for one thing at a time.
 *
 * Everything here comes from stores the rest of the shell already loads — the
 * friend lists the sidebar dots read, the conversation list chat keeps live —
 * except trending projects, one three-row page per session. Friend requests
 * are a number here and a screen of their own under Friends, where accepting
 * and declining live.
 */
export function RightRail({ isCollapsed = false }: RightRailProps) {
  useFriendsLoader();
  const railMode = useLayoutStore((state) => state.railMode);

  return (
    <aside
      aria-label="Activity"
      aria-hidden={isCollapsed}
      className={cn(
        'border-outline-variant hidden shrink-0 overflow-x-hidden overflow-y-auto border-l transition-[width,opacity] duration-300 xl:block',
        railMode === 'compact' && 'bg-chrome',
        isCollapsed ? 'pointer-events-none w-0 border-l-0 opacity-0' : 'w-rail-width opacity-100',
      )}
    >
      {/* Fixed inner width, so the content does not reflow while the aside animates. */}
      <div className="w-rail-width flex min-h-full flex-col">
        {railMode === 'compact' ? <ActivityPanel /> : <QuietRail />}
      </div>
    </aside>
  );
}

/** Shared by both shapes: the numbers, the chats, the projects, who is on. */
function useRailData() {
  const friends = useFriendList('friends');
  const received = useFriendList('received');
  const online = useMessagesStore((state) => state.socket.onlineUserIds);
  const { rows } = useConversationRows();
  const trending = useProjectList({ sort: 'trending', size: TRENDING_ROWS }).projects;
  const onlineFriends = friends.entries.filter((entry) => online.includes(entry.user.id));
  return {
    friendCount: friends.total,
    requestCount: received.total,
    unread: rows.reduce((sum, row) => sum + row.unreadCount, 0),
    chats: rows.slice(0, CHAT_ROWS),
    trending,
    onlineCount: onlineFriends.length,
    hasFriends: friends.entries.length > 0,
  };
}

function SectionLabel({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex h-[22px] items-center px-1.5">
      <h2 className="font-display text-outline flex-1 text-[12px] font-bold tracking-[0.06em] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

function AccentLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-primary text-[12.5px] font-medium hover:underline">
      {children}
    </Link>
  );
}

/** "No friends online right now", or how many are — the presence line above chats. */
function PresenceLine({
  onlineCount,
  hasFriends,
  action,
}: {
  onlineCount: number;
  hasFriends: boolean;
  action?: ReactNode;
}) {
  const text =
    onlineCount > 0
      ? `${String(onlineCount)} ${onlineCount === 1 ? 'friend' : 'friends'} online`
      : hasFriends
        ? 'No friends online right now'
        : 'Add friends to see who is around';
  return (
    <p className="text-outline flex items-center gap-[7px] text-[12.5px]">
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          onlineCount > 0 ? 'bg-tertiary' : 'bg-surface-container-highest',
        )}
      />
      <span className="flex-1">{text}</span>
      {action}
    </p>
  );
}

/**
 * One recent chat. Unread reads as the design's state table says: the name at
 * 600, the preview a step brighter, a raised row, and the accent dot.
 */
function ChatRow({ row, isRoomy }: { row: ConversationRow; isRoomy: boolean }) {
  const [peer] = row.peers;
  const isUnread = row.unreadCount > 0;
  const when = row.conversation.lastMessageAt ?? row.conversation.createdAt;

  return (
    <Link
      to={`/messages/${encodeURIComponent(row.conversation.id)}`}
      aria-label={isUnread ? `${row.title}, ${String(row.unreadCount)} unread` : undefined}
      className={cn(
        'transition-tone flex items-center gap-[11px] rounded-[11px] px-1.5 py-2',
        isRoomy && 'px-2 py-[9px]',
        isUnread ? 'bg-surface-container-low' : 'hover:bg-surface-container-low',
      )}
    >
      {row.conversation.type === 'GROUP' || peer === undefined ? (
        <GroupAvatar row={row} size={isRoomy ? 'md' : 'sm'} />
      ) : (
        <UserAvatar user={peer} size={isRoomy ? 'md' : 'sm'} isOnline={row.isOnline || undefined} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-[13.5px]',
            isUnread ? 'text-on-surface font-semibold' : 'text-on-surface/90 font-medium',
          )}
        >
          {row.title}
        </span>
        <span
          className={cn('truncate text-[12.5px]', isUnread ? 'text-on-surface/80' : 'text-outline')}
        >
          {row.previewIsMine ? 'You: ' : ''}
          {row.preview}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-[5px]">
        <time
          dateTime={when}
          title={relativeTime(when)}
          className="text-outline font-mono text-[11px]"
        >
          {shortRelativeTime(when)}
        </time>
        {isUnread && <span aria-hidden className="bg-primary size-[7px] rounded-full" />}
      </span>
    </Link>
  );
}

interface TrendingProject {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
}

function ProjectRow({ project, rank }: { project: TrendingProject; rank?: number }) {
  return (
    <Link
      to={`/showcase/${encodeURIComponent(project.id)}`}
      className="hover:bg-surface-container-low transition-tone flex items-center gap-[11px] rounded-[11px] px-1.5 py-2"
    >
      {rank !== undefined && (
        <span className="text-outline/80 w-3 shrink-0 font-mono text-[12px]">{rank}</span>
      )}
      <span className="bg-surface-container border-outline-strong grid size-[30px] shrink-0 place-items-center rounded-[9px] border text-[15px]">
        {project.emoji === '' ? (
          <FolderKanban aria-hidden className="text-on-surface-variant size-4" />
        ) : (
          project.emoji
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-on-surface truncate text-[13.5px] font-medium">{project.name}</span>
        <span className="text-outline truncate text-[12px]">{project.tagline}</span>
      </span>
    </Link>
  );
}

/** Option A: identity card, Messages, Trending projects, a quiet footer. */
function QuietRail() {
  const user = useCurrentUser();
  const data = useRailData();

  return (
    <div className="flex flex-1 flex-col gap-[18px] px-4 py-[18px]">
      {user !== null && (
        <section className="bg-surface-container-lowest border-outline-variant flex flex-col gap-2.5 rounded-[14px] border p-3.5">
          <div className="flex items-center gap-[11px]">
            <UserAvatar user={user} size="md" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-on-surface truncate text-[15px] font-semibold">
                {displayName(user)}
              </span>
              <span className="text-outline truncate text-[12.5px]">{handleOf(user)}</span>
            </span>
            <Link
              to="/profile"
              className="border-outline-strong text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-tone rounded-lg border px-2.5 py-[5px] text-[12.5px] font-medium"
            >
              Edit
            </Link>
          </div>
          <StatLine friends={data.friendCount} requests={data.requestCount} unread={data.unread} />
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <SectionLabel action={<AccentLink to="/messages">All</AccentLink>}>Messages</SectionLabel>
        <div className="mb-1 ml-1.5">
          <PresenceLine onlineCount={data.onlineCount} hasFriends={data.hasFriends} />
        </div>
        {data.chats.length === 0 ? (
          <p className="text-outline px-1.5 text-[12.5px]">No conversations yet.</p>
        ) : (
          data.chats.map((row) => <ChatRow key={row.conversation.id} row={row} isRoomy={false} />)
        )}
      </section>

      {data.trending.length > 0 && (
        <>
          <span aria-hidden className="bg-outline-variant h-px" />
          <section className="flex flex-col gap-1.5">
            <SectionLabel action={<AccentLink to="/showcase">Showcase</AccentLink>}>
              Trending projects
            </SectionLabel>
            {data.trending.map((project, index) => (
              <ProjectRow key={project.id} project={project} rank={index + 1} />
            ))}
          </section>
        </>
      )}

      <p className="text-outline mt-auto px-1.5 text-[11.5px]">© 2026 Yello</p>
    </div>
  );
}

/** Three numbers as one line, each a way into its screen. */
function StatLine({
  friends,
  requests,
  unread,
}: {
  friends: number;
  requests: number;
  unread: number;
}) {
  const stats = [
    { value: friends, label: friends === 1 ? 'friend' : 'friends', to: '/friends' },
    { value: requests, label: requests === 1 ? 'request' : 'requests', to: '/friends' },
    { value: unread, label: 'unread', to: '/messages' },
  ];
  return (
    <p className="text-outline flex flex-wrap items-center gap-2 text-[12.5px]">
      {stats.map((stat, index) => (
        <span key={stat.label} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden className="text-surface-container-highest">
              ·
            </span>
          )}
          <Link to={stat.to} className="hover:text-on-surface-variant">
            <strong className="text-on-surface font-mono font-medium">{stat.value}</strong>{' '}
            {stat.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

const PANEL_TABS: readonly (readonly [CompactPanelTab, string])[] = [
  ['chats', 'Chats'],
  ['trending', 'Trending'],
];

/** Option B: one surface, one switch, and "New message" pinned to its foot. */
function ActivityPanel() {
  const data = useRailData();
  const tab = useLayoutStore((state) => state.panelTab);
  const setTab = useLayoutStore((state) => state.setPanelTab);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [featured] = data.trending;

  return (
    <>
      <div className="border-outline-variant flex flex-col gap-3 border-b px-3.5 pt-3.5 pb-3">
        <div
          role="tablist"
          aria-label="Activity view"
          className="bg-surface-container-low grid grid-cols-2 gap-1 rounded-[11px] p-[3px]"
        >
          {PANEL_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
              }}
              className={cn(
                'transition-tone h-8 rounded-lg text-[13px]',
                tab === value
                  ? 'bg-surface-container-highest text-on-surface font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface font-medium',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'chats' && (
          <PresenceLine
            onlineCount={data.onlineCount}
            hasFriends={data.hasFriends}
            action={<AccentLink to="/friends">Invite</AccentLink>}
          />
        )}
      </div>

      <div role="tabpanel" className="flex flex-1 flex-col gap-0.5 p-2">
        {tab === 'chats' ? (
          <>
            {data.chats.length === 0 ? (
              <p className="text-outline px-2 py-2 text-[12.5px]">No conversations yet.</p>
            ) : (
              data.chats.map((row) => <ChatRow key={row.conversation.id} row={row} isRoomy />)
            )}
            {featured !== undefined && (
              <>
                <span aria-hidden className="bg-outline-variant mx-2 my-2.5 h-px" />
                <p className="font-display text-outline mx-2 mb-1 text-[12px] font-bold tracking-[0.06em] uppercase">
                  Trending project
                </p>
                <ProjectRow project={featured} />
              </>
            )}
          </>
        ) : data.trending.length === 0 ? (
          <p className="text-outline px-2 py-2 text-[12.5px]">Nothing trending yet.</p>
        ) : (
          data.trending.map((project, index) => (
            <ProjectRow key={project.id} project={project} rank={index + 1} />
          ))
        )}
      </div>

      <div className="border-outline-variant border-t px-3.5 pt-2.5 pb-3.5">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setIsNewChatOpen(true);
          }}
          className="border-outline-strong text-on-surface/90 hover:bg-surface-container-low transition-tone flex h-10 w-full items-center justify-center gap-2 rounded-[11px] border text-[13.5px] font-medium"
        >
          <SquarePen aria-hidden className="size-4" />
          New message
        </button>
      </div>

      {isNewChatOpen && (
        <NewChatDialog
          isOpen
          onClose={() => {
            setIsNewChatOpen(false);
          }}
        />
      )}
    </>
  );
}
