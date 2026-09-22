/**
 * The live chat socket, owned by the main process.
 *
 * Why here and not in the renderer: the socket authenticates with the access
 * token, which never enters the renderer (OWASP A02/A04), and the chat
 * service's origin allowlist is for browsers — a native client sends no Origin
 * and is admitted, which `app://bundle` would not be.
 *
 * Protocol (yello-chat README § WebSocket protocol): every frame is
 * `{ event, data }`; the first frame is `auth { token }`, answered by
 * `auth.ok { userId, expiresAt, onlinePeers }`; when the token's `exp` passes
 * the server closes with 4401 unless a fresh `auth` arrived first. `ref` on a
 * request is echoed on its reply and on an `error`, which is how a
 * `message.send` is matched to its `message.sent`.
 *
 * What the renderer sees is narrower than the wire: frames are parsed here
 * against `chatEventSchema` before they are pushed, so an unknown or malformed
 * frame never reaches the page (A08). Frame bodies are not logged (A09).
 *
 * The shape of the problem is a connection with a handful of states and
 * timers, so this is a plain class with a state field rather than a State
 * pattern — three states and no per-state behaviour split do not earn one.
 *
 * Parsed frames have two audiences: every renderer window, and the desktop
 * chat alerts (alerts.ts), which run in this process. That second consumer is
 * what earns `subscribe` — an Observer in its plainest spelling, a set of
 * callbacks — rather than the alerts reaching into the socket's internals.
 */
import { randomUUID } from 'node:crypto';

import { BrowserWindow } from 'electron';
import { z } from 'zod';

import { chatBaseUrl, ensureFreshAccessToken } from '../api/http-client';
import { ENDPOINTS } from '../api/endpoints';
import { IPC_CHANNELS } from '../ipc/channels';
import { createLogger } from '../../shared/logger';
import {
  chatEventSchema,
  type ChatEvent,
  type ChatSocketState,
  type ChatSocketStatus,
} from '../../shared/ipc-types';

const log = createLogger('chat.socket');

const MAX_FRAME_BYTES = 64 * 1024;
const REPLY_TIMEOUT_MS = 10_000;
const REAUTH_MARGIN_MS = 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 45 * 1000;
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;
const FLOOD_BACKOFF_MS = 60 * 1000;

/** Server close codes the README documents. */
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FLOODING = 4429;
const CLOSE_NORMAL = 1000;

const serverFrameSchema = z.object({
  event: z.string().min(1).max(64),
  data: z.record(z.string(), z.unknown()).nullish(),
});

const authOkSchema = z.object({
  userId: z.string().min(1).max(64),
  expiresAt: z.union([z.string(), z.number()]),
  onlinePeers: z.array(z.string().min(1).max(64)).max(5000).nullish(),
});

const errorFrameSchema = z.object({
  code: z.string().max(64),
  message: z.string().max(500),
  ref: z.string().max(64).optional(),
});

/** A refusal from the service, or a transport failure, with a stable code. */
export class SocketFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SocketFailure';
  }
}

interface PendingReply {
  replyEvent: string;
  resolve: (data: unknown) => void;
  reject: (failure: SocketFailure) => void;
  timer: NodeJS.Timeout;
}

function socketUrl(): string {
  const url = new URL(ENDPOINTS.chat.socket, chatBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function toEpoch(value: string | number): number {
  if (typeof value === 'number') {
    // Seconds (a JWT exp) or milliseconds: anything before 1e12 is seconds.
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() + REAUTH_MARGIN_MS * 2 : parsed;
}

class ChatSocket {
  private socket: WebSocket | null = null;
  private status: ChatSocketStatus = 'disconnected';
  /** True between connect() and disconnect(): whether to keep a socket up. */
  private wanted = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reauthTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatDeadline: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingReply>();
  private readonly online = new Set<string>();
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  /** Who the socket is authenticated as, from `auth.ok`; null while it is not. */
  private userId: string | null = null;

  state(): ChatSocketState {
    return { status: this.status, onlineUserIds: [...this.online] };
  }

  /** The authenticated user's id, or null before `auth.ok` and after a close. */
  viewerId(): string | null {
    return this.userId;
  }

  /** Every frame the renderer is sent, also delivered in-process. Returns the detach. */
  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Publishes a locally originated event (a clicked alert) to the renderer. */
  announce(event: ChatEvent): void {
    this.publish(event);
  }

  isConnected(): boolean {
    return this.status === 'connected' && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Idempotent: a second call while up or in progress is a no-op. */
  connect(): void {
    if (this.wanted) {
      return;
    }
    this.wanted = true;
    this.reconnectAttempt = 0;
    void this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearTimers();
    this.failPending(new SocketFailure('DISCONNECTED', 'The chat connection was closed.'));
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close(CLOSE_NORMAL, 'signed out');
      } catch {
        // Already closed.
      }
    }
    this.online.clear();
    this.userId = null;
    this.setStatus('disconnected');
  }

  /** Fire-and-forget. Returns false when there is no open socket to send on. */
  send(event: string, data: Record<string, unknown>): boolean {
    if (!this.isConnected() || this.socket === null) {
      return false;
    }
    const frame = JSON.stringify({ event, data });
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
      log.warn('frame_too_large', { event });
      return false;
    }
    this.socket.send(frame);
    return true;
  }

  /**
   * Sends a frame and resolves with the `data` of the reply that echoes its
   * `ref`, or rejects with the `error` that does. Times out rather than hangs.
   */
  request(event: string, data: Record<string, unknown>, replyEvent: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ref = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(ref);
        reject(new SocketFailure('TIMEOUT', 'The chat service did not answer in time.'));
      }, REPLY_TIMEOUT_MS);
      this.pending.set(ref, { replyEvent, resolve, reject, timer });

      if (!this.send(event, { ...data, ref })) {
        clearTimeout(timer);
        this.pending.delete(ref);
        reject(new SocketFailure('DISCONNECTED', 'The chat connection is down.'));
      }
    });
  }

  /** Read through a call so a change across an `await` is not narrowed away. */
  private stillWanted(): boolean {
    return this.wanted;
  }

  private async open(): Promise<void> {
    if (!this.wanted || this.socket !== null) {
      return;
    }

    this.setStatus('connecting');

    const token = await ensureFreshAccessToken();
    if (token === null) {
      // No session to authenticate with: nothing to reconnect to, either.
      log.info('socket_no_session', {});
      this.wanted = false;
      this.setStatus('disconnected');
      return;
    }
    // disconnect() may have run while the token was being fetched.
    if (!this.stillWanted()) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch (error) {
      log.error('socket_open_failed', { error });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      // Authenticated by the first frame, never by the URL.
      socket.send(JSON.stringify({ event: 'auth', data: { token } }));
    });

    socket.addEventListener('message', (event) => {
      if (this.socket === socket) {
        this.receive(event.data);
      }
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearTimers();
      this.failPending(new SocketFailure('DISCONNECTED', 'The chat connection dropped.'));
      this.online.clear();
      log.info('socket_closed', { code: event.code });
      this.setStatus('disconnected');

      if (!this.wanted) {
        return;
      }
      if (event.code === CLOSE_FLOODING) {
        this.scheduleReconnect(FLOOD_BACKOFF_MS);
        return;
      }
      if (event.code === CLOSE_UNAUTHENTICATED) {
        // The token was refused or timed out; the next attempt fetches a
        // fresh one first, and gives up if there is no session left.
        log.info('socket_unauthenticated', {});
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // 'close' follows and carries the code; nothing to add here.
    });
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) {
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      log.warn('frame_unparseable', {});
      return;
    }

    const frame = serverFrameSchema.safeParse(json);
    if (!frame.success) {
      log.warn('frame_rejected', {});
      return;
    }

    const { event, data } = frame.data;
    const body = data ?? {};

    switch (event) {
      case 'auth.ok':
        this.onAuthenticated(body);
        return;
      case 'error':
        this.onError(body);
        return;
      case 'pong':
        this.settle(body, event);
        return;
      case 'message.sent':
        this.settle(body, event);
        return;
      case 'presence':
        this.onPresence(body);
        break;
      default:
        break;
    }

    // Everything else is for the renderer, once it is known to be well-formed.
    const parsed = chatEventSchema.safeParse({ event, data: body });
    if (parsed.success) {
      this.publish(parsed.data);
    } else {
      log.info('frame_ignored', { event });
    }
  }

  private onAuthenticated(body: Record<string, unknown>): void {
    const parsed = authOkSchema.safeParse(body);
    if (!parsed.success) {
      log.warn('auth_ok_rejected', {});
      return;
    }

    this.reconnectAttempt = 0;
    this.userId = parsed.data.userId;
    this.online.clear();
    for (const peer of parsed.data.onlinePeers ?? []) {
      this.online.add(peer);
    }

    this.scheduleReauth(toEpoch(parsed.data.expiresAt));
    this.startHeartbeat();
    log.info('socket_authenticated', {});
    this.setStatus('connected');
  }

  private onError(body: Record<string, unknown>): void {
    const parsed = errorFrameSchema.safeParse(body);
    if (!parsed.success) {
      return;
    }
    const { code, message, ref } = parsed.data;
    log.warn('socket_error_frame', { code, correlated: ref !== undefined });

    if (ref !== undefined) {
      const waiting = this.pending.get(ref);
      if (waiting !== undefined) {
        clearTimeout(waiting.timer);
        this.pending.delete(ref);
        waiting.reject(new SocketFailure(code, message));
      }
      return;
    }

    // An uncorrelated UNAUTHORIZED means the auth frame was refused: the
    // server closes with 4401 next, and the reconnect fetches a fresh token.
  }

  private onPresence(body: Record<string, unknown>): void {
    const userId = body.userId;
    const online = body.online;
    if (typeof userId !== 'string' || typeof online !== 'boolean') {
      return;
    }
    if (online) {
      this.online.add(userId);
    } else {
      this.online.delete(userId);
    }
  }

  /** Resolves the request waiting on this reply, if any. */
  private settle(body: Record<string, unknown>, event: string): void {
    const ref = body.ref;
    if (typeof ref !== 'string') {
      return;
    }
    const waiting = this.pending.get(ref);
    if (waiting?.replyEvent !== event) {
      return;
    }
    clearTimeout(waiting.timer);
    this.pending.delete(ref);
    waiting.resolve(body);
  }

  private failPending(failure: SocketFailure): void {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(failure);
    }
    this.pending.clear();
  }

  /**
   * Re-authenticates shortly before the token the socket holds expires, on the
   * same connection, so a live thread never blinks every fifteen minutes.
   */
  private scheduleReauth(expiresAt: number): void {
    if (this.reauthTimer !== null) {
      clearTimeout(this.reauthTimer);
    }
    const delay = Math.max(1000, expiresAt - Date.now() - REAUTH_MARGIN_MS);
    this.reauthTimer = setTimeout(() => {
      this.reauthTimer = null;
      void this.reauthenticate();
    }, delay);
  }

  private async reauthenticate(): Promise<void> {
    const token = await ensureFreshAccessToken();
    if (token === null) {
      // The session is gone; the server would close us shortly anyway.
      log.info('socket_reauth_no_session', {});
      this.disconnect();
      return;
    }
    if (!this.send('auth', { token })) {
      return;
    }
    log.info('socket_reauth_sent', {});
  }

  /**
   * An application-level ping, because a socket that died while the machine
   * slept looks open until something is written to it.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatDeadline !== null) {
        return;
      }
      this.heartbeatDeadline = setTimeout(() => {
        this.heartbeatDeadline = null;
        log.warn('socket_heartbeat_missed', {});
        this.socket?.close(CLOSE_NORMAL, 'heartbeat');
      }, HEARTBEAT_TIMEOUT_MS);

      this.request('ping', {}, 'pong')
        .catch(() => undefined)
        .finally(() => {
          if (this.heartbeatDeadline !== null) {
            clearTimeout(this.heartbeatDeadline);
            this.heartbeatDeadline = null;
          }
        });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatDeadline !== null) {
      clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = null;
    }
  }

  private scheduleReconnect(minimumDelay = 0): void {
    if (!this.wanted || this.reconnectTimer !== null) {
      return;
    }
    const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const jitter = Math.floor(Math.random() * RECONNECT_BASE_MS);
    const delay = Math.max(minimumDelay, exponential + jitter);
    this.reconnectAttempt += 1;

    log.info('socket_reconnect_scheduled', { attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.reauthTimer !== null) {
      clearTimeout(this.reauthTimer);
      this.reauthTimer = null;
    }
    this.stopHeartbeat();
  }

  private setStatus(status: ChatSocketStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.publish({ event: 'socket', data: this.state() });
  }

  private publish(event: ChatEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.CHAT_EVENT, event);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // One consumer failing must not starve the others of the frame (A10).
        log.error('socket_listener_threw', { error });
      }
    }
  }
}

/** One socket per app: a container-scoped single instance, not a static global. */
export const chatSocket = new ChatSocket();
