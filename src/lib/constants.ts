/** Application-wide magic numbers, named once. */

/** A session is valid for 30 minutes; there are no non-expiring sessions. */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/** How often the renderer re-checks whether the current session has expired. */
export const SESSION_EXPIRY_CHECK_MS = 30 * 1000;

/** The API sends at most one code per account per minute; the button waits as long. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Latency the mock API simulates, so loading states are exercised for real. */
export const MOCK_LATENCY_MS = 600;

/** Search inputs wait this long after the last keystroke before filtering. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Estimated row height for the timeline, and the budget for windowing. */
export const FEED_ROW_HEIGHT_PX = 220;

/** Page size for a profile's own timeline (offset-paginated by the API). */
export const PROFILE_POSTS_PAGE_SIZE = 10;

/** Above this many rows the list should be handed to a windowing renderer. */
export const VIRTUALIZATION_THRESHOLD = 100;
