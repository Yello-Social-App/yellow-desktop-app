/**
 * The project showcase: the grid, the tech chips, one project, counting a
 * view, publishing, and liking.
 *
 * A view is recorded by its own call rather than by the read, so a refresh or
 * a list prefetch never inflates Trending; the server also counts at most one
 * per viewer a day, so the renderer need not be precise about it.
 *
 * Publishing sends exactly the documented fields. `isFeatured`, the counts and
 * the author are the server's to decide and are never put in the body.
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS, type IpcChannel } from '../channels';
import { registerIpcHandler } from '../register';

import {
  ipcOk,
  listProjectTechRequestSchema,
  listProjectsRequestSchema,
  projectIdRequestSchema,
  projectLikeSchema,
  projectPageSchema,
  projectSchema,
  publishProjectRequestSchema,
  techCountRowsSchema,
  type AcknowledgedResponse,
  type IpcResult,
  type ProjectLike,
  type ProjectPage,
  type ProjectResponse,
  type TechCountList,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.showcase');

const noContentSchema = z.undefined();

/** Like and unlike differ only in verb, so they are one table. */
const LIKES: readonly { channel: IpcChannel; method: 'post' | 'delete'; event: string }[] = [
  { channel: IPC_CHANNELS.SHOWCASE_LIKE, method: 'post', event: 'project_liked' },
  { channel: IPC_CHANNELS.SHOWCASE_UNLIKE, method: 'delete', event: 'project_unliked' },
];

export function registerShowcaseHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.SHOWCASE_LIST,
    listProjectsRequestSchema,
    async ({ sort, tech, featured, page, size }): Promise<IpcResult<ProjectPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.projects.list,
        schema: projectPageSchema,
        params: {
          sort,
          page,
          size,
          ...(tech === undefined ? {} : { tech }),
          // `false` is the server default; only the narrowing is worth sending.
          ...(featured === true ? { featured: 'true' } : {}),
        },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.SHOWCASE_TECH,
    listProjectTechRequestSchema,
    async ({ limit }): Promise<IpcResult<TechCountList>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.projects.tech,
        schema: techCountRowsSchema,
        params: { limit },
      });
      return result.ok ? ipcOk({ items: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.SHOWCASE_GET,
    projectIdRequestSchema,
    async ({ projectId }): Promise<IpcResult<ProjectResponse>> => {
      const result = await apiRequest({
        method: 'get',
        url: ENDPOINTS.projects.byId(projectId),
        schema: projectSchema,
      });
      return result.ok ? ipcOk({ project: result.data }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.SHOWCASE_RECORD_VIEW,
    projectIdRequestSchema,
    async ({ projectId }): Promise<IpcResult<AcknowledgedResponse>> => {
      // 204 whether or not this view was the one that counted.
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.projects.views(projectId),
        schema: noContentSchema,
      });
      return result.ok ? ipcOk({ acknowledged: true }) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.SHOWCASE_PUBLISH,
    publishProjectRequestSchema,
    async (request): Promise<IpcResult<ProjectResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.projects.list,
        body: {
          name: request.name,
          tagline: request.tagline,
          description: request.description,
          emoji: request.emoji,
          tech: request.tech,
          repoUrl: request.repoUrl ?? null,
          liveUrl: request.liveUrl ?? null,
        },
        schema: projectSchema,
      });

      log.info(result.ok ? 'project_published' : 'project_publish_failed', {
        techCount: request.tech.length,
      });
      return result.ok ? ipcOk({ project: result.data }) : result;
    },
  );

  for (const change of LIKES) {
    registerIpcHandler(
      change.channel,
      projectIdRequestSchema,
      async ({ projectId }): Promise<IpcResult<ProjectLike>> => {
        const result = await apiRequest({
          method: change.method,
          url: ENDPOINTS.projects.like(projectId),
          schema: projectLikeSchema,
        });
        if (result.ok) {
          log.info(change.event, {});
        }
        return result;
      },
    );
  }
}
