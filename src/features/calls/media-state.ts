/**
 * The call's media as the UI draws it, and the words for a device that would
 * not start. Kept apart from call-room.ts so the app can hold and draw this
 * state without loading `livekit-client`, which is fetched on the first join.
 */
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';

export interface CallMediaState {
  /** In the room: its devices can be toggled. */
  isConnected: boolean;
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** This device's camera, for the self view. */
  localCamera: LocalVideoTrack | null;
  remoteCamera: RemoteVideoTrack | null;
  remoteScreen: RemoteVideoTrack | null;
  /** The other side is in the room. */
  peerJoined: boolean;
  peerMicOn: boolean;
  /** LiveKit is re-establishing the connection on its own. */
  reconnecting: boolean;
}

export const IDLE_MEDIA: CallMediaState = {
  isConnected: false,
  micOn: false,
  cameraOn: false,
  screenOn: false,
  localCamera: null,
  remoteCamera: null,
  remoteScreen: null,
  peerJoined: false,
  peerMicOn: false,
  reconnecting: false,
};

/**
 * Why the room closed without being asked to: `removed` — the server closed
 * it (the call ended, or this identity joined elsewhere), nothing to rejoin;
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
