/**
 * Call vocabulary for the renderer: the phases the call UI moves through, and
 * the words it uses for how a call ended or why it could not start.
 */
import type { Call, CallEndReason, IpcError } from '@shared/ipc-types';

/**
 * Where this device is in a call.
 *
 * - `outgoing` — this device rings someone ("Calling…");
 * - `incoming` — someone rings this device;
 * - `connecting` — answered here, joining the media room;
 * - `active` — in the room;
 * - `rejoin` — the service says a call is live that this device is not in
 *   (after a restart or a reconnect): rejoin or end it.
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'rejoin';

/** A short line shown after a call closes, and who it is about. */
export interface CallNotice {
  /** Changes per notice, so the toast restarts its timer. */
  id: number;
  text: string;
  tone: 'neutral' | 'error';
}

export function isCaller(call: Call, viewerId: string | null): boolean {
  return viewerId !== null && call.initiatorId === viewerId;
}

/**
 * How a call ended, in the words CALLS-API.md suggests — from this side's
 * point of view, since "cancelled" is the caller's word for the callee's
 * "missed call". An unknown reason still reads as an ending.
 */
export function endedCopy(reason: string, asCaller: boolean, peerName: string): string {
  switch (reason as CallEndReason) {
    case 'HANGUP':
      return 'Call ended';
    case 'DECLINED':
      return asCaller ? `${peerName} declined` : 'Declined';
    case 'CANCELLED':
      return asCaller ? 'Cancelled' : `Missed call from ${peerName}`;
    case 'MISSED':
      return asCaller ? 'No answer' : `Missed call from ${peerName}`;
    case 'BUSY':
      return `${peerName} is on another call`;
    case 'FAILED':
      return 'Call failed — try again';
    default:
      return 'Call ended';
  }
}

/** Why a call could not be placed, answered or joined, for the person who tried. */
export function callErrorMessage(error: IpcError): string {
  if (error.code === 'NETWORK') {
    return error.message;
  }
  switch (error.apiCode) {
    case 'VALIDATION_ERROR':
      return error.apiReason === 'GROUP_CALL_UNSUPPORTED'
        ? 'Group calls are not available yet.'
        : 'That call could not be placed.';
    case 'FORBIDDEN':
      return 'You cannot call this person.';
    case 'NOT_FOUND':
      return 'This call is no longer available.';
    case 'CONFLICT':
      return 'This call has already ended.';
    case 'RATE_LIMITED':
      return error.retryAfterSeconds === undefined
        ? 'Too many calls — wait a moment and try again.'
        : `Too many calls — try again in ${String(error.retryAfterSeconds)} s.`;
    case 'UNAVAILABLE':
      return 'Calls are not available right now. Try again later.';
    default:
      return error.message;
  }
}

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatCallDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}
