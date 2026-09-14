/**
 * The user directory: who a user id is.
 *
 * The chat service carries ids only — no names, no avatars — so anything that
 * draws a conversation has to look its people up. Answers are cached for the
 * session and requests are de-duplicated, so a thread with the same sender on
 * every line costs one `GET /users/{id}`, not one per line. Authors seen on
 * posts, comments and friend rows are primed in for free.
 *
 * A lookup the server refuses (404: unknown, or a block in either direction —
 * never distinguished) is remembered as a placeholder rather than retried,
 * so a blocked peer's old messages still render and do not hammer the API.
 */
import type { Author } from '@shared/ipc-types';
import { create } from 'zustand';

import { ipc } from '@/lib/ipc';

const UNKNOWN_USERNAME = 'unknown';

interface UsersState {
  byId: Record<string, Author>;
  resolve: (ids: readonly string[]) => Promise<void>;
  prime: (authors: readonly Author[]) => void;
}

/** Ids with a lookup in flight, shared across callers. */
const inFlight = new Map<string, Promise<void>>();

export function unknownUser(id: string): Author {
  return { id, username: UNKNOWN_USERNAME, fullName: undefined, avatarUrl: undefined };
}

export function isUnknownUser(author: Author): boolean {
  return author.username === UNKNOWN_USERNAME;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  byId: {},

  resolve: async (ids) => {
    const wanted = [...new Set(ids)].filter((id) => get().byId[id] === undefined);
    if (wanted.length === 0) {
      return;
    }

    await Promise.all(
      wanted.map((id) => {
        const pending = inFlight.get(id);
        if (pending !== undefined) {
          return pending;
        }

        const lookup = ipc
          .getUser({ userId: id })
          .then((result) => {
            const author: Author = result.ok
              ? {
                  id: result.data.user.id,
                  username: result.data.user.username,
                  fullName: result.data.user.fullName,
                  avatarUrl: result.data.user.avatarUrl,
                }
              : unknownUser(id);
            set((state) => ({ byId: { ...state.byId, [id]: author } }));
          })
          .finally(() => {
            inFlight.delete(id);
          });

        inFlight.set(id, lookup);
        return lookup;
      }),
    );
  },

  prime: (authors) => {
    if (authors.length === 0) {
      return;
    }
    set((state) => {
      const byId = { ...state.byId };
      for (const author of authors) {
        // A real record always beats a placeholder, and refreshes a stale one.
        byId[author.id] = author;
      }
      return { byId };
    });
  },
}));
