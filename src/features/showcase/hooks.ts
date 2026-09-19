/**
 * Showcase hooks: the only way screens read projects. Each loads its list the
 * first time it is drawn, and again whenever the store has marked it stale.
 */
import { useEffect, useMemo } from 'react';

import {
  projectListKey,
  useShowcaseStore,
  type ProjectListSlice,
  type ProjectLookup,
} from './store';
import type { Project, ProjectQuery, TechCount } from './types';

const IDLE_LOOKUP: ProjectLookup = { status: 'idle', error: null };

export interface ProjectListView extends Omit<ProjectListSlice, 'query' | 'ids'> {
  projects: Project[];
  loadMore: () => void;
  reload: () => void;
}

export function useProjectList(query: ProjectQuery): ProjectListView {
  const { sort, tech, featured, size } = query;
  const key = projectListKey({ sort, tech, featured, size });
  const slice = useShowcaseStore((state) => state.lists[key]);
  const records = useShowcaseStore((state) => state.projects);
  const loadList = useShowcaseStore((state) => state.loadList);
  const loadMoreList = useShowcaseStore((state) => state.loadMoreList);
  const status = slice?.status ?? 'idle';

  useEffect(() => {
    if (status === 'idle') {
      void loadList({ sort, tech, featured, size });
    }
  }, [status, loadList, sort, tech, featured, size]);

  const ids = slice?.ids;
  const projects = useMemo(
    () =>
      (ids ?? []).flatMap((id) => {
        const project = records[id];
        return project === undefined ? [] : [project];
      }),
    [ids, records],
  );

  return useMemo(
    () => ({
      projects,
      status,
      page: slice?.page ?? 0,
      hasMore: slice?.hasMore ?? false,
      isLoadingMore: slice?.isLoadingMore ?? false,
      error: slice?.error ?? null,
      loadMore: () => {
        void loadMoreList({ sort, tech, featured, size });
      },
      reload: () => {
        void loadList({ sort, tech, featured, size });
      },
    }),
    [projects, status, slice, sort, tech, featured, size, loadList, loadMoreList],
  );
}

/** The most-used tech names, for the filter chips. */
export function useProjectTech(): TechCount[] {
  const tech = useShowcaseStore((state) => state.tech);
  const loadTech = useShowcaseStore((state) => state.loadTech);

  useEffect(() => {
    if (tech.status === 'idle') {
      void loadTech();
    }
  }, [tech.status, loadTech]);

  return tech.items;
}

/**
 * One project by id, read fresh once per session, and reported as viewed once
 * per session — opening the page is the view, not loading the record.
 */
export function useProject(projectId: string | undefined): {
  project: Project | undefined;
  lookup: ProjectLookup;
  reload: () => void;
} {
  const project = useShowcaseStore((state) =>
    projectId === undefined ? undefined : state.projects[projectId],
  );
  const lookup = useShowcaseStore((state) =>
    projectId === undefined ? IDLE_LOOKUP : (state.lookups[projectId] ?? IDLE_LOOKUP),
  );
  const loadProject = useShowcaseStore((state) => state.loadProject);
  const recordView = useShowcaseStore((state) => state.recordView);

  useEffect(() => {
    if (projectId !== undefined && lookup.status === 'idle') {
      void loadProject(projectId);
    }
  }, [projectId, lookup.status, loadProject]);

  const exists = lookup.status === 'ready';
  useEffect(() => {
    if (projectId !== undefined && exists) {
      recordView(projectId);
    }
  }, [projectId, exists, recordView]);

  return {
    project,
    lookup,
    reload: () => {
      if (projectId !== undefined) {
        void loadProject(projectId);
      }
    },
  };
}

/** Like or unlike, and whether that is already under way for this project. */
export function useProjectLike(projectId: string): { isBusy: boolean; toggle: () => void } {
  const isBusy = useShowcaseStore((state) => state.pendingIds.has(projectId));
  const toggleLike = useShowcaseStore((state) => state.toggleLike);
  return {
    isBusy,
    toggle: () => {
      void toggleLike(projectId);
    },
  };
}
