import { create } from 'zustand';

import { SAMPLE_PROJECTS } from '@/mocks/showcase';

import type { Project } from './types';

export type ProjectDraft = Pick<
  Project,
  'name' | 'tagline' | 'description' | 'emoji' | 'tech' | 'repoUrl' | 'liveUrl' | 'author'
>;

interface ShowcaseState {
  projects: Project[];
  toggleLike: (projectId: string) => void;
  submit: (draft: ProjectDraft) => string;
  /** Counts a visit; a detail page opening is a view. */
  view: (projectId: string) => void;
}

export const useShowcaseStore = create<ShowcaseState>((set) => ({
  projects: [...SAMPLE_PROJECTS],

  toggleLike: (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, viewerLiked: !p.viewerLiked, likes: p.likes + (p.viewerLiked ? -1 : 1) }
          : p,
      ),
    }));
  },

  submit: (draft) => {
    const id = `pj-local-${Date.now().toString(36)}`;
    set((state) => ({
      projects: [
        {
          ...draft,
          id,
          stars: 0,
          likes: 1,
          views: 1,
          createdAt: new Date().toISOString(),
          viewerLiked: true,
          featured: false,
        },
        ...state.projects,
      ],
    }));
    return id;
  },

  view: (projectId) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, views: p.views + 1 } : p)),
    }));
  },
}));
