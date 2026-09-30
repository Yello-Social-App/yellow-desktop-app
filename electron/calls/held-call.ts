/**
 * The call this device is part of, so it can be ended when this device leaves.
 *
 * Until a call ends, both users count as "in a call" and anyone ringing them
 * hears BUSY (CALLS-API.md: "Always end a call you will not rejoin"). The
 * renderer hangs up for a user who presses the button; this covers the exits
 * the renderer never sees coming — signing out, switching account, quitting —
 * by sending `call.end` before the socket closes (OWASP A06).
 *
 * "Part of" is deliberately narrow: this device started the call, or fetched
 * a join token for it. A callee's other devices, still only ringing, hold
 * nothing — quitting one of them must not decline a call another device may
 * yet answer. A crash sends nothing, which is what lets the restarted app
 * offer to rejoin.
 *
 * Shape: one field, cleared by the socket's `call.ended`, or by a
 * `call.updated` that shows the viewer out of the call (left from another
 * device, or removed from the group) — an Observer subscription, as the chat
 * alerts use.
 */
import { createLogger } from '../../shared/logger';
import { chatSocket } from '../chat/socket';

const log = createLogger('calls.held');

class HeldCall {
  private callId: string | null = null;
  private detach: (() => void) | null = null;

  /** Starts listening to the socket. Once per app; the listener outlives sessions. */
  attach(): void {
    if (this.detach !== null) {
      return;
    }
    this.detach = chatSocket.subscribe((event) => {
      if (event.event !== 'call.ended' && event.event !== 'call.updated') {
        return;
      }
      const { call } = event.data;
      if (call.id !== this.callId) {
        return;
      }
      const viewerId = chatSocket.viewerId();
      const own = call.participants.find((participant) => participant.userId === viewerId);
      if (event.event === 'call.ended' || (own !== undefined && own.state !== 'JOINED')) {
        this.callId = null;
      }
    });
  }

  /** This device started the call, or is joining its media. */
  hold(callId: string): void {
    this.callId = callId;
  }

  /** Hangs up the held call, if any, while the socket is still up. */
  endHeld(): void {
    const callId = this.callId;
    this.callId = null;
    if (callId === null) {
      return;
    }
    const sent = chatSocket.send('call.end', { callId });
    log.info('held_call_ended', { sent });
  }
}

/** One per app: a container-scoped single instance, not a static global. */
export const heldCall = new HeldCall();
