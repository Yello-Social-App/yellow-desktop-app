import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/store';
import { createLogger } from '@/lib/logger';

import { fetchMyFeedback } from './api';
import type { FeedbackEntry } from './types';

const log = createLogger('feedback.store');

export type FeedbackHistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface FeedbackState {
  /** What the viewer has sent, most recent first, from `GET /v1/feedback/me`. */
  sent: FeedbackEntry[];
  status: FeedbackHistoryStatus;
  load: () => Promise<void>;
  add: (entry: FeedbackEntry) => void;
  reset: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  sent: [],
  status: 'idle',

  load: async () => {
    set({ status: 'loading' });
    const result = await fetchMyFeedback();
    if (!result.ok) {
      log.warn('history_load_failed', { code: result.error.code });
      set({ status: 'error' });
      return;
    }
    set({ sent: result.data, status: 'ready' });
  },

  add: (entry) => {
    set((state) => ({
      sent: [entry, ...state.sent.filter((existing) => existing.id !== entry.id)],
    }));
  },

  reset: () => {
    set({ sent: [], status: 'idle' });
  },
}));

// The history is the viewer's own: nothing of it may be drawn for the next
// account to sign in on this window.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useFeedbackStore.getState().reset();
  }
});
