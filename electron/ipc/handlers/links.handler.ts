/**
 * Link previews for URLs found in post text. The fetch, and every check that
 * makes fetching a stranger's URL safe, lives in links/unfurl.ts.
 */
import { unfurl } from '../../links/unfurl';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  ipcOk,
  linkPreviewRequestSchema,
  linkPreviewResponseSchema,
  type IpcResult,
  type LinkPreviewResponse,
} from '../../../shared/ipc-types';

export function registerLinkHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.LINKS_PREVIEW,
    linkPreviewRequestSchema,
    async ({ url }): Promise<IpcResult<LinkPreviewResponse>> => {
      const preview = await unfurl(url);
      return ipcOk(linkPreviewResponseSchema.parse({ preview }));
    },
  );
}
