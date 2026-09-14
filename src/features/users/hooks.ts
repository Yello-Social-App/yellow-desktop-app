/**
 * Directory hooks: resolve ids to people, loading what is missing.
 */
import type { Author } from '@shared/ipc-types';
import { useEffect, useMemo } from 'react';

import { unknownUser, useUsersStore } from './store';

/** Ids are uuids, so a separator that cannot appear in one keeps the key exact. */
const KEY_SEPARATOR = '|';

/** The people behind a set of ids; placeholders until each lookup lands. */
export function useUsers(ids: readonly string[]): Record<string, Author> {
  const byId = useUsersStore((state) => state.byId);
  const resolve = useUsersStore((state) => state.resolve);
  const key = ids.join(KEY_SEPARATOR);

  useEffect(() => {
    const missing =
      key === '' ? [] : key.split(KEY_SEPARATOR).filter((id) => byId[id] === undefined);
    if (missing.length > 0) {
      void resolve(missing);
    }
  }, [key, byId, resolve]);

  return useMemo(() => {
    const people: Record<string, Author> = {};
    for (const id of key === '' ? [] : key.split(KEY_SEPARATOR)) {
      people[id] = byId[id] ?? unknownUser(id);
    }
    return people;
  }, [key, byId]);
}

export function useUser(id: string | undefined): Author | undefined {
  const people = useUsers(id === undefined ? [] : [id]);
  return id === undefined ? undefined : people[id];
}
