/**
 * Call vocabulary for the renderer: the phases the call UI moves through, and
 * the words it uses for how a call ended or why it could not start.
 */
import type { Call, CallEndReason, CallParticipantState, IpcError } from '@shared/ipc-types';

/**
 * Where this device is in a call.
 *
 * - `outgoing` — this device rings someone ("Calling…");
 * - `incoming` — someone rings this device;
 * - `connecting` — answered or joining here, getting into the media room;
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
 * The viewer's own entry in the roster, which decides every frame about the
 * call: INVITED keeps ringing, JOINED stays in, anything else closes. Null
 * when the viewer is not listed — or the call has no roster (a service from
 * before group calls), where the status alone has to say.
 */
export function ownState(call: Call, viewerId: string | null): CallParticipantState | null {
  return call.participants.find((participant) => participant.userId === viewerId)?.state ?? null;
}

/** How many people the service counts as in the call. */
export function joinedCount(call: Call): number {
  return call.participants.filter((participant) => participant.state === 'JOINED').length;
}

/** How many are still being rung. */
export function ringingCount(call: Call): number {
  return call.participants.filter((participant) => participant.state === 'INVITED').length;
}

/**
 * How a call ended, in the words CALLS-API.md suggests — from this side's
 * point of view, since "cancelled" is the caller's word for the callee's
 * "missed call". `name` is the other person in a direct call, and whoever
 * started a group call. An unknown reason still reads as an ending.
 */
export function endedCopy(
  reason: string,
  asCaller: boolean,
  name: string,
  isGroup: boolean,
): string {
  const missed = isGroup ? `Missed group call from ${name}` : `Missed call from ${name}`;
  switch (reason as CallEndReason) {
    case 'HANGUP':
      return 'Call ended';
    case 'DECLINED':
      if (!asCaller) {
        return 'Declined';
      }
      return isGroup ? 'Everyone declined' : `${name} declined`;
    case 'CANCELLED':
      return asCaller ? 'Cancelled' : missed;
    case 'MISSED':
      return asCaller ? 'No answer' : missed;
    case 'BUSY':
      return isGroup ? 'Nobody else is free right now' : `${name} is on another call`;
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
      return 'That call could not be placed.';
    case 'FORBIDDEN':
      return 'You cannot place or join this call.';
    case 'NOT_FOUND':
      return 'This call is no longer available.';
    case 'CONFLICT':
      switch (error.apiReason) {
        case 'CALL_FULL':
          return 'This call is full.';
        case 'ALREADY_IN_CALL':
          return 'You are in another call. Leave it first.';
        case 'CALL_IN_PROGRESS':
          return 'A call is already going on here. Join it instead.';
        default:
          return 'This call has already ended.';
      }
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
