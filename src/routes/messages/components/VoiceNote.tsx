import type { ChatAttachment } from '@shared/ipc-types';
import { AlertCircle, LoaderCircle, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { useMessagesStore } from '@/features/messages/store';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';

interface VoiceNoteProps {
  voice: ChatAttachment;
  isMine: boolean;
  /** Re-sign an expired link; the store decides whether it really expired. */
  onExpired: (attachment: ChatAttachment) => void;
}

const PLAYBACK_RATES = [1, 1.5, 2] as const;
/** Bars drawn, whatever the service measured: enough to read, few enough to breathe. */
const BAR_COUNT = 28;
/** The quietest bar is still drawn, so silence reads as a line, not a gap. */
const BAR_MIN_PX = 4;
/** How much taller the loudest bar is than the quietest. */
const BAR_RANGE_PX = 22;
/** Drawn when the service sent no waveform: a flat, quiet line. */
const PLACEHOLDER_BARS = Array.from({ length: BAR_COUNT }, () => 0);
const SEEK_STEP_MS = 5000;
/** A presigned link this close to expiry is re-signed before playing, as the store does. */
const URL_EXPIRY_MARGIN_MS = 30_000;

/**
 * Folds the service's up-to-64 bars into BAR_COUNT, keeping each bucket's
 * loudest value so peaks survive the squeeze. Fewer bars are kept as they are.
 */
function resample(waveform: readonly number[]): number[] {
  if (waveform.length <= BAR_COUNT) {
    return [...waveform];
  }
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const from = Math.floor((index * waveform.length) / BAR_COUNT);
    const to = Math.floor(((index + 1) * waveform.length) / BAR_COUNT);
    return Math.max(...waveform.slice(from, Math.max(to, from + 1)));
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - URL_EXPIRY_MARGIN_MS <= Date.now();
}

/**
 * A voice message: play/pause, the waveform the service measured (which
 * fills as it plays, and seeks on click or arrow keys), the length as m:ss,
 * and a 1× / 1.5× / 2× toggle.
 *
 * The presigned link streams straight into an `<audio>` with no credentials —
 * the link is its own authorisation, and the CSP `media-src` admits only the
 * chat-media host. It lasts an hour: an expired one is re-signed before
 * playing, and a playback error asks once more (the store only re-fetches a
 * link that really has expired, so a broken file cannot loop).
 *
 * Only one note plays at a time: the store holds which, and every other note
 * pauses when it changes.
 */
export function VoiceNote({ voice, isMine, onExpired }: VoiceNoteProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [measuredMs, setMeasuredMs] = useState<number | null>(null);
  const [rate, setRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  /** Play was pressed while the link was being re-signed: start once it arrives. */
  const wantsPlay = useRef(false);

  const playingVoiceId = useMessagesStore((state) => state.playingVoiceId);
  const setPlayingVoice = useMessagesStore((state) => state.setPlayingVoice);

  const url = voice.url;
  const isBroken = url === null || failedUrl === url;
  const durationMs = voice.voice?.durationMs ?? measuredMs ?? 0;
  const waveform = voice.voice?.waveform;
  const bars = useMemo(
    () => (waveform === undefined || waveform.length === 0 ? PLACEHOLDER_BARS : resample(waveform)),
    [waveform],
  );
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const hasStarted = isPlaying || positionMs > 0;

  // Another note started: this one yields.
  useEffect(() => {
    if (playingVoiceId !== voice.id) {
      audioRef.current?.pause();
    }
  }, [playingVoiceId, voice.id]);

  // A re-signed link arrived after Play was pressed.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || url === null || !wantsPlay.current || isExpired(voice.urlExpiresAt)) {
      return;
    }
    wantsPlay.current = false;
    audio.playbackRate = rate;
    void audio.play().catch(() => {
      setIsBuffering(false);
    });
    // Keyed on the link only: a rate change must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, voice.urlExpiresAt]);

  // Unmounting — a tombstone, a switched thread — stops the sound and frees the slot.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (useMessagesStore.getState().playingVoiceId === voice.id) {
        setPlayingVoice(null);
      }
    },
    [voice.id, setPlayingVoice],
  );

  // Smooth progress while playing; `timeupdate` alone ticks only ~4 times a second.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let frame = 0;
    const tick = (): void => {
      const audio = audioRef.current;
      if (audio !== null) {
        setPositionMs(audio.currentTime * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isPlaying]);

  const togglePlay = (): void => {
    const audio = audioRef.current;
    if (audio === null || url === null) {
      return;
    }
    if (isPlaying) {
      audio.pause();
      return;
    }
    setPlayingVoice(voice.id);
    if (isExpired(voice.urlExpiresAt)) {
      wantsPlay.current = true;
      setIsBuffering(true);
      onExpired(voice);
      return;
    }
    audio.playbackRate = rate;
    setIsBuffering(true);
    void audio.play().catch(() => {
      setIsBuffering(false);
    });
  };

  const seekTo = (milliseconds: number): void => {
    const audio = audioRef.current;
    if (audio === null || durationMs <= 0) {
      return;
    }
    const clamped = Math.min(durationMs, Math.max(0, milliseconds));
    audio.currentTime = clamped / 1000;
    setPositionMs(clamped);
  };

  const onWaveClick = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) {
      seekTo(((event.clientX - box.left) / box.width) * durationMs);
    }
  };

  const onWaveKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(positionMs + (event.key === 'ArrowRight' ? SEEK_STEP_MS : -SEEK_STEP_MS));
    }
  };

  const cycleRate = (): void => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length] ?? 1;
    setRate(next);
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = next;
    }
  };

  const tone = isMine
    ? 'bg-primary-container text-on-primary-container rounded-[22px] rounded-br-[6px]'
    : 'bg-surface-container-high text-on-surface rounded-[22px] rounded-bl-[6px]';

  if (isBroken) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] opacity-80',
          tone,
        )}
      >
        <AlertCircle aria-hidden className="size-4 shrink-0" />
        Voice message unavailable
      </div>
    );
  }

  return (
    <div className={cn('flex w-[280px] max-w-full items-center gap-3 py-2 pr-4 pl-2', tone)}>
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onWaiting={() => {
          setIsBuffering(true);
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsBuffering(false);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setPositionMs(0);
          if (useMessagesStore.getState().playingVoiceId === voice.id) {
            setPlayingVoice(null);
          }
        }}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) {
            setMeasuredMs(seconds * 1000);
          }
        }}
        onError={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          setFailedUrl(url);
          // An expired link is re-signed and playback resumes on the new one;
          // anything else stays failed.
          wantsPlay.current = isExpired(voice.urlExpiresAt);
          onExpired(voice);
        }}
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        // A dark disc with a white glyph reads on the yellow of a sent bubble.
        // On a received bubble the disc is the brand yellow instead, and the
        // glyph stays dark: white on yellow would be too faint to see.
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-110 active:scale-[0.94]',
          isMine ? 'bg-on-primary-container text-white' : 'bg-primary text-on-primary',
        )}
      >
        {isBuffering && !isPlaying ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause aria-hidden strokeWidth={0} className="size-3.5 fill-current" />
        ) : (
          <Play aria-hidden strokeWidth={0} className="ml-0.5 size-3.5 fill-current" />
        )}
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Voice message position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(positionMs / 1000)}
        aria-valuetext={`${formatDuration(positionMs)} of ${formatDuration(durationMs)}`}
        onClick={onWaveClick}
        onKeyDown={onWaveKey}
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
      >
        {bars.map((bar, index) => (
          <span
            // The waveform never reorders; its index is its identity.
            key={index}
            aria-hidden
            // At rest every bar is drawn alike; playing, the heard part fills in.
            className={cn(
              'max-w-[3px] min-w-[2px] flex-1 rounded-[2px] bg-current transition-opacity duration-150',
              !hasStarted
                ? 'opacity-85'
                : (index + 0.5) / bars.length <= progress
                  ? 'opacity-100'
                  : 'opacity-35',
            )}
            style={{ height: `${String(BAR_MIN_PX + (bar * BAR_RANGE_PX) / 100)}px` }}
          />
        ))}
      </div>

      <span className="flex shrink-0 items-center gap-1.5">
        <span className="min-w-[32px] text-right font-mono text-[13px] tabular-nums">
          {formatDuration(hasStarted ? positionMs : durationMs)}
        </span>
        {hasStarted && (
          <button
            type="button"
            onClick={cycleRate}
            aria-label={`Playback speed ${String(rate)}×`}
            className="rounded-full bg-current/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums hover:bg-current/20"
          >
            {rate}×
          </button>
        )}
      </span>
    </div>
  );
}
