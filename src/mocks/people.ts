import type { Author } from '@shared/ipc-types';

/** The cast the sample surfaces share, so a name means the same person everywhere. */
export const SAMPLE_PEOPLE: readonly Author[] = [
  { id: 'sample-sok', username: 'sokchea.dev', fullName: 'Sokchea Lim', avatarUrl: undefined },
  { id: 'sample-dara', username: 'dara.codes', fullName: 'Dara Chan', avatarUrl: undefined },
  { id: 'sample-vanna', username: 'vanna', fullName: 'Vanna Keo', avatarUrl: undefined },
  { id: 'sample-piseth', username: 'piseth.ui', fullName: 'Piseth Rith', avatarUrl: undefined },
  { id: 'sample-kanha', username: 'kanha.ml', fullName: 'Kanha Sok', avatarUrl: undefined },
  { id: 'sample-rithy', username: 'rithy', fullName: 'Rithy Chea', avatarUrl: undefined },
  { id: 'sample-mealea', username: 'mealea.go', fullName: 'Mealea Heng', avatarUrl: undefined },
  { id: 'sample-bora', username: 'bora.rs', fullName: 'Bora Ouk', avatarUrl: undefined },
];

export function samplePerson(index: number): Author {
  const person = SAMPLE_PEOPLE[index % SAMPLE_PEOPLE.length];
  if (person === undefined) {
    throw new Error('No sample people');
  }
  return person;
}

/** A stable cover class for an id, so the same item always wears the same gradient. */
export function coverClass(key: string): string {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `cover-${String(hash % 8)}`;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export { hoursAgo };
