import { Ban, Check, MessageCircle, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import { UnblockDialog } from '@/components/people/UnblockDialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import type { RelationshipControl } from '@/features/friends/hooks';

interface FriendshipControlsProps {
  control: RelationshipControl;
  /** The other person's display name, for the unblock confirmation. */
  name: string;
  /** Starts a direct conversation; absent where chat is not offered. */
  onMessage?: () => void;
  isMessaging?: boolean;
  /** The block/unblock control; only the profile shows it. */
  showBlock?: boolean;
}

/**
 * The relationship controls on someone else's profile and on people rows.
 *
 * Six states, because the API models the relationship as a request that is
 * sent, then answered, and a block that ends everything: nothing yet, a
 * request you sent (cancel), a request waiting on you (accept / decline), an
 * accepted friendship (unfriend), someone you blocked (unblock), and you.
 * Every button reads from the server's own `friendStatus`.
 */
export function FriendshipControls({
  control,
  name,
  onMessage,
  isMessaging = false,
  showBlock = false,
}: FriendshipControlsProps) {
  const { relationship, isBusy } = control;
  const [isUnblockOpen, setIsUnblockOpen] = useState(false);

  if (relationship === 'self') {
    return null;
  }

  if (relationship === 'blocked') {
    return (
      <>
        <Button
          variant="outline"
          leadingIcon={<Ban className="size-4" />}
          isLoading={isBusy}
          onClick={() => {
            setIsUnblockOpen(true);
          }}
        >
          Unblock
        </Button>
        {isUnblockOpen && (
          <UnblockDialog
            name={name}
            onConfirm={control.unblock}
            onClose={() => {
              setIsUnblockOpen(false);
            }}
          />
        )}
      </>
    );
  }

  const message =
    onMessage === undefined ? null : (
      <Button
        variant="secondary"
        leadingIcon={<MessageCircle className="size-4" />}
        isLoading={isMessaging}
        onClick={onMessage}
      >
        Message
      </Button>
    );

  const block = showBlock ? (
    <IconButton
      label="Block this person"
      tone="danger"
      icon={<Ban className="size-4" />}
      disabled={isBusy}
      onClick={control.block}
    />
  ) : null;

  let primary: React.ReactNode;
  if (relationship === 'friends') {
    primary = (
      <Button
        variant="outline"
        leadingIcon={<UserMinus className="size-4" />}
        isLoading={isBusy}
        onClick={control.unfriend}
        title="Unfriend"
      >
        Friends
      </Button>
    );
  } else if (relationship === 'incoming') {
    primary = (
      <>
        <Button
          leadingIcon={<Check className="size-4" />}
          isLoading={isBusy}
          onClick={control.accept}
        >
          Accept
        </Button>
        <Button
          variant="outline"
          leadingIcon={<X className="size-4" />}
          disabled={isBusy}
          onClick={control.decline}
        >
          Decline
        </Button>
      </>
    );
  } else if (relationship === 'outgoing') {
    primary = (
      <Button
        variant="outline"
        leadingIcon={<UserCheck className="size-4" />}
        isLoading={isBusy}
        onClick={control.cancelRequest}
        title="Cancel the request"
      >
        Requested
      </Button>
    );
  } else {
    primary = (
      <Button
        leadingIcon={<UserPlus className="size-4" />}
        isLoading={isBusy}
        onClick={control.sendRequest}
      >
        Add friend
      </Button>
    );
  }

  return (
    <div className="gap-sm flex flex-wrap items-center">
      {message}
      {primary}
      {block}
    </div>
  );
}
