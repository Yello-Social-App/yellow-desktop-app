import type { Author } from '@shared/ipc-types';
import { Ban } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useFriendsStore } from '@/features/friends/store';
import type { DirectBlock } from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';
import { displayName } from '@/lib/user-display';

interface BlockedNoticeProps {
  kind: Exclude<DirectBlock, null>;
  conversationId: string;
  peer: Author;
}

/**
 * What stands where the composer was once a block ends a direct chat — the
 * Messenger arrangement. The transcript stays readable above it; only writing
 * is gone.
 *
 * A block the viewer made is named, with the way out. One made by the other
 * person is not: the service never says who blocked whom, and the wording
 * does not guess.
 */
export function BlockedNotice({ kind, conversationId, peer }: BlockedNoticeProps) {
  const unblock = useFriendsStore((state) => state.unblock);
  const isPending = useFriendsStore((state) => state.pendingIds.has(peer.id));
  const clearRefusal = useMessagesStore((state) => state.clearRefusal);
  const [failed, setFailed] = useState(false);
  const name = displayName(peer);

  if (kind === 'unreachable') {
    return (
      <div
        role="status"
        className="border-outline-variant px-lg flex shrink-0 flex-col items-center gap-1 border-t py-4 text-center"
      >
        <p className="text-on-surface text-[14px] font-semibold">
          You can’t reply to this conversation
        </p>
        <p className="text-on-surface-variant max-w-copy text-[13px]">
          {name} isn’t receiving messages from you right now.
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="border-outline-variant px-lg flex shrink-0 flex-col items-center gap-3 border-t py-4 text-center"
    >
      <div className="flex flex-col items-center gap-1">
        <p className="text-on-surface gap-sm flex items-center text-[14px] font-semibold">
          <Ban aria-hidden className="text-on-surface-variant size-4" />
          You blocked {name}
        </p>
        <p className="text-on-surface-variant max-w-copy text-[13px]">
          You can’t message them in this chat, and you won’t receive their messages.
        </p>
      </div>
      <Button
        variant="secondary"
        className="w-full max-w-[360px]"
        isLoading={isPending}
        onClick={() => {
          setFailed(false);
          void unblock(peer.id).then((done) => {
            if (done) {
              // A send refused while the block stood says nothing about now.
              clearRefusal(conversationId);
            } else {
              setFailed(true);
            }
          });
        }}
      >
        {isPending ? 'Unblocking…' : 'Unblock'}
      </Button>
      {failed && (
        <p role="alert" className="text-error text-[13px]">
          That didn’t go through. Try again.
        </p>
      )}
    </div>
  );
}
