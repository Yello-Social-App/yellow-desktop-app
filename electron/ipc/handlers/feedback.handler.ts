/**
 * Feature feedback: rate one part of Yello 1–5, and read back what was sent.
 *
 * The body is rebuilt field by field from the validated request rather than
 * forwarded, so nothing the renderer adds reaches the server; diagnostics are
 * the app version and OS, and nothing else (OWASP A04). The note is the user's
 * own words and is never logged (A09).
 */

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  feedbackPageSchema,
  feedbackSchema,
  ipcOk,
  safetyPageRequestSchema,
  submitFeedbackRequestSchema,
  type FeedbackPage,
  type FeedbackResponse,
  type IpcResult,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.feedback');

export function registerFeedbackHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.FEEDBACK_SUBMIT,
    submitFeedbackRequestSchema,
    async (request): Promise<IpcResult<FeedbackResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.feedback.create,
        body: {
          featureId: request.featureId,
          rating: request.rating,
          note: request.note === '' ? null : request.note,
          diagnostics:
            request.diagnostics === null
              ? null
              : {
                  appVersion: request.diagnostics.appVersion,
                  platform: request.diagnostics.platform,
                },
        },
        schema: feedbackSchema,
      });

      log.info(result.ok ? 'feedback_sent' : 'feedback_failed', {
        featureId: request.featureId,
      });
      return result.ok ? ipcOk({ feedback: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.FEEDBACK_LIST_MINE,
    safetyPageRequestSchema,
    async ({ page, size }): Promise<IpcResult<FeedbackPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.feedback.mine,
        schema: feedbackPageSchema,
        params: { page, size },
      }),
  );
}
