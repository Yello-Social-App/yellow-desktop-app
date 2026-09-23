import type { AppInfoResponse, IpcError } from '@shared/ipc-types';
import { Send, Star } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { submitFeedback } from '@/features/feedback/api';
import { useFeedbackStore } from '@/features/feedback/store';
import {
  FEEDBACK_FEATURES,
  FEEDBACK_NOTE_MAX,
  RATING_LABELS,
  featureLabel,
  notePromptFor,
  type FeedbackFeatureId,
} from '@/features/feedback/types';
import { cn } from '@/lib/cn';
import { createLogger } from '@/lib/logger';
import { relativeTime } from '@/lib/relative-time';

import { AsideLabel, SuccessNote } from './SettingsSection';

const log = createLogger('settings.feedback');

const STARS = [1, 2, 3, 4, 5] as const;

interface FeedbackSettingsProps {
  appInfo: AppInfoResponse | null;
}

/**
 * Rate one feature, 1–5, with an optional note; what was sent is listed beside
 * the form.
 *
 * Send stays clickable while the form is incomplete — pressing it marks what
 * is missing, which a disabled button cannot do — and is only toned down.
 * A sent rating clears the form and says so at its top; the new entry is
 * already in the list on the right.
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
  const [justSent, setJustSent] = useState(false);
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

  const clearForm = (): void => {
    setFeatureId(null);
    setRating(0);
    setHover(0);
    setNote('');
    setAttachDetails(true);
    setHasTried(false);
    setError(null);
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
    setJustSent(false);
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
      clearForm();
      setJustSent(true);
    });
  };

  return (
    <div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="flex flex-col gap-[22px] p-[22px]">
        {justSent && (
          <SuccessNote>Thanks — your feedback was sent. It’s listed with your others.</SuccessNote>
        )}

        <section className="flex flex-col gap-2.5">
          <StepHeading step={1}>Which feature?</StepHeading>
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
                    setJustSent(false);
                  }}
                  className={cn(
                    'transition-tone h-[34px] rounded-full border px-3.5 text-[13px]',
                    isSelected
                      ? 'border-primary-container bg-primary-fixed text-on-surface'
                      : cn(
                          'text-on-surface-variant hover:text-on-surface hover:border-outline',
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

        <section className="flex flex-col gap-2.5">
          <StepHeading step={2}>How would you rate it?</StepHeading>
          <div className="flex items-center gap-2.5">
            <div
              role="radiogroup"
              aria-label="Rating"
              className="flex gap-1"
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
                      setJustSent(false);
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
                    className="flex size-10 items-center justify-center rounded-lg transition-transform hover:scale-110"
                  >
                    <Star
                      aria-hidden
                      strokeWidth={1.6}
                      className={cn(
                        'size-7',
                        isLit
                          ? 'fill-primary-container text-primary-container'
                          : hasTried && rating === 0
                            ? 'text-error'
                            : 'text-outline/60',
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <span className={cn('text-[13px]', shown > 0 ? 'text-on-surface' : 'text-outline')}>
              {shown > 0 ? RATING_LABELS[shown] : 'Pick a rating'}
            </span>
          </div>
          {hasTried && rating === 0 && (
            <p className="text-error text-[13px]">Pick a rating to continue</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <label htmlFor={noteId}>
            <StepHeading step={3}>
              {prompt.label} <span className="text-outline text-[13px] font-normal">Optional</span>
            </StepHeading>
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={FEEDBACK_NOTE_MAX}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            placeholder={prompt.placeholder}
            className="bg-surface-container-low border-outline-strong text-on-surface focus:border-outline placeholder:text-outline h-[110px] resize-none rounded-[10px] border px-3.5 py-3 text-[14px] leading-normal outline-none"
          />
          <div className="text-outline flex justify-between gap-3 text-[12px]">
            <span>Don’t include passwords or private messages.</span>
            <span className="font-mono tabular-nums">
              {note.length} / {FEEDBACK_NOTE_MAX}
            </span>
          </div>
        </section>

        <div className="bg-surface-container-low border-outline-variant flex items-center gap-3.5 rounded-[10px] border px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-on-surface text-[14px] font-medium">Attach app details</span>
            <span className="text-on-surface-variant text-[12px]">
              Yello {appInfo?.appVersion ?? '—'} · {platform ?? '—'} · no messages or contacts
            </span>
          </div>
          <Switch
            size="sm"
            label="Attach app details"
            checked={attachDetails}
            onChange={setAttachDetails}
          />
        </div>

        {error !== null && (
          <p role="alert" className="text-error text-[13px]">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            isLoading={isSending}
            aria-disabled={!isReady}
            leadingIcon={<Send className="size-4" />}
            onClick={send}
            className={cn(
              !isReady && 'bg-surface-container-high text-outline hover:brightness-100',
            )}
          >
            {isSending ? 'Sending…' : 'Send feedback'}
          </Button>
          <Button
            variant="ghost"
            disabled={isSending}
            onClick={() => {
              clearForm();
              setJustSent(false);
            }}
          >
            Clear
          </Button>
          {!isReady && (
            <span className="text-outline ml-auto text-[12px]">
              Pick a feature and a rating to send.
            </span>
          )}
        </div>
      </Card>

      <aside aria-label="Your recent feedback" className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <AsideLabel>Your recent feedback</AsideLabel>
          </span>
          <span className="text-outline text-[12px]">Only you see this</span>
        </div>
        {history.length === 0 ? (
          <Card className="px-4 py-3.5">
            <p className="text-on-surface-variant text-[13px]">
              {historyStatus === 'loading' || historyStatus === 'idle'
                ? 'Loading…'
                : historyStatus === 'error'
                  ? 'Your feedback history couldn’t be loaded.'
                  : 'Nothing sent yet.'}
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {history.map((entry) => (
              <li key={entry.id}>
                <Card className="flex flex-col gap-1.5 px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="bg-surface-container text-on-surface rounded-full px-2 py-0.5 text-[12px] font-medium">
                      {featureLabel(entry.featureId)}
                    </span>
                    <span className="flex-1" />
                    <StarRow value={entry.rating} />
                  </div>
                  {entry.note !== '' && (
                    <span className="text-on-surface text-[13px] leading-snug">{entry.note}</span>
                  )}
                  <span className="text-outline text-[12px]">{relativeTime(entry.createdAt)}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

/** A step's heading, led by its number in the mono face. */
function StepHeading({ step, children }: { step: number; children: ReactNode }) {
  return (
    <span className="text-on-surface text-[14px] font-semibold">
      <span className="text-outline mr-2 font-mono font-medium">{step}</span>
      {children}
    </span>
  );
}

/** A read-only rating, for the history rows. */
function StarRow({ value }: { value: number }) {
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
            'size-3.5',
            star <= value ? 'fill-primary-container text-primary-container' : 'text-outline/50',
          )}
        />
      ))}
    </span>
  );
}
