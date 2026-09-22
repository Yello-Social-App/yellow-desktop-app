import type { FeedbackEntry } from '@/features/feedback/types';
import type { ReportEntry, RestrictedAccount } from '@/features/moderation/types';

import { hoursAgo, samplePerson } from './people';

/** Feedback "sent" before this session, so the history list has something in it. */
export const SAMPLE_FEEDBACK: readonly FeedbackEntry[] = [
  {
    id: 'fb-1',
    featureId: 'compact-mode',
    rating: 5,
    note: 'Icon-only rails are perfect on my 13" laptop.',
    createdAt: hoursAgo(26),
  },
  {
    id: 'fb-2',
    featureId: 'messages',
    rating: 2,
    note: 'Messages sometimes arrive out of order after waking from sleep.',
    createdAt: hoursAgo(24 * 6),
  },
];

export const SAMPLE_REPORTS: readonly ReportEntry[] = [
  {
    id: 'rp-1',
    postId: 'sample-post-1',
    reason: 'SPAM',
    authorName: 'crypto.gains.daily',
    excerpt: 'Send 0.1 ETH and get 1 ETH back, limited time only…',
    status: 'ACTION_TAKEN',
    createdAt: hoursAgo(24 * 3),
  },
  {
    id: 'rp-2',
    postId: 'sample-post-2',
    reason: 'MISINFORMATION',
    authorName: samplePerson(7).fullName ?? samplePerson(7).username,
    excerpt: 'Turns out Rust compiles to JavaScript under the hood…',
    status: 'NO_VIOLATION',
    createdAt: hoursAgo(24 * 9),
  },
];

export const SAMPLE_MUTED: readonly RestrictedAccount[] = [
  {
    id: samplePerson(5).id,
    name: samplePerson(5).fullName ?? samplePerson(5).username,
    username: samplePerson(5).username,
    since: hoursAgo(24 * 12),
  },
];

export const SAMPLE_BLOCKED: readonly RestrictedAccount[] = [];
