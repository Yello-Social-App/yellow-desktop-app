/**
 * Feature feedback: which part of Yello, a 1–5 rating, and an optional note.
 *
 * The schema is the contract the future endpoint will take, and is checked
 * before anything is sent — the feature id is an allowlist, not free text, and
 * the note is length-capped (OWASP A05/A06). The server must validate again.
 */
import { z } from 'zod';

export const FEEDBACK_NOTE_MAX = 500;

export const FEEDBACK_FEATURES = [
  { id: 'messages', label: 'Messages' },
  { id: 'stories', label: 'Stories' },
  { id: 'communities', label: 'Communities' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'compact-mode', label: 'Compact mode' },
  { id: 'in-app-updates', label: 'In-app updates' },
  { id: 'other', label: 'Something else' },
] as const;

export type FeedbackFeatureId = (typeof FEEDBACK_FEATURES)[number]['id'];

const FEATURE_IDS = FEEDBACK_FEATURES.map((feature) => feature.id) as [
  FeedbackFeatureId,
  ...FeedbackFeatureId[],
];

export const RATING_LABELS: Record<number, string> = {
  1: 'Frustrating',
  2: 'Needs work',
  3: 'It’s okay',
  4: 'Good',
  5: 'Love it',
};

export const feedbackInputSchema = z.object({
  featureId: z.enum(FEATURE_IDS),
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(FEEDBACK_NOTE_MAX),
  /** App version and OS only — never messages, contacts or tokens. */
  diagnostics: z
    .object({
      appVersion: z.string().max(32),
      platform: z.string().max(32),
    })
    .nullable(),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export interface FeedbackEntry {
  id: string;
  featureId: FeedbackFeatureId;
  rating: number;
  note: string;
  createdAt: string;
}

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
