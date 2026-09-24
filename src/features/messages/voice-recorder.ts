/**
 * Recording a voice message, from the mic button to the upload.
 *
 * The recorder is a state machine, spelled as a discriminated union:
 *
 *   idle ─start→ starting ─mic granted→ recording ⇄ paused
 *                                          │          │
 *                              5:00 cap → recorded ←──┘ (a failed send lands here too)
 *                                          │
 *            recording / paused / recorded ─send→ sending ─ok→ sent ─→ closing ─→ idle
 *            any live state ─discard→ closing ─→ idle (+ "Recording discarded")
 *
 * `closing` carries the state it is leaving, so the screen can animate out
 * showing what it showed rather than going blank first. `recorded` holds the
 * finished bytes, so a failed upload keeps the recording and Send tries again —
 * the service treats every upload as new and the send's fresh `clientId` makes
 * the message itself safe to repeat.
 *
 * Chromium's MediaRecorder writes Opus in WebM, which the service accepts
 * as-is and transcodes; the page never names a file or a host, it only hands
 * the bytes to the main process (see `uploadVoice`).
 */
import { VOICE_MAX_DURATION_MS } from '@shared/ipc-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMessagesStore } from './store';

/** Anything shorter is a mis-tap, not a message. */
const MIN_VOICE_MS = 1000;
/** Stops a little before the service's cap, so container overhead never tips it over. */
const RECORDING_CAP_MS = VOICE_MAX_DURATION_MS - 500;
/** Opus at voice quality: five minutes stays near 1.2 MB, far under the 10 MB cap. */
const AUDIO_BITS_PER_SECOND = 32_000;
const PREFERRED_MIME_TYPE = 'audio/webm;codecs=opus';
const CHUNK_INTERVAL_MS = 1000;
const TICK_MS = 100;
/** How long "sent" is shown before the screen closes. */
const SENT_HOLD_MS = 800;
/** The screen's exit animation; the state goes idle when it ends. */
const CLOSE_MS = 250;
const TOAST_MS = 2200;
/** A paused recorder flushes its last chunk on request; this is how long to wait for it. */
const FLUSH_TIMEOUT_MS = 800;

interface HeldRecording {
  recording: Uint8Array<ArrayBuffer>;
  durationMs: number;
}

/** Every state the recording screen draws. */
export type LiveRecorderState =
  | { kind: 'starting' }
  | { kind: 'recording' }
  | { kind: 'paused' }
  | ({ kind: 'recorded' } & HeldRecording)
  | ({ kind: 'sending' } & HeldRecording)
  | { kind: 'sent'; durationMs: number };

export type RecorderState =
  { kind: 'idle' } | LiveRecorderState | { kind: 'closing'; last: LiveRecorderState };

/** What the recorder is to do once MediaRecorder has flushed its last chunk. */
type StopIntent = 'send' | 'hold' | 'discard';

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  meter: LevelMeter | null;
  chunks: Blob[];
  /** Time recorded before the running stretch; pauses are not counted. */
  accumulatedMs: number;
  /** When the running stretch began, or null while paused. */
  segmentStartedAt: number | null;
  intent: StopIntent;
  /** Resolves the wait for a flush requested while paused. */
  onFlush: (() => void) | null;
}

function recordedMs(session: Session): number {
  return (
    session.accumulatedMs +
    (session.segmentStartedAt === null ? 0 : performance.now() - session.segmentStartedAt)
  );
}

export interface VoiceRecorder {
  state: RecorderState;
  /** Milliseconds recorded so far, pauses excluded; the length once recorded. */
  elapsedMs: number;
  /** Why the last attempt went nowhere (no mic, too short, refused), or null. */
  problem: string | null;
  /** A passing note for under the composer ("Recording discarded"), or null. */
  toast: string | null;
  /** The mic's loudness now, 0–1; 0 when nothing is being recorded. Cheap to poll per frame. */
  readLevel: () => number;
  /** The audio so far, for a preview: while paused, or once recorded. */
  snapshot: () => Promise<ArrayBuffer | null>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Recording or paused: stop and send. Recorded: send (again). */
  send: () => void;
  discard: () => void;
}

/** How loud the mic is right now, for the live waveform. */
interface LevelMeter {
  /** 0 (silence) to 1 (loud speech). */
  read: () => number;
  close: () => void;
}

/**
 * Reads the recording stream's loudness through an AnalyserNode. It only
 * listens: nothing is connected to the speakers, so there is no echo, and
 * nothing it computes leaves the page. Speech RMS sits well under 0.3, so it
 * is scaled up to fill the bar height.
 */
function createLevelMeter(stream: MediaStream): LevelMeter | null {
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    return {
      read: () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          sum += sample * sample;
        }
        return Math.min(1, Math.sqrt(sum / samples.length) * 4);
      },
      close: () => {
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    // No waveform is a cosmetic loss; the recording itself still works.
    return null;
  }
}

function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is off. Allow it for Yello in your system settings.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is in use by another app.';
  }
  return 'The microphone could not be started.';
}

function releaseStream(stream: MediaStream, meter: LevelMeter | null = null): void {
  meter?.close();
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * One recorder per composer, bound to the open conversation: switching threads
 * mid-recording discards it rather than posting it somewhere unexpected.
 */
export function useVoiceRecorder(conversationId: string | null): VoiceRecorder {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  /**
   * Bumped by every discard and conversation switch. The mic prompt can take
   * a while to answer; a grant that arrives after the user already gave up is
   * released at once instead of starting a recording nobody asked for. The
   * close and toast timers check it too, so a switch cancels them.
   */
  const generation = useRef(0);

  const later = useCallback((ms: number, run: () => void) => {
    const scheduledIn = generation.current;
    setTimeout(() => {
      if (scheduledIn === generation.current) {
        run();
      }
    }, ms);
  }, []);

  /** Animates the screen out showing `last`, then settles on idle. */
  const close = useCallback(
    (last: LiveRecorderState, then?: () => void) => {
      setState({ kind: 'closing', last });
      later(CLOSE_MS, () => {
        setState({ kind: 'idle' });
        setElapsedMs(0);
        then?.();
      });
    },
    [later],
  );

  const deliver = useCallback(
    async (recording: Uint8Array<ArrayBuffer>, durationMs: number) => {
      setState({ kind: 'sending', recording, durationMs });
      setProblem(null);
      const outcome = await useMessagesStore.getState().sendVoice(recording);
      if (outcome.status === 'sent') {
        setState({ kind: 'sent', durationMs });
        later(SENT_HOLD_MS, () => {
          close({ kind: 'sent', durationMs });
        });
        return;
      }
      setProblem(outcome.message);
      // With no voice on this server the mic is gone, so there is nothing to retry.
      if (outcome.status === 'unavailable') {
        setState({ kind: 'idle' });
        setElapsedMs(0);
        return;
      }
      setState({ kind: 'recorded', recording, durationMs });
    },
    [close, later],
  );

  const stop = useCallback((intent: StopIntent) => {
    const current = session.current;
    if (current === null) {
      return;
    }
    current.intent = intent;
    if (current.recorder.state !== 'inactive') {
      current.recorder.stop();
    }
  }, []);

  const start = useCallback(() => {
    if (session.current !== null || conversationId === null) {
      return;
    }
    setProblem(null);
    setToast(null);
    setElapsedMs(0);
    setState({ kind: 'starting' });
    const startedIn = generation.current;

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (error: unknown) {
        if (startedIn === generation.current) {
          setProblem(microphoneProblem(error));
          setState({ kind: 'idle' });
        }
        return;
      }
      if (startedIn !== generation.current) {
        releaseStream(stream);
        return;
      }

      const recorder = new MediaRecorder(stream, {
        ...(MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE)
          ? { mimeType: PREFERRED_MIME_TYPE }
          : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      const active: Session = {
        recorder,
        stream,
        meter: createLevelMeter(stream),
        chunks: [],
        accumulatedMs: 0,
        segmentStartedAt: performance.now(),
        intent: 'discard',
        onFlush: null,
      };
      session.current = active;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          active.chunks.push(event.data);
        }
        active.onFlush?.();
        active.onFlush = null;
      };
      recorder.onstop = () => {
        releaseStream(stream, active.meter);
        session.current = null;
        const durationMs = recordedMs(active);
        setElapsedMs(durationMs);

        if (active.intent === 'discard') {
          return;
        }
        if (durationMs < MIN_VOICE_MS) {
          setProblem('Too short to send. Record for at least a second.');
          setState({ kind: 'idle' });
          setElapsedMs(0);
          return;
        }
        const intent = active.intent;
        void new Blob(active.chunks, { type: recorder.mimeType }).arrayBuffer().then((buffer) => {
          const recording = new Uint8Array(buffer);
          if (intent === 'send') {
            void deliver(recording, durationMs);
          } else {
            setState({ kind: 'recorded', recording, durationMs });
          }
        });
      };
      recorder.onerror = () => {
        setProblem('Recording stopped unexpectedly.');
        stop('discard');
        setState({ kind: 'idle' });
      };

      recorder.start(CHUNK_INTERVAL_MS);
      setState({ kind: 'recording' });
    })();
  }, [conversationId, deliver, stop]);

  const pause = useCallback(() => {
    const current = session.current;
    if (current?.recorder.state !== 'recording' || current.segmentStartedAt === null) {
      return;
    }
    current.recorder.pause();
    current.accumulatedMs += performance.now() - current.segmentStartedAt;
    current.segmentStartedAt = null;
    setElapsedMs(current.accumulatedMs);
    setState({ kind: 'paused' });
  }, []);

  const resume = useCallback(() => {
    const current = session.current;
    if (current?.recorder.state !== 'paused') {
      return;
    }
    current.recorder.resume();
    current.segmentStartedAt = performance.now();
    setState({ kind: 'recording' });
  }, []);

  // The clock, and the five-minute cap: at the cap the recording is kept for
  // the user to send or discard, never sent on their behalf.
  const isRecording = state.kind === 'recording';
  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const timer = setInterval(() => {
      const current = session.current;
      if (current === null) {
        return;
      }
      const elapsed = recordedMs(current);
      setElapsedMs(elapsed);
      if (elapsed >= RECORDING_CAP_MS) {
        setProblem('Voice messages can be up to 5 minutes.');
        stop('hold');
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isRecording, stop]);

  // Leaving the conversation (or the page) drops whatever was being recorded,
  // and always lets go of the microphone.
  useEffect(
    () => () => {
      generation.current += 1;
      const current = session.current;
      if (current !== null) {
        current.intent = 'discard';
        if (current.recorder.state !== 'inactive') {
          current.recorder.stop();
        }
        releaseStream(current.stream, current.meter);
        session.current = null;
      }
      setState({ kind: 'idle' });
      setElapsedMs(0);
      setProblem(null);
      setToast(null);
    },
    [conversationId],
  );

  const readLevel = useCallback(() => {
    const current = session.current;
    return current?.recorder.state === 'recording' ? (current.meter?.read() ?? 0) : 0;
  }, []);

  const snapshot = useCallback(async (): Promise<ArrayBuffer | null> => {
    if (state.kind === 'recorded' || state.kind === 'sending') {
      return state.recording.slice().buffer;
    }
    const current = session.current;
    if (current?.recorder.state !== 'paused') {
      return null;
    }
    // Ask for what is buffered, and wait for it — without it the last second
    // of speech would be missing from the preview.
    await new Promise<void>((resolve) => {
      current.onFlush = resolve;
      current.recorder.requestData();
      setTimeout(resolve, FLUSH_TIMEOUT_MS);
    });
    return new Blob(current.chunks, { type: current.recorder.mimeType }).arrayBuffer();
  }, [state]);

  return {
    state,
    elapsedMs,
    problem,
    toast,
    readLevel,
    snapshot,
    start,
    pause,
    resume,
    send: () => {
      if (state.kind === 'recording' || state.kind === 'paused') {
        stop('send');
      } else if (state.kind === 'recorded') {
        void deliver(state.recording, state.durationMs);
      }
    },
    discard: () => {
      if (state.kind === 'idle' || state.kind === 'closing' || state.kind === 'sending') {
        return;
      }
      if (state.kind === 'starting') {
        generation.current += 1;
      } else {
        stop('discard');
      }
      setProblem(null);
      close(state, () => {
        setToast('Recording discarded');
        later(TOAST_MS, () => {
          setToast(null);
        });
      });
    },
  };
}

/** A preview of the recording so far, played through Web Audio. */
export interface VoicePreview {
  isPlaying: boolean;
  /** 0–1 through the preview. */
  progress: number;
  /** The preview's own length, once decoded; null before the first play. */
  durationMs: number | null;
  toggle: () => void;
  stop: () => void;
}

/**
 * Plays back what has been recorded, while paused or once recorded.
 *
 * Decoded with Web Audio rather than handed to an `<audio>` as a `blob:` URL:
 * the CSP's `media-src` stays limited to the chat-media host, and the decoded
 * buffer knows its exact length (MediaRecorder's WebM carries none, so an
 * `<audio>` would report Infinity). The decode is cached until the recording
 * changes, which is whenever recording resumes.
 */
export function useVoicePreview(recorder: VoiceRecorder): VoicePreview {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const player = useRef<{
    context: AudioContext;
    source: AudioBufferSourceNode | null;
    buffer: AudioBuffer | null;
    startedAt: number;
  } | null>(null);
  const frame = useRef(0);
  const kind = recorder.state.kind;
  const canPreview = kind === 'paused' || kind === 'recorded';

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const current = player.current;
    if (current?.source !== null && current?.source !== undefined) {
      current.source.onended = null;
      current.source.stop();
      current.source = null;
    }
    setIsPlaying(false);
    setProgress(0);
  }, []);

  // Whatever changes the recording (resume, send, discard) ends the preview
  // and drops the decode, which no longer matches. Stopping the source fires
  // its `ended`, which resets the playing state.
  useEffect(() => {
    if (canPreview) {
      return;
    }
    const current = player.current;
    if (current !== null) {
      current.source?.stop();
      current.buffer = null;
    }
  }, [canPreview]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      const current = player.current;
      player.current = null;
      if (current !== null) {
        current.source?.stop();
        void current.context.close().catch(() => undefined);
      }
    },
    [],
  );

  const toggle = (): void => {
    if (isPlaying) {
      stop();
      return;
    }
    if (!canPreview) {
      return;
    }
    void (async () => {
      player.current ??= { context: new AudioContext(), source: null, buffer: null, startedAt: 0 };
      const current = player.current;
      if (current.buffer === null) {
        const bytes = await recorder.snapshot();
        if (bytes === null) {
          return;
        }
        try {
          current.buffer = await current.context.decodeAudioData(bytes);
        } catch {
          // A preview is a nicety; failing to decode one must not block sending.
          return;
        }
        setDurationMs(current.buffer.duration * 1000);
      }
      const buffer = current.buffer;
      await current.context.resume();
      const source = current.context.createBufferSource();
      source.buffer = buffer;
      source.connect(current.context.destination);
      source.onended = () => {
        stop();
      };
      current.source = source;
      current.startedAt = current.context.currentTime;
      source.start();
      setIsPlaying(true);

      const tick = (): void => {
        setProgress(
          Math.min(1, (current.context.currentTime - current.startedAt) / buffer.duration),
        );
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    })();
  };

  return { isPlaying, progress, durationMs, toggle, stop };
}
