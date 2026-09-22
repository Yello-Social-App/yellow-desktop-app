/**
 * The viewer's safety state: what they reported, hid and muted.
 *
 * Reports and mutes are read from the API (`/v1/reports/me`,
 * `/v1/users/me/muted`); blocks are the friends store's, since upstream they
 * are a friendship route. The feed already leaves out hidden posts and muted
 * authors on the server, so the folds here only cover posts loaded before the
 * viewer acted. Nothing here authorises anything — the server enforces a
 * block or a mute (OWASP A01).
 */
import type { Author, MutedUser } from '@shared/ipc-types';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/store';
import { createLogger } from '@/lib/logger';
import { displayName } from '@/lib/user-display';

import { fetchMutedUsers, fetchMyReports } from './api';
import type { ReportEntry, RestrictedAccount } from './types';

const log = createLogger('moderation.store');

export type SafetyListStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ModerationState {
  reports: ReportEntry[];
  reportsStatus: SafetyListStatus;
  /** Posts the viewer hid, one at a time, this session. */
  hiddenPostIds: string[];
  /** Posts shown again by hand although their author is muted or blocked. */
  revealedPostIds: string[];
  muted: RestrictedAccount[];
  mutedStatus: SafetyListStatus;
  loadReports: () => Promise<void>;
  loadMuted: () => Promise<void>;
  addReport: (entry: ReportEntry) => void;
  hidePost: (postId: string) => void;
  showPost: (postId: string) => void;
  mute: (author: Author) => void;
  unmute: (userId: string) => void;
  reset: () => void;
}

const initialState = {
  reports: [],
  reportsStatus: 'idle',
  hiddenPostIds: [],
  revealedPostIds: [],
  muted: [],
  mutedStatus: 'idle',
} satisfies Partial<ModerationState>;

function fromMuted(entry: MutedUser): RestrictedAccount {
  return {
    id: entry.user.id,
    name: displayName(entry.user),
    username: entry.user.username,
    since: entry.since,
  };
}

function fromAuthor(author: Author): RestrictedAccount {
  return {
    id: author.id,
    name: displayName(author),
    username: author.username,
    since: new Date().toISOString(),
  };
}

export const useModerationStore = create<ModerationState>((set) => ({
  ...initialState,

  loadReports: async () => {
    set({ reportsStatus: 'loading' });
    const result = await fetchMyReports();
    if (!result.ok) {
      log.warn('reports_load_failed', { code: result.error.code });
      set({ reportsStatus: 'error' });
      return;
    }
    set({ reports: result.data, reportsStatus: 'ready' });
  },

  loadMuted: async () => {
    set({ mutedStatus: 'loading' });
    const result = await fetchMutedUsers();
    if (!result.ok) {
      log.warn('muted_load_failed', { code: result.error.code });
      set({ mutedStatus: 'error' });
      return;
    }
    set({ muted: result.data.map(fromMuted), mutedStatus: 'ready' });
  },

  addReport: (entry) => {
    set((state) => ({
      reports: [entry, ...state.reports.filter((existing) => existing.id !== entry.id)],
    }));
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
    set((state) => ({
      muted: state.muted.some((entry) => entry.id === author.id)
        ? state.muted
        : [fromAuthor(author), ...state.muted],
    }));
  },

  unmute: (userId) => {
    set((state) => ({ muted: state.muted.filter((entry) => entry.id !== userId) }));
  },

  reset: () => {
    set(initialState);
  },
}));

// Reports and mutes are the viewer's own: nothing of one account may be drawn
// for the next to sign in on this window.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useModerationStore.getState().reset();
  }
});
