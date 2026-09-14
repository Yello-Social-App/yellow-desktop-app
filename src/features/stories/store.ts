import type { Author } from '@shared/ipc-types';
import { create } from 'zustand';

import { SAMPLE_STORIES } from '@/mocks/stories';

import type { Story, StorySlide } from './types';

/** Where on screen a story was opened from, so the viewer can grow out of it. */
export interface Origin {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StoriesState {
  /** Everyone else's, most recent first. */
  stories: Story[];
  /** The viewer's own; null until they add one this session. */
  mine: Story | null;
  /** Which story is open in the viewer, or null. */
  openId: string | null;
  origin: Origin | null;
  open: (storyId: string, origin?: Origin) => void;
  close: () => void;
  markSeen: (storyId: string) => void;
  addSlide: (author: Author, slide: Omit<StorySlide, 'id' | 'createdAt'>) => void;
}

export const useStoriesStore = create<StoriesState>((set) => ({
  stories: [...SAMPLE_STORIES],
  mine: null,
  openId: null,
  origin: null,

  open: (storyId, origin) => {
    set({ openId: storyId, origin: origin ?? null });
  },

  close: () => {
    set({ openId: null, origin: null });
  },

  markSeen: (storyId) => {
    set((state) => ({
      stories: state.stories.map((s) => (s.id === storyId ? { ...s, isSeen: true } : s)),
    }));
  },

  addSlide: (author, slide) => {
    set((state) => {
      const next: StorySlide = {
        ...slide,
        id: `st-mine-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
      };
      const mine: Story =
        state.mine === null
          ? { id: 'st-mine', author, slides: [next], isSeen: true }
          : { ...state.mine, slides: [...state.mine.slides, next] };
      return { mine };
    });
  },
}));
