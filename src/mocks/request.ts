import type { IpcError } from '@shared/ipc-types';

import { ok, type Result } from '@/lib/result';

/**
 * Stands in for an endpoint that does not exist yet: answers after a short,
 * realistic delay so the screens show their pending state, and always
 * succeeds. The feature's `api.ts` is the only caller, so when the real
 * endpoint ships that one function swaps to an IPC call and nothing above it
 * changes.
 */
export function sampleRequest<TData>(data: TData, delayMs = 700): Promise<Result<TData, IpcError>> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(ok(data));
    }, delayMs);
  });
}

/** A client-side id for a record the sample endpoints "create". */
export function sampleId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
