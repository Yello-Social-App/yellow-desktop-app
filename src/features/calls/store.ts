/**
 * The one call this device can be in, from first ring to hang-up.
 *
 * Three inputs move it: what the user presses (call, answer, decline, hang
 * up), what the service pushes over the chat socket (`call.ringing`,
 * `call.accepted`, `call.ended`), and what `GET /ws/calls/active` says after
 * every (re)connect. The service is the authority on the call's state; this
 * store is the authority on what this device is doing about it — ringing,
 * joining the media room, in it — which the service cannot know.
 *
 * Every frame is matched on the call's id (CALLS-API.md: dedupe on id and
 * status), and anything asynchronous checks a generation counter when it
 * resumes: a hang-up, or a newer call, bumps it, so an answer that lands late
 * cannot resurrect a call the user already left.
 *
 * Shape: a zustand store like the app's others, with a phase field rather
 * than a State pattern. The phases differ in which of a few actions are legal
 * and what is drawn, which a `phase` read at each entry point covers; the
 * LiveKit side lives behind the CallRoom facade and is kept out of state,
 * since only its snapshot is drawn.
 */
import type { Call, CallMedia, ChatEvent } from '@shared/ipc-types';
import { create } from 'zustand';

import { fetchConversation } from '@/features/messages/api';
import { useMessagesStore } from '@/features/messages/store';
import { peerIdsOf } from '@/features/messages/types';
import { useUsersStore } from '@/features/users/store';
import { onChatEvent } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';
import { displayName } from '@/lib/user-display';

import {
  acceptCall,
  chooseScreenSource,
  declineCall,
  endCall,
  fetchActiveCall,
  fetchCallJoin,
  startCall,
} from './api';
import type { CallRoom } from './call-room';
import { IDLE_MEDIA, captureErrorMessage, type CallMediaState, type RoomLoss } from './media-state';
import { startRinging, stopRinging } from './ringtone';
import { callErrorMessage, endedCopy, isCaller, type CallNotice, type CallPhase } from './types';

const log = createLogger('calls.store');

/** A dropped connection is retried with a fresh token this many times in a row. */
const MAX_REJOINS = 2;
/** Ids of calls this device already closed: late frames about them are ignored. */
const CLOSED_MAX = 20;

interface CallsState {
  viewerId: string | null;
  phase: CallPhase;
  /** Null only while a `call.start` is in flight. */
  call: Call | null;
  /** The other person. */
  peerId: string | null;
  media: CallMediaState;
  isMinimized: boolean;
  isScreenPickerOpen: boolean;
  /** A device or connection problem while the call goes on. */
  problem: string | null;
  /** The line shown after a call closes. */
  notice: CallNotice | null;

  /** Attaches to the chat frames and recovers any live call. Returns the detach. */
  subscribe: (viewerId: string) => () => void;
  startCall: (conversationId: string, peerId: string, media: CallMedia) => Promise<void>;
  accept: (withCamera: boolean) => Promise<void>;
  decline: () => void;
  hangUp: () => void;
  /** From `rejoin`: back into a call that is still live. */
  rejoin: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  openScreenPicker: () => void;
  closeScreenPicker: () => void;
  shareScreen: (sourceId: string) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setMinimized: (isMinimized: boolean) => void;
  dismissProblem: () => void;
  dismissNotice: () => void;
}

export const useCallsStore = create<CallsState>((set, get) => {
  let room: CallRoom | null = null;
  /** A join in flight, so a second trigger does not start another. */
  let isJoining = false;
  /** This device sent `call.accept` (or rejoined): `call.accepted` is ours, not another device's. */
  let answeredHere = false;
  let rejoins = 0;
  let generation = 0;
  let noticeId = 0;
  const closed: string[] = [];

  function remember(callId: string): void {
    if (!closed.includes(callId)) {
      closed.push(callId);
    }
    while (closed.length > CLOSED_MAX) {
      closed.shift();
    }
  }

  function notice(text: string, tone: CallNotice['tone'] = 'neutral'): CallNotice {
    noticeId += 1;
    return { id: noticeId, text, tone };
  }

  function peerName(): string {
    const { peerId } = get();
    const person = peerId === null ? undefined : useUsersStore.getState().byId[peerId];
    return person === undefined ? 'They' : displayName(person);
  }

  function endedNotice(call: Call, reason: string): CallNotice {
    const text = endedCopy(reason, isCaller(call, get().viewerId), peerName());
    return notice(text, reason === 'FAILED' ? 'error' : 'neutral');
  }

  /** Closes everything this device has open for the call, and shows `after`. */
  function teardown(after: CallNotice | null): void {
    generation += 1;
    stopRinging();
    const leaving = room;
    room = null;
    isJoining = false;
    answeredHere = false;
    rejoins = 0;
    if (leaving !== null) {
      void leaving.leave();
    }
    const { call } = get();
    if (call !== null) {
      remember(call.id);
    }
    set({
      phase: 'idle',
      call: null,
      peerId: null,
      media: IDLE_MEDIA,
      isMinimized: false,
      isScreenPickerOpen: false,
      problem: null,
      notice: after,
    });
  }

  /** The other member of the call's conversation, when this side is the caller. */
  async function resolvePeerId(call: Call, viewerId: string): Promise<string | null> {
    if (call.initiatorId !== viewerId) {
      return call.initiatorId;
    }
    const known = useMessagesStore
      .getState()
      .conversations.find((conversation) => conversation.id === call.conversationId);
    if (known !== undefined) {
      return peerIdsOf(known, viewerId)[0] ?? null;
    }
    const fetched = await fetchConversation(call.conversationId);
    return fetched.ok ? (peerIdsOf(fetched.data, viewerId)[0] ?? null) : null;
  }

  /**
   * Fetches a join and connects the media room. A failure while the call
   * still only rings (the caller joining early) is left for `call.accepted`
   * to retry; a failure once it is answered ends this device's part in it.
   *
   * `livekit-client` is loaded here, on the first join, rather than with the
   * app: most sessions never make a call.
   */
  async function joinMedia(gen: number, call: Call, camera: boolean): Promise<void> {
    if (isJoining || room !== null) {
      return;
    }
    isJoining = true;
    const failed = (text: string): void => {
      if (gen !== generation) {
        return;
      }
      isJoining = false;
      if (get().call?.status !== 'RINGING') {
        endCall(call.id);
        teardown(notice(text, 'error'));
      }
    };

    const [join, loaded] = await Promise.all([
      fetchCallJoin(call.id),
      import('./call-room').catch((error: unknown) => {
        log.error('call_room_load_failed', { error });
        return null;
      }),
    ]);
    if (gen !== generation) {
      return;
    }
    if (!join.ok) {
      log.warn('call_join_failed', { code: join.error.apiCode ?? join.error.code });
      failed(callErrorMessage(join.error));
      return;
    }
    if (loaded === null) {
      failed('Calls could not be started. Restart Yello and try again.');
      return;
    }

    const joining: CallRoom = new loaded.CallRoom(
      (media) => {
        if (room === joining) {
          set({ media });
        }
      },
      (why) => {
        if (room === joining) {
          onRoomLost(why);
        }
      },
    );
    room = joining;
    try {
      const problem = await joining.connect(join.data.serverUrl, join.data.token, { camera });
      if (gen !== generation || room !== joining) {
        await joining.leave();
        return;
      }
      isJoining = false;
      rejoins = 0;
      set({ problem });
      if (get().call?.status === 'ACTIVE') {
        set({ phase: 'active' });
      }
    } catch (error) {
      log.warn('call_connect_failed', { error });
      if (room === joining) {
        room = null;
      }
      failed('Could not connect to the call.');
    }
  }

  /** The room closed without this device asking. */
  function onRoomLost(why: RoomLoss): void {
    const { call } = get();
    room = null;
    if (call === null) {
      return;
    }
    if (why === 'removed' || rejoins >= MAX_REJOINS) {
      // The room is gone with the call — `call.ended` says why, if it is still
      // coming — or this account joined it somewhere else.
      if (why === 'lost') {
        endCall(call.id);
      }
      teardown(notice(why === 'lost' ? 'Connection lost — call ended.' : 'Call ended'));
      return;
    }
    rejoins += 1;
    log.info('call_rejoining', { attempt: rejoins });
    const { cameraOn } = get().media;
    if (call.status === 'ACTIVE') {
      set({ phase: 'connecting', media: IDLE_MEDIA });
    }
    void joinMedia(generation, call, cameraOn);
  }

  /** `call.accepted`, or recovery finding the call answered. */
  function onAccepted(call: Call): void {
    const { viewerId } = get();
    if (isCaller(call, viewerId)) {
      stopRinging();
      set({ call, phase: room !== null && !isJoining ? 'active' : 'connecting' });
      void joinMedia(generation, call, call.media === 'video');
      return;
    }
    if (answeredHere) {
      set({ call });
      return;
    }
    // Answered on another of this user's devices.
    teardown(notice('Answered on another device'));
  }

  function handleEvent(event: ChatEvent): void {
    switch (event.event) {
      case 'call.ringing': {
        const { call } = event.data;
        const { phase, viewerId } = get();
        if (phase !== 'idle' || isCaller(call, viewerId) || closed.includes(call.id)) {
          return;
        }
        set({
          phase: 'incoming',
          call,
          peerId: call.initiatorId,
          notice: null,
          problem: null,
        });
        void useUsersStore.getState().resolve([call.initiatorId]);
        startRinging('incoming');
        return;
      }
      case 'call.accepted':
        if (get().call?.id === event.data.call.id) {
          onAccepted(event.data.call);
        }
        return;
      case 'call.ended': {
        const { call } = get();
        if (call?.id === event.data.call.id) {
          teardown(endedNotice(call, event.data.reason));
        }
        remember(event.data.call.id);
        return;
      }
      default:
        return;
    }
  }

  /**
   * CALLS-API.md § Recovery: after every connect, ask the service what is
   * live, and make this device agree — close what ended while it was away,
   * ring again, or offer to rejoin an answered call.
   */
  async function recover(): Promise<void> {
    const viewerId = get().viewerId;
    const gen = generation;
    const result = await fetchActiveCall();
    if (!result.ok || gen !== generation || viewerId !== get().viewerId || viewerId === null) {
      return;
    }
    const active = result.data;
    const { call, phase } = get();

    if (active === null) {
      if (call !== null) {
        teardown(notice('Call ended'));
      }
      return;
    }
    if (call?.id === active.id) {
      if (active.status === 'ACTIVE' && call.status === 'RINGING') {
        onAccepted(active);
      }
      return;
    }
    if (closed.includes(active.id)) {
      // Hung up here while the socket was down: say so now.
      endCall(active.id);
      return;
    }
    if (phase !== 'idle') {
      if (call === null) {
        // A start in flight: its own answer settles it.
        return;
      }
      // This device shows a call the service has moved on from.
      teardown(null);
    }

    const settled = generation;
    const peerId = await resolvePeerId(active, viewerId);
    if (generation !== settled || get().phase !== 'idle') {
      return;
    }
    if (peerId !== null) {
      void useUsersStore.getState().resolve([peerId]);
    }
    const base = { call: active, peerId, notice: null };
    if (active.status === 'ACTIVE') {
      set({ ...base, phase: 'rejoin' });
    } else if (isCaller(active, viewerId)) {
      set({ ...base, phase: 'outgoing' });
      startRinging('ringback');
      void joinMedia(generation, active, active.media === 'video');
    } else {
      set({ ...base, phase: 'incoming' });
      startRinging('incoming');
    }
  }

  return {
    viewerId: null,
    phase: 'idle',
    call: null,
    peerId: null,
    media: IDLE_MEDIA,
    isMinimized: false,
    isScreenPickerOpen: false,
    problem: null,
    notice: null,

    subscribe: (viewerId) => {
      set({ viewerId });
      let wasConnected = useMessagesStore.getState().socket.status === 'connected';
      const detach = onChatEvent((event) => {
        if (event.event === 'socket') {
          const isConnected = event.data.status === 'connected';
          if (isConnected && !wasConnected) {
            void recover();
          }
          wasConnected = isConnected;
          return;
        }
        handleEvent(event);
      });
      void recover();
      return () => {
        detach();
        // The session is ending; the main process hangs up what this device held.
        teardown(null);
        set({ viewerId: null, notice: null });
      };
    },

    startCall: async (conversationId, peerId, media) => {
      if (get().phase !== 'idle') {
        return;
      }
      generation += 1;
      const gen = generation;
      answeredHere = false;
      set({
        phase: 'outgoing',
        call: null,
        peerId,
        isMinimized: false,
        problem: null,
        notice: null,
      });

      const result = await startCall(conversationId, media);
      if (gen !== generation) {
        // Cancelled while it was being placed.
        if (result.ok && result.data.status !== 'ENDED') {
          endCall(result.data.id);
          remember(result.data.id);
        }
        return;
      }
      if (!result.ok) {
        teardown(notice(callErrorMessage(result.error), 'error'));
        return;
      }
      const call = result.data;
      if (call.status === 'ENDED') {
        set({ call });
        teardown(endedNotice(call, call.endReason ?? 'HANGUP'));
        return;
      }
      set({ call });
      if (call.status === 'ACTIVE') {
        onAccepted(call);
        return;
      }
      startRinging('ringback');
      // Joining early: the self view is up while it rings, and media flows the
      // moment the other side answers.
      void joinMedia(gen, call, media === 'video');
    },

    accept: async (withCamera) => {
      const { call, phase } = get();
      if (phase !== 'incoming' || call === null) {
        return;
      }
      const gen = generation;
      answeredHere = true;
      stopRinging();
      set({ phase: 'connecting' });
      const result = await acceptCall(call.id);
      if (gen !== generation) {
        return;
      }
      if (!result.ok) {
        teardown(notice(callErrorMessage(result.error), 'error'));
        return;
      }
      if (result.data.status === 'ENDED') {
        teardown(endedNotice(result.data, result.data.endReason ?? 'HANGUP'));
        return;
      }
      set({ call: result.data });
      await joinMedia(gen, result.data, withCamera);
    },

    decline: () => {
      const { call, phase } = get();
      if (phase !== 'incoming' || call === null) {
        return;
      }
      declineCall(call.id);
      teardown(null);
    },

    hangUp: () => {
      const { call, phase } = get();
      if (phase === 'idle') {
        return;
      }
      if (call !== null) {
        endCall(call.id);
      }
      teardown(phase === 'active' ? notice('Call ended') : null);
    },

    rejoin: async () => {
      const { call, phase } = get();
      if (phase !== 'rejoin' || call === null) {
        return;
      }
      answeredHere = true;
      set({ phase: 'connecting' });
      await joinMedia(generation, call, call.media === 'video');
    },

    toggleMicrophone: async () => {
      if (room === null) {
        return;
      }
      try {
        await room.setMicrophone(!get().media.micOn);
      } catch (error) {
        set({ problem: captureErrorMessage(error, 'microphone') });
      }
    },

    toggleCamera: async () => {
      if (room === null) {
        return;
      }
      try {
        await room.setCamera(!get().media.cameraOn);
      } catch (error) {
        set({ problem: captureErrorMessage(error, 'camera') });
      }
    },

    openScreenPicker: () => {
      if (room !== null) {
        set({ isScreenPickerOpen: true });
      }
    },

    closeScreenPicker: () => {
      set({ isScreenPickerOpen: false });
    },

    shareScreen: async (sourceId) => {
      set({ isScreenPickerOpen: false });
      if (room === null) {
        return;
      }
      const chosen = await chooseScreenSource(sourceId);
      if (!chosen.ok) {
        set({ problem: chosen.error.message });
        return;
      }
      try {
        await room.setScreenShare(true);
      } catch (error) {
        set({ problem: captureErrorMessage(error, 'screen') });
      }
    },

    stopScreenShare: async () => {
      if (room === null) {
        return;
      }
      try {
        await room.setScreenShare(false);
      } catch (error) {
        log.warn('screen_share_stop_failed', { error });
      }
    },

    setMinimized: (isMinimized) => {
      set({ isMinimized });
    },

    dismissProblem: () => {
      set({ problem: null });
    },

    dismissNotice: () => {
      set({ notice: null });
    },
  };
});
