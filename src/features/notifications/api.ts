/**
 * Notification operations, as seen by the renderer: one allowlisted IPC call
 * each. No call takes a user id — the inbox is always the caller's own, decided
 * from the token in the main process, so there is nothing here to address.
 */
import type {
  IpcError,
  Notification,
  NotificationPage,
  NotificationPreferences,
  RegisterDeviceRequest,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { NOTIFICATIONS_PAGE_SIZE } from './types';

export type NotificationsError = IpcError;

type PageResult = Promise<Result<NotificationPage, NotificationsError>>;

export function fetchNotifications(options: {
  cursor?: string;
  size?: number;
  unreadOnly?: boolean;
}): PageResult {
  const { cursor, size = NOTIFICATIONS_PAGE_SIZE, unreadOnly = false } = options;
  return ipc
    .listNotifications({
      size,
      ...(cursor === undefined ? {} : { cursor }),
      ...(unreadOnly ? { unread: true } : {}),
    })
    .then((r) => (r.ok ? ok(r.data) : fail(r.error)));
}

export async function fetchUnreadCount(): Promise<Result<number, NotificationsError>> {
  const result = await ipc.unreadNotificationCount();
  return result.ok ? ok(result.data.count) : fail(result.error);
}

export async function markNotificationRead(
  notificationId: string,
): Promise<Result<Notification, NotificationsError>> {
  const result = await ipc.markNotificationRead({ notificationId });
  return result.ok ? ok(result.data.notification) : fail(result.error);
}

/** Answers how many rows *were* unread, so a second call reports 0. */
export async function markAllNotificationsRead(): Promise<Result<number, NotificationsError>> {
  const result = await ipc.markAllNotificationsRead();
  return result.ok ? ok(result.data.updated) : fail(result.error);
}

export async function dismissNotification(
  notificationId: string,
): Promise<Result<true, NotificationsError>> {
  const result = await ipc.dismissNotification({ notificationId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function fetchNotificationPreferences(): Promise<
  Result<NotificationPreferences, NotificationsError>
> {
  const result = await ipc.notificationPreferences();
  return result.ok ? ok(result.data) : fail(result.error);
}

/**
 * Replaces the whole preference record. The caller supplies the complete
 * desired state — the server treats an omitted field as a reset, not as "leave
 * it alone", and `mutedTypes` omitted would clear every mute.
 */
export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<Result<NotificationPreferences, NotificationsError>> {
  const result = await ipc.saveNotificationPreferences({
    pushEnabled: preferences.pushEnabled,
    mutedTypes: preferences.mutedTypes,
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

/**
 * Registers this client's push token.
 *
 * Nothing calls this yet: push is delivered over FCM, and the desktop app has
 * no registration token to offer — its live signal is the main process polling
 * the inbox instead. The call exists so that the day a token source appears
 * (a bundled Firebase client, or a relay), the wiring and the strict body it
 * needs are already here and already validated.
 *
 * Whoever does call it must also call `unregisterPushDevice` on sign-out
 * **before** the session is dropped: that endpoint authenticates with the very
 * token being discarded, and skipping it leaves this machine receiving pushes
 * for an account nobody is signed into.
 */
export async function registerPushDevice(
  request: RegisterDeviceRequest,
): Promise<Result<string, NotificationsError>> {
  const result = await ipc.registerPushDevice(request);
  return result.ok ? ok(result.data.id) : fail(result.error);
}

/** Forgets a push token. A token that was never registered reads as success. */
export async function unregisterPushDevice(
  token: string,
): Promise<Result<true, NotificationsError>> {
  const result = await ipc.unregisterPushDevice({ token });
  return result.ok ? ok(true) : fail(result.error);
}
