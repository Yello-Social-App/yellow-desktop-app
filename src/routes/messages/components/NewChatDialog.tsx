import { Search, Users } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useFriendList, useFriendsLoader } from '@/features/friends/hooks';
import { useStartConversation } from '@/features/messages/hooks';
import { CHAT_GROUP_TITLE_MAX } from '@shared/ipc-types';
import { cn } from '@/lib/cn';
import { displayName, handleOf } from '@/lib/user-display';

interface NewChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Start a conversation with friends. One person is a direct chat; more than
 * one is a group, which needs a title. Only friends are offered, since only
 * they can be messaged.
 */
export function NewChatDialog({ isOpen, onClose }: NewChatDialogProps) {
  useFriendsLoader();
  const friends = useFriendList('friends');
  const { direct, group, isStarting } = useStartConversation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const titleId = useId();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return friends.entries;
    }
    return friends.entries.filter(
      ({ user }) =>
        user.username.toLowerCase().includes(needle) ||
        (user.fullName ?? '').toLowerCase().includes(needle),
    );
  }, [friends.entries, query]);

  const isGroup = selected.length > 1;
  const canStart = selected.length > 0 && (!isGroup || title.trim() !== '');

  const toggle = (userId: string): void => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const start = (): void => {
    const [only] = selected;
    if (only === undefined) {
      return;
    }
    const started = isGroup ? group(title.trim(), selected) : direct(only);
    void started.then(onClose);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New message"
      description={
        isGroup
          ? 'Two or more people make a group — give it a name.'
          : 'Pick a friend to message, or several to start a group.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={isStarting} disabled={!canStart} onClick={start}>
            {isGroup ? 'Create group' : 'Start chat'}
          </Button>
        </>
      }
    >
      <div className="gap-sm flex flex-col">
        <Input
          type="search"
          aria-label="Search friends"
          placeholder="Search friends"
          value={query}
          leadingIcon={<Search className="size-4" />}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="h-10 rounded-full pl-10 text-[14px]"
        />

        {isGroup && (
          <div>
            <label htmlFor={titleId} className="sr-only">
              Group name
            </label>
            <Input
              id={titleId}
              placeholder="Group name"
              value={title}
              maxLength={CHAT_GROUP_TITLE_MAX}
              leadingIcon={<Users className="size-4" />}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              className="h-10 text-[14px]"
            />
          </div>
        )}

        <ul className="divide-hairline border-outline-variant max-h-72 overflow-y-auto rounded-xl border">
          {friends.status === 'ready' && visible.length === 0 && (
            <li className="text-on-surface-variant px-md py-lg text-center text-[14px]">
              {friends.entries.length === 0
                ? 'Add some friends first — only friends can be messaged.'
                : 'Nobody matches that search.'}
            </li>
          )}
          {visible.map(({ user }) => {
            const isChecked = selected.includes(user.id);
            return (
              <li key={user.id}>
                <label
                  className={cn(
                    'gap-md px-md transition-tone flex cursor-pointer items-center py-2.5',
                    isChecked ? 'bg-primary-fixed/60' : 'hover:bg-surface-container-low',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      toggle(user.id);
                    }}
                    aria-label={displayName(user)}
                    className="border-outline-variant accent-primary-container size-4 cursor-pointer rounded-sm border"
                  />
                  <UserAvatar user={user} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface block truncate text-[14px] font-semibold">
                      {displayName(user)}
                    </span>
                    <span className="text-on-surface-variant block truncate text-[12px]">
                      {handleOf(user)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
