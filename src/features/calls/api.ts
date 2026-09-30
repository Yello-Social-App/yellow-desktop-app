/**
 * Call operations, as seen by the renderer: one allowlisted IPC call each.
 * The lifecycle travels over the chat socket and the join over HTTP, both in
 * the main process; the renderer only ever holds a join token for the moment
 * it takes to connect.
 */
import type { Call, CallJoin, CallMedia, IpcError, ScreenSource } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type CallsError = IpcError;

export async function startCall(
  conversationId: string,
  media: CallMedia,
): Promise<Result<Call, CallsError>> {
  const result = await ipc.startCall({ conversationId, media });
  return result.ok ? ok(result.data.call) : fail(result.error);
}

/**
 * Answers a ringing call, or joins a group call already going on. Resolves
 * once the service has the viewer JOINED — or with the call ENDED (FAILED, or
 * gone). Only then may this device ask for a join token.
 */
export async function acceptCall(callId: string): Promise<Result<Call, CallsError>> {
  const result = await ipc.acceptCall({ callId });
  return result.ok ? ok(result.data.call) : fail(result.error);
}

/** Fire and forget: the outcome, if the socket was up, arrives as `call.ended`. */
export function declineCall(callId: string): void {
  void ipc.declineCall({ callId });
}

/** Fire and forget: leaves (declines, while rung); the call ends when fewer than two are left. */
export function endCall(callId: string): void {
  void ipc.endCall({ callId });
}

export async function fetchCallJoin(callId: string): Promise<Result<CallJoin, CallsError>> {
  const result = await ipc.joinCall({ callId });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchActiveCall(): Promise<Result<Call | null, CallsError>> {
  const result = await ipc.activeCall();
  return result.ok ? ok(result.data.call) : fail(result.error);
}

/** The conversation's RINGING or ACTIVE call, or null. */
export async function fetchConversationCall(
  conversationId: string,
): Promise<Result<Call | null, CallsError>> {
  const result = await ipc.conversationCall({ conversationId });
  return result.ok ? ok(result.data.call) : fail(result.error);
}

export async function fetchScreenSources(): Promise<
  Result<{ sources: ScreenSource[]; canShareAudio: boolean }, CallsError>
> {
  const result = await ipc.screenSources();
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function chooseScreenSource(
  sourceId: string,
  withAudio: boolean,
): Promise<Result<true, CallsError>> {
  const result = await ipc.chooseScreenSource({ sourceId, withAudio });
  return result.ok ? ok(true) : fail(result.error);
}
