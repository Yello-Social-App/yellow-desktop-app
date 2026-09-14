/**
 * Friend requests, friendships and blocks.
 *
 * Every route is addressed by the *other user's* id — there is no friendship
 * id in this API — and every mutation answers with a `FriendEntry` whose
 * `friendStatus` is what the button should read next. The renderer redraws
 * from that rather than guessing.
 *
 * A block is never revealed: the server reports NONE for either side of one,
 * and a blocked user's profile answers 404. Nothing here tries to infer it.
 */
import { z } from 'zod';

import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { apiRequest } from '../../api/http-client';
import { IPC_CHANNELS, type IpcChannel } from '../channels';
import { registerIpcHandler } from '../register';

import {
  deletedResponseSchema,
  friendEntryPageSchema,
  friendEntryResponseSchema,
  friendEntrySchema,
  friendUserRequestSchema,
  ipcOk,
  listFriendRequestsRequestSchema,
  pageRequestSchema,
  type DeletedResponse,
  type FriendEntryPage,
  type FriendEntryResponse,
  type IpcResult,
} from '../../../shared/ipc-types';

const log = createLogger('ipc.friends');

const noContentSchema = z.undefined();

/**
 * Seven mutations differ only in verb and path, so they are one table and one
 * implementation rather than seven near-identical handlers.
 */
const MUTATIONS: readonly {
  channel: IpcChannel;
  method: 'post' | 'delete';
  url: (userId: string) => string;
  event: string;
}[] = [
  {
    channel: IPC_CHANNELS.FRIENDS_SEND_REQUEST,
    method: 'post',
    url: ENDPOINTS.friends.requestTo,
    event: 'friend_request_sent',
  },
  {
    channel: IPC_CHANNELS.FRIENDS_CANCEL_REQUEST,
    method: 'delete',
    url: ENDPOINTS.friends.requestTo,
    event: 'friend_request_cancelled',
  },
  {
    channel: IPC_CHANNELS.FRIENDS_ACCEPT,
    method: 'post',
    url: ENDPOINTS.friends.accept,
    event: 'friend_request_accepted',
  },
  {
    channel: IPC_CHANNELS.FRIENDS_DECLINE,
    method: 'post',
    url: ENDPOINTS.friends.decline,
    event: 'friend_request_declined',
  },
  {
    channel: IPC_CHANNELS.FRIENDS_BLOCK,
    method: 'post',
    url: ENDPOINTS.users.block,
    event: 'user_blocked',
  },
  {
    channel: IPC_CHANNELS.FRIENDS_UNBLOCK,
    method: 'delete',
    url: ENDPOINTS.users.block,
    event: 'user_unblocked',
  },
];

export function registerFriendHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.FRIENDS_LIST,
    pageRequestSchema,
    async ({ page, size }): Promise<IpcResult<FriendEntryPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.friends.list,
        schema: friendEntryPageSchema,
        params: { page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.FRIENDS_REQUESTS,
    listFriendRequestsRequestSchema,
    async ({ direction, page, size }): Promise<IpcResult<FriendEntryPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.friends.requests,
        schema: friendEntryPageSchema,
        params: { direction, page, size },
      }),
  );

  registerIpcHandler(
    IPC_CHANNELS.FRIENDS_BLOCKED,
    pageRequestSchema,
    async ({ page, size }): Promise<IpcResult<FriendEntryPage>> =>
      apiRequest({
        method: 'get',
        url: ENDPOINTS.friends.blocked,
        schema: friendEntryPageSchema,
        params: { page, size },
      }),
  );

  for (const mutation of MUTATIONS) {
    registerIpcHandler(
      mutation.channel,
      friendUserRequestSchema,
      async ({ userId }): Promise<IpcResult<FriendEntryResponse>> => {
        const result = await apiRequest({
          method: mutation.method,
          url: mutation.url(userId),
          schema: friendEntrySchema,
        });

        if (!result.ok) {
          return result;
        }

        log.info(mutation.event, {});
        return ipcOk(friendEntryResponseSchema.parse({ entry: result.data }));
      },
    );
  }

  registerIpcHandler(
    IPC_CHANNELS.FRIENDS_REMOVE,
    friendUserRequestSchema,
    async ({ userId }): Promise<IpcResult<DeletedResponse>> => {
      const result = await apiRequest({
        method: 'delete',
        url: ENDPOINTS.friends.remove(userId),
        schema: noContentSchema,
      });

      if (!result.ok) {
        return result;
      }

      log.info('friendship_removed', {});
      return ipcOk(deletedResponseSchema.parse({ deleted: true }));
    },
  );
}
