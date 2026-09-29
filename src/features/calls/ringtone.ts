/**
 * The two call sounds: the ring an incoming call makes, and the ringback a
 * caller hears while it rings at the other end.
 *
 * Synthesised with WebAudio rather than played from a file: nothing to ship,
 * nothing for the CSP's `media-src` to allow, and the pattern is a few lines.
 * The service ends an unanswered call itself (MISSED, after 45 s), so these
 * never time out on their own — they stop when the phase changes.
 *
 * Shape: two functions over one module-held context. One sound at a time.
 */
import { createLogger } from '@/lib/logger';

const log = createLogger('calls.ringtone');

export type RingKind = 'incoming' | 'ringback';

interface Pattern {
  /** Tones layered together while the pattern is on. */
  frequencies: readonly number[];
  /** On/off steps in ms, repeated: on, off, on, off… */
  steps: readonly number[];
  gain: number;
}

const PATTERNS: Readonly<Record<RingKind, Pattern>> = {
  // A bright double ring.
  incoming: { frequencies: [660, 880], steps: [400, 200, 400, 2000], gain: 0.08 },
  // The familiar ringback: two seconds on, four off.
  ringback: { frequencies: [440, 480], steps: [2000, 4000], gain: 0.05 },
};

const RAMP_S = 0.02;

let context: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;

function audioContext(): AudioContext | null {
  try {
    context ??= new AudioContext();
    return context;
  } catch (error) {
    log.warn('ringtone_unavailable', { error });
    return null;
  }
}

/** Starts a pattern, replacing whatever was playing. */
export function startRinging(kind: RingKind): void {
  stopRinging();
  const ctx = audioContext();
  if (ctx === null) {
    return;
  }
  void ctx.resume().catch(() => undefined);

  const pattern = PATTERNS[kind];
  const output = ctx.createGain();
  output.gain.value = 0;
  output.connect(ctx.destination);
  const oscillators = pattern.frequencies.map((frequency) => {
    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(output);
    oscillator.start();
    return oscillator;
  });

  let step = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const advance = (): void => {
    const isOn = step % 2 === 0;
    const now = ctx.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setTargetAtTime(isOn ? pattern.gain : 0, now, RAMP_S);
    const duration = pattern.steps[step % pattern.steps.length] ?? 1000;
    step += 1;
    timer = setTimeout(advance, duration);
  };
  advance();

  stopCurrent = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    output.gain.cancelScheduledValues(ctx.currentTime);
    output.gain.setTargetAtTime(0, ctx.currentTime, RAMP_S);
    const at = ctx.currentTime + RAMP_S * 5;
    for (const oscillator of oscillators) {
      oscillator.stop(at);
    }
    setTimeout(() => {
      output.disconnect();
    }, 200);
  };
}

export function stopRinging(): void {
  stopCurrent?.();
  stopCurrent = null;
}
