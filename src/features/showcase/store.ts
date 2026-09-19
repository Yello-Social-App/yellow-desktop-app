/**
 * Showcase state, normalised the way the communities store is: every project
 * by id, and each grid an ordered list of ids keyed by the query behind it.
 *
 * A project is drawn in the featured strip, the grid, the rail and its own
 * page at once, so a like is written to the one record and every grid showing
 * it follows. Publishing a project changes what any ranking would return, so
 * it marks every grid stale instead of guessing where the new one belongs.
 */
import type { IpcError, Project, PublishProjectRequest, TechCount } from '@shared/ipc-types';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/store';
import { useUsersStore } from '@/features/users/store';
import { createLogger } from '@/lib/logger';
import { fail, ok, type Result } from '@/lib/result';

import {
  fetchProject,
  fetchProjects,
  fetchTechCounts,
  publishProject,
  recordProjectView,
  setProjectLike,
} from './api';
import { PROJECTS_PAGE_SIZE, type ProjectQuery } from './types';

const log = createLogger('showcase.store');

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectListSlice {
  query: ProjectQuery;
  ids: string[];
  status: LoadStatus;
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

/** One project read by id: `missing` is a 404, which the page draws differently. */
export interface ProjectLookup {
  status: LoadStatus | 'missing';
  error: string | null;
}

export function projectListKey(query: ProjectQuery): string {
  return [
    query.sort,
    query.tech?.toLowerCase() ?? '',
    query.featured === true ? 'featured' : 'all',
    String(query.size ?? PROJECTS_PAGE_SIZE),
  ].join('|');
}

const NOT_FOUND = 'RESOURCE_NOT_FOUND';

interface ShowcaseState {
  projects: Record<string, Project>;
  lookups: Record<string, ProjectLookup>;
  lists: Record<string, ProjectListSlice>;
  tech: { items: TechCount[]; status: LoadStatus };
  /** Project ids with a like or unlike in flight. */
  pendingIds: ReadonlySet<string>;
  /** Ids whose view this session already reported; the server dedupes a day anyway. */
  viewedIds: ReadonlySet<string>;
  /** The last failed like, for a banner. Reads report on their list. */
  error: string | null;
  loadList: (query: ProjectQuery) => Promise<void>;
  loadMoreList: (query: ProjectQuery) => Promise<void>;
  loadTech: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  recordView: (projectId: string) => void;
  toggleLike: (projectId: string) => Promise<void>;
  publish: (draft: PublishProjectRequest) => Promise<Result<Project, IpcError>>;
  clearError: () => void;
  reset: () => void;
}

function withFlag(set: ReadonlySet<string>, id: string, present: boolean): Set<string> {
  const next = new Set(set);
  if (present) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

function byId(items: readonly Project[]): Record<string, Project> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function appendUnique(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing);
  return [...existing, ...incoming.filter((id) => !seen.has(id))];
}

const initialState = {
  projects: {},
  lookups: {},
  lists: {},
  tech: { items: [], status: 'idle' as LoadStatus },
  pendingIds: new Set<string>(),
  viewedIds: new Set<string>(),
  error: null,
};

export const useShowcaseStore = create<ShowcaseState>((set, get) => ({
  ...initialState,

  loadList: async (query) => {
    const key = projectListKey(query);
    const current = get().lists[key];
    set((state) => ({
      lists: {
        ...state.lists,
        // Keeps the rows it had, so a refresh does not blank the grid.
        [key]: {
          query,
          ids: current?.ids ?? [],
          page: current?.page ?? 0,
          hasMore: current?.hasMore ?? false,
          isLoadingMore: false,
          status: 'loading',
          error: null,
        },
      },
    }));

    const result = await fetchProjects(query, 0);
    if (!result.ok) {
      set((state) => {
        const latest = state.lists[key];
        return latest === undefined
          ? {}
          : {
              lists: {
                ...state.lists,
                [key]: { ...latest, status: 'error', error: result.error.message },
              },
            };
      });
      return;
    }

    const { content, page, last } = result.data;
    useUsersStore.getState().prime(content.map((project) => project.author));
    set((state) => ({
      projects: { ...state.projects, ...byId(content) },
      lists: {
        ...state.lists,
        [key]: {
          query,
          ids: content.map((project) => project.id),
          page,
          hasMore: !last,
          isLoadingMore: false,
          status: 'ready',
          error: null,
        },
      },
    }));
  },

  loadMoreList: async (query) => {
    const key = projectListKey(query);
    const slice = get().lists[key];
    if (slice === undefined || !slice.hasMore || slice.isLoadingMore || slice.status !== 'ready') {
      return;
    }

    set((state) => ({ lists: { ...state.lists, [key]: { ...slice, isLoadingMore: true } } }));
    const result = await fetchProjects(query, slice.page + 1);

    if (result.ok) {
      useUsersStore.getState().prime(result.data.content.map((project) => project.author));
    }
    set((state) => {
      const latest = state.lists[key] ?? slice;
      if (!result.ok) {
        return {
          lists: {
            ...state.lists,
            [key]: { ...latest, isLoadingMore: false, error: result.error.message },
          },
        };
      }
      const { content, page, last } = result.data;
      return {
        projects: { ...state.projects, ...byId(content) },
        lists: {
          ...state.lists,
          [key]: {
            ...latest,
            ids: appendUnique(
              latest.ids,
              content.map((project) => project.id),
            ),
            page,
            hasMore: !last,
            isLoadingMore: false,
            error: null,
          },
        },
      };
    });
  },

  loadTech: async () => {
    set((state) => ({ tech: { ...state.tech, status: 'loading' } }));
    const result = await fetchTechCounts();
    set((state) => ({
      tech: result.ok
        ? { items: result.data, status: 'ready' }
        : { items: state.tech.items, status: 'error' },
    }));
  },

  loadProject: async (projectId) => {
    set((state) => ({
      lookups: { ...state.lookups, [projectId]: { status: 'loading', error: null } },
    }));
    const result = await fetchProject(projectId);

    if (!result.ok) {
      const missing = result.error.apiCode === NOT_FOUND;
      set((state) => ({
        lookups: {
          ...state.lookups,
          [projectId]: missing
            ? { status: 'missing', error: null }
            : { status: 'error', error: result.error.message },
        },
      }));
      return;
    }

    useUsersStore.getState().prime([result.data.author]);
    set((state) => ({
      projects: { ...state.projects, [projectId]: result.data },
      lookups: { ...state.lookups, [projectId]: { status: 'ready', error: null } },
    }));
  },

  recordView: (projectId) => {
    if (get().viewedIds.has(projectId)) {
      return;
    }
    set((state) => ({ viewedIds: withFlag(state.viewedIds, projectId, true) }));
    // Fire and forget: a view that fails to count must never break the page.
    void recordProjectView(projectId).then((result) => {
      if (!result.ok) {
        log.warn('project_view_not_recorded', { apiCode: result.error.apiCode });
      }
    });
  },

  toggleLike: async (projectId) => {
    const before = get().projects[projectId];
    if (before === undefined || get().pendingIds.has(projectId)) {
      return;
    }

    const liked = !before.isLiked;
    // Drawn at once; the server's settled count then replaces the guess, or
    // the snapshot comes back.
    set((state) => ({
      pendingIds: withFlag(state.pendingIds, projectId, true),
      error: null,
      projects: {
        ...state.projects,
        [projectId]: {
          ...before,
          isLiked: liked,
          likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)),
        },
      },
    }));

    const result = await setProjectLike(projectId, liked);

    set((state) => {
      const latest = state.projects[projectId];
      const settled =
        latest === undefined
          ? state.projects
          : {
              ...state.projects,
              [projectId]: result.ok
                ? { ...latest, isLiked: result.data.isLiked, likeCount: result.data.likeCount }
                : { ...latest, isLiked: before.isLiked, likeCount: before.likeCount },
            };
      return {
        projects: settled,
        pendingIds: withFlag(state.pendingIds, projectId, false),
        error: result.ok ? null : result.error.message,
      };
    });
  },

  publish: async (draft) => {
    const result = await publishProject(draft);
    if (!result.ok) {
      return fail(result.error);
    }

    const project = result.data;
    set((state) => ({
      projects: { ...state.projects, [project.id]: project },
      lookups: { ...state.lookups, [project.id]: { status: 'ready', error: null } },
      lists: Object.fromEntries(
        Object.entries(state.lists).map(([key, slice]) => [
          key,
          slice.status === 'ready' ? { ...slice, status: 'idle' as const } : slice,
        ]),
      ),
      tech: { ...state.tech, status: state.tech.status === 'ready' ? 'idle' : state.tech.status },
    }));
    log.info('project_published', {});
    return ok(project);
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({ ...initialState, pendingIds: new Set(), viewedIds: new Set() });
  },
}));

// Likes and ownership are the viewer's own: nothing of one session may be
// drawn for the next account to sign in on this window.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useShowcaseStore.getState().reset();
  }
});
