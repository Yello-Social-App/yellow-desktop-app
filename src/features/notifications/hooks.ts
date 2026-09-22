/**
 * Notification hooks: the only way components touch the inbox.
 *
 * The subscription lives here rather than in the store because acting on a
 * frame can mean navigating — a clicked OS notification has to open the thing
 * it is about — and the router belongs to React, not to a module-level store.
 * The store keeps state; this decides what a frame means.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrentUser } from '@/features/auth/hooks';
import { useFeedStore } from '@/features/feed/store';
import { createLogger } from '@/lib/logger';
import { onNotificationEvent } from '@/lib/ipc';
import { useFriendsStore } from '@/features/friends/store';
import { useModerationStore } from '@/features/moderation/store';

import { useNotificationsStore, type NotificationListSlice } from './store';
import { REPORT_RESOLVED, routeFor, type Notification, type NotificationFilter } from './types';

const log = createLogger('notifications.hooks');

/**
 * Attaches the store to the watcher's frames for as long as there is a session,
 * and reads the badge once. Mounted from the app shell, so a notification
 * arriving on any screen still bumps the count and still opens the right place
 * when its OS toast is clicked.
 */
export function useNotificationSubscription(): void {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const userId = user?.id;

  const receive = useNotificationsStore((state) => state.receive);
  const setUnreadCount = useNotificationsStore((state) => state.setUnreadCount);
  const markRead = useNotificationsStore((state) => state.markRead);
  const loadCount = useNotificationsStore((state) => state.loadCount);
  const reset = useNotificationsStore((state) => state.reset);

  useEffect(() => {
    if (userId === undefined) {
      // A sign-out leaves another account's rows in memory otherwise.
      reset();
      return;
    }

    void loadCount();

    return onNotificationEvent((event) => {
      switch (event.event) {
        case 'unread-count':
          setUnreadCount(event.data.count);
          break;

        case 'received': {
          receive(event.data.items);
          // A comment, reply or reaction on a post means the feed's copy of
          // that post is now behind; re-read it. The id is only used as a
          // lookup key into posts the feed already holds, never as a route.
          const postIds = event.data.items.flatMap((row) =>
            row.data.postId === undefined ? [] : [row.data.postId],
          );
          if (postIds.length > 0) {
            void useFeedStore.getState().refreshPosts(postIds);
          }
          // A request or an acceptance changes the friend lists on this side
          // too; re-read them now rather than at the next background refresh.
          if (event.data.items.some((row) => row.type.startsWith('FRIEND_'))) {
            void useFriendsStore.getState().refresh({ force: true });
          }
          // A report was decided: its status lives in "Your reports", which
          // is re-read rather than patched from the row's `status`.
          if (event.data.items.some((row) => row.type === REPORT_RESOLVED)) {
            void useModerationStore.getState().loadReports();
          }
          break;
        }

        case 'activated': {
          // The toast has already brought the window back; acknowledge the row
          // and follow it, exactly as clicking it in the panel would.
          const { notification } = event.data;
          receive([notification]);
          void markRead(notification.id);
          const route = routeFor(notification);
          if (route === null) {
            log.info('notification_activated_without_route', { type: notification.type });
            void navigate('/notifications');
          } else {
            void navigate(route);
          }
          break;
        }
      }
    });
  }, [userId, receive, setUnreadCount, markRead, loadCount, reset, navigate]);
}

/** The badge number, for the topbar bell and the sidebar. */
export function useUnreadNotificationCount(): number {
  return useNotificationsStore((state) => state.unreadCount);
}

export interface NotificationList extends NotificationListSlice {
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * One list, refetched each time it is actually shown. `all` and `unread` are
 * independent, so the panel and the page's tabs do not disturb each other.
 *
 * `isEnabled` exists for the topbar panel, which is mounted on every screen but
 * only shows rows once it is opened. Loading it on mount would spend a page
 * fetch at every app start for a panel most sessions never open — the badge
 * comes from the count, which is one cheap indexed read.
 *
 * Loading only when the slice is `idle` was wrong, and quietly so: a slice goes
 * `ready` once and never returns to `idle`, so the second time the panel opened
 * it showed whatever the first fetch found. Between opens the watcher pushes
 * arrivals in, but its poll can be three minutes away when the window is in the
 * background — which is exactly when something arrives. Opening the panel is
 * the user asking; this answers by asking the server.
 */
export function useNotificationList(
  filter: NotificationFilter,
  isEnabled = true,
): NotificationList {
  const slice = useNotificationsStore((state) => state.lists[filter]);
  const load = useNotificationsStore((state) => state.load);
  const loadMore = useNotificationsStore((state) => state.loadMore);
  /** The filter last fetched for this opening; null while closed. */
  const fetchedFor = useRef<NotificationFilter | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      // Closing arms the next open to fetch again.
      fetchedFor.current = null;
      return;
    }
    if (fetchedFor.current === filter) {
      return;
    }
    fetchedFor.current = filter;
    void load(filter);
  }, [filter, isEnabled, load]);

  return {
    ...slice,
    hasMore: slice.nextCursor !== null,
    loadMore: () => {
      void loadMore(filter);
    },
    reload: () => {
      void load(filter);
    },
  };
}

export interface NotificationActions {
  /** Acknowledges the row and follows it, when it points somewhere. */
  open: (notification: Notification) => void;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
  dismiss: (notificationId: string) => void;
  isPending: (notificationId: string) => boolean;
}

export function useNotificationActions(): NotificationActions {
  const navigate = useNavigate();
  const markRead = useNotificationsStore((state) => state.markRead);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const dismiss = useNotificationsStore((state) => state.dismiss);
  const pendingIds = useNotificationsStore((state) => state.pendingIds);

  const open = useCallback(
    (notification: Notification) => {
      // Acknowledge and navigate together: the row keeps its place in the list
      // either way, because marking read never bumps its sort key.
      void markRead(notification.id);
      const route = routeFor(notification);
      if (route !== null) {
        void navigate(route);
      }
    },
    [markRead, navigate],
  );

  return {
    open,
    markRead: (notificationId) => {
      void markRead(notificationId);
    },
    markAllRead: () => {
      void markAllRead();
    },
    dismiss: (notificationId) => {
      void dismiss(notificationId);
    },
    isPending: (notificationId) => pendingIds.has(notificationId),
  };
}

export interface NotificationPreferencesForm {
  pushEnabled: boolean;
  mutedTypes: ReadonlySet<string>;
  status: ReturnType<typeof useNotificationsStore.getState>['preferences']['status'];
  isSaving: boolean;
  setPushEnabled: (enabled: boolean) => void;
  toggleMuted: (type: string) => void;
}

/**
 * The settings toggles.
 *
 * Every change is saved immediately as a full replace, because that is what the
 * endpoint is: a PUT that resets any field it is not sent. There is no "Save"
 * button to get half-right, and no partial body this app can construct.
 *
 * A mute for a type this build does not list is carried through untouched, so
 * saving from the desktop cannot silently unmute something set on the phone.
 */
export function useNotificationPreferences(): NotificationPreferencesForm {
  const preferences = useNotificationsStore((state) => state.preferences);
  const loadPreferences = useNotificationsStore((state) => state.loadPreferences);
  const savePreferences = useNotificationsStore((state) => state.savePreferences);

  useEffect(() => {
    if (preferences.status === 'idle') {
      void loadPreferences();
    }
  }, [preferences.status, loadPreferences]);

  const mutedTypes = useMemo(() => new Set(preferences.mutedTypes), [preferences.mutedTypes]);

  return {
    pushEnabled: preferences.pushEnabled,
    mutedTypes,
    status: preferences.status,
    isSaving: preferences.isSaving,
    setPushEnabled: (enabled) => {
      void savePreferences({ pushEnabled: enabled, mutedTypes: preferences.mutedTypes });
    },
    toggleMuted: (type) => {
      const next = preferences.mutedTypes.includes(type)
        ? preferences.mutedTypes.filter((entry) => entry !== type)
        : [...preferences.mutedTypes, type];
      void savePreferences({ pushEnabled: preferences.pushEnabled, mutedTypes: next });
    },
  };
}
