/**
 * The sample people directory: who Discover suggests, and the relationship
 * with each — all in memory for the session. Search does not read it; that
 * runs on the API.
 *
 * Relationship changes follow the same transitions the friends API allows
 * (a request can only be accepted if one was received, and so on), so the
 * screens behave the way they will once the endpoints exist. Nothing here
 * calls the API: sample ids are not real users.
 */
import { create } from 'zustand';

import { LOCAL_BLOCKED_STATUS } from '@/features/friends/types';
import { SAMPLE_DIRECTORY } from '@/mocks/directory';

import type { DirectoryPerson } from './types';

export type RelationshipAction =
  'sendRequest' | 'cancelRequest' | 'accept' | 'decline' | 'unfriend' | 'block' | 'unblock';

/** Which statuses each action may start from, and where it leads. */
const TRANSITIONS: Record<RelationshipAction, { from: readonly string[]; to: string }> = {
  sendRequest: { from: ['NONE'], to: 'REQUEST_SENT' },
  cancelRequest: { from: ['REQUEST_SENT'], to: 'NONE' },
  accept: { from: ['REQUEST_RECEIVED'], to: 'FRIENDS' },
  decline: { from: ['REQUEST_RECEIVED'], to: 'NONE' },
  unfriend: { from: ['FRIENDS'], to: 'NONE' },
  block: {
    from: ['NONE', 'FRIENDS', 'REQUEST_SENT', 'REQUEST_RECEIVED'],
    to: LOCAL_BLOCKED_STATUS,
  },
  unblock: { from: [LOCAL_BLOCKED_STATUS], to: 'NONE' },
};

/** Statuses that carry a date worth showing next to them. */
const DATED_STATUSES = new Set(['FRIENDS', 'REQUEST_SENT']);

interface PeopleState {
  people: DirectoryPerson[];
  apply: (userId: string, action: RelationshipAction) => void;
  /** Hides a suggestion for the session. */
  dismissSuggestion: (userId: string) => void;
}

export const usePeopleStore = create<PeopleState>((set) => ({
  people: [...SAMPLE_DIRECTORY],

  apply: (userId, action) => {
    const { from, to } = TRANSITIONS[action];
    set((state) => ({
      people: state.people.map((person) => {
        if (person.user.id !== userId || !from.includes(person.friendStatus)) {
          return person;
        }
        return {
          ...person,
          friendStatus: to,
          // Befriending someone answers the suggestion; a request does not,
          // so its card stays and reads "Requested".
          isSuggested: to === 'FRIENDS' ? false : person.isSuggested,
          since: DATED_STATUSES.has(to) ? new Date().toISOString() : undefined,
        };
      }),
    }));
  },

  dismissSuggestion: (userId) => {
    set((state) => ({
      people: state.people.map((person) =>
        person.user.id === userId ? { ...person, isSuggested: false } : person,
      ),
    }));
  },
}));
