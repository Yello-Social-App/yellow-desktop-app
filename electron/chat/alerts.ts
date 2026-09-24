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
  userSchema,
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

class ChatAlerts {
  /** `chat:<conversationId>` — the one alert up per conversation. */
  private readonly byConversation = new Map<string, ShownAlert>();
  /** `chat.reaction:<messageId>` — the one reaction alert up per message. */
  private readonly byReactedMessage = new Map<string, Notification>();
  private readonly ownMessages = new Map<string, OwnMessage>();
  private readonly names = new Map<string, string>();
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
    this.byConversation.clear();
    this.byReactedMessage.clear();
    this.ownMessages.clear();
    this.names.clear();
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

  private takeDown(conversationId: string): void {
    this.byConversation.get(conversationId)?.toast.close();
    this.byConversation.delete(conversationId);
  }

  /** Push on, the type not muted, the platform able, and nobody looking. */
  private shouldAlert(type: 'CHAT_MESSAGE' | 'CHAT_REACTION'): boolean {
    const preferences = notificationWatcher.currentPreferences();
    if (!preferences.pushEnabled || preferences.mutedTypes.includes(type)) {
      return false;
    }
    if (!Notification.isSupported()) {
      return false;
    }
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    return window !== undefined && !window.isFocused();
  }

  private show(title: string, body: string, conversationId: string): Notification | null {
    try {
      const toast = new Notification({
        title: toPlainText(title, TITLE_MAX),
        body: toPlainText(body, BODY_MAX),
      });
      toast.on('click', () => {
        this.activate(conversationId);
      });
      toast.show();
      log.info('chat_alert_shown', {});
      return toast;
    } catch (error) {
      log.warn('chat_alert_failed', { error });
      return null;
    }
  }

  /** A clicked alert: bring the window back and let the renderer open the thread. */
  private activate(conversationId: string): void {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    }
    this.byConversation.delete(conversationId);
    chatSocket.announce({ event: 'alert.activated', data: { conversationId } });
  }

  /**
   * A display name for an alert title. The chat service knows only ids, so it
   * is resolved against the API once and cached; a lookup that fails still
   * alerts, under a neutral name, rather than dropping the news (A10).
   */
  private async nameOf(userId: string): Promise<string> {
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
      return 'New message';
    }
    const name = result.data.fullName ?? result.data.username;
    remember(this.names, userId, name, NAMES_MAX);
    return name;
  }
}

/** One per app: a container-scoped single instance, not a static global. */
export const chatAlerts = new ChatAlerts();
