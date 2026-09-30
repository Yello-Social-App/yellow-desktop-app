/**
 * The call's media as the UI draws it, and the words for a device that would
 * not start. Kept apart from call-room.ts so the app can hold and draw this
 * state without loading `livekit-client`, which is fetched on the first join.
 */
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';

/** Someone else connected to the call's media right now, as a tile draws them. */
export interface RemoteMember {
  /** The LiveKit identity, which is the member's user id. */
  identity: string;
  /** The name in their join token, for someone the app cannot resolve. */
  name: string | null;
  camera: RemoteVideoTrack | null;
  screen: RemoteVideoTrack | null;
  micOn: boolean;
  isSpeaking: boolean;
}

export interface CallMediaState {
  /** In the room: its devices can be toggled. */
  isConnected: boolean;
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** This device's camera, for the self view. */
  localCamera: LocalVideoTrack | null;
  /** Everyone else in the room, in the order they joined it. */
  remotes: readonly RemoteMember[];
  /** LiveKit is re-establishing the connection on its own. */
  reconnecting: boolean;
}

export const IDLE_MEDIA: CallMediaState = {
  isConnected: false,
  micOn: false,
  cameraOn: false,
  screenOn: false,
  localCamera: null,
  remotes: [],
  reconnecting: false,
};

/** The one screen drawn large: the first member sharing, while anyone is. */
export function sharedScreenOf(
  remotes: readonly RemoteMember[],
): { member: RemoteMember; track: RemoteVideoTrack } | null {
  for (const member of remotes) {
    if (member.screen !== null) {
      return { member, track: member.screen };
    }
  }
  return null;
}

/**
 * Why the room closed without being asked to: `removed` — the server closed
 * it (the call ended, this identity joined elsewhere, or it was taken out of
 * the group), nothing to rejoin;
 * `lost` — the connection gave up, and a fresh token may bring it back.
 */
export type RoomLoss = 'removed' | 'lost';

export type CaptureDevice = 'microphone' | 'camera' | 'screen';

/** What went wrong with a capture device, in words for the person using it. */
export function captureErrorMessage(error: unknown, device: CaptureDevice): string {
  const word = device;
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return device === 'screen'
      ? 'Screen sharing was not allowed.'
      : `Yello is not allowed to use your ${word}. Check your system privacy settings.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${word} was found.`;
  }
  if (name === 'NotReadableError') {
    return `Your ${word} is in use by another app.`;
  }
  return `Your ${word} could not be started.`;
}
