/**
 * The viewer's safety state: what they reported, hid, muted and blocked.
 *
 * Seeded from sample data and held in memory for the session, like the other
 * surfaces without an API (see src/mocks/README.md). Nothing here authorises
 * anything — hiding a muted author's post is a view preference, and the server
 * is what will enforce a block (OWASP A01).
 */
import type { Author } from '@shared/ipc-types';
import { create } from 'zustand';

import { displayName } from '@/lib/user-display';
import { SAMPLE_BLOCKED, SAMPLE_MUTED, SAMPLE_REPORTS } from '@/mocks/moderation';

import type { ReportEntry, RestrictedAccount } from './types';

interface ModerationState {
  reports: ReportEntry[];
  /** Posts the viewer hid, one at a time. */
  hiddenPostIds: string[];
  /** Posts shown again by hand although their author is muted or blocked. */
  revealedPostIds: string[];
  muted: RestrictedAccount[];
  blocked: RestrictedAccount[];
  addReport: (entry: ReportEntry) => void;
  hidePost: (postId: string) => void;
  showPost: (postId: string) => void;
  mute: (author: Author) => void;
  unmute: (userId: string) => void;
  block: (author: Author) => void;
  unblock: (userId: string) => void;
}

function toAccount(author: Author): RestrictedAccount {
  return {
    id: author.id,
    name: displayName(author),
    username: author.username,
    since: new Date().toISOString(),
  };
}

function withAccount(list: RestrictedAccount[], author: Author): RestrictedAccount[] {
  return list.some((entry) => entry.id === author.id) ? list : [toAccount(author), ...list];
}

export const useModerationStore = create<ModerationState>((set) => ({
  reports: [...SAMPLE_REPORTS],
  hiddenPostIds: [],
  revealedPostIds: [],
  muted: [...SAMPLE_MUTED],
  blocked: [...SAMPLE_BLOCKED],

  addReport: (entry) => {
    set((state) => ({ reports: [entry, ...state.reports] }));
  },

  hidePost: (postId) => {
    set((state) => ({
      hiddenPostIds: state.hiddenPostIds.includes(postId)
        ? state.hiddenPostIds
        : [...state.hiddenPostIds, postId],
      revealedPostIds: state.revealedPostIds.filter((id) => id !== postId),
    }));
  },

  showPost: (postId) => {
    set((state) => ({
      hiddenPostIds: state.hiddenPostIds.filter((id) => id !== postId),
      revealedPostIds: [...state.revealedPostIds, postId],
    }));
  },

  mute: (author) => {
    set((state) => ({ muted: withAccount(state.muted, author) }));
  },

  unmute: (userId) => {
    set((state) => ({ muted: state.muted.filter((entry) => entry.id !== userId) }));
  },

  block: (author) => {
    set((state) => ({ blocked: withAccount(state.blocked, author) }));
  },

  unblock: (userId) => {
    set((state) => ({ blocked: state.blocked.filter((entry) => entry.id !== userId) }));
  },
}));
