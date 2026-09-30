/**
 * One call's media: a Facade over `livekit-client`, so the rest of the app
 * sees a handful of methods and one plain snapshot instead of LiveKit's room,
 * participants, publications and event names.
 *
 * The room holds two people in a direct call and up to the group limit (16)
 * in a group one, so the snapshot lists every remote member with their
 * camera, screen, mic and whether they are speaking. It is recomputed from
 * the room on every event that could change it, which keeps it honest
 * without bookkeeping of its own.
 *
 * Remote audio — microphones and shared-screen sound alike — plays through
 * `<audio>` elements this class owns: nothing on screen needs to know about
 * them. What the service's token allows — camera, microphone, screen share
 * and its audio, no data channel — is all this uses.
 *
 * A shared screen is captured and sent for motion at 1080p60: VP9 in three
 * spatial and three temporal layers (1080p/540p/270p × 60/30/15 fps) so each
 * viewer gets the best their link carries, with VP8 as a backup for anyone
 * who cannot decode VP9. The yello-chat group-calls note sets these numbers.
 *
 * The join token passes through `connect` and is not kept (A04).
 */
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteVideoTrack,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from 'livekit-client';

import { createLogger } from '@/lib/logger';

import {
  captureErrorMessage,
  type CallMediaState,
  type RemoteMember,
  type RoomLoss,
} from './media-state';

const log = createLogger('calls.room');

/** How a shared screen is captured: full HD, 60 fps, tuned for motion. */
const SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  resolution: { width: 1920, height: 1080, frameRate: 60 },
  contentHint: 'motion',
  systemAudio: 'include',
  surfaceSwitching: 'include',
  selfBrowserSurface: 'exclude',
};

/** How it is sent: about 5 Mbps up, keeping the frame rate over the resolution. */
const SCREEN_PUBLISH: TrackPublishOptions = {
  videoCodec: 'vp9',
  scalabilityMode: 'L3T3_KEY',
  backupCodec: { codec: 'vp8' },
  screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 60, priority: 'high' },
  degradationPreference: 'maintain-framerate',
};

const REMOVED_REASONS: ReadonlySet<DisconnectReason> = new Set([
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.DUPLICATE_IDENTITY,
]);

function memberOf(participant: RemoteParticipant): RemoteMember {
  const video = (source: Track.Source): RemoteVideoTrack | null => {
    const publication = participant.getTrackPublication(source);
    if (publication === undefined || publication.isMuted || !publication.isSubscribed) {
      return null;
    }
    return (publication.videoTrack as RemoteVideoTrack | undefined) ?? null;
  };
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  return {
    identity: participant.identity,
    name: participant.name === undefined || participant.name === '' ? null : participant.name,
    camera: video(Track.Source.Camera),
    screen: video(Track.Source.ScreenShare),
    micOn: mic !== undefined && !mic.isMuted,
    isSpeaking: participant.isSpeaking,
  };
}

export class CallRoom {
  private readonly room = new Room({ adaptiveStream: true, dynacast: true });
  private readonly audioElements = new Map<string, HTMLMediaElement>();
  private isLeaving = false;
  private isReconnecting = false;

  constructor(
    private readonly onChange: (state: CallMediaState) => void,
    private readonly onLoss: (why: RoomLoss) => void,
  ) {
    const changed = (): void => {
      this.onChange(this.snapshot());
    };
    this.room
      .on(RoomEvent.TrackSubscribed, (track) => {
        this.attachAudio(track);
        changed();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.detachAudio(track);
        changed();
      })
      .on(RoomEvent.TrackMuted, changed)
      .on(RoomEvent.TrackUnmuted, changed)
      .on(RoomEvent.LocalTrackPublished, changed)
      .on(RoomEvent.LocalTrackUnpublished, changed)
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.ActiveSpeakersChanged, changed)
      .on(RoomEvent.Reconnecting, () => {
        this.isReconnecting = true;
        changed();
      })
      .on(RoomEvent.Reconnected, () => {
        this.isReconnecting = false;
        changed();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        this.detachAllAudio();
        if (this.isLeaving) {
          return;
        }
        const why: RoomLoss =
          reason !== undefined && REMOVED_REASONS.has(reason) ? 'removed' : 'lost';
        log.info('call_room_lost', { why });
        this.onLoss(why);
      });
  }

  /**
   * Joins the room and turns the microphone on (and the camera, if asked).
   * Joining failing throws; a device failing does not — the call goes on
   * without it, and the device's error is returned for the UI to show.
   */
  async connect(
    serverUrl: string,
    token: string,
    options: { camera: boolean },
  ): Promise<string | null> {
    await this.room.connect(serverUrl, token);
    log.info('call_room_joined', {});
    let problem: string | null = null;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true);
    } catch (error) {
      log.warn('call_mic_failed', { error });
      problem = captureErrorMessage(error, 'microphone');
    }
    if (options.camera) {
      try {
        await this.room.localParticipant.setCameraEnabled(true);
      } catch (error) {
        log.warn('call_camera_failed', { error });
        problem ??= captureErrorMessage(error, 'camera');
      }
    }
    this.onChange(this.snapshot());
    return problem;
  }

  async setMicrophone(on: boolean): Promise<void> {
    try {
      await this.room.localParticipant.setMicrophoneEnabled(on);
    } finally {
      this.onChange(this.snapshot());
    }
  }

  async setCamera(on: boolean): Promise<void> {
    try {
      await this.room.localParticipant.setCameraEnabled(on);
    } finally {
      this.onChange(this.snapshot());
    }
  }

  /**
   * The source was already picked in the main process; this only asks for it.
   * `withAudio` asks for the computer's sound too, which the main process
   * grants only where it can capture it and the user turned it on.
   */
  async setScreenShare(on: boolean, withAudio = false): Promise<void> {
    try {
      if (on) {
        await this.room.localParticipant.setScreenShareEnabled(
          true,
          { ...SCREEN_CAPTURE, audio: withAudio },
          SCREEN_PUBLISH,
        );
      } else {
        await this.room.localParticipant.setScreenShareEnabled(false);
      }
    } finally {
      this.onChange(this.snapshot());
    }
  }

  /** Leaves on purpose: no loss is reported, and every device is let go. */
  async leave(): Promise<void> {
    this.isLeaving = true;
    this.detachAllAudio();
    try {
      await this.room.disconnect();
    } catch (error) {
      log.warn('call_room_leave_failed', { error });
    }
  }

  private snapshot(): CallMediaState {
    const local = this.room.localParticipant;
    const camera = local.getTrackPublication(Track.Source.Camera);
    return {
      isConnected: this.room.state !== ConnectionState.Disconnected,
      micOn: local.isMicrophoneEnabled,
      cameraOn: local.isCameraEnabled,
      screenOn: local.isScreenShareEnabled,
      localCamera: camera !== undefined && !camera.isMuted ? (camera.videoTrack ?? null) : null,
      remotes: [...this.room.remoteParticipants.values()].map(memberOf),
      reconnecting: this.isReconnecting,
    };
  }

  private attachAudio(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio || track.sid === undefined) {
      return;
    }
    const element = track.attach();
    element.hidden = true;
    document.body.appendChild(element);
    this.audioElements.set(track.sid, element);
  }

  private detachAudio(track: RemoteTrack): void {
    if (track.sid === undefined) {
      return;
    }
    const element = this.audioElements.get(track.sid);
    if (element !== undefined) {
      track.detach(element);
      element.remove();
      this.audioElements.delete(track.sid);
    }
  }

  private detachAllAudio(): void {
    for (const element of this.audioElements.values()) {
      element.srcObject = null;
      element.remove();
    }
    this.audioElements.clear();
  }
}
