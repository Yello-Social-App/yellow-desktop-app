/**
 * Feature feedback: which part of Yello, a 1–5 rating, and an optional note.
 *
 * The request schema is the endpoint's own contract (shared/ipc-types.ts) and
 * is checked here before anything is sent, then again by the main process —
 * the feature id is an allowlist, not free text, and the note is length-capped
 * (OWASP A05/A06). The server validates a third time.
 */
import {
  FEEDBACK_NOTE_MAX,
  submitFeedbackRequestSchema,
  type Feedback,
  type FeedbackFeatureId,
  type SubmitFeedbackRequest,
} from '@shared/ipc-types';

export { FEEDBACK_NOTE_MAX };
export type { FeedbackFeatureId };

export const FEEDBACK_FEATURES: readonly { id: FeedbackFeatureId; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'stories', label: 'Stories' },
  { id: 'communities', label: 'Communities' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'compact-mode', label: 'Compact mode' },
  { id: 'in-app-updates', label: 'In-app updates' },
  { id: 'other', label: 'Something else' },
];

/** How many past entries "Your recent feedback" shows. */
export const FEEDBACK_HISTORY_SIZE = 20;

export const RATING_LABELS: Record<number, string> = {
  1: 'Frustrating',
  2: 'Needs work',
  3: 'It’s okay',
  4: 'Good',
  5: 'Love it',
};

export const feedbackInputSchema = submitFeedbackRequestSchema;

export type FeedbackInput = SubmitFeedbackRequest;

/** One sent entry, as the server answered it; a blank note is `''`. */
export type FeedbackEntry = Feedback;

export function featureLabel(id: FeedbackFeatureId): string {
  return FEEDBACK_FEATURES.find((feature) => feature.id === id)?.label ?? 'Something else';
}

/** The note's prompt follows the score: a low one asks what got in the way. */
export function notePromptFor(rating: number): { label: string; placeholder: string } {
  if (rating === 0) {
    return { label: 'What should we know?', placeholder: 'Tell us what works or what doesn’t…' };
  }
  if (rating <= 2) {
    return {
      label: 'What got in your way?',
      placeholder: 'e.g. Messages take a few seconds to show up after I send them',
    };
  }
  if (rating === 3) {
    return {
      label: 'What would make it better?',
      placeholder: 'One change that would make this a 5…',
    };
  }
  return {
    label: 'What do you like about it?',
    placeholder: 'Tell us what’s working so we keep it…',
  };
}
