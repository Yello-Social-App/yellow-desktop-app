/**
 * Reporting a post, muting an account, and hiding one post.
 *
 * Each call acts as the token's owner; the only id the renderer supplies is
 * the post or user acted on, and it is percent-encoded into its own path
 * segment by ENDPOINTS (OWASP A01/A05). A report's details are the reporter's
 * words and never reach the log (A09).
 *
 * Blocking lives with the friendship routes (friends.handler.ts), because
 * upstream it answers with a `friendStatus` the way they do.
 */

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { noContentSchema } from '../../api/envelope';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS, type IpcChannel } from '../channels';
import { registerIpcHandler } from '../register';

import {
  ipcOk,
  muteUserRequestSchema,
  mutedUserPageSchema,
  postIdRequestSchema,
  postReportPageSchema,
  postReportSchema,
  safetyPageRequestSchema,
  submitReportRequestSchema,
  type AcknowledgedResponse,
  type IpcResult,
  type MutedUserPage,
  type PostReportPage,
  type PostReportResponse,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.safety');

/**
 * Mute, unmute, hide and unhide differ only in verb and path, and all four
 * answer 204 whether or not anything changed, so they are one table.
 */
const TOGGLES: readonly {
  channel: IpcChannel;
  method: 'post' | 'delete';
  target: 'user' | 'post';
  event: string;
}[] = [
  { channel: IPC_CHANNELS.SAFETY_MUTE, method: 'post', target: 'user', event: 'user_muted' },
  { channel: IPC_CHANNELS.SAFETY_UNMUTE, method: 'delete', target: 'user', event: 'user_unmuted' },
  { channel: IPC_CHANNELS.SAFETY_HIDE_POST, method: 'post', target: 'post', event: 'post_hidden' },
  {
    channel: IPC_CHANNELS.SAFETY_UNHIDE_POST,
    method: 'delete',
    target: 'post',
    event: 'post_unhidden',
  },
];

async function toggle(
  method: 'post' | 'delete',
  url: string,
  event: string,
): Promise<IpcResult<AcknowledgedResponse>> {
  const result = await apiRequest({ method, url, schema: noContentSchema });
  if (!result.ok) {
    return result;
  }
  log.info(event, {});
  return ipcOk({ acknowledged: true });
}

export function registerSafetyHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.SAFETY_REPORT_POST,
    submitReportRequestSchema,
    async ({ postId, reason, details }): Promise<IpcResult<PostReportResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.posts.reports(postId),
        // No `status`: a new report is always UNDER_REVIEW, and that is the
        // server's to set.
        body: { reason, details: details === '' ? null : details },
        schema: postReportSchema,
      });

      log.info(result.ok ? 'post_reported' : 'post_report_failed', { reason });
      return result.ok ? ipcOk({ report: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.SAFETY_LIST_MY_REPORTS,
    safetyPageRequestSchema,
    async ({ page, size }): Promise<IpcResult<PostReportPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.reports.mine,
        schema: postReportPageSchema,
        params: { page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.SAFETY_LIST_MUTED,
    safetyPageRequestSchema,
    async ({ page, size }): Promise<IpcResult<MutedUserPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.users.muted,
        schema: mutedUserPageSchema,
        params: { page, size },
      }),
  );

  for (const change of TOGGLES) {
    if (change.target === 'user') {
      registerIpcHandler(change.channel, muteUserRequestSchema, ({ userId }) =>
        toggle(change.method, ENDPOINTS.users.mute(userId), change.event),
      );
    } else {
      registerIpcHandler(change.channel, postIdRequestSchema, ({ postId }) =>
        toggle(change.method, ENDPOINTS.posts.hide(postId), change.event),
      );
    }
  }
}
