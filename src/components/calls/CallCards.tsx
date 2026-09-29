import { Phone, PhoneOff, Video } from 'lucide-react';
import type { ReactNode } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { useCallPeer } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';
import { cn } from '@/lib/cn';
import { displayName } from '@/lib/user-display';

interface RoundActionProps {
  label: string;
  icon: ReactNode;
  tone: 'accept' | 'decline';
  onClick: () => void;
}

/** The big round answer/decline buttons of a ringing phone. */
export function RoundAction({ label, icon, tone, onClick }: RoundActionProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cn(
          'shadow-floating grid size-12 place-items-center rounded-full text-white transition-transform hover:scale-105 active:scale-95',
          tone === 'accept' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500',
        )}
      >
        {icon}
      </button>
      <span className="text-on-surface-variant text-[11px] font-medium">{label}</span>
    </div>
  );
}

function CardShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="alertdialog"
      aria-label={label}
      className="bg-surface-container-lowest border-outline-variant shadow-floating animate-voice-toast fixed top-[calc(var(--spacing-topbar)+12px)] right-4 z-[60] flex w-80 flex-col items-center gap-4 rounded-3xl border px-6 pt-6 pb-5"
    >
      {children}
    </div>
  );
}

/** Someone is calling: who, audio or video, and answer or decline. */
export function IncomingCall() {
  const call = useCallsStore((state) => state.call);
  const accept = useCallsStore((state) => state.accept);
  const decline = useCallsStore((state) => state.decline);
  const peer = useCallPeer();
  if (call === null) {
    return null;
  }
  const name = peer === undefined ? 'Someone' : displayName(peer);
  const isVideo = call.media === 'video';
  const kind = isVideo ? 'video' : 'voice';

  return (
    <CardShell label={`Incoming ${kind} call from ${name}`}>
      <div className="relative grid place-items-center">
        <span
          aria-hidden
          className="border-primary animate-voice-ripple pointer-events-none absolute inset-0 rounded-full border-2"
        />
        <span
          aria-hidden
          className="border-primary animate-voice-ripple pointer-events-none absolute inset-0 rounded-full border-2 [animation-delay:1000ms]"
        />
        {peer !== undefined && <UserAvatar user={peer} size="lg" />}
      </div>
      <div className="text-center">
        <p className="text-on-surface truncate text-[16px] font-bold">{name}</p>
        <p className="text-on-surface-variant text-[13px]" aria-live="polite">
          {`Incoming ${kind} call…`}
        </p>
      </div>
      <div className="flex items-start justify-center gap-6">
        <RoundAction
          label="Decline"
          tone="decline"
          icon={<PhoneOff className="size-5" />}
          onClick={decline}
        />
        {isVideo && (
          <RoundAction
            label="Audio only"
            tone="accept"
            icon={<Phone className="size-5" />}
            onClick={() => {
              void accept(false);
            }}
          />
        )}
        <RoundAction
          label={isVideo ? 'Video' : 'Answer'}
          tone="accept"
          icon={isVideo ? <Video className="size-5" /> : <Phone className="size-5" />}
          onClick={() => {
            void accept(isVideo);
          }}
        />
      </div>
    </CardShell>
  );
}

/** A call is still live that this device is not in — after a restart, say. */
export function RejoinCall() {
  const rejoin = useCallsStore((state) => state.rejoin);
  const hangUp = useCallsStore((state) => state.hangUp);
  const peer = useCallPeer();
  const name = peer === undefined ? 'your contact' : displayName(peer);

  return (
    <CardShell label={`Call with ${name} is still going`}>
      {peer !== undefined && <UserAvatar user={peer} size="lg" />}
      <div className="text-center">
        <p className="text-on-surface text-[16px] font-bold">Call in progress</p>
        <p className="text-on-surface-variant text-[13px]">{`Your call with ${name} is still going.`}</p>
      </div>
      <div className="flex items-start justify-center gap-6">
        <RoundAction
          label="End"
          tone="decline"
          icon={<PhoneOff className="size-5" />}
          onClick={hangUp}
        />
        <RoundAction
          label="Rejoin"
          tone="accept"
          icon={<Phone className="size-5" />}
          onClick={() => {
            void rejoin();
          }}
        />
      </div>
    </CardShell>
  );
}
