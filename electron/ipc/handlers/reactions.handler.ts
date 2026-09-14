/**
 * Reactions, for either target type.
 *
 * There is one write: a toggle. The server compares the type sent with the
 * caller's current reaction and adds, changes or removes accordingly, so the
 * client never has to know its prior state to get the right outcome — and a
 * double-click cannot add twice. Every call answers with the summary so the
 * UI can repaint counts without a follow-up read.
 *
 * `targetType` is a closed enum in the request schema rather than free text —
 * it becomes a URL path segment, and an unbounded string there would be a route
 * the renderer gets to choose (OWASP A01/A05).
 */
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  listReactorsRequestSchema,
  reactionSummarySchema,
  reactionTargetRequestSchema,
  reactorPageSchema,
  toggleReactionRequestSchema,
  type IpcResult,
  type ReactionSummary,
  type ReactorPage,
} from '../../../shared/ipc-types';

export function registerReactionHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.REACTIONS_TOGGLE,
    toggleReactionRequestSchema,
    async ({ targetType, targetId, type }): Promise<IpcResult<ReactionSummary>> =>
      apiRequest({
        method: 'post',
        url: ENDPOINTS.reactions.forTarget(targetType, targetId),
        // Always sent explicitly: an absent body means LIKE upstream, and a
        // default that lives on the server is one the client cannot see change.
        body: { type },
        schema: reactionSummarySchema,
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.REACTIONS_SUMMARY,
    reactionTargetRequestSchema,
    async ({ targetType, targetId }): Promise<IpcResult<ReactionSummary>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.reactions.summary(targetType, targetId),
        schema: reactionSummarySchema,
      }),
  );

  // Who reacted, newest first, with the viewer's friendship to each — the
  // server works that out per row, so the list needs no follow-up calls.
  registerIpcHandler(
    IPC_CHANNELS.REACTIONS_LIST,
    listReactorsRequestSchema,
    async ({ targetType, targetId, type, page, size }): Promise<IpcResult<ReactorPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.reactions.forTarget(targetType, targetId),
        schema: reactorPageSchema,
        params: { page, size, ...(type === undefined ? {} : { type }) },
      }),
  );
}
