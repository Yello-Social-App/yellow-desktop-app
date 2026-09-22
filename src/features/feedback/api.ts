/**
 * Feedback, as seen by the renderer. There is no endpoint yet, so the request
 * is answered by `sampleRequest`; this file is the one place that changes when
 * it ships.
 */
import type { IpcError } from '@shared/ipc-types';

import { fail, type Result } from '@/lib/result';
import { sampleId, sampleRequest } from '@/mocks/request';

import { feedbackInputSchema, type FeedbackEntry, type FeedbackInput } from './types';

export async function submitFeedback(
  input: FeedbackInput,
): Promise<Result<FeedbackEntry, IpcError>> {
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'INVALID_PAYLOAD', message: 'Pick a feature and a rating first.' });
  }
  return sampleRequest({
    id: sampleId('fb'),
    featureId: parsed.data.featureId,
    rating: parsed.data.rating,
    note: parsed.data.note,
    createdAt: new Date().toISOString(),
  });
}
