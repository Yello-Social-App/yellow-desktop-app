import type { Author, CallMedia, ConversationSummary } from '@shared/ipc-types';
import { Phone, Video } from 'lucide-react';

import { IconButton } from '@/components/ui/IconButton';
import { useCallAvailability } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';

interface CallButtonsProps {
  conversation: ConversationSummary;
  peer: Author;
}

/** Voice and video call buttons for a direct conversation's header. */
export function CallButtons({ conversation, peer }: CallButtonsProps) {
  const startCall = useCallsStore((state) => state.startCall);
  const { canCall, reason } = useCallAvailability(conversation);
  const call = (media: CallMedia) => () => {
    void startCall(conversation.id, peer.id, media);
  };

  return (
    <>
      <IconButton
        label={canCall ? 'Voice call' : `Voice call — ${reason ?? ''}`}
        icon={<Phone className="size-5" />}
        disabled={!canCall}
        className="disabled:cursor-not-allowed disabled:opacity-40"
        onClick={call('audio')}
      />
      <IconButton
        label={canCall ? 'Video call' : `Video call — ${reason ?? ''}`}
        icon={<Video className="size-5" />}
        disabled={!canCall}
        className="disabled:cursor-not-allowed disabled:opacity-40"
        onClick={call('video')}
      />
    </>
  );
}
