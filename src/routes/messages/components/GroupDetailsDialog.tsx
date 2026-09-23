import { CHAT_GROUP_SIZE_LIMIT, CHAT_GROUP_TITLE_MAX, type Participant } from '@shared/ipc-types';
import { Camera, Crown, LogOut, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useActiveRole, type ConversationRow } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { groupRights } from '@/features/messages/types';
import { useUsers } from '@/features/users/hooks';
import { cn } from '@/lib/cn';
import { displayName, handleOf } from '@/lib/user-display';

import { GroupAvatar } from './GroupAvatar';

interface GroupDetailsDialogProps {
  row: ConversationRow;
  onClose: () => void;
}

const ROLE_ORDER = { OWNER: 0, ADMIN: 1, MEMBER: 2 } as const;

/**
 * Everything about a group: its name and photo, who is in it and in what role,
 * adding or inviting people, and leaving.
 *
 * Controls are drawn by role — admins rename, change the photo and remove
 * members; only the owner promotes, demotes or removes an admin; anyone adds,
 * invites and leaves. That is presentation only: the service enforces the same
 * table and its refusal is what the user sees if the two ever disagree (A01).
 *
 * Adding and inviting are both offered, because they are different social
 * acts: adding puts a friend straight in; an invite sends them a card in your
 * DM that they can decline.
 */
export function GroupDetailsDialog({ row, onClose }: GroupDetailsDialogProps) {
  const { conversation } = row;
  const role = useActiveRole();
  const viewerId = useMessagesStore((state) => state.viewerId);
  const renameGroup = useMessagesStore((state) => state.renameGroup);
  const setGroupPhoto = useMessagesStore((state) => state.setGroupPhoto);
  const removeGroupPhoto = useMessagesStore((state) => state.removeGroupPhoto);
  const removeMember = useMessagesStore((state) => state.removeMember);
  const setRole = useMessagesStore((state) => state.setRole);
  const leave = useMessagesStore((state) => state.leave);
  const error = useMessagesStore((state) => state.error);

  const [title, setTitle] = useState(conversation.title ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
  const titleId = useId();

  const members = useMemo(
    () =>
      [...conversation.participants].sort(
        (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt),
      ),
    [conversation.participants],
  );
  const people = useUsers(members.map((member) => member.userId));
  const canManage = groupRights.canManage(role);
  const trimmedTitle = title.trim();
  const canRename = canManage && trimmedTitle !== '' && trimmedTitle !== (conversation.title ?? '');

  /** Runs one action with its control showing busy; the store reports refusals. */
  const run = async (key: string, action: () => Promise<boolean>): Promise<boolean> => {
    setBusy(key);
    const done = await action();
    setBusy(null);
    return done;
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Group details"
      description={`${String(members.length)} of ${String(CHAT_GROUP_SIZE_LIMIT)} members`}
      size="md"
      footer={
        isConfirmingLeave ? (
          <>
            <span className="text-on-surface-variant mr-auto text-[13px]">
              {role === 'OWNER'
                ? 'Leave? Ownership passes to the longest-standing admin, or member.'
                : 'Leave this group? You will stop receiving its messages.'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setIsConfirmingLeave(false);
              }}
            >
              Stay
            </Button>
            <Button
              variant="danger"
              isLoading={busy === 'leave'}
              onClick={() => {
                void run('leave', () => leave(conversation.id)).then((left) => {
                  if (left) {
                    onClose();
                  }
                });
              }}
            >
              Leave group
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              leadingIcon={<LogOut className="size-4" />}
              onClick={() => {
                setIsConfirmingLeave(true);
              }}
              className="text-error mr-auto"
            >
              Leave group
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </>
        )
      }
    >
      <div className="gap-lg flex flex-col">
        <div className="gap-md flex items-center">
          <GroupAvatar row={row} size="lg" />
          <div className="gap-sm flex min-w-0 flex-1 flex-col">
            {canManage ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canRename) {
                    void run('rename', () => renameGroup(conversation.id, trimmedTitle));
                  }
                }}
              >
                <label htmlFor={titleId} className="sr-only">
                  Group name
                </label>
                <Input
                  id={titleId}
                  value={title}
                  maxLength={CHAT_GROUP_TITLE_MAX}
                  placeholder="Group name"
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  className="h-10 text-[15px]"
                />
                <Button type="submit" size="sm" disabled={!canRename} isLoading={busy === 'rename'}>
                  Save
                </Button>
              </form>
            ) : (
              <p className="text-on-surface truncate text-[17px] font-bold">
                {conversation.title ?? row.title}
              </p>
            )}
            {canManage && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Camera className="size-4" />}
                  isLoading={busy === 'photo'}
                  onClick={() => {
                    void run('photo', () => setGroupPhoto(conversation.id));
                  }}
                >
                  {conversation.photoUrl === null ? 'Add photo' : 'Change photo'}
                </Button>
                {conversation.photoUrl !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    isLoading={busy === 'unphoto'}
                    onClick={() => {
                      void run('unphoto', () => removeGroupPhoto(conversation.id));
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="text-error text-[13px]">
            {error}
          </p>
        )}

        <section className="gap-sm flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
              Members
            </h3>
            {!isAdding && members.length < CHAT_GROUP_SIZE_LIMIT && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<UserPlus className="size-4" />}
                onClick={() => {
                  setIsAdding(true);
                }}
              >
                Add people
              </Button>
            )}
          </div>

          {isAdding && (
            <AddPeople
              conversationId={conversation.id}
              memberIds={members.map((member) => member.userId)}
              room={CHAT_GROUP_SIZE_LIMIT - members.length}
              onDone={() => {
                setIsAdding(false);
              }}
            />
          )}

          <ul className="divide-hairline border-outline-variant max-h-72 overflow-y-auto rounded-xl border">
            {members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isViewer={member.userId === viewerId}
                person={people[member.userId]}
                canRemove={member.userId !== viewerId && groupRights.canRemove(role, member.role)}
                canChangeRole={
                  member.userId !== viewerId &&
                  member.role !== 'OWNER' &&
                  groupRights.canChangeRoles(role)
                }
                busyKey={busy}
                onRemove={() => {
                  void run(`remove:${member.userId}`, () =>
                    removeMember(conversation.id, member.userId),
                  );
                }}
                onToggleAdmin={() => {
                  void run(`role:${member.userId}`, () =>
                    setRole(
                      conversation.id,
                      member.userId,
                      member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                    ),
                  );
                }}
              />
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

interface MemberRowProps {
  member: Participant;
  isViewer: boolean;
  person: ReturnType<typeof useUsers>[string] | undefined;
  canRemove: boolean;
  canChangeRole: boolean;
  busyKey: string | null;
  onRemove: () => void;
  onToggleAdmin: () => void;
}

function MemberRow({
  member,
  isViewer,
  person,
  canRemove,
  canChangeRole,
  busyKey,
  onRemove,
  onToggleAdmin,
}: MemberRowProps) {
  const name = person === undefined ? '…' : displayName(person);
  return (
    <li className="gap-md px-md flex items-center py-2.5">
      {person === undefined ? (
        <span className="bg-surface-container size-8 shrink-0 rounded-full" />
      ) : (
        <UserAvatar user={person} size="sm" />
      )}
      <span className="min-w-0 flex-1">
        <span className="text-on-surface flex items-center gap-1.5 truncate text-[14px] font-semibold">
          {name}
          {isViewer && <span className="text-on-surface-variant font-normal">(you)</span>}
          {member.role === 'OWNER' && (
            <Crown aria-label="Owner" className="text-primary size-3.5 shrink-0" />
          )}
          {member.role === 'ADMIN' && (
            <ShieldCheck aria-label="Admin" className="text-tertiary size-3.5 shrink-0" />
          )}
        </span>
        {person !== undefined && (
          <span className="text-on-surface-variant block truncate text-[12px]">
            {handleOf(person)}
          </span>
        )}
      </span>
      {canChangeRole && (
        <Button
          size="sm"
          variant="ghost"
          isLoading={busyKey === `role:${member.userId}`}
          onClick={onToggleAdmin}
        >
          {member.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}
        </Button>
      )}
      {canRemove && (
        <Button
          size="sm"
          variant="ghost"
          isLoading={busyKey === `remove:${member.userId}`}
          onClick={onRemove}
          className="text-error"
        >
          Remove
        </Button>
      )}
    </li>
  );
}

interface AddPeopleProps {
  conversationId: string;
  memberIds: readonly string[];
  /** Seats left before the group is full. */
  room: number;
  onDone: () => void;
}

/** Friends not yet in the group: add them outright, or send each an invite card. */
function AddPeople({ conversationId, memberIds, room, onDone }: AddPeopleProps) {
  useFriendsLoader();
  const friends = useFriendList('friends');
  const addMembers = useMessagesStore((state) => state.addMembers);
  const invite = useMessagesStore((state) => state.invite);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<'add' | 'invite' | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const candidates = useMemo(() => {
    const inGroup = new Set(memberIds);
    const needle = query.trim().toLowerCase();
    return friends.entries.filter(
      ({ user }) =>
        !inGroup.has(user.id) &&
        (needle === '' ||
          user.username.toLowerCase().includes(needle) ||
          (user.fullName ?? '').toLowerCase().includes(needle)),
    );
  }, [friends.entries, memberIds, query]);

  const toggle = (userId: string): void => {
    setSentCount(null);
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length < room
          ? [...current, userId]
          : current,
    );
  };

  return (
    <div className="bg-surface-container-low gap-sm p-sm flex flex-col rounded-xl">
      <Input
        type="search"
        aria-label="Search friends"
        placeholder="Search friends"
        value={query}
        leadingIcon={<Search className="size-4" />}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        className="h-9 rounded-full pl-10 text-[14px]"
      />
      <ul className="max-h-48 overflow-y-auto">
        {friends.status === 'ready' && candidates.length === 0 && (
          <li className="text-on-surface-variant px-md py-md text-center text-[13px]">
            {friends.entries.length === 0
              ? 'Add some friends first — only friends can be added.'
              : 'Everyone who matches is already here.'}
          </li>
        )}
        {candidates.map(({ user }) => {
          const isChecked = selected.includes(user.id);
          return (
            <li key={user.id}>
              <label
                className={cn(
                  'gap-md px-sm transition-tone flex cursor-pointer items-center rounded-lg py-2',
                  isChecked ? 'bg-primary-fixed/60' : 'hover:bg-surface-container',
                )}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    toggle(user.id);
                  }}
                  aria-label={displayName(user)}
                  className="accent-primary-container size-4 cursor-pointer"
                />
                <UserAvatar user={user} size="xs" />
                <span className="text-on-surface truncate text-[14px]">{displayName(user)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {sentCount !== null && (
        <p role="status" className="text-on-surface-variant text-[13px]">
          {sentCount === 0
            ? 'No invites were sent.'
            : `Sent ${String(sentCount)} ${sentCount === 1 ? 'invite' : 'invites'} in your direct messages.`}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={selected.length === 0 || busy !== null}
          isLoading={busy === 'invite'}
          onClick={() => {
            setBusy('invite');
            void invite(conversationId, selected).then((sent) => {
              setBusy(null);
              setSentCount(sent);
              setSelected([]);
            });
          }}
        >
          Send invites
        </Button>
        <Button
          size="sm"
          disabled={selected.length === 0 || busy !== null}
          isLoading={busy === 'add'}
          onClick={() => {
            setBusy('add');
            void addMembers(conversationId, selected).then((added) => {
              setBusy(null);
              if (added) {
                onDone();
              }
            });
          }}
        >
          Add to group
        </Button>
      </div>
    </div>
  );
}
