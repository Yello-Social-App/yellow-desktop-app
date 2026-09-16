/**
 * The inbox watcher, owned by the main process.
 *
 * Why this exists at all: the notify service delivers live notifications over
 * FCM, and a desktop Electron client has no FCM registration token and no
 * matching platform. So there is nothing to push to us, and the documented
 * client flow — "poll unread-count on foreground" — is the only live signal
 * available. This turns that poll into the three things a desktop user expects:
 * a taskbar badge, a native OS notification, and a frame the renderer can act
 * on without every screen owning a timer.
 *
 * Why in the main process rather than the renderer:
 *   - the access token never enters the renderer, so the polling has to happen
 *     on this side anyway (OWASP A02/A04);
 *   - `Notification` and `app.setBadgeCount` are main-process APIs, and the
 *     text of an OS notification is then composed from a parsed server response
 *     rather than from anything the page hands us (A05);
 *   - it keeps running while the user is on a screen that has no interest in
 *     notifications, which is exactly when a notification is worth raising.
 *
 * Cadence follows attention rather than a fixed clock: a focused window is
 * checked often, a backgrounded one rarely, and a focus event checks at once.
 * Reads are not rate limited by the service; the per-IP edge ceiling is 20/s,
 * which this is three orders of magnitude below.
 *
 * Shape: a connection-like object with a handful of states and timers — the
 * same shape as ChatSocket, so it is spelled the same way, as a plain class
 * with a status field. Three states with no per-state behaviour split do not
 * earn a State pattern.
 */
import { app, BrowserWindow, Notification } from 'electron';

import { createLogger } from '../../shared/logger';
import { ENDPOINTS } from '../api/endpoints';
import { apiRequest } from '../api/http-client';
import { IPC_CHANNELS } from '../ipc/channels';
import {
  notificationPageSchema,
  notificationPreferencesSchema,
  unreadCountSchema,
  type Notification as InboxNotification,
  type NotificationEvent,
  type NotificationPreferences,
} from '../../shared/ipc-types';

const log = createLogger('notifications.watcher');

/** A focused window is where a stale badge is most obvious. */
const POLL_FOCUSED_MS = 60_000;
/** Backgrounded, the poll is only feeding the OS notification and the badge. */
const POLL_BACKGROUND_MS = 180_000;
/** After a network failure, back off from the current interval to this ceiling. */
const POLL_MAX_MS = 15 * 60_000;
/** A settle delay so a burst of focus events costs one request, not five. */
const FOCUS_DEBOUNCE_MS = 750;

/** How many rows one poll may announce; beyond this the badge speaks for them. */
const MAX_TOASTS_PER_POLL = 3;
/** Rows fetched when the count says something arrived. */
const NEW_ROWS_PAGE_SIZE = 20;
/** Ids remembered, so a row is never announced twice. Bounded, oldest evicted. */
const SEEN_IDS_MAX = 500;

const OS_NOTIFICATION_TITLE_MAX = 120;
const OS_NOTIFICATION_BODY_MAX = 240;

type WatcherStatus = 'stopped' | 'seeding' | 'running';

/**
 * Collapses a row's text to one line the OS will actually render.
 *
 * The text is already a parsed, length-capped string from the service, and an
 * OS notification is plain text rather than markup — but a title carrying
 * newlines renders as a mess on some desktops, and control or format characters
 * (a bidi override, a zero-width joiner) have no business reaching a system
 * API. Unicode classes rather than an escaped range: an escaped one is rewritten
 * into literal control bytes on the next format pass, which is unreadable and
 * easy to break silently.
 */
function toPlainText(value: string, max: number): string {
  const flattened = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flattened.length > max ? `${flattened.slice(0, max - 1)}…` : flattened;
}

class NotificationWatcher {
  private status: WatcherStatus = 'stopped';
  private timer: NodeJS.Timeout | null = null;
  private focusTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;

  private unreadCount = 0;
  private intervalMs = POLL_FOCUSED_MS;

  /** Rows already announced. Insertion-ordered, so the oldest evicts first. */
  private readonly seenIds = new Set<string>();

  /**
   * The user's push opt-outs, as last read. A mute is about push, so on this
   * client it governs the OS notification only: the row still arrives in the
   * inbox and still counts toward the badge, exactly as the service intends.
   */
  private preferences: NotificationPreferences = { pushEnabled: true, mutedTypes: [] };

  /** Starts watching for the signed-in user. Safe to call on every session check. */
  start(): void {
    if (this.status !== 'stopped') {
      return;
    }
    this.status = 'seeding';
    this.intervalMs = POLL_FOCUSED_MS;
    log.info('watcher_started', {});

    void this.loadPreferences();
    // The first pass only learns what is already there: opening the app must
    // not fire a toast for every notification that arrived while it was shut.
    void this.poll();
  }

  /** Stops watching and clears the badge. Called before the tokens are dropped. */
  stop(): void {
    if (this.status === 'stopped') {
      return;
    }
    this.status = 'stopped';
    this.clearTimers();
    this.seenIds.clear();
    this.unreadCount = 0;
    this.setBadge(0);
    log.info('watcher_stopped', {});
  }

  /** The window's attention changed; re-pace, and check now if it just came back. */
  handleFocusChange(isFocused: boolean): void {
    this.intervalMs = isFocused ? POLL_FOCUSED_MS : POLL_BACKGROUND_MS;
    if (this.status === 'stopped') {
      return;
    }
    this.schedule();

    if (!isFocused) {
      return;
    }
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
    }
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      void this.poll();
    }, FOCUS_DEBOUNCE_MS);
  }

  /**
   * Adopts a count the renderer's own request already paid for, so the badge
   * and the poll do not drift apart between ticks.
   */
  adoptCount(count: number): void {
    if (count === this.unreadCount) {
      return;
    }
    this.unreadCount = count;
    this.setBadge(count);
    this.publish({ event: 'unread-count', data: { count } });
  }

  /** Adopts preferences the renderer just read or saved, sparing a fetch. */
  adoptPreferences(preferences: NotificationPreferences): void {
    this.preferences = preferences;
  }

  private async loadPreferences(): Promise<void> {
    const result = await apiRequest({
      method: 'get',
      url: ENDPOINTS.notifications.preferences,
      schema: notificationPreferencesSchema,
    });
    if (result.ok) {
      this.preferences = result.data;
    }
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    if (this.status === 'stopped') {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => {
      void this.poll();
    }, this.intervalMs);
  }

  private clearTimers(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.status === 'stopped' || this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;

    try {
      const counted = await apiRequest({
        method: 'get',
        url: ENDPOINTS.notifications.unreadCount,
        schema: unreadCountSchema,
      });

      if (!counted.ok) {
        // A session that is over is not a transient failure: stop rather than
        // poll a signed-out account forever (A07).
        if (counted.error.code === 'UNAUTHENTICATED') {
          this.stop();
          return;
        }
        // Unreachable is not gone. Ease off, keep what we have (A10).
        this.intervalMs = Math.min(this.intervalMs * 2, POLL_MAX_MS);
        return;
      }

      const previous = this.unreadCount;
      const { count } = counted.data;

      // Only a rise means something arrived. A fall is this client, or another
      // one, having read rows — no page fetch can tell us anything new.
      if (count > previous || this.status === 'seeding') {
        await this.collectNewRows(count);
      }

      this.adoptCount(count);

      if (this.status === 'seeding') {
        this.status = 'running';
      }
    } finally {
      this.pollInFlight = false;
      this.schedule();
    }
  }

  /** Reads the unread page and announces the rows this session has not seen. */
  private async collectNewRows(count: number): Promise<void> {
    if (count === 0) {
      return;
    }

    const page = await apiRequest({
      method: 'get',
      url: ENDPOINTS.notifications.list,
      schema: notificationPageSchema,
      params: { size: NEW_ROWS_PAGE_SIZE, unread: true },
    });

    if (!page.ok) {
      return;
    }

    const fresh = page.data.items.filter((row) => !this.seenIds.has(row.id));
    for (const row of page.data.items) {
      this.remember(row.id);
    }

    if (fresh.length === 0) {
      return;
    }

    // The seeding pass exists to fill `seenIds`, not to announce a backlog.
    if (this.status === 'seeding') {
      log.info('watcher_seeded', { rows: fresh.length });
      return;
    }

    this.publish({ event: 'received', data: { items: fresh } });
    this.announce(fresh);
  }

  private remember(id: string): void {
    this.seenIds.delete(id);
    this.seenIds.add(id);
    while (this.seenIds.size > SEEN_IDS_MAX) {
      const oldest = this.seenIds.values().next();
      if (oldest.done === true) {
        break;
      }
      this.seenIds.delete(oldest.value);
    }
  }

  /**
   * Raises the OS notifications, newest last so the newest ends up on top of
   * the stack.
   *
   * Nothing is raised while the window has focus: the badge and the panel are
   * already in front of the user, and a toast over the app they are looking at
   * is noise rather than news.
   */
  private announce(rows: readonly InboxNotification[]): void {
    if (!Notification.isSupported() || !this.preferences.pushEnabled) {
      return;
    }
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (window === undefined || window.isFocused()) {
      return;
    }

    const muted = new Set(this.preferences.mutedTypes);
    const announceable = rows.filter((row) => !muted.has(row.type));

    for (const row of announceable.slice(0, MAX_TOASTS_PER_POLL).reverse()) {
      const toast = new Notification({
        title: toPlainText(row.title, OS_NOTIFICATION_TITLE_MAX),
        body: toPlainText(row.body, OS_NOTIFICATION_BODY_MAX),
      });

      toast.on('click', () => {
        this.activate(row);
      });
      toast.show();
    }

    log.info('notifications_announced', {
      shown: Math.min(announceable.length, MAX_TOASTS_PER_POLL),
    });
  }

  /** A clicked toast: bring the window back, and let the renderer deep-link. */
  private activate(row: InboxNotification): void {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    }
    this.publish({ event: 'activated', data: { notification: row } });
  }

  /**
   * Linux shows the count on a launcher entry, macOS on the dock icon, and
   * Windows supports neither through this API — where it is unsupported the
   * call is a no-op that answers false, which is not worth reporting.
   */
  private setBadge(count: number): void {
    try {
      app.setBadgeCount(count);
    } catch {
      // A desktop without badge support is not a failure worth a log line.
    }
  }

  private publish(event: NotificationEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.NOTIFICATIONS_EVENT, event);
      }
    }
  }
}

/** One watcher per app: a container-scoped single instance, not a static global. */
export const notificationWatcher = new NotificationWatcher();
