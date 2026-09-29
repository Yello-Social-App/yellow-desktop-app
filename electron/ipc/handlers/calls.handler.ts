/**
 * Calls: start, answer, refuse and end over the chat socket; join tokens and
 * recovery over HTTP; and the screen-share source pick.
 *
 * The lifecycle frames have no HTTP form — the service rings over the socket
 * and nowhere else — so with the socket down a call cannot start or be
 * answered, and these say so rather than pretend. The outcomes (`call.ringing`,
 * `call.accepted`, `call.ended`) reach the renderer as ordinary chat events.
 *
 * `call.start` has a direct reply (`call.started`, by `ref`). `call.accept`
 * has none — its outcome is the fan-out — so it is matched to the
 * `call.accepted` or `call.ended` that names its call. Decline and end are
 * sent and left: ending an ended call is a no-op upstream, and the renderer
 * closes its call UI on the user's word, not on the echo.
 *
 * Who may do what (only the callee answers, blocks, one live call per user)
 * is the service's call. Nothing here names the actor — the socket's own
 * authenticated user is always the one acting (A01).
 *
 * The join token is the one credential that crosses into the renderer: WebRTC
 * runs there, so LiveKit must be connected from there. It is scoped to one
 * room for ten minutes, is never logged, and is handed over only with a
 * `serverUrl` that is on the call host allowlist (A01/A04).
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { heldCall } from '../../calls/held-call';
import { chooseScreenSource, listScreenSources } from '../../calls/screen-capture';
import { chatSocket, SocketFailure } from '../../chat/socket';
import { isCallServerUrl } from '../../security/call-hosts';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  activeCallResponseSchema,
  callIdRequestSchema,
  callJoinSchema,
  callResponseSchema,
  callSchema,
  chooseScreenSourceRequestSchema,
  emptyRequestSchema,
  ipcFail,
  ipcOk,
  screenSourceListSchema,
  startCallRequestSchema,
  type AcknowledgedResponse,
  type ActiveCallResponse,
  type CallJoin,
  type CallResponse,
  type IpcResult,
  type ScreenSourceList,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.calls');

const SOCKET_DOWN: IpcResult<never> = ipcFail(
  'NETWORK',
  'Calls need a live connection. Reconnecting — try again in a moment.',
);

/** `call.started`: the reply to `call.start`, RINGING or already ENDED/BUSY. */
const callStartedSchema = z.object({ call: callSchema });

/** `POST /calls/{id}/token`, as the service answers it; the renderer gets less. */
const callTokenSchema = z.object({
  serverUrl: z.string().min(1).max(2048),
  roomName: z.string().max(256),
  token: z.string().min(1).max(8192),
  expiresAt: z.string().max(64),
});

/** A socket refusal as an IPC failure, keeping the service's code and reason. */
function socketFailure(failure: unknown): IpcResult<never> {
  if (!(failure instanceof SocketFailure)) {
    log.error('call_frame_failed', { error: failure });
    return ipcFail('UNKNOWN', 'The call could not be placed.');
  }
  if (failure.code === 'TIMEOUT' || failure.code === 'DISCONNECTED') {
    return SOCKET_DOWN;
  }
  const { reason, retryAfterMs } = failure.details;
  return ipcFail('API', failure.message, {
    apiCode: failure.code,
    ...(typeof reason === 'string' ? { apiReason: reason.slice(0, 64) } : {}),
    ...(typeof retryAfterMs === 'number' && retryAfterMs > 0
      ? { retryAfterSeconds: Math.min(86_400, Math.ceil(retryAfterMs / 1000)) }
      : {}),
  });
}

export function registerCallHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.CALLS_START,
    startCallRequestSchema,
    async ({ conversationId, media }): Promise<IpcResult<CallResponse>> => {
      if (!chatSocket.isConnected()) {
        return SOCKET_DOWN;
      }
      try {
        const reply = await chatSocket.request(
          'call.start',
          { conversationId, media },
          'call.started',
        );
        const parsed = callStartedSchema.safeParse(reply);
        if (!parsed.success) {
          log.warn('call_started_reply_rejected', {});
          return ipcFail('INVALID_PAYLOAD', 'The call service answered unexpectedly.');
        }
        const { call } = parsed.data;
        if (call.status !== 'ENDED') {
          heldCall.hold(call.id);
        }
        log.info('call_started', { media, status: call.status });
        return ipcOk(callResponseSchema.parse({ call }));
      } catch (failure: unknown) {
        return socketFailure(failure);
      }
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_ACCEPT,
    callIdRequestSchema,
    async ({ callId }): Promise<IpcResult<CallResponse>> => {
      if (!chatSocket.isConnected()) {
        return SOCKET_DOWN;
      }
      try {
        const outcome = await chatSocket.requestOutcome(
          'call.accept',
          { callId },
          (event) =>
            (event.event === 'call.accepted' || event.event === 'call.ended') &&
            event.data.call.id === callId,
        );
        if (outcome.event !== 'call.accepted' && outcome.event !== 'call.ended') {
          return ipcFail('UNKNOWN', 'The call could not be answered.');
        }
        log.info('call_accepted', { status: outcome.data.call.status });
        return ipcOk(callResponseSchema.parse({ call: outcome.data.call }));
      } catch (failure: unknown) {
        return socketFailure(failure);
      }
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_DECLINE,
    callIdRequestSchema,
    ({ callId }): IpcResult<AcknowledgedResponse> => {
      const sent = chatSocket.send('call.decline', { callId });
      return ipcOk(acknowledgedResponseSchema.parse({ acknowledged: sent }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_END,
    callIdRequestSchema,
    ({ callId }): IpcResult<AcknowledgedResponse> => {
      const sent = chatSocket.send('call.end', { callId });
      log.info('call_end_sent', { sent });
      return ipcOk(acknowledgedResponseSchema.parse({ acknowledged: sent }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_JOIN,
    callIdRequestSchema,
    async ({ callId }): Promise<IpcResult<CallJoin>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.chat.callToken(callId),
        schema: callTokenSchema,
        service: 'chat',
      });
      if (!result.ok) {
        return result;
      }
      // A response is untrusted input too: the renderer is only ever sent to
      // a media server someone configured (A01).
      if (!isCallServerUrl(result.data.serverUrl)) {
        log.error('call_server_refused', {});
        return ipcFail('API', 'The call server is not one this app may connect to.', {
          apiCode: 'UNAVAILABLE',
        });
      }
      heldCall.hold(callId);
      log.info('call_join_issued', {});
      const { serverUrl, token, expiresAt } = result.data;
      return ipcOk(callJoinSchema.parse({ serverUrl, token, expiresAt }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_ACTIVE,
    emptyRequestSchema,
    async (): Promise<IpcResult<ActiveCallResponse>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.activeCall,
        schema: activeCallResponseSchema,
        service: 'chat',
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_SCREEN_SOURCES,
    emptyRequestSchema,
    async (): Promise<IpcResult<ScreenSourceList>> => {
      try {
        return ipcOk(screenSourceListSchema.parse({ sources: await listScreenSources() }));
      } catch (error: unknown) {
        // macOS without Screen Recording permission, or no capturer at all.
        log.warn('screen_sources_failed', { error });
        return ipcFail('IO_ERROR', 'Screens could not be listed. Check screen-recording access.');
      }
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_CHOOSE_SCREEN_SOURCE,
    chooseScreenSourceRequestSchema,
    ({ sourceId }): IpcResult<AcknowledgedResponse> =>
      chooseScreenSource(sourceId)
        ? ipcOk(acknowledgedResponseSchema.parse({ acknowledged: true }))
        : ipcFail('INVALID_PAYLOAD', 'That screen is no longer available.'),
  );
}
