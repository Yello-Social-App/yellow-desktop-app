/**
 * How a person is shown.
 *
 * The API gives a username and an optional full name — on every author
 * summary as well as the full profile — so the display rules live in one place
 * rather than being re-derived in every component.
 */
import type { Author } from '@shared/ipc-types';

const MAX_INITIALS = 2;
const FALLBACK_INITIAL = 'Y';

type Nameable = Pick<Author, 'username' | 'fullName'>;

export function displayName(person: Nameable): string {
  return person.fullName ?? person.username;
}

export function initialsOf(person: Nameable): string {
  const source = displayName(person).trim();
  const words = source.split(/\s+/).filter((word) => word !== '');

  if (words.length === 0) {
    return FALLBACK_INITIAL;
  }

  const first = words[0]?.charAt(0) ?? FALLBACK_INITIAL;
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';

  return `${first}${last}`.toUpperCase().slice(0, MAX_INITIALS);
}

/** The `@handle` form, for secondary lines under a display name. */
export function handleOf(person: Nameable): string {
  return `@${person.username}`;
}
