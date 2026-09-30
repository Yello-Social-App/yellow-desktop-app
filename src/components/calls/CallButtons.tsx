import type { Author, CallMedia, ConversationSummary } from '@shared/ipc-types';
import { Phone, Video } from 'lucide-react';

import { IconButton } from '@/components/ui/IconButton';
import { useCallAvailability } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';

interface CallButtonsProps {
  conversation: ConversationSummary;
  /** The other person in a direct chat; null in a group. */
  peer: Author | null;
}

/**
 * Voice and video call buttons for a conversation's header. In a group with
 * a call already going on they join it instead — the service allows one call
 * per conversation.
 */
export function CallButtons({ conversation, peer }: CallButtonsProps) {
  const startCall = useCallsStore((state) => state.startCall);
  const joinCall = useCallsStore((state) => state.joinCall);
  const { canCall, reason, isLive } = useCallAvailability(conversation);
  const press = (media: CallMedia) => () => {
    if (isLive) {
      void joinCall(conversation.id, media === 'video');
    } else {
      void startCall(conversation.id, peer?.id ?? null, media);
    }
  };
  const voice = isLive ? 'Join call' : 'Voice call';
  const video = isLive ? 'Join call with video' : 'Video call';

  return (
    <>
      <IconButton
        label={canCall ? voice : `${voice} — ${reason ?? ''}`}
        icon={<Phone className="size-5" />}
        disabled={!canCall}
        className="disabled:cursor-not-allowed disabled:opacity-40"
        onClick={press('audio')}
      />
      <IconButton
        label={canCall ? video : `${video} — ${reason ?? ''}`}
        icon={<Video className="size-5" />}
        disabled={!canCall}
        className="disabled:cursor-not-allowed disabled:opacity-40"
        onClick={press('video')}
      />
    </>
  );
}
