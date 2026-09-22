/**
 * Reports, mutes and blocks, as seen by the renderer. None of these endpoints
 * exist yet, so each answers through `sampleRequest`; this file is the one
 * place that changes when they ship. Hiding a single post is a local view
 * preference and never goes to the server.
 */
import type { IpcError } from '@shared/ipc-types';
import { z } from 'zod';

import { fail, type Result } from '@/lib/result';
import { sampleId, sampleRequest } from '@/mocks/request';

import { reportInputSchema, type ReportInput } from './types';

export interface ReportReceipt {
  id: string;
  createdAt: string;
}

export async function submitReport(input: ReportInput): Promise<Result<ReportReceipt, IpcError>> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'INVALID_PAYLOAD', message: 'Choose a reason for the report.' });
  }
  return sampleRequest({ id: sampleId('rp'), createdAt: new Date().toISOString() }, 900);
}

const restrictionSchema = z.object({ userId: z.string().min(1).max(64), on: z.boolean() });

export async function setMuted(userId: string, muted: boolean): Promise<Result<null, IpcError>> {
  return restrict(userId, muted);
}

export async function setBlocked(
  userId: string,
  blocked: boolean,
): Promise<Result<null, IpcError>> {
  return restrict(userId, blocked);
}

/** Checked like the real request will be; the sample answer then ignores it. */
async function restrict(userId: string, on: boolean): Promise<Result<null, IpcError>> {
  if (!restrictionSchema.safeParse({ userId, on }).success) {
    return fail({ code: 'INVALID_PAYLOAD', message: 'That account could not be updated.' });
  }
  return sampleRequest(null, 300);
}
