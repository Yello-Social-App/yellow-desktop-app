/**
 * The notification inbox, device push registration, and push opt-outs.
 *
 * The notify service is a third mount behind the same origin as the API, and
 * answers in the same envelope, so it needs no new transport — `apiRequest`
 * with the default `service: 'api'` reaches it. What *is* different is that it
 * is read-only to a client: rows are written by the service from domain events
 * on its broker, and there is no endpoint that creates one. Nothing here tries.
 *
 * Two of its refusals are not failures and are translated rather than shown:
 *
 *   - unregistering a token that is not registered answers 404, including on a
 *     repeat call. That is the state the caller wanted, so it reads as success;
 *   - marking an already-read row read answers 200 with the original `readAt`.
 *     Idempotent by design, so a double click costs nothing.
 *
 * A delete is *not* idempotent — a second one is a genuine 404 — so it is left
 * alone and reported.
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { notificationWatcher } from '../../notifications/watcher';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  deletedResponseSchema,
  deviceResponseSchema,
  emptyRequestSchema,
  ipcOk,
  listNotificationsRequestSchema,
  markAllNotificationsReadSchema,
  notificationIdRequestSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationResponseSchema,
  notificationSchema,
  registerDeviceRequestSchema,
  unreadCountSchema,
  unregisterDeviceRequestSchema,
  updateNotificationPreferencesRequestSchema,
  type AcknowledgedResponse,
  type DeletedResponse,
  type DeviceResponse,
  type IpcResult,
  type MarkAllNotificationsRead,
  type NotificationPage,
  type NotificationPreferences,
  type NotificationResponse,
  type UnreadCount,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.notifications');

const noContentSchema = z.undefined();
const ACKNOWLEDGED: AcknowledgedResponse = { acknowledged: true };

/** The service's own code for "no such row, or not yours" — the two are one answer. */
const NOT_FOUND = 'RESOURCE_NOT_FOUND';

export function registerNotificationHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_LIST,
    listNotificationsRequestSchema,
    async ({ cursor, size, unread }): Promise<IpcResult<NotificationPage>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.notifications.list,
        schema: notificationPageSchema,
        // `unread: false` is the server default; sending it only adds noise.
        params: {
          size,
          ...(cursor === undefined ? {} : { cursor }),
          ...(unread ? { unread } : {}),
        },
      });

      // How many rows came back, and nothing about what is in them. An inbox
      // that is genuinely empty and a response that failed to parse look
      // identical on screen; this is the line that tells them apart. A count
      // carries no PII, and the rows themselves are never logged (A09).
      if (result.ok) {
        log.info('notifications_listed', {
          count: result.data.items.length,
          unreadOnly: unread === true,
          hasMore: result.data.nextCursor !== null,
        });
      }
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_UNREAD_COUNT,
    emptyRequestSchema,
    async (): Promise<IpcResult<UnreadCount>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.notifications.unreadCount,
        schema: unreadCountSchema,
      });

      // The watcher owns the OS badge, so a count the renderer asked for keeps
      // it current too rather than letting the two drift apart.
      if (result.ok) {
        notificationWatcher.adoptCount(result.data.count);
      }
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_MARK_READ,
    notificationIdRequestSchema,
    async ({ notificationId }): Promise<IpcResult<NotificationResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.notifications.read(notificationId),
        schema: notificationSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('notification_read', {});
      return ipcOk(notificationResponseSchema.parse({ notification: result.data }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ,
    emptyRequestSchema,
    async (): Promise<IpcResult<MarkAllNotificationsRead>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.notifications.readAll,
        schema: markAllNotificationsReadSchema,
      });

      if (!result.ok) {
        return result;
      }

      // Everything is read by definition now: take the badge to zero without
      // spending a second request re-reading the count.
      notificationWatcher.adoptCount(0);
      log.info('notifications_all_read', { updated: result.data.updated });
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_DISMISS,
    notificationIdRequestSchema,
    async ({ notificationId }): Promise<IpcResult<DeletedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.notifications.remove(notificationId),
        schema: noContentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('notification_dismissed', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_REGISTER_DEVICE,
    registerDeviceRequestSchema,
    async (request): Promise<IpcResult<DeviceResponse>> => {
      const result = await apiRequest({
        method: 'put',
        url: ENDPOINTS.notifications.devices,
        // The body is strict upstream: a stray key is a 400, not an ignored
        // field, so only the four documented ones are ever sent.
        body: {
          token: request.token,
          platform: request.platform,
          appVersion: request.appVersion ?? null,
          locale: request.locale ?? null,
        },
        schema: deviceResponseSchema,
      });

      // The token itself is never logged, and never comes back in the response.
      log.info(result.ok ? 'device_registered' : 'device_register_failed', {
        platform: request.platform,
      });
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_UNREGISTER_DEVICE,
    unregisterDeviceRequestSchema,
    async ({ token }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.notifications.unregisterDevice,
        body: { token },
        schema: noContentSchema,
      });

      // A token that is not registered to us is the state we were asking for.
      if (!result.ok && result.error.apiCode !== NOT_FOUND) {
        return result;
      }

      log.info('device_unregistered', {});
      return ipcOk(acknowledgedResponseSchema.parse(ACKNOWLEDGED));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_PREFERENCES,
    emptyRequestSchema,
    async (): Promise<IpcResult<NotificationPreferences>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.notifications.preferences,
        schema: notificationPreferencesSchema,
      });

      // The watcher honours the mutes when it raises an OS notification, so it
      // takes the fresh copy rather than holding one that the user has changed.
      if (result.ok) {
        notificationWatcher.adoptPreferences(result.data);
      }
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_SAVE_PREFERENCES,
    updateNotificationPreferencesRequestSchema,
    async ({ pushEnabled, mutedTypes }): Promise<IpcResult<NotificationPreferences>> => {
      // A replace, not a patch: both fields go every time, because an omitted
      // one resets to its default rather than keeping what is stored.
      const result = await apiRequest({
        method: 'put',
        url: ENDPOINTS.notifications.preferences,
        body: { pushEnabled, mutedTypes },
        schema: notificationPreferencesSchema,
      });

      if (result.ok) {
        notificationWatcher.adoptPreferences(result.data);
      }

      log.info(result.ok ? 'notification_preferences_saved' : 'notification_preferences_failed', {
        mutedCount: mutedTypes.length,
      });
      return result;
    },
  );
}
