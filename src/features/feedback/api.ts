/**
 * Feedback, as seen by the renderer: one allowlisted IPC call each. The input
 * is checked against the endpoint's schema before it leaves, so a form bug is
 * caught here rather than as a server 400.
 */
import type { IpcError } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import {
  FEEDBACK_HISTORY_SIZE,
  feedbackInputSchema,
  type FeedbackEntry,
  type FeedbackInput,
} from './types';

/** The server allows 10 an hour per user; say so in words, not a code. */
const RATE_LIMITED = 'RATE_LIMIT_EXCEEDED';

export async function submitFeedback(
  input: FeedbackInput,
): Promise<Result<FeedbackEntry, IpcError>> {
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'INVALID_PAYLOAD', message: 'Pick a feature and a rating first.' });
  }
  const result = await ipc.submitFeedback(parsed.data);
  if (result.ok) {
    return ok(result.data.feedback);
  }
  if (result.error.apiCode === RATE_LIMITED) {
    return fail({
      ...result.error,
      message: 'You’ve sent a lot of feedback in the last hour. Try again a little later.',
    });
  }
  return fail(result.error);
}

export async function fetchMyFeedback(): Promise<Result<FeedbackEntry[], IpcError>> {
  const result = await ipc.listMyFeedback({ page: 0, size: FEEDBACK_HISTORY_SIZE });
  return result.ok ? ok(result.data.content) : fail(result.error);
}
