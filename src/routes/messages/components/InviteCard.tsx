import type { GroupInviteCard } from '@shared/ipc-types';
import { Users } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useUsers } from '@/features/users/hooks';
import { displayName } from '@/lib/user-display';

interface InviteCardProps {
  invite: GroupInviteCard;
  viewerId: string | null;
  /** Whether the viewer is already in the group (it is in their list). */
  isMember: boolean;
  onRespond: (inviteId: string, accept: boolean) => Promise<void>;
  onOpen: (conversationId: string) => void;
}

const STATUS_LABELS = {
  PENDING: 'Waiting for an answer',
  ACCEPTED: 'Joined',
  DECLINED: 'Declined',
} as const;

/**
 * An invite to a group, as a line in a DM. Join and Decline are drawn only
 * for the invitee while the invite is pending — the service answers anyone
 * else with a refusal anyway, and re-checks everything (is the inviter still
 * in, is the group full, is anyone blocked) at the moment you join.
 */
export function InviteCard({ invite, viewerId, isMember, onRespond, onOpen }: InviteCardProps) {
  const [answering, setAnswering] = useState<'join' | 'decline' | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const people = useUsers(invite.inviterId === '' ? [] : [invite.inviterId]);
  const inviter = people[invite.inviterId];
  const canAnswer =
    viewerId !== null && viewerId === invite.inviteeId && invite.status === 'PENDING';
  const title = invite.title ?? 'A group';

  const respond = (accept: boolean): void => {
    setAnswering(accept ? 'join' : 'decline');
    void onRespond(invite.id, accept).finally(() => {
      setAnswering(null);
    });
  };

  return (
    <div className="bg-surface-container-lowest border-outline-variant w-72 overflow-hidden rounded-2xl border">
      <div className="gap-md p-md flex items-center">
        {invite.photoUrl !== null && !photoFailed ? (
          <img
            src={invite.photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => {
              setPhotoFailed(true);
            }}
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="bg-primary-fixed text-on-primary-fixed flex size-12 shrink-0 items-center justify-center rounded-full">
            <Users aria-hidden className="size-5" />
          </span>
        )}
        <span className="min-w-0">
          <span className="text-on-surface-variant block text-[12px]">
            {inviter === undefined
              ? 'Group invite'
              : `${displayName(inviter)} invited ${viewerId === invite.inviteeId ? 'you' : 'them'}`}
          </span>
          <span className="text-on-surface block truncate text-[15px] font-bold">{title}</span>
          <span className="text-on-surface-variant block text-[12px]">
            {`${String(invite.memberCount)} ${invite.memberCount === 1 ? 'member' : 'members'}`}
          </span>
        </span>
      </div>

      <div className="border-outline-variant px-md flex items-center justify-end gap-2 border-t py-2">
        {canAnswer ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              isLoading={answering === 'decline'}
              disabled={answering !== null}
              onClick={() => {
                respond(false);
              }}
            >
              Decline
            </Button>
            <Button
              size="sm"
              isLoading={answering === 'join'}
              disabled={answering !== null}
              onClick={() => {
                respond(true);
              }}
            >
              Join
            </Button>
          </>
        ) : isMember ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onOpen(invite.conversationId);
            }}
          >
            Open group
          </Button>
        ) : (
          <span className="text-on-surface-variant text-[13px]">
            {STATUS_LABELS[invite.status]}
          </span>
        )}
      </div>
    </div>
  );
}
