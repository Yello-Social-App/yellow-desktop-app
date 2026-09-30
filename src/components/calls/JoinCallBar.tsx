import { Phone, Video } from 'lucide-react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { useConversationLiveCall } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';
import { joinedCount, ownState } from '@/features/calls/types';
import { useSocketStatus } from '@/features/messages/hooks';
import { useUsers } from '@/features/users/hooks';

/** At most this many faces in the bar; the count says the rest. */
const FACES_MAX = 4;

/**
 * "Join call · 3 in call", under a chat's header while its conversation has
 * a live call this device is not in: after declining, missing the ring,
 * leaving, being added to the group later — or being in it on another
 * device, when joining here moves the call over. Not drawn while the call
 * rings for the viewer: the incoming-call card has that.
 */
export function JoinCallBar({ conversationId }: { conversationId: string }) {
  const live = useConversationLiveCall(conversationId);
  const viewerId = useCallsStore((state) => state.viewerId);
  const phase = useCallsStore((state) => state.phase);
  const currentId = useCallsStore((state) => state.call?.id);
  const joinCall = useCallsStore((state) => state.joinCall);
  const socket = useSocketStatus();
  const joinedIds =
    live?.participants.filter((p) => p.state === 'JOINED').map((p) => p.userId) ?? [];
  const people = useUsers(joinedIds.slice(0, FACES_MAX));

  if (live === null) {
    return null;
  }
  const own = ownState(live, viewerId);
  if (own === 'INVITED' || (phase !== 'idle' && currentId === live.id)) {
    return null;
  }

  const isVideo = live.media === 'video';
  const inAnother = phase !== 'idle';
  const blocked = inAnother
    ? 'Leave your current call first'
    : socket !== 'connected'
      ? 'Reconnecting…'
      : null;
  const count = joinedCount(live);
  const headline =
    own === 'JOINED'
      ? 'You are in this call on another device'
      : `${isVideo ? 'Video' : 'Voice'} call · ${String(count)} in call`;
  const join = (withCamera: boolean) => () => {
    void joinCall(conversationId, withCamera);
  };

  return (
    <div
      role="region"
      aria-label="Call in progress"
      className="border-outline-variant bg-primary-container/40 gap-md px-lg flex shrink-0 items-center border-b py-2"
    >
      <span className="bg-primary text-on-primary grid size-8 shrink-0 place-items-center rounded-full">
        {isVideo ? <Video className="size-4" /> : <Phone className="size-4" />}
      </span>
      <p
        className="text-on-surface min-w-0 flex-1 truncate text-[13px] font-semibold"
        aria-live="polite"
      >
        {headline}
      </p>
      <div className="flex -space-x-2" aria-hidden>
        {joinedIds.slice(0, FACES_MAX).map((id) => {
          const person = people[id];
          return person === undefined ? null : (
            <UserAvatar key={id} user={person} size="xs" className="ring-surface ring-2" />
          );
        })}
      </div>
      {isVideo && (
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked !== null}
          title={blocked ?? 'Join with your camera off'}
          onClick={join(false)}
        >
          Audio only
        </Button>
      )}
      <Button
        size="sm"
        disabled={blocked !== null}
        title={blocked ?? undefined}
        leadingIcon={isVideo ? <Video className="size-4" /> : <Phone className="size-4" />}
        onClick={join(isVideo)}
      >
        {own === 'JOINED' ? 'Join here' : 'Join'}
      </Button>
    </div>
  );
}
