/**
 * App updates: read the state, check, download, restart into it, the
 * "check automatically" switch, and the release notes.
 *
 * Every call is addressed to the one update service, and none takes anything
 * from the renderer but a boolean — the feed, the version and the release-notes
 * URL are all decided in the main process (OWASP A01). Whether a call does
 * anything depends on the install: a Store or other notify-only install
 * answers Update now and Install with its unchanged state.
 */
import { updateService } from '../../autoUpdater';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  emptyRequestSchema,
  ipcOk,
  setAutoCheckRequestSchema,
  type AcknowledgedResponse,
  type IpcResult,
  type UpdateState,
} from '../../../shared/ipc-types';

export function registerUpdateHandlers(): void {
  registerIpcHandler(IPC_CHANNELS.UPDATES_STATE, emptyRequestSchema, (): IpcResult<UpdateState> =>
    ipcOk(updateService.snapshot()),
  );

  registerIpcHandler(
    IPC_CHANNELS.UPDATES_CHECK,
    emptyRequestSchema,
    async (): Promise<IpcResult<UpdateState>> => ipcOk(await updateService.check()),
  );

  registerIpcHandler(
    IPC_CHANNELS.UPDATES_UPDATE_NOW,
    emptyRequestSchema,
    async (): Promise<IpcResult<UpdateState>> => ipcOk(await updateService.updateNow()),
  );

  registerIpcHandler(
    IPC_CHANNELS.UPDATES_INSTALL,
    emptyRequestSchema,
    async (): Promise<IpcResult<UpdateState>> => ipcOk(await updateService.install()),
  );

  registerIpcHandler(
    IPC_CHANNELS.UPDATES_SET_AUTO_CHECK,
    setAutoCheckRequestSchema,
    async ({ enabled }): Promise<IpcResult<UpdateState>> =>
      ipcOk(await updateService.setAutoCheck(enabled)),
  );

  registerIpcHandler(
    IPC_CHANNELS.UPDATES_OPEN_RELEASE_NOTES,
    emptyRequestSchema,
    async (): Promise<IpcResult<AcknowledgedResponse>> =>
      ipcOk(
        acknowledgedResponseSchema.parse({
          acknowledged: await updateService.openReleaseNotes(),
        }),
      ),
  );
}
