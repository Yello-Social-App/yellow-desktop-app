import { create } from 'zustand';

import { SAMPLE_FEEDBACK } from '@/mocks/moderation';

import type { FeedbackEntry } from './types';

interface FeedbackState {
  /** What the viewer has sent, most recent first. Session-only until the API exists. */
  sent: FeedbackEntry[];
  add: (entry: FeedbackEntry) => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  sent: [...SAMPLE_FEEDBACK],
  add: (entry) => {
    set((state) => ({ sent: [entry, ...state.sent] }));
  },
}));
