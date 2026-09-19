/**
 * What was typed, turned into what the search endpoint is asked. The server
 * ranks the results; all the renderer decides is whether there is enough to
 * send.
 */
import { USER_SEARCH_QUERY_MIN } from '@shared/ipc-types';

/** Lower-case, trimmed, and without the `@` people type before a username. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/^@+/, '').toLowerCase();
}

/** The server refuses anything shorter, so it is never sent. */
export function isSearchable(needle: string): boolean {
  return needle.length >= USER_SEARCH_QUERY_MIN;
}
