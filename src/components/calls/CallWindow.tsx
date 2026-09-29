import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { useCallElapsed, useCallPeer } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';
import { formatCallDuration } from '@/features/calls/types';
import { cn } from '@/lib/cn';
import { displayName } from '@/lib/user-display';

import { CallVideo } from './CallVideo';

interface ControlProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Off-state styling for a toggle that is off (muted, camera off). */
  isOff?: boolean;
  isDanger?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
}

function Control({
  label,
  icon,
  onClick,
  isOff = false,
  isDanger = false,
  disabled = false,
  size = 'md',
}: ControlProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'md' ? 'size-12' : 'size-9',
        isDanger
          ? 'bg-red-600 text-white hover:bg-red-500'
          : isOff
            ? 'bg-white text-neutral-900 hover:bg-white/90'
            : 'bg-white/10 text-white hover:bg-white/20',
      )}
    >
      {icon}
    </button>
  );
}

/** "Calling…", "Connecting…", the timer, or what the connection is doing. */
function useStatusLine(): string {
  const phase = useCallsStore((state) => state.phase);
  const call = useCallsStore((state) => state.call);
  const media = useCallsStore((state) => state.media);
  const peer = useCallPeer();
  const elapsed = useCallElapsed(call?.status === 'ACTIVE' ? call.answeredAt : null);
  const name = peer === undefined ? 'them' : displayName(peer);

  if (phase === 'outgoing') {
    return call === null ? 'Calling…' : 'Ringing…';
  }
  if (phase === 'connecting') {
    return 'Connecting…';
  }
  if (media.reconnecting) {
    return 'Reconnecting…';
  }
  if (!media.peerJoined) {
    return `Waiting for ${name}…`;
  }
  return elapsed === null ? 'Connected' : formatCallDuration(elapsed);
}

function CallControls({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const phase = useCallsStore((state) => state.phase);
  const media = useCallsStore((state) => state.media);
  const toggleMicrophone = useCallsStore((state) => state.toggleMicrophone);
  const toggleCamera = useCallsStore((state) => state.toggleCamera);
  const openScreenPicker = useCallsStore((state) => state.openScreenPicker);
  const stopScreenShare = useCallsStore((state) => state.stopScreenShare);
  const hangUp = useCallsStore((state) => state.hangUp);
  const iconSize = size === 'md' ? 'size-5' : 'size-4';
  // Devices are the room's: before it is joined there is nothing to toggle.
  const inRoom = media.isConnected;

  return (
    <div className="flex items-center gap-3">
      <Control
        size={size}
        label={media.micOn ? 'Mute' : 'Unmute'}
        isOff={!media.micOn}
        disabled={!inRoom}
        icon={media.micOn ? <Mic className={iconSize} /> : <MicOff className={iconSize} />}
        onClick={() => {
          void toggleMicrophone();
        }}
      />
      {size === 'md' && (
        <>
          <Control
            label={media.cameraOn ? 'Turn camera off' : 'Turn camera on'}
            isOff={!media.cameraOn}
            disabled={!inRoom}
            icon={
              media.cameraOn ? <Video className={iconSize} /> : <VideoOff className={iconSize} />
            }
            onClick={() => {
              void toggleCamera();
            }}
          />
          <Control
            label={media.screenOn ? 'Stop sharing' : 'Share screen'}
            isOff={media.screenOn}
            disabled={phase !== 'active'}
            icon={
              media.screenOn ? (
                <MonitorX className={iconSize} />
              ) : (
                <MonitorUp className={iconSize} />
              )
            }
            onClick={() => {
              if (media.screenOn) {
                void stopScreenShare();
              } else {
                openScreenPicker();
              }
            }}
          />
        </>
      )}
      <Control
        size={size}
        label={phase === 'outgoing' ? 'Cancel call' : 'Hang up'}
        isDanger
        icon={<PhoneOff className={iconSize} />}
        onClick={hangUp}
      />
    </div>
  );
}

/**
 * The call, full size: the other side's screen or camera filling the stage
 * (their avatar while there is neither), the self view in a corner, and the
 * controls along the bottom. Sits below the title bar so the window can still
 * be moved and closed.
 */
export function CallWindow() {
  const media = useCallsStore((state) => state.media);
  const problem = useCallsStore((state) => state.problem);
  const dismissProblem = useCallsStore((state) => state.dismissProblem);
  const setMinimized = useCallsStore((state) => state.setMinimized);
  const peer = useCallPeer();
  const status = useStatusLine();
  const name = peer === undefined ? 'Call' : displayName(peer);
  const main = media.remoteScreen ?? media.remoteCamera;
  // With a screen on the stage, their camera moves to a corner tile.
  const cornerCamera = media.remoteScreen !== null ? media.remoteCamera : null;

  return (
    <div
      role="dialog"
      aria-label={`Call with ${name}`}
      className="animate-fade-in fixed inset-x-0 top-[var(--spacing-topbar)] bottom-0 z-[60] flex flex-col overflow-hidden bg-neutral-950 text-white"
    >
      <div className="relative min-h-0 flex-1">
        {main !== null ? (
          <CallVideo
            track={main}
            fit={media.remoteScreen !== null ? 'contain' : 'cover'}
            className="absolute inset-0"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {peer !== undefined && <UserAvatar user={peer} size="xl" />}
            <p className="text-[22px] font-bold">{name}</p>
            <p className="text-[14px] text-white/70" aria-live="polite">
              {status}
            </p>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-5 pt-4 pb-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{name}</p>
            <p className="text-[12px] text-white/70 tabular-nums">
              {!media.peerMicOn && media.peerJoined ? `${status} · Muted` : status}
            </p>
          </div>
          <Control
            size="sm"
            label="Minimize call"
            icon={<Minimize2 className="size-4" />}
            onClick={() => {
              setMinimized(true);
            }}
          />
        </div>

        {cornerCamera !== null && (
          <div className="absolute top-20 left-5 aspect-video w-48 overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10">
            <CallVideo track={cornerCamera} />
          </div>
        )}

        {media.localCamera !== null && (
          <div className="absolute right-5 bottom-5 aspect-video w-56 overflow-hidden rounded-2xl bg-neutral-900 shadow-lg ring-1 ring-white/10">
            <CallVideo track={media.localCamera} isMirrored />
          </div>
        )}

        {problem !== null && (
          <div
            role="alert"
            className="absolute top-20 left-1/2 flex max-w-md -translate-x-1/2 items-center gap-2 rounded-full bg-red-600/90 py-1.5 pr-1.5 pl-4 text-[13px] shadow-lg"
          >
            <span className="min-w-0 flex-1">{problem}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismissProblem}
              className="grid size-6 place-items-center rounded-full hover:bg-white/15"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-center py-5">
        <CallControls />
      </div>
    </div>
  );
}

/** The call, out of the way: a floating pill that keeps the call going while you use the app. */
export function CallPill() {
  const setMinimized = useCallsStore((state) => state.setMinimized);
  const peer = useCallPeer();
  const status = useStatusLine();
  const name = peer === undefined ? 'Call' : displayName(peer);

  return (
    <div
      role="region"
      aria-label={`Call with ${name}`}
      className="animate-voice-toast shadow-floating fixed right-4 bottom-4 z-[60] flex items-center gap-3 rounded-full bg-neutral-900 py-2 pr-2 pl-2 text-white ring-1 ring-white/10"
    >
      <button
        type="button"
        onClick={() => {
          setMinimized(false);
        }}
        aria-label="Open call"
        title="Open call"
        className="flex min-w-0 items-center gap-2.5 rounded-full pr-1 text-left"
      >
        {peer !== undefined && <UserAvatar user={peer} size="sm" />}
        <span className="min-w-0">
          <span className="block max-w-36 truncate text-[13px] font-bold">{name}</span>
          <span className="block text-[11px] text-white/70 tabular-nums">{status}</span>
        </span>
        <Maximize2 className="size-4 text-white/70" />
      </button>
      <CallControls size="sm" />
    </div>
  );
}
