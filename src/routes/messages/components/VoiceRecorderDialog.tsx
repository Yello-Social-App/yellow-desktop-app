import { VOICE_MAX_DURATION_MS } from '@shared/ipc-types';
import { Check, LoaderCircle, Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import {
  useVoicePreview,
  type LiveRecorderState,
  type VoicePreview,
  type VoiceRecorder,
} from '@/features/messages/voice-recorder';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { createLogger } from '@/lib/logger';

const log = createLogger('messages.voice-dialog');

interface VoiceRecorderDialogProps {
  recorder: VoiceRecorder;
  /** Who it goes to: the conversation's title. */
  recipient: string;
}

type ViewKind = LiveRecorderState['kind'];

/** Lift on hover, give on press: every round control on this screen. */
const CONTROL =
  'flex items-center justify-center rounded-full transition-[transform,background-color,color,box-shadow] duration-150 hover:-translate-y-0.5 active:scale-90 disabled:pointer-events-none disabled:opacity-40';
/** The brand-yellow halo a primary control takes on hover. */
const GLOW = 'hover:shadow-[0_0_0_6px_rgb(255_206_43/0.15)]';

/**
 * The recording screen, centred over the whole window, which blurs behind
 * it. Top to bottom: a pill saying what is happening and to whom; the mic orb
 * inside a ring of bars that is the waveform itself; the clock; and
 * Discard · Pause/Resume · Send. Paused, the orb turns into the preview's
 * play button and the ring shows the whole recording, filling as it plays.
 * Sent, a check lands, the ring bursts, and the screen closes itself.
 *
 * A modal `<dialog>` as Modal is — focus trap, top layer, focus restored,
 * portal to `document.body` — but a click on the blurred backdrop does
 * nothing: a recording cannot be re-made, so only Discard or Esc throws it
 * away.
 */
export function VoiceRecorderDialog({ recorder, recipient }: VoiceRecorderDialogProps) {
  const { state } = recorder;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const preview = useVoicePreview(recorder);
  const isClosing = state.kind === 'closing';
  // Closing keeps drawing what it is leaving while it animates out.
  const view: LiveRecorderState | null =
    state.kind === 'closing' ? state.last : state.kind === 'idle' ? null : state;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    try {
      if (!dialog.open) {
        dialog.showModal();
      }
    } catch (error) {
      log.error('voice_dialog_open_failed', { error });
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        recorder.discard();
      }}
      className={cn(
        'text-on-surface m-auto max-w-[calc(100vw-2rem)] overflow-visible border-0 bg-transparent p-0',
        // The whole window behind it blurs, and darkens a touch so the white
        // controls read on any chat.
        'backdrop:bg-surface-dim/40 backdrop:backdrop-blur-xl',
        'backdrop:transition-opacity backdrop:duration-300',
        isClosing && 'backdrop:opacity-0',
      )}
    >
      <h2 id={titleId} className="sr-only">
        Voice message to {recipient}
      </h2>
      {view !== null && (
        <Stage
          view={view}
          recorder={recorder}
          preview={preview}
          recipient={recipient}
          isClosing={isClosing}
        />
      )}
    </dialog>,
    document.body,
  );
}

interface StageProps {
  view: LiveRecorderState;
  recorder: VoiceRecorder;
  preview: VoicePreview;
  recipient: string;
  isClosing: boolean;
}

function Stage({ view, recorder, preview, recipient, isClosing }: StageProps) {
  const sendRef = useRef<HTMLButtonElement>(null);
  const kind = view.kind;
  const isHeld = kind === 'paused' || kind === 'recorded';
  const canSend = kind === 'recording' || isHeld;
  const totalMs =
    kind === 'recorded' || kind === 'sending' || kind === 'sent'
      ? view.durationMs
      : recorder.elapsedMs;
  const isPreviewing = preview.isPlaying || preview.progress > 0;
  const previewTotalMs = preview.durationMs ?? totalMs;

  // Send takes focus once it can be pressed, so Enter sends.
  useEffect(() => {
    if (canSend) {
      sendRef.current?.focus();
    }
  }, [canSend]);

  const timeText = formatDuration(isPreviewing ? preview.progress * previewTotalMs : totalMs);
  const timeSub =
    kind === 'sent'
      ? 'sent'
      : kind === 'sending'
        ? 'sending…'
        : isHeld
          ? isPreviewing
            ? `/ ${formatDuration(previewTotalMs)}`
            : 'recorded'
          : `/ ${formatDuration(VOICE_MAX_DURATION_MS)}`;

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-[22px] px-6 py-4',
        isClosing && 'animate-voice-out',
      )}
    >
      <div className="animate-voice-up flex h-[30px] items-center [animation-delay:20ms]">
        <StatusPill kind={kind} recipient={recipient} />
      </div>

      <div className="animate-voice-zoom-in relative size-[240px]">
        <RadialWaveform recorder={recorder} kind={kind} progress={preview.progress} />
        <div className="absolute top-[76px] left-[76px] size-[88px]">
          <Orb recorder={recorder} kind={kind} preview={preview} />
        </div>
      </div>

      <div className="animate-voice-up flex flex-col items-center gap-2 [animation-delay:160ms]">
        <p className="flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-[48px] leading-none font-semibold tracking-[-1px]">{timeText}</span>
          <span className="text-on-surface-variant text-[14px]">{timeSub}</span>
        </p>
        {recorder.problem !== null && (
          <p role="alert" className="text-error max-w-[320px] text-center text-[13px]">
            {recorder.problem}
          </p>
        )}
      </div>

      <div className="flex items-center gap-7">
        <div className="animate-voice-up [animation-delay:220ms]">
          <button
            type="button"
            onClick={recorder.discard}
            disabled={kind === 'sending' || kind === 'sent'}
            aria-label="Discard recording"
            className={cn(
              CONTROL,
              'bg-surface-container border-outline-strong text-on-surface-variant size-[52px] border',
              'hover:bg-error/16 hover:text-on-error-container',
            )}
          >
            <Trash2 aria-hidden className="size-5" />
          </button>
        </div>

        <div className="animate-voice-up [animation-delay:280ms]">
          {kind === 'recording' || kind === 'starting' ? (
            <button
              type="button"
              onClick={recorder.pause}
              disabled={kind !== 'recording'}
              aria-label="Pause recording"
              className={cn(CONTROL, 'bg-on-surface text-surface size-16')}
            >
              <Pause aria-hidden strokeWidth={0} className="size-[22px] fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                preview.stop();
                recorder.resume();
              }}
              // At the cap, or after a failed send, there is nothing to resume.
              disabled={kind !== 'paused'}
              aria-label="Resume recording"
              className={cn(CONTROL, 'bg-error size-16 text-white')}
            >
              <Mic aria-hidden className="size-[22px]" strokeWidth={2.2} />
            </button>
          )}
        </div>

        <div className="animate-voice-up [animation-delay:340ms]">
          <button
            ref={sendRef}
            type="button"
            onClick={recorder.send}
            disabled={!canSend}
            aria-label="Send voice message"
            className={cn(
              CONTROL,
              GLOW,
              'bg-primary-container text-on-primary-container size-[52px]',
              kind === 'sending' && 'disabled:opacity-100',
            )}
          >
            {kind === 'sending' ? (
              <LoaderCircle aria-hidden className="size-5 animate-spin" />
            ) : (
              <SendHorizontal aria-hidden className="size-5" strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ kind, recipient }: { kind: ViewKind; recipient: string }) {
  const pill =
    'flex max-w-[360px] items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3 text-[13px] font-medium';

  if (kind === 'sent') {
    return (
      <p role="status" className={cn(pill, 'bg-primary/14 text-primary px-3.5')}>
        <span className="truncate">Sent to {recipient}</span>
      </p>
    );
  }
  if (kind === 'starting' || kind === 'recording' || kind === 'sending') {
    return (
      <p role="status" className={cn(pill, 'bg-error/14 text-on-error-container')}>
        <span aria-hidden className="bg-error animate-voice-blink size-2 shrink-0 rounded-full" />
        <span className="truncate">
          {kind === 'starting'
            ? 'Starting the microphone…'
            : kind === 'sending'
              ? `Sending to ${recipient}…`
              : `Recording to ${recipient}`}
        </span>
      </p>
    );
  }
  return (
    <p role="status" className={cn(pill, 'bg-surface-container-high text-on-surface-variant')}>
      <span aria-hidden className="bg-outline size-2 shrink-0 rounded-[2px]" />
      {kind === 'paused' ? 'Paused · tap to preview' : 'Ready · tap to preview'}
    </p>
  );
}

/**
 * The centre of the ring. Live: the brand-yellow mic, circled by a slowly
 * turning dashed orbit and three ripples, swelling a little with each word.
 * Held: a white play button for the preview. Sent: a check that pops in.
 */
function Orb({
  recorder,
  kind,
  preview,
}: {
  recorder: VoiceRecorder;
  kind: ViewKind;
  preview: VoicePreview;
}) {
  const orbRef = useRef<HTMLDivElement>(null);
  const { readLevel } = recorder;
  const isLive = kind === 'recording' || kind === 'starting';

  useEffect(() => {
    const orb = orbRef.current;
    if (orb === null || kind !== 'recording') {
      return;
    }
    let frame = 0;
    let smoothed = 0;
    const tick = (): void => {
      smoothed = smoothed * 0.6 + readLevel() * 0.4;
      orb.style.transform = `scale(${String(1 + smoothed * 0.14)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [kind, readLevel]);

  if (kind === 'sent') {
    return (
      <div className="bg-primary-container text-on-primary-container animate-voice-check flex size-[88px] items-center justify-center rounded-full">
        <Check
          aria-hidden
          strokeWidth={2.6}
          className="animate-voice-draw size-[38px] [stroke-dasharray:24] [stroke-dashoffset:24]"
        />
      </div>
    );
  }

  if (!isLive) {
    return (
      <button
        type="button"
        onClick={preview.toggle}
        disabled={kind === 'sending'}
        aria-label={preview.isPlaying ? 'Pause preview' : 'Play preview'}
        className={cn(
          CONTROL,
          GLOW,
          'bg-on-surface text-surface relative size-[88px] disabled:opacity-100',
        )}
      >
        {kind === 'sending' ? (
          <LoaderCircle aria-hidden className="size-7 animate-spin" />
        ) : preview.isPlaying ? (
          <Pause aria-hidden strokeWidth={0} className="size-7 fill-current" />
        ) : (
          <Play aria-hidden strokeWidth={0} className="ml-1 size-7 fill-current" />
        )}
      </button>
    );
  }

  return (
    <>
      <span
        aria-hidden
        className="border-primary/25 animate-voice-orbit absolute -inset-3.5 rounded-full border-[1.5px] border-dashed"
      />
      <span
        aria-hidden
        className="border-primary animate-voice-ripple pointer-events-none absolute inset-0 rounded-full border-2"
      />
      <span
        aria-hidden
        className="border-primary animate-voice-ripple pointer-events-none absolute inset-0 rounded-full border-2 [animation-delay:660ms]"
      />
      <span
        aria-hidden
        className="border-primary animate-voice-ripple pointer-events-none absolute inset-0 rounded-full border-2 [animation-delay:1330ms]"
      />
      <div
        ref={orbRef}
        aria-hidden
        className="bg-primary-container text-on-primary-container relative flex size-[88px] items-center justify-center rounded-full shadow-[0_10px_40px_rgb(255_206_43/0.3)] transition-transform duration-100 ease-out"
      >
        <Mic className="size-[34px]" strokeWidth={2} />
      </div>
    </>
  );
}

const BAR_COUNT = 60;
/** A new bar every ~80 ms, as the design samples: it follows syllables and still reads. */
const SAMPLE_MS = 80;
const BAR_MIN_PX = 4;
const BAR_RANGE_PX = 30;
/**
 * The ring's slots, each a spoke turned to its angle. Rendered once at the
 * resting height and never re-styled by React — the loop below owns each
 * bar's height, colour and opacity.
 */
const BAR_SLOTS = Array.from({ length: BAR_COUNT }, (_, index) => ({
  index,
  turn: `rotate(${((index * 360) / BAR_COUNT).toFixed(1)}deg)`,
}));
const RESTING_HEIGHT = `${String(BAR_MIN_PX)}px`;
/** Round the ring, older bars fade: the newest is fully drawn. */
const liveOpacity = (slot: number): string => (0.2 + 0.8 * (slot / (BAR_COUNT - 1))).toFixed(2);

/** Folds a history of levels into `count` bars, keeping each bucket's peak. */
function fold(levels: readonly number[], count: number): number[] {
  if (levels.length === 0) {
    return Array.from({ length: count }, () => 0.05);
  }
  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor((index * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / count));
    return Math.max(...levels.slice(from, Math.min(to, levels.length)));
  });
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The waveform as a ring of 60 spokes round the orb. Live: a bar is sampled
 * from the mic every few frames and the ring turns through it, older bars
 * fading. Starting: a wave chases round the ring, as the loader. Held: the
 * whole recording folded into the ring, filled in the brand yellow as the
 * preview plays. Sent: the whole recording, bursting outward.
 *
 * One loop writes straight to the DOM through refs; sixty renders a second
 * for a meter would be waste.
 */
function RadialWaveform({
  recorder,
  kind,
  progress,
}: {
  recorder: VoiceRecorder;
  kind: ViewKind;
  progress: number;
}) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const recent = useRef<number[]>(BAR_SLOTS.map(() => 0.04));
  /** Every level sampled this recording, for the held and sent rings. */
  const history = useRef<number[]>([]);
  const { readLevel } = recorder;

  useEffect(() => {
    const paint = (levels: readonly number[], style: (slot: number) => [string, string]): void => {
      levels.forEach((level, slot) => {
        const bar = barRefs.current[slot];
        if (bar === null || bar === undefined) {
          return;
        }
        const [color, opacity] = style(slot);
        bar.style.height = `${String(Math.round(BAR_MIN_PX + level * BAR_RANGE_PX))}px`;
        bar.style.backgroundColor = color;
        bar.style.opacity = opacity;
      });
    };
    const live = (slot: number): [string, string] => ['var(--color-primary)', liveOpacity(slot)];

    if (kind === 'starting') {
      if (prefersReducedMotion()) {
        paint(recent.current, live);
        return undefined;
      }
      let frame = 0;
      const tick = (now: number): void => {
        paint(
          BAR_SLOTS.map(({ index }) => 0.1 + 0.12 * (1 + Math.sin(now / 160 - index * 0.35))),
          live,
        );
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    if (kind === 'recording') {
      paint(recent.current, live);
      let frame = 0;
      let lastSample = 0;
      let smoothed = 0;
      const tick = (now: number): void => {
        if (now - lastSample >= SAMPLE_MS) {
          lastSample = now;
          // Quick to rise, a touch slower to fall, so speech reads as shapes.
          const level = readLevel();
          smoothed = level > smoothed ? level : smoothed * 0.55 + level * 0.45;
          const shown = Math.min(1, 0.04 + smoothed);
          recent.current = [...recent.current.slice(1), shown];
          if (history.current.length < 4000) {
            history.current.push(shown);
          }
          paint(recent.current, live);
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    const whole = fold(history.current, BAR_COUNT);
    if (kind === 'sent') {
      paint(whole, () => ['var(--color-primary)', '1']);
      return undefined;
    }
    // Held: the whole recording, filled as the preview plays.
    paint(whole, (slot) =>
      slot / BAR_COUNT < progress ? ['var(--color-primary)', '1'] : ['var(--color-outline)', '0.5'],
    );
    return undefined;
  }, [kind, progress, readLevel]);

  return (
    <div
      aria-hidden
      className={cn(
        'absolute inset-0',
        kind === 'sent' ? 'animate-voice-burst' : 'animate-voice-spin-grow',
      )}
    >
      {BAR_SLOTS.map(({ index, turn }) => (
        // Fixed spokes that change by value, never reorder: the index is the identity.
        <div key={index} className="absolute inset-0" style={{ transform: turn }}>
          <span
            ref={(element) => {
              barRefs.current[index] = element;
            }}
            className="absolute bottom-[182px] left-[118.5px] w-[3px] rounded-[2px] transition-[height,background-color,opacity] duration-100 ease-linear"
            style={{ height: RESTING_HEIGHT }}
          />
        </div>
      ))}
    </div>
  );
}
