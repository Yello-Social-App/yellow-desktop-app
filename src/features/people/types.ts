/**
 * People shapes — search and friend suggestions.
 *
 * Search runs on `GET /users/search` and its rows are plain friend entries.
 * Suggestions have no API yet: `DirectoryPerson` is the sample directory's
 * record, seeded from src/mocks and kept in memory for the session. Its
 * `friendStatus` uses the server's own vocabulary (see FRIEND_STATUSES), so the
 * relationship controls read it unchanged.
 */
import { USER_SEARCH_QUERY_MAX, type Author } from '@shared/ipc-types';

export interface DirectoryPerson {
  user: Author;
  /** The server's `friendStatus` text, plus the local BLOCKED status. */
  friendStatus: string;
  /** Friends you have in common, most familiar first. */
  mutualFriends: Author[];
  /** A community you have both joined, when that is the connection. */
  sharedCommunitySlug?: string;
  /** Offered on the Discover tab until dismissed or befriended. */
  isSuggested: boolean;
  /** When the friendship was accepted or the request was sent. */
  since?: string;
}

/** Who a search looks through. */
export type SearchScope = 'everyone' | 'friends';

/**
 * How another screen hands a search to the Friends screen (the top bar's
 * "See all people"). Navigation state is whatever was pushed, so the Friends
 * screen checks it rather than casting.
 */
export interface FriendsLocationState {
  peopleQuery: string;
}

/** What the search endpoint accepts; longer than any name or username. */
export const PEOPLE_QUERY_MAX = USER_SEARCH_QUERY_MAX;

/** How many people the top bar's quick search lists before "See all". */
export const QUICK_SEARCH_LIMIT = 3;
