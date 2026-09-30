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
 * has none — its outcome is the fan-out — so it is matched to the frame that
 * names its call and shows the viewer JOINED: `call.accepted` for the first
 * answer, `call.updated` for a later join to a group call, or `call.ended`.
 * Accepting a call the viewer is already JOINED in sends nothing back at all,
 * so a wait that times out asks `GET /calls/active` before giving up. Decline
 * and end are sent and left: `call.end` is "leave", a no-op for someone not
 * in the call, and the renderer closes its call UI on the user's word, not on
 * the echo.
 *
 * Who may do what (who may ring whom, blocks, the group size, one call per
 * user) is the service's call. Nothing here names the actor — the socket's
 * own authenticated user is always the one acting (A01).
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
import {
  canShareScreenAudio,
  chooseScreenSource,
  listScreenSources,
} from '../../calls/screen-capture';
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
  conversationIdRequestSchema,
  emptyRequestSchema,
  ipcFail,
  ipcOk,
  screenSourceListSchema,
  startCallRequestSchema,
  type AcknowledgedResponse,
  type ActiveCallResponse,
  type Call,
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

/**
 * The viewer is in this call. A roster-less call (a service from before group
 * calls) has only one frame that can mean it: the first answer.
 */
function viewerJoined(call: Call, viewerId: string | null, isFirstAnswer: boolean): boolean {
  if (call.participants.length === 0) {
    return isFirstAnswer;
  }
  return call.participants.some(
    (participant) => participant.userId === viewerId && participant.state === 'JOINED',
  );
}

/**
 * After an accept got no frame back: the viewer may already have been JOINED
 * (from another device), which the service answers with silence.
 */
async function joinedAlready(callId: string): Promise<Call | null> {
  const active = await apiRequest({
    method: 'get',
    url: ENDPOINTS.chat.activeCall,
    schema: activeCallResponseSchema,
    service: 'chat',
  });
  if (!active.ok || active.data.call?.id !== callId) {
    return null;
  }
  const { call } = active.data;
  return viewerJoined(call, chatSocket.viewerId(), call.status === 'ACTIVE') ? call : null;
}

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
      const viewerId = chatSocket.viewerId();
      try {
        const outcome = await chatSocket.requestOutcome('call.accept', { callId }, (event) => {
          switch (event.event) {
            case 'call.ended':
              return event.data.call.id === callId;
            case 'call.accepted':
            case 'call.updated':
              return (
                event.data.call.id === callId &&
                viewerJoined(event.data.call, viewerId, event.event === 'call.accepted')
              );
            default:
              return false;
          }
        });
        if (
          outcome.event !== 'call.accepted' &&
          outcome.event !== 'call.updated' &&
          outcome.event !== 'call.ended'
        ) {
          return ipcFail('UNKNOWN', 'The call could not be answered.');
        }
        log.info('call_accepted', { status: outcome.data.call.status, frame: outcome.event });
        return ipcOk(callResponseSchema.parse({ call: outcome.data.call }));
      } catch (failure: unknown) {
        if (failure instanceof SocketFailure && failure.code === 'TIMEOUT') {
          const call = await joinedAlready(callId);
          if (call !== null) {
            log.info('call_accept_already_joined', {});
            return ipcOk(callResponseSchema.parse({ call }));
          }
        }
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
    IPC_CHANNELS.CALLS_CONVERSATION,
    conversationIdRequestSchema,
    async ({ conversationId }): Promise<IpcResult<ActiveCallResponse>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.chat.conversationCall(conversationId),
        schema: activeCallResponseSchema,
        service: 'chat',
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.CALLS_SCREEN_SOURCES,
    emptyRequestSchema,
    async (): Promise<IpcResult<ScreenSourceList>> => {
      try {
        return ipcOk(
          screenSourceListSchema.parse({
            sources: await listScreenSources(),
            canShareAudio: canShareScreenAudio(),
          }),
        );
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
    ({ sourceId, withAudio }): IpcResult<AcknowledgedResponse> =>
      chooseScreenSource(sourceId, withAudio)
        ? ipcOk(acknowledgedResponseSchema.parse({ acknowledged: true }))
        : ipcFail('INVALID_PAYLOAD', 'That screen is no longer available.'),
  );
}
