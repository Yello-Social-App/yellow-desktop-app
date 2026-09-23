/**
 * Auth operations, as seen by the renderer.
 *
 * Each is one allowlisted IPC call: the main process holds the tokens and talks
 * to the API, so nothing here ever sees a credential beyond the password the
 * user just typed.
 */
import type { IpcError, RegisterResponse, Session } from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

export type AuthError = IpcError;

/** The API's rate limiter is per-endpoint; this is the one code worth naming. */
export const RATE_LIMIT_CODE = 'RATE_LIMIT_EXCEEDED';

export async function login(
  email: string,
  password: string,
  remember: boolean,
): Promise<Result<Session | null, AuthError>> {
  const result = await ipc.login({ email, password, remember });
  return result.ok ? ok(result.data.session) : fail(result.error);
}

export async function register(input: {
  email: string;
  username: string;
  fullName: string;
  password: string;
}): Promise<Result<RegisterResponse, AuthError>> {
  const result = await ipc.register({
    email: input.email,
    username: input.username,
    password: input.password,
    ...(input.fullName.trim() === '' ? {} : { fullName: input.fullName.trim() }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function verifyOtp(
  email: string,
  code: string,
  remember: boolean,
): Promise<Result<Session | null, AuthError>> {
  const result = await ipc.verifyOtp({ email, code, remember });
  return result.ok ? ok(result.data.session) : fail(result.error);
}

export async function currentSession(): Promise<Result<Session | null, AuthError>> {
  const result = await ipc.currentSession();
  return result.ok ? ok(result.data.session) : fail(result.error);
}

export async function logout(): Promise<void> {
  await ipc.logout();
}

/**
 * Re-sends whichever code the account is waiting on — a registration code or
 * a reset code. Succeeds identically whether or not the address is registered,
 * and inside the server's per-account cooldown, so the UI must not imply the
 * account was found or that a new email is certain.
 */
export async function resendOtp(email: string): Promise<Result<true, AuthError>> {
  const result = await ipc.resendOtp({ email });
  return result.ok ? ok(true) : fail(result.error);
}

/**
 * Starts a password reset by emailing a code. Succeeds identically whether or
 * not the address is registered, so the UI must not imply the account was
 * found.
 */
export async function forgotPassword(email: string): Promise<Result<true, AuthError>> {
  const result = await ipc.forgotPassword({ email });
  return result.ok ? ok(true) : fail(result.error);
}

/**
 * Exchanges the emailed reset code for a reset token. The token stays in the
 * main process; the renderer only learns that the code was accepted.
 */
export async function verifyResetOtp(
  email: string,
  code: string,
): Promise<Result<true, AuthError>> {
  const result = await ipc.verifyResetOtp({ email, code });
  return result.ok ? ok(true) : fail(result.error);
}

/** Completes the reset with the token the main process is holding. */
export async function resetPassword(newPassword: string): Promise<Result<true, AuthError>> {
  const result = await ipc.resetPassword({ newPassword });
  return result.ok ? ok(true) : fail(result.error);
}

/**
 * Step one of changing the password while signed in: proves the current one
 * and has a code emailed. Calling it again is the resend — inside the server's
 * 60-second window nothing new is sent and the code already emailed stays good.
 */
export async function requestChangePasswordCode(
  currentPassword: string,
): Promise<Result<true, AuthError>> {
  const result = await ipc.requestChangePasswordCode({ currentPassword });
  return result.ok ? ok(true) : fail(result.error);
}

/**
 * Step two: spends the code and sets the new password. The server answers with
 * a new token pair, which the main process has already adopted by the time this
 * resolves — this session carries on, every other one is signed out.
 */
export async function changePassword(
  code: string,
  newPassword: string,
): Promise<Result<true, AuthError>> {
  const result = await ipc.changePassword({ code, newPassword });
  return result.ok ? ok(true) : fail(result.error);
}
