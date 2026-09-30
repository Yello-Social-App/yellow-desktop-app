/**
 * Desktop chat alerts: the stand-in for the chat pushes a phone receives.
 *
 * The notify service delivers chat alerts over FCM only, to registered
 * devices, and never writes them to the inbox — so the inbox watcher will never
 * see one, and a desktop app has no FCM token to register. What this client
 * *does* have is the live socket, which carries the same events. This turns
 * them into the three pushes the notify guide describes:
 *
 *   - `CHAT_MESSAGE` — someone else's new line. One alert per conversation: a
 *     newer line replaces the older alert, as Android's `tag` does;
 *   - `CHAT_REACTION` — a first reaction by someone on one of your messages;
 *     changing or removing it alerts nothing, and neither does your own;
 *   - `CHAT_MESSAGE_DELETED` — the unsend. Nothing is shown; the alert for that
 *     message is taken down if it is still up.
 *
 * And the call pushes a phone gets (`CALL_INCOMING`, `CALL_MISSED`), which a
 * desktop is not sent: the call guide has it ring from `call.ringing`
 * instead. The incoming-call alert is up while the call rings for you — your
 * own answer anywhere, a decline, a cancel or a miss takes it down; in a
 * group, someone else answering does not — and the taskbar entry flashes with
 * it. It carries Accept and Decline where the OS draws alert buttons (macOS,
 * Windows); pressing one is handed to the renderer, which owns the call.
 * Clicking the alert itself only brings the window forward: the
 * incoming-call screen is already there. A ring that ends unanswered — timed
 * out, or the caller gave up — leaves a "Missed call" alert in its place,
 * which opens the conversation. After a reconnect, `GET /calls/active` says
 * whether a call still rings for you, and the alert comes back if so.
 *
 * The rules the service applies to pushes are applied here to alerts: nothing
 * while you are looking (the service pushes only to people offline in chat;
 * the desktop analogue is a window without focus), nothing when push is off,
 * and nothing of a type you muted — the same preferences, read from the same
 * place the inbox watcher keeps them.
 *
 * Reactions are only noticed on messages this session has seen you send: the
 * frame names the message but not its author, and remembering your own recent
 * lines is how the author is known without a fetch per reaction. A reaction to
 * something you sent before the app opened therefore raises nothing — the
 * honest cost of not guessing.
 *
 * Shape: a plain class holding two bounded maps, subscribed to the socket.
 * There is one variant of alert delivery (the OS notification), so no Strategy.
 */
import { BrowserWindow, Notification } from 'electron';

import { createLogger } from '../../shared/logger';
import { ENDPOINTS } from '../api/endpoints';
import { apiRequest } from '../api/http-client';
import { notificationWatcher, toPlainText } from '../notifications/watcher';
import {
  activeCallResponseSchema,
  userSchema,
  type Call,
  type ChatEvent,
  type ChatMessage,
  type ChatReaction,
} from '../../shared/ipc-types';

import { chatSocket } from './socket';

const log = createLogger('chat.alerts');

const TITLE_MAX = 120;
const BODY_MAX = 240;
/** Your own recent lines, remembered so a reaction to one can be attributed. */
const OWN_MESSAGES_MAX = 300;
/** Names resolved for alert titles. */
const NAMES_MAX = 200;
/** Missed-call alerts kept up, one per conversation. */
const MISSED_MAX = 20;

interface ShownAlert {
  messageId: string;
  toast: Notification;
}

interface OwnMessage {
  conversationId: string;
  snippet: string;
  /** Who had reacted as of the last frame; a new id here is a first reaction. */
  reactors: Set<string>;
}

/** Inserts or refreshes a key, evicting the oldest past `max`. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      break;
    }
    map.delete(oldest.value);
  }
}

const ATTACHMENT_WORDING = {
  IMAGE: 'Sent a photo',
  VOICE: 'Sent a voice message',
  FILE: 'Sent a file',
} as const;

/** What an alert says for a line, following the service's own wording. */
function describe(message: ChatMessage): string {
  if (message.body !== '') {
    return message.body;
  }
  if (message.groupInvite !== null) {
    return `Invited you to ${message.groupInvite.title ?? 'a group'}`;
  }
  if (message.sticker !== null) {
    return 'Sent a sticker';
  }
  const [first] = message.attachments;
  if (first !== undefined) {
    return ATTACHMENT_WORDING[first.kind];
  }
  return 'Sent a message';
}

function reactorsOf(reactions: readonly ChatReaction[]): Map<string, string> {
  const byUser = new Map<string, string>();
  for (const reaction of reactions) {
    for (const userId of reaction.userIds) {
      byUser.set(userId, reaction.emoji);
    }
  }
  return byUser;
}

function ownState(call: Call, viewerId: string | null): string | undefined {
  return call.participants.find((participant) => participant.userId === viewerId)?.state;
}

/**
 * Whether the viewer is still being rung for this call. A roster-less call (a
 * service from before group calls) reads as not: its answer ends the ring.
 */
function isStillRung(call: Call, viewerId: string | null): boolean {
  return ownState(call, viewerId) === 'INVITED';
}

/**
 * An ended call that rang here went unanswered: timed out, or the caller gave
 * up while it rang (still INVITED at the end). Declined is not missed; a
 * roster-less call has only the reason to say so.
 */
function endedUnanswered(call: Call, viewerId: string | null, reason: string): boolean {
  const own = ownState(call, viewerId);
  if (own === undefined) {
    return reason !== 'DECLINED';
  }
  return own === 'MISSED' || own === 'INVITED';
}

function callWording(call: Call, what: 'Incoming' | 'Missed'): string {
  const kind = call.media === 'video' ? 'video' : 'voice';
  return call.kind === 'GROUP' ? `${what} group ${kind} call` : `${what} ${kind} call`;
}

interface ToastExtras {
  /** Button labels; drawn on macOS and Windows, ignored elsewhere. */
  actions?: readonly string[];
  onAction?: (index: number) => void;
  /** Stays until dismissed rather than timing out (Linux, Windows). */
  persistent?: boolean;
}

class ChatAlerts {
  /** `chat:<conversationId>` — the one alert up per conversation. */
  private readonly byConversation = new Map<string, ShownAlert>();
  /** `chat.reaction:<messageId>` — the one reaction alert up per message. */
  private readonly byReactedMessage = new Map<string, Notification>();
  private readonly ownMessages = new Map<string, OwnMessage>();
  private readonly names = new Map<string, string>();
  /**
   * The incoming call ringing here, if any: at most one rings at a time. Kept
   * whether or not an alert could be shown, since it is also what makes a
   * later end a "missed" call.
   */
  private ringing: { callId: string; toast: Notification | null } | null = null;
  /** `call:<conversationId>` — the one missed-call alert up per conversation. */
  private readonly missedByConversation = new Map<string, Notification>();
  private detach: (() => void) | null = null;

  /** Starts listening to the socket. Once per app; the listener outlives sessions. */
  attach(): void {
    if (this.detach !== null) {
      return;
    }
    this.detach = chatSocket.subscribe((event) => {
      this.handle(event);
    });
  }

  /** Takes every alert down and forgets the session. Called as a session ends. */
  reset(): void {
    for (const shown of this.byConversation.values()) {
      shown.toast.close();
    }
    for (const toast of this.byReactedMessage.values()) {
      toast.close();
    }
    for (const toast of this.missedByConversation.values()) {
      toast.close();
    }
    this.byConversation.clear();
    this.byReactedMessage.clear();
    this.missedByConversation.clear();
    this.ownMessages.clear();
    this.names.clear();
    this.stopRinging(null);
  }

  private handle(event: ChatEvent): void {
    switch (event.event) {
      case 'message.new':
        this.onMessage(event.data.message);
        return;
      case 'message.deleted':
        this.onDeleted(event.data.conversationId, event.data.messageId);
        return;
      case 'message.reactions':
        this.onReactions(event.data.messageId, event.data.reactions);
        return;
      case 'socket':
        if (event.data.status === 'connected') {
          void this.recoverRing();
        }
        return;
      case 'call.ringing':
        this.onRinging(event.data.call);
        return;
      case 'call.accepted':
      case 'call.updated': {
        // In a group, someone else answering does not stop your ring; the call
        // going on without you after your ring timed out does.
        const { call } = event.data;
        const viewerId = chatSocket.viewerId();
        if (!isStillRung(call, viewerId) && this.stopRinging(call.id)) {
          if (ownState(call, viewerId) === 'MISSED') {
            this.onMissed(call);
          }
        }
        return;
      }
      case 'call.ended': {
        const { call, reason } = event.data;
        if (this.stopRinging(call.id) && endedUnanswered(call, chatSocket.viewerId(), reason)) {
          this.onMissed(call);
        }
        return;
      }
      case 'conversation.removed': {
        // Out of the group: an alert from it would open a thread you cannot read.
        const shown = this.byConversation.get(event.data.conversationId);
        shown?.toast.close();
        this.byConversation.delete(event.data.conversationId);
        return;
      }
      default:
        return;
    }
  }

  private onMessage(message: ChatMessage): void {
    const viewerId = chatSocket.viewerId();
    if (viewerId === null || message.deletedAt !== null) {
      return;
    }

    if (message.senderId === viewerId) {
      remember(
        this.ownMessages,
        message.id,
        {
          conversationId: message.conversationId,
          snippet: describe(message),
          reactors: new Set(reactorsOf(message.reactions).keys()),
        },
        OWN_MESSAGES_MAX,
      );
      // You answered from here, or from another device: you have seen it.
      this.takeDown(message.conversationId);
      return;
    }

    if (!this.shouldAlert('CHAT_MESSAGE')) {
      return;
    }
    void this.nameOf(message.senderId).then((name) => {
      // Rechecked: the window may have gained focus while the name resolved.
      if (!this.shouldAlert('CHAT_MESSAGE')) {
        return;
      }
      const toast = this.show(name, describe(message), message.conversationId);
      if (toast === null) {
        return;
      }
      this.byConversation.get(message.conversationId)?.toast.close();
      this.byConversation.set(message.conversationId, { messageId: message.id, toast });
    });
  }

  private onDeleted(conversationId: string, messageId: string): void {
    const shown = this.byConversation.get(conversationId);
    if (shown?.messageId === messageId) {
      shown.toast.close();
      this.byConversation.delete(conversationId);
      log.info('chat_alert_withdrawn', {});
    }
    this.byReactedMessage.get(messageId)?.close();
    this.byReactedMessage.delete(messageId);
    this.ownMessages.delete(messageId);
  }

  private onReactions(messageId: string, reactions: readonly ChatReaction[]): void {
    const own = this.ownMessages.get(messageId);
    const viewerId = chatSocket.viewerId();
    if (own === undefined || viewerId === null) {
      return;
    }

    const current = reactorsOf(reactions);
    const newcomers = [...current.entries()].filter(
      ([userId]) => userId !== viewerId && !own.reactors.has(userId),
    );
    own.reactors = new Set(current.keys());

    const [first] = newcomers;
    if (first === undefined || !this.shouldAlert('CHAT_REACTION')) {
      return;
    }
    const [reactorId, emoji] = first;
    void this.nameOf(reactorId).then((name) => {
      if (!this.shouldAlert('CHAT_REACTION')) {
        return;
      }
      const toast = this.show(name, `Reacted ${emoji} to "${own.snippet}"`, own.conversationId);
      if (toast === null) {
        return;
      }
      this.byReactedMessage.get(messageId)?.close();
      this.byReactedMessage.set(messageId, toast);
    });
  }

  private onRinging(call: Call): void {
    const viewerId = chatSocket.viewerId();
    if (
      viewerId === null ||
      call.initiatorId === viewerId ||
      call.status !== 'RINGING' ||
      this.ringing?.callId === call.id
    ) {
      return;
    }
    this.stopRinging(null);
    this.ringing = { callId: call.id, toast: null };
    if (!this.shouldAlert('CALL_INCOMING')) {
      return;
    }
    this.mainWindow()?.flashFrame(true);
    void this.nameOf(call.initiatorId, 'Yello').then((name) => {
      // Rechecked: answered, declined or focused while the name resolved.
      if (this.ringing?.callId !== call.id || !this.shouldAlert('CALL_INCOMING')) {
        return;
      }
      this.ringing.toast = this.showToast(
        name,
        callWording(call, 'Incoming'),
        () => {
          this.focusWindow();
        },
        {
          actions: ['Accept', 'Decline'],
          onAction: (index) => {
            this.answer(call.id, index === 0 ? 'accept' : 'decline');
          },
          persistent: true,
        },
      );
    });
  }

  /**
   * Accept or Decline pressed on the alert. The renderer holds the call — the
   * answer, the media room, the call screen — so it is told, not bypassed;
   * the window comes forward only for an answer.
   */
  private answer(callId: string, action: 'accept' | 'decline'): void {
    this.stopRinging(callId);
    if (action === 'accept') {
      this.focusWindow();
    }
    log.info('call_alert_action', { action });
    chatSocket.announce({ event: 'alert.call', data: { callId, action } });
  }

  /** The ring ended unanswered: a "Missed call" alert takes its place. */
  private onMissed(call: Call): void {
    if (!this.shouldAlert('CALL_MISSED')) {
      return;
    }
    void this.nameOf(call.initiatorId, 'Yello').then((name) => {
      if (!this.shouldAlert('CALL_MISSED')) {
        return;
      }
      const toast = this.showToast(name, callWording(call, 'Missed'), () => {
        this.missedByConversation.delete(call.conversationId);
        this.activate(call.conversationId);
      });
      if (toast === null) {
        return;
      }
      this.missedByConversation.get(call.conversationId)?.close();
      remember(this.missedByConversation, call.conversationId, toast, MISSED_MAX);
    });
  }

  /**
   * After a (re)connect: a call that rang while the socket was down, and
   * still rings for you, is announced again; a ring shown here that ended
   * meanwhile is taken down (whether it was missed is not known, so no alert).
   */
  private async recoverRing(): Promise<void> {
    const result = await apiRequest({
      method: 'get',
      url: ENDPOINTS.chat.activeCall,
      schema: activeCallResponseSchema,
      service: 'chat',
    });
    if (!result.ok) {
      return;
    }
    const { call } = result.data;
    if (call !== null && isStillRung(call, chatSocket.viewerId())) {
      this.onRinging(call);
      return;
    }
    if (this.ringing !== null && this.ringing.callId !== call?.id) {
      this.stopRinging(null);
    }
  }

  /**
   * Takes the incoming-call alert down: for this call, or whichever is up
   * (null). True when a ring was up here and is now down.
   */
  private stopRinging(callId: string | null): boolean {
    if (this.ringing === null || (callId !== null && this.ringing.callId !== callId)) {
      return false;
    }
    this.ringing.toast?.close();
    this.ringing = null;
    this.mainWindow()?.flashFrame(false);
    return true;
  }

  private takeDown(conversationId: string): void {
    this.byConversation.get(conversationId)?.toast.close();
    this.byConversation.delete(conversationId);
  }

  /**
   * Push on, the type not muted, the platform able, and nobody looking. A
   * muted call type silences the alert only: the open app still rings.
   */
  private shouldAlert(
    type: 'CHAT_MESSAGE' | 'CHAT_REACTION' | 'CALL_INCOMING' | 'CALL_MISSED',
  ): boolean {
    const preferences = notificationWatcher.currentPreferences();
    if (!preferences.pushEnabled || preferences.mutedTypes.includes(type)) {
      return false;
    }
    if (!Notification.isSupported()) {
      return false;
    }
    const window = this.mainWindow();
    return window !== undefined && !window.isFocused();
  }

  private mainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  }

  private show(title: string, body: string, conversationId: string): Notification | null {
    return this.showToast(title, body, () => {
      this.activate(conversationId);
    });
  }

  private showToast(
    title: string,
    body: string,
    onClick: () => void,
    extras: ToastExtras = {},
  ): Notification | null {
    const { actions = [], onAction, persistent = false } = extras;
    try {
      const toast = new Notification({
        title: toPlainText(title, TITLE_MAX),
        body: toPlainText(body, BODY_MAX),
        actions: actions.map((text) => ({ type: 'button', text })),
        ...(persistent ? { timeoutType: 'never' } : {}),
      });
      toast.on('click', onClick);
      if (onAction !== undefined) {
        toast.on('action', (details) => {
          onAction(details.actionIndex);
        });
      }
      toast.show();
      log.info('chat_alert_shown', {});
      return toast;
    } catch (error) {
      log.warn('chat_alert_failed', { error });
      return null;
    }
  }

  private focusWindow(): void {
    const window = this.mainWindow();
    if (window === undefined) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  /** A clicked alert: bring the window back and let the renderer open the thread. */
  private activate(conversationId: string): void {
    this.focusWindow();
    this.byConversation.delete(conversationId);
    chatSocket.announce({ event: 'alert.activated', data: { conversationId } });
  }

  /**
   * A display name for an alert title. The chat service knows only ids, so it
   * is resolved against the API once and cached; a lookup that fails still
   * alerts, under a neutral name, rather than dropping the news (A10).
   */
  private async nameOf(userId: string, fallback = 'New message'): Promise<string> {
    const known = this.names.get(userId);
    if (known !== undefined) {
      return known;
    }
    const result = await apiRequest({
      method: 'get',
      url: ENDPOINTS.users.byId(userId),
      schema: userSchema,
    });
    if (!result.ok) {
      return fallback;
    }
    const name = result.data.fullName ?? result.data.username;
    remember(this.names, userId, name, NAMES_MAX);
    return name;
  }
}

/** One per app: a container-scoped single instance, not a static global. */
export const chatAlerts = new ChatAlerts();
