/**
 * Notification shapes, and the one piece of real logic the inbox needs: turning
 * a row's `data` map into a route.
 *
 * The records themselves come from the API (see @shared/ipc-types). What lives
 * here is the page size, the human label for a type, and `routeFor`.
 *
 * `routeFor` is the trust boundary. `data` is a free-form string map written by
 * a service from domain events, so nothing in it is spliced into a path on
 * sight: the type must be one this build knows, the key it reads is fixed per
 * type, and the value must look like an id before it is encoded into a segment
 * (OWASP A01/A05). Anything else yields `null` and the row simply does not
 * navigate — a notification you cannot follow beats one that follows the row
 * somewhere it chose.
 */
import type { Notification, NotificationType } from '@shared/ipc-types';

/** Rows per page. The service clamps anything above 50 silently. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * A moderator decided one of the viewer's reports. Deliberately not in
 * NOTIFICATION_TYPES: that list is also what Notification settings offers to
 * mute, and a report's outcome is not a stream to switch off. The row carries
 * `reportId` and `status` only — never the post, its author, or who decided.
 */
export const REPORT_RESOLVED = 'REPORT_RESOLVED';

/** How many rows the topbar panel shows before deferring to the full page. */
export const NOTIFICATIONS_PANEL_SIZE = 8;

/** Which list is being shown. Both are kept, so switching tabs does not refetch. */
export type NotificationFilter = 'all' | 'unread';

/**
 * An id safe to place in a route segment: the service issues UUIDs, and this
 * accepts that alphabet without insisting on the exact UUID layout, so an id
 * scheme changing upstream degrades to "no deep link" rather than to a wrong one.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function asId(value: string | undefined): string | null {
  return value !== undefined && ID_PATTERN.test(value) ? value : null;
}

function idOf(data: Readonly<Record<string, string>>, key: string): string | null {
  return asId(data[key]);
}

/**
 * Where a row points, as an in-app route, or `null` when it points nowhere this
 * build can reach. One handler serves a clicked inbox row and a clicked OS
 * notification alike, because both carry the same `data` map.
 */
export function routeFor(notification: Notification): string | null {
  const { data } = notification;
  const post = idOf(data, 'postId');
  // The row carries the actor as a column too, and on an aggregated row that
  // column is the authoritative "most recent actor"; the data map is only a
  // hint. Either has to pass the same id check before it becomes a segment.
  const actor = idOf(data, 'actorId') ?? asId(notification.actorId);

  switch (notification.type) {
    case 'POST_CREATED':
    case 'POST_REACTED':
    case 'POST_COMMENTED':
    case 'COMMENT_REPLIED':
    case 'COMMENT_REACTED':
      // The comment screens live inside the post, so every one of these lands
      // on the post; the thread scrolls itself once it is open.
      return post === null ? null : `/posts/${encodeURIComponent(post)}`;

    case 'POST_REPOSTED': {
      // The repost is its own post, and is the more useful of the two.
      const repost = idOf(data, 'repostId') ?? post;
      return repost === null ? null : `/posts/${encodeURIComponent(repost)}`;
    }

    case 'FRIEND_REQUEST_RECEIVED':
    case 'FRIEND_REQUEST_ACCEPTED':
      return actor === null ? null : `/users/${encodeURIComponent(actor)}`;

    case REPORT_RESOLVED:
      // The outcome is listed under "Your reports"; nothing in `data` is used.
      return '/settings/privacy';

    case 'CHAT_MESSAGE':
    case 'CHAT_REACTION': {
      // Push-only upstream, so these should never arrive from the inbox — they
      // are handled anyway, so a row of either type still leads somewhere.
      const conversation = idOf(data, 'conversationId');
      return conversation === null ? '/messages' : `/messages/${encodeURIComponent(conversation)}`;
    }

    default:
      // A type added server-side after this build: the row still renders with
      // the server's own title, it just has nowhere known to go (A10).
      return null;
  }
}

/** The short label under a row, and the wording of a mute in settings. */
const TYPE_LABELS: Record<NotificationType, string> = {
  POST_CREATED: 'New posts',
  POST_COMMENTED: 'Comments on your posts',
  COMMENT_REPLIED: 'Replies to your comments',
  POST_REPOSTED: 'Reposts',
  POST_REACTED: 'Reactions to your posts',
  COMMENT_REACTED: 'Reactions to your comments',
  FRIEND_REQUEST_RECEIVED: 'Friend requests',
  FRIEND_REQUEST_ACCEPTED: 'Accepted friend requests',
  CHAT_MESSAGE: 'Chat messages',
  CHAT_REACTION: 'Reactions to your chat messages',
};

export function labelForType(type: string): string {
  if (type === REPORT_RESOLVED) {
    return 'Your reports';
  }
  return type in TYPE_LABELS ? TYPE_LABELS[type as NotificationType] : 'Other activity';
}

export type { Notification, NotificationType };
