import type { AppInfoResponse, IpcError } from '@shared/ipc-types';
import { Check, Star } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { submitFeedback } from '@/features/feedback/api';
import { useFeedbackStore } from '@/features/feedback/store';
import {
  FEEDBACK_FEATURES,
  FEEDBACK_NOTE_MAX,
  RATING_LABELS,
  featureLabel,
  notePromptFor,
  type FeedbackEntry,
  type FeedbackFeatureId,
} from '@/features/feedback/types';
import { cn } from '@/lib/cn';
import { createLogger } from '@/lib/logger';
import { relativeTime } from '@/lib/relative-time';

import { PaneHeader, SettingsSection } from './SettingsSection';

const log = createLogger('settings.feedback');

const STARS = [1, 2, 3, 4, 5] as const;

interface FeedbackSettingsProps {
  appInfo: AppInfoResponse | null;
}

/**
 * Rate one feature, 1–5, with an optional note.
 *
 * Send stays clickable while the form is incomplete — pressing it marks what
 * is missing, which a disabled button cannot do — and is only toned down.
 */
export function FeedbackSettings({ appInfo }: FeedbackSettingsProps) {
  const [featureId, setFeatureId] = useState<FeedbackFeatureId | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState('');
  const [attachDetails, setAttachDetails] = useState(true);
  const [hasTried, setHasTried] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);
  const [sent, setSent] = useState<FeedbackEntry | null>(null);
  const history = useFeedbackStore((state) => state.sent);
  const historyStatus = useFeedbackStore((state) => state.status);
  const addSent = useFeedbackStore((state) => state.add);
  const loadHistory = useFeedbackStore((state) => state.load);
  const noteId = useId();

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const shown = hover || rating;
  const isReady = featureId !== null && rating > 0;
  const prompt = notePromptFor(rating);
  const platform = appInfo === null ? null : `${appInfo.platform} (${appInfo.arch})`;

  const reset = (): void => {
    setFeatureId(null);
    setRating(0);
    setHover(0);
    setNote('');
    setHasTried(false);
    setError(null);
    setSent(null);
  };

  const send = (): void => {
    if (isSending) {
      return;
    }
    if (featureId === null || rating === 0) {
      setHasTried(true);
      return;
    }
    setIsSending(true);
    setError(null);
    void submitFeedback({
      featureId,
      rating,
      note,
      diagnostics:
        attachDetails && appInfo !== null
          ? { appVersion: appInfo.appVersion, platform: appInfo.platform }
          : null,
    }).then((result) => {
      setIsSending(false);
      if (!result.ok) {
        // The note is the user's words: only the code is logged (A09).
        log.warn('feedback_failed', { code: result.error.code });
        setError(result.error);
        return;
      }
      addSent(result.data);
      setSent(result.data);
    });
  };

  if (sent !== null) {
    return (
      <div className="gap-md mx-auto mt-16 flex max-w-[420px] flex-col items-center text-center">
        <span className="bg-tertiary-fixed text-tertiary flex size-14 items-center justify-center rounded-2xl">
          <Check aria-hidden className="size-7" strokeWidth={2.2} />
        </span>
        <h1 className="font-heading text-h1 text-on-surface">Thanks — your feedback is in</h1>
        <p className="text-on-surface-variant text-[15px] leading-relaxed">
          You rated{' '}
          <span className="text-on-surface font-semibold">{featureLabel(sent.featureId)}</span>{' '}
          {sent.rating} out of 5. The Yello team reads every note; if you left one, we may reply in
          Notifications.
        </p>
        <StarRow value={sent.rating} size="sm" />
        <Button className="mt-sm" onClick={reset}>
          Rate another feature
        </Button>
      </div>
    );
  }

  return (
    <>
      <PaneHeader
        title="Send feedback"
        description="Tell us how a feature is working for you. It takes about 20 seconds."
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-h3 text-on-surface">Which feature?</h2>
        <div role="radiogroup" aria-label="Feature" className="flex flex-wrap gap-2">
          {FEEDBACK_FEATURES.map((feature) => {
            const isSelected = feature.id === featureId;
            return (
              <button
                key={feature.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setFeatureId(feature.id);
                }}
                className={cn(
                  'transition-tone h-9 rounded-full border px-3.5 text-[13px] font-medium',
                  isSelected
                    ? 'border-primary-container bg-primary-fixed-dim text-on-primary-fixed'
                    : cn(
                        'bg-surface-container-lowest text-on-surface-variant hover:text-on-surface hover:border-outline',
                        hasTried && featureId === null
                          ? 'border-error/60'
                          : 'border-outline-strong',
                      ),
                )}
              >
                {feature.label}
              </button>
            );
          })}
        </div>
        {hasTried && featureId === null && (
          <p className="text-error text-[13px]">Pick the feature you’re rating</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-h3 text-on-surface">How would you rate it?</h2>
        <div className="flex items-center gap-4">
          <div
            role="radiogroup"
            aria-label="Rating"
            className="flex gap-0.5"
            onMouseLeave={() => {
              setHover(0);
            }}
          >
            {STARS.map((value) => {
              const isLit = value <= shown;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === rating}
                  aria-label={`${String(value)} ${value === 1 ? 'star' : 'stars'}, ${RATING_LABELS[value] ?? ''}`}
                  onClick={() => {
                    setRating(value);
                  }}
                  onMouseEnter={() => {
                    setHover(value);
                  }}
                  onFocus={() => {
                    setHover(value);
                  }}
                  onBlur={() => {
                    setHover(0);
                  }}
                  className="rounded-lg p-1 transition-transform hover:scale-110"
                >
                  <Star
                    aria-hidden
                    strokeWidth={1.6}
                    className={cn(
                      'size-8',
                      isLit
                        ? 'fill-primary-container text-primary-container'
                        : hasTried && rating === 0
                          ? 'text-error'
                          : 'text-outline/50',
                    )}
                  />
                </button>
              );
            })}
          </div>
          {shown > 0 ? (
            <span className="text-on-primary-fixed min-w-28 text-[15px] font-semibold">
              {RATING_LABELS[shown]}
            </span>
          ) : (
            <span className="text-outline text-[13px]">Hover to preview, click to rate</span>
          )}
        </div>
        {hasTried && rating === 0 && (
          <p className="text-error text-[13px]">Pick a rating to continue</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor={noteId} className="font-heading text-h3 text-on-surface">
          {prompt.label}{' '}
          <span className="font-body text-outline text-[13px] font-normal">Optional</span>
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={FEEDBACK_NOTE_MAX}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder={prompt.placeholder}
          className="bg-surface-container-lowest border-outline-strong text-on-surface focus:border-outline placeholder:text-outline h-28 resize-none rounded-xl border px-3.5 py-3 text-[14px] leading-normal outline-none"
        />
        <div className="text-outline flex justify-between text-[12px]">
          <span>Don’t include passwords or private messages.</span>
          <span className="tabular-nums">
            {note.length} / {FEEDBACK_NOTE_MAX}
          </span>
        </div>
      </section>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={attachDetails}
          onChange={(event) => {
            setAttachDetails(event.target.checked);
          }}
          className="accent-primary-container mt-0.5 size-[18px] cursor-pointer"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-on-surface text-[14px] font-medium">Attach app details</span>
          <span className="text-outline text-[13px]">
            Yello {appInfo?.appVersion ?? '—'} · {platform ?? '—'} · no messages or contacts
          </span>
        </span>
      </label>

      {error !== null && (
        <p role="alert" className="text-error text-[13px]">
          {error.message}
        </p>
      )}

      <div className="border-outline-variant flex items-center gap-3 border-t pt-4">
        <Button
          size="lg"
          isLoading={isSending}
          aria-disabled={!isReady}
          onClick={send}
          className={cn(!isReady && 'bg-surface-container-high text-outline hover:brightness-100')}
        >
          {isSending ? 'Sending…' : 'Send feedback'}
        </Button>
        <Button size="lg" variant="ghost" disabled={isSending} onClick={reset}>
          Clear
        </Button>
      </div>

      <SettingsSection title="Your recent feedback">
        <Card className="divide-outline-variant flex flex-col divide-y">
          <div className="px-lg py-md flex items-center justify-between gap-3">
            <span className="text-on-surface-variant text-[13px]">Only you see this list.</span>
          </div>
          {history.length === 0 ? (
            <p className="text-on-surface-variant px-lg py-md text-[14px]">
              {historyStatus === 'loading' || historyStatus === 'idle'
                ? 'Loading…'
                : historyStatus === 'error'
                  ? 'Your feedback history couldn’t be loaded.'
                  : 'Nothing sent yet.'}
            </p>
          ) : (
            history.map((entry) => (
              <div key={entry.id} className="px-lg py-md flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-on-surface text-[14px] font-medium">
                    {featureLabel(entry.featureId)}
                  </span>
                  {entry.note !== '' && (
                    <span className="text-on-surface-variant truncate text-[13px]">
                      {entry.note}
                    </span>
                  )}
                  <span className="text-outline text-[12px]">{relativeTime(entry.createdAt)}</span>
                </div>
                <StarRow value={entry.rating} size="xs" />
              </div>
            ))
          )}
        </Card>
      </SettingsSection>
    </>
  );
}

interface StarRowProps {
  value: number;
  size: 'xs' | 'sm';
}

/** A read-only rating, for the confirmation and the history rows. */
function StarRow({ value, size }: StarRowProps) {
  return (
    <span
      role="img"
      aria-label={`${String(value)} out of 5`}
      className="flex shrink-0 items-center gap-0.5"
    >
      {STARS.map((star) => (
        <Star
          key={star}
          aria-hidden
          strokeWidth={1.8}
          className={cn(
            size === 'xs' ? 'size-3.5' : 'size-5',
            star <= value ? 'fill-primary-container text-primary-container' : 'text-outline/50',
          )}
        />
      ))}
    </span>
  );
}
