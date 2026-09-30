import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type { Author, User } from '@shared/ipc-types';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import type { ReactNode } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCallElapsed, useCallPeer, useCallTitle, useIsGroupCall } from '@/features/calls/hooks';
import { sharedScreenOf } from '@/features/calls/media-state';
import { useCallsStore } from '@/features/calls/store';
import { formatCallDuration, ringingCount } from '@/features/calls/types';
import { useUsers } from '@/features/users/hooks';
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

/** "Calling…", "Connecting…", who is in it, the timer, or what the connection is doing. */
function useStatusLine(): string {
  const phase = useCallsStore((state) => state.phase);
  const call = useCallsStore((state) => state.call);
  const media = useCallsStore((state) => state.media);
  const peer = useCallPeer();
  const isGroup = useIsGroupCall();
  const elapsed = useCallElapsed(call?.status === 'ACTIVE' ? call.answeredAt : null);
  const time = elapsed === null ? null : formatCallDuration(elapsed);

  if (phase === 'outgoing') {
    return call === null ? 'Calling…' : 'Ringing…';
  }
  if (phase === 'connecting') {
    return 'Connecting…';
  }
  if (media.reconnecting) {
    return 'Reconnecting…';
  }
  if (isGroup) {
    if (media.remotes.length === 0) {
      return 'Waiting for others to join…';
    }
    const inCall = `${String(media.remotes.length + 1)} in call`;
    const ringing = call === null ? 0 : ringingCount(call);
    return [inCall, ringing > 0 ? `${String(ringing)} ringing` : null, time]
      .filter((part) => part !== null)
      .join(' · ');
  }
  if (media.remotes.length === 0) {
    return `Waiting for ${peer === undefined ? 'them' : displayName(peer)}…`;
  }
  return time ?? 'Connected';
}

function CallControls({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const phase = useCallsStore((state) => state.phase);
  const media = useCallsStore((state) => state.media);
  const toggleMicrophone = useCallsStore((state) => state.toggleMicrophone);
  const toggleCamera = useCallsStore((state) => state.toggleCamera);
  const openScreenPicker = useCallsStore((state) => state.openScreenPicker);
  const stopScreenShare = useCallsStore((state) => state.stopScreenShare);
  const hangUp = useCallsStore((state) => state.hangUp);
  const isGroup = useIsGroupCall();
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
        label={phase === 'outgoing' ? 'Cancel call' : isGroup ? 'Leave call' : 'Hang up'}
        isDanger
        icon={<PhoneOff className={iconSize} />}
        onClick={hangUp}
      />
    </div>
  );
}

/** Someone in a group call, as a tile: their camera, or their face while it is off. */
function MemberTile({
  person,
  fallbackName,
  track,
  micOn,
  isSpeaking,
  isSelf = false,
}: {
  person: Author | User | undefined;
  fallbackName: string;
  track: LocalVideoTrack | RemoteVideoTrack | null;
  micOn: boolean;
  isSpeaking: boolean;
  isSelf?: boolean;
}) {
  const name = isSelf ? 'You' : person === undefined ? fallbackName : displayName(person);
  return (
    <div
      className={cn(
        'relative grid aspect-video min-h-0 w-full place-items-center overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-white/10 transition-shadow',
        isSpeaking && 'ring-2 ring-emerald-400',
      )}
    >
      {track !== null ? (
        <CallVideo track={track} isMirrored={isSelf} className="absolute inset-0" />
      ) : (
        person !== undefined && <UserAvatar user={person} size="lg" />
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-medium">
        {!micOn && <MicOff className="size-3 shrink-0" aria-label="Muted" />}
        <span className="truncate">{name}</span>
      </span>
    </div>
  );
}

/** Grid columns for this many tiles, so they stay as large as the stage allows. */
function columnsFor(count: number): string {
  if (count <= 1) {
    return 'grid-cols-1';
  }
  if (count <= 4) {
    return 'grid-cols-2';
  }
  if (count <= 9) {
    return 'grid-cols-3';
  }
  return 'grid-cols-4';
}

/**
 * A group call's stage: everyone as tiles, this device first. While someone
 * shares a screen it fills the stage and the tiles move to a strip beside it.
 */
function GroupStage() {
  const media = useCallsStore((state) => state.media);
  const viewer = useCurrentUser();
  const people = useUsers(media.remotes.map((member) => member.identity));
  const shared = sharedScreenOf(media.remotes);

  const tiles = [
    <MemberTile
      key="self"
      person={viewer ?? undefined}
      fallbackName="You"
      track={media.localCamera}
      micOn={media.micOn}
      isSpeaking={false}
      isSelf
    />,
    ...media.remotes.map((member) => (
      <MemberTile
        key={member.identity}
        person={people[member.identity]}
        fallbackName={member.name ?? 'Guest'}
        track={member.camera}
        micOn={member.micOn}
        isSpeaking={member.isSpeaking}
      />
    )),
  ];

  if (shared !== null) {
    const sharer = people[shared.member.identity];
    const sharerName =
      sharer === undefined ? (shared.member.name ?? 'Someone') : displayName(sharer);
    return (
      <div className="absolute inset-0 flex gap-3 px-5 pt-20 pb-5">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-black">
          <CallVideo track={shared.track} fit="contain" className="absolute inset-0" />
          <span className="absolute top-3 left-3 rounded-full bg-black/60 px-3 py-1 text-[12px] font-medium">
            {`${sharerName} is sharing`}
          </span>
        </div>
        <div className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">{tiles}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'absolute inset-0 grid content-center gap-3 overflow-y-auto px-5 pt-20 pb-5',
        columnsFor(tiles.length),
      )}
    >
      {tiles}
    </div>
  );
}

/**
 * A direct call's stage: the other side's screen or camera filling it (their
 * avatar while there is neither), their camera in a corner while they share,
 * and the self view in the other corner.
 */
function DirectStage({ status }: { status: string }) {
  const media = useCallsStore((state) => state.media);
  const peer = useCallPeer();
  const title = useCallTitle();
  const [other] = media.remotes;
  const screen = other?.screen ?? null;
  const main = screen ?? other?.camera ?? null;
  // With a screen on the stage, their camera moves to a corner tile.
  const cornerCamera = screen !== null ? (other?.camera ?? null) : null;

  return (
    <>
      {main !== null ? (
        <CallVideo
          track={main}
          fit={screen !== null ? 'contain' : 'cover'}
          className="absolute inset-0"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          {peer !== undefined && <UserAvatar user={peer} size="xl" />}
          <p className="text-[22px] font-bold">{title}</p>
          <p className="text-[14px] text-white/70" aria-live="polite">
            {status}
          </p>
        </div>
      )}

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
    </>
  );
}

/**
 * The call, full size: the stage — one other person, or a group's tiles —
 * with the controls along the bottom. Sits below the title bar so the window
 * can still be moved and closed.
 */
export function CallWindow() {
  const media = useCallsStore((state) => state.media);
  const problem = useCallsStore((state) => state.problem);
  const dismissProblem = useCallsStore((state) => state.dismissProblem);
  const setMinimized = useCallsStore((state) => state.setMinimized);
  const isGroup = useIsGroupCall();
  const title = useCallTitle();
  const status = useStatusLine();
  const [other] = media.remotes;
  const isOtherMuted = !isGroup && other !== undefined && !other.micOn;

  return (
    <div
      role="dialog"
      aria-label={isGroup ? `Call in ${title}` : `Call with ${title}`}
      className="animate-fade-in fixed inset-x-0 top-[var(--spacing-topbar)] bottom-0 z-[60] flex flex-col overflow-hidden bg-neutral-950 text-white"
    >
      <div className="relative min-h-0 flex-1">
        {isGroup ? <GroupStage /> : <DirectStage status={status} />}

        <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-5 pt-4 pb-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{title}</p>
            <p className="text-[12px] text-white/70 tabular-nums" aria-live="polite">
              {isOtherMuted ? `${status} · Muted` : status}
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

        {problem !== null && (
          <div
            role="alert"
            className="absolute top-20 left-1/2 z-10 flex max-w-md -translate-x-1/2 items-center gap-2 rounded-full bg-red-600/90 py-1.5 pr-1.5 pl-4 text-[13px] shadow-lg"
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
  const isGroup = useIsGroupCall();
  const title = useCallTitle();
  const status = useStatusLine();

  return (
    <div
      role="region"
      aria-label={isGroup ? `Call in ${title}` : `Call with ${title}`}
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
        {isGroup ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10">
            <Users className="size-4" />
          </span>
        ) : (
          peer !== undefined && <UserAvatar user={peer} size="sm" />
        )}
        <span className="min-w-0">
          <span className="block max-w-36 truncate text-[13px] font-bold">{title}</span>
          <span className="block max-w-44 truncate text-[11px] text-white/70 tabular-nums">
            {status}
          </span>
        </span>
        <Maximize2 className="size-4 text-white/70" />
      </button>
      <CallControls size="sm" />
    </div>
  );
}
