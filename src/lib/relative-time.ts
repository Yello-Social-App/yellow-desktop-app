/**
 * Human-readable timestamps ("2 hours ago"), formatted with the platform's own
 * Intl support rather than a date library.
 *
 * Every entry point tolerates a timestamp it cannot read. `Intl` does not: both
 * `DateTimeFormat.format` and `RelativeTimeFormat.format` throw a RangeError on
 * an invalid date rather than returning something unusable, and these are
 * called during render — so one malformed timestamp in one row of one list
 * takes down the entire screen through the error boundary. A row whose time is
 * unreadable is still worth showing, because the text is the point, so the time
 * degrades to a dash instead (OWASP A10: an error path that fails soft rather
 * than taking the surrounding work with it).
 */
const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const timeFormatter = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

/** What a timestamp reads as when it cannot be parsed at all. */
const UNKNOWN_TIME = '—';

/**
 * The instant a timestamp names, or null when it names none.
 *
 * An empty string, a null that reached here as text, and a truncated or
 * non-ISO value all land in the same place: unusable. Note that ISO strings
 * with microsecond precision (`…:03.118820Z`), which some services emit, parse
 * correctly and are not affected.
 */
function instantOf(isoTimestamp: string): Date | null {
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function relativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const date = instantOf(isoTimestamp);
  if (date === null) {
    return UNKNOWN_TIME;
  }

  const elapsedMinutes = Math.round((now - date.getTime()) / MS_PER_MINUTE);

  if (elapsedMinutes < MINUTES_PER_HOUR) {
    return relativeFormatter.format(-elapsedMinutes, 'minute');
  }

  const elapsedHours = Math.round(elapsedMinutes / MINUTES_PER_HOUR);
  if (elapsedHours < HOURS_PER_DAY) {
    return relativeFormatter.format(-elapsedHours, 'hour');
  }

  const elapsedDays = Math.round(elapsedHours / HOURS_PER_DAY);
  if (elapsedDays < DAYS_PER_WEEK) {
    return relativeFormatter.format(-elapsedDays, 'day');
  }

  return dayFormatter.format(date);
}

export function clockTime(isoTimestamp: string): string {
  const date = instantOf(isoTimestamp);
  return date === null ? UNKNOWN_TIME : timeFormatter.format(date);
}

export function calendarDay(isoTimestamp: string): string {
  const date = instantOf(isoTimestamp);
  return date === null ? UNKNOWN_TIME : dayFormatter.format(date);
}
