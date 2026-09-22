/**
 * Reports, mutes and hidden posts, as seen by the renderer: one allowlisted
 * IPC call each. Blocking is a friendship route and lives in
 * `@/features/friends/api`.
 *
 * The API's own error codes are turned into sentences here, once, so no
 * screen has to know them. `REPORT_ALREADY_EXISTS` is not a failure to the
 * caller — it is "already reported", which `submitReport` says with its own
 * outcome.
 */
import type { IpcError, MutedUser } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { reportInputSchema, SAFETY_LIST_SIZE, type ReportEntry, type ReportInput } from './types';

const FRIENDLY_MESSAGES: Record<string, string> = {
  CANNOT_REPORT_OWN_POST: 'You can’t report your own post.',
  CANNOT_MUTE_SELF: 'You can’t mute yourself.',
  RESOURCE_NOT_FOUND: 'That post is no longer available.',
  RATE_LIMIT_EXCEEDED: 'You’ve done that a lot in the last hour. Try again a little later.',
};

function friendly(error: IpcError): IpcError {
  const message = error.apiCode === undefined ? undefined : FRIENDLY_MESSAGES[error.apiCode];
  return message === undefined ? error : { ...error, message };
}

export type ReportOutcome =
  | { kind: 'created'; report: ReportEntry }
  /** An open report by this viewer already exists; the server kept that one. */
  | { kind: 'already-reported' };

export async function submitReport(input: ReportInput): Promise<Result<ReportOutcome, IpcError>> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'INVALID_PAYLOAD', message: 'Choose a reason for the report.' });
  }
  const result = await ipc.reportPost(parsed.data);
  if (result.ok) {
    return ok({ kind: 'created', report: result.data.report });
  }
  if (result.error.apiCode === 'REPORT_ALREADY_EXISTS') {
    return ok({ kind: 'already-reported' });
  }
  return fail(friendly(result.error));
}

export async function fetchMyReports(): Promise<Result<ReportEntry[], IpcError>> {
  const result = await ipc.listMyReports({ page: 0, size: SAFETY_LIST_SIZE });
  return result.ok ? ok(result.data.content) : fail(result.error);
}

export async function fetchMutedUsers(): Promise<Result<MutedUser[], IpcError>> {
  const result = await ipc.listMutedUsers({ page: 0, size: SAFETY_LIST_SIZE });
  return result.ok ? ok(result.data.content) : fail(result.error);
}

export async function setMuted(userId: string, muted: boolean): Promise<Result<null, IpcError>> {
  const result = await (muted ? ipc.muteUser({ userId }) : ipc.unmuteUser({ userId }));
  return result.ok ? ok(null) : fail(friendly(result.error));
}

export async function setPostHidden(
  postId: string,
  hidden: boolean,
): Promise<Result<null, IpcError>> {
  const result = await (hidden ? ipc.hidePost({ postId }) : ipc.unhidePost({ postId }));
  return result.ok ? ok(null) : fail(friendly(result.error));
}
