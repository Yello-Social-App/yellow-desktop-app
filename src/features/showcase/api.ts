/**
 * Showcase operations, as seen by the renderer: one allowlisted IPC call each.
 */
import type {
  IpcError,
  Project,
  ProjectLike,
  ProjectPage,
  PublishProjectRequest,
  TechCount,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { PROJECTS_PAGE_SIZE, PROJECT_TECH_CHIPS, type ProjectQuery } from './types';

export type ShowcaseError = IpcError;

export async function fetchProjects(
  query: ProjectQuery,
  page: number,
): Promise<Result<ProjectPage, ShowcaseError>> {
  const result = await ipc.listProjects({
    sort: query.sort,
    page,
    size: query.size ?? PROJECTS_PAGE_SIZE,
    ...(query.tech === undefined ? {} : { tech: query.tech }),
    ...(query.featured === true ? { featured: true } : {}),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchTechCounts(
  limit: number = PROJECT_TECH_CHIPS,
): Promise<Result<TechCount[], ShowcaseError>> {
  const result = await ipc.listProjectTech({ limit });
  return result.ok ? ok(result.data.items) : fail(result.error);
}

export async function fetchProject(projectId: string): Promise<Result<Project, ShowcaseError>> {
  const result = await ipc.getProject({ projectId });
  return result.ok ? ok(result.data.project) : fail(result.error);
}

export async function recordProjectView(projectId: string): Promise<Result<true, ShowcaseError>> {
  const result = await ipc.recordProjectView({ projectId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function publishProject(
  draft: PublishProjectRequest,
): Promise<Result<Project, ShowcaseError>> {
  const result = await ipc.publishProject(draft);
  return result.ok ? ok(result.data.project) : fail(result.error);
}

/** Likes or unlikes; both idempotent, both answer with the settled count. */
export async function setProjectLike(
  projectId: string,
  liked: boolean,
): Promise<Result<ProjectLike, ShowcaseError>> {
  const result = liked
    ? await ipc.likeProject({ projectId })
    : await ipc.unlikeProject({ projectId });
  return result.ok ? ok(result.data) : fail(result.error);
}
