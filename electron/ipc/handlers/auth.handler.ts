/**
 * Authentication against the Yello API.
 *
 * The whole credential lifecycle stays in the main process: the renderer sends
 * an email and password in, and gets back a profile and an expiry — never a
 * token (OWASP A02). "Remember me" writes only the refresh token, encrypted by
 * safeStorage, and a cold start exchanges it for a fresh pair.
 *
 * The same rule covers the password reset. `/auth/verify-otp` answers a reset
 * code with a single-use reset token; that token is held here, in memory, and
 * spent by the reset call — the renderer is told the code was accepted and
 * nothing more.
 */
import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import { adoptTokenPair, apiRequest, tokenPairResponseSchema } from '../../api/http-client';
import {
  accessToken,
  accessTokenExpiresAt,
  clearTokens,
  discardPersistedRefreshToken,
  loadPersistedRefreshToken,
  persistRefreshToken,
} from '../../api/token-store';
import { chatSocket } from '../../chat/socket';
import { notificationWatcher } from '../../notifications/watcher';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  acknowledgedResponseSchema,
  emptyRequestSchema,
  forgotPasswordRequestSchema,
  ipcFail,
  ipcOk,
  loginRequestSchema,
  registerRequestSchema,
  registerResponseSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  sessionResponseSchema,
  userSchema,
  verifyOtpRequestSchema,
  verifyResetOtpRequestSchema,
  type AcknowledgedResponse,
  type IpcResult,
  type RegisterResponse,
  type SessionResponse,
} from '../../../shared/ipc-types';
import { z } from 'zod';

const log = createLogger('ipc.auth');

const EMPTY_SESSION: SessionResponse = { session: null };

const ACKNOWLEDGED = acknowledgedResponseSchema.parse({ acknowledged: true });

/** `logout` and other empty-payload endpoints answer with `data: null`. */
const nullDataSchema = emptyRequestSchema.or(userSchema).nullish();

/** The code-sending endpoints answer with `data: null` and nothing else to read. */
const ignoredDataSchema = z.unknown();

/**
 * `/auth/verify-otp` serves both flows and says which one it served. Fields
 * the purpose does not use are omitted, not null, so this is a union rather
 * than one shape with optionals.
 */
const verifyOtpResponseSchema = z.discriminatedUnion('purpose', [
  tokenPairResponseSchema.extend({ purpose: z.literal('REGISTER') }),
  z.object({
    purpose: z.literal('RESET_PASSWORD'),
    resetToken: z.string().min(1).max(512),
    resetTokenExpiresAt: z.string().max(64).optional(),
  }),
]);

type VerifiedOtp = z.infer<typeof verifyOtpResponseSchema>;

/**
 * The reset token from the last verified reset code. One at a time: a new
 * verification replaces it, and spending it clears it. Never persisted and
 * never logged (A04/A09).
 */
let heldResetToken: string | null = null;

async function verifyOtp(email: string, code: string): Promise<IpcResult<VerifiedOtp>> {
  return apiRequest({
    method: 'post',
    url: ENDPOINTS.auth.verifyOtp,
    body: { email, code },
    schema: verifyOtpResponseSchema,
    allowRefresh: false,
  });
}

/**
 * Each screen expects one purpose. The server decides the purpose from the
 * account's state, so a mismatch means the user is on the wrong screen — say
 * so rather than, say, signing someone in from the reset flow.
 */
function wrongPurpose<TData>(): IpcResult<TData> {
  return ipcFail('API', 'That code is for a different step. Start over from the beginning.');
}

/** Fetches the signed-in profile and pairs it with the access token's expiry. */
async function currentSession(): Promise<IpcResult<SessionResponse>> {
  const profile = await apiRequest({ method: 'get', url: ENDPOINTS.users.me, schema: userSchema });

  if (!profile.ok) {
    // An unusable credential is "signed out", not an error to show the user.
    return profile.error.code === 'UNAUTHENTICATED' ? ipcOk(EMPTY_SESSION) : profile;
  }

  // A usable session is what the live socket needs; it fetches its own token.
  chatSocket.connect();
  // Same trigger, same reason: the inbox watcher polls with that token.
  notificationWatcher.start();

  return ipcOk(
    sessionResponseSchema.parse({
      session: { user: profile.data, expiresAt: accessTokenExpiresAt() ?? Date.now() },
    }),
  );
}

/** Adopts a freshly issued pair, then resolves the profile behind it. */
async function establishSession(
  pair: z.infer<typeof tokenPairResponseSchema>,
  remember: boolean,
): Promise<IpcResult<SessionResponse>> {
  adoptTokenPair(pair);

  if (remember) {
    const persisted = await persistRefreshToken();
    if (!persisted) {
      // Not fatal: the session simply will not survive a restart.
      log.warn('session_persist_failed', {});
    }
  } else {
    // An earlier "remember me" must not outlive a later plain sign-in.
    await discardPersistedRefreshToken();
  }

  return currentSession();
}

export function registerAuthHandlers(): void {
  registerIpcHandler(
    IPC_CHANNELS.AUTH_LOGIN,
    loginRequestSchema,
    async ({ email, password, remember }): Promise<IpcResult<SessionResponse>> => {
      const tokens = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.login,
        body: { email, password },
        schema: tokenPairResponseSchema,
        allowRefresh: false,
      });
      const result = tokens.ok ? await establishSession(tokens.data, remember) : tokens;
      log.info(result.ok ? 'sign_in_succeeded' : 'sign_in_failed', {});
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_REGISTER,
    registerRequestSchema,
    async (request): Promise<IpcResult<RegisterResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.register,
        body: request,
        schema: registerResponseSchema,
        allowRefresh: false,
      });
      log.info(result.ok ? 'registration_started' : 'registration_failed', {});
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_VERIFY_OTP,
    verifyOtpRequestSchema,
    async ({ email, code, remember }): Promise<IpcResult<SessionResponse>> => {
      const verified = await verifyOtp(email, code);
      if (!verified.ok) {
        log.info('otp_rejected', {});
        return verified;
      }
      if (verified.data.purpose !== 'REGISTER') {
        log.info('otp_purpose_mismatch', { expected: 'REGISTER' });
        return wrongPurpose();
      }

      const result = await establishSession(verified.data, remember);
      log.info(result.ok ? 'otp_verified' : 'otp_session_failed', {});
      return result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_RESEND_OTP,
    resendOtpRequestSchema,
    async ({ email }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.resendOtp,
        body: { email },
        schema: ignoredDataSchema,
        allowRefresh: false,
      });

      // Always 200 for a known and an unknown address alike (A01); a resend
      // inside the server's cooldown is the same silent success.
      log.info(result.ok ? 'otp_resent' : 'otp_resend_failed', {});
      return result.ok ? ipcOk(ACKNOWLEDGED) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_LOGOUT,
    emptyRequestSchema,
    async (): Promise<IpcResult<SessionResponse>> => {
      // Before the tokens go: a socket re-auth racing a logout has no token to
      // find, and a poll in flight would 401 its way into a pointless refresh.
      chatSocket.disconnect();
      notificationWatcher.stop();

      if (accessToken() !== null) {
        // Revoke server-side, but a failure here still signs the user out locally.
        await apiRequest({
          method: 'post',
          url: ENDPOINTS.auth.logout,
          schema: nullDataSchema,
          allowRefresh: false,
        });
      }

      clearTokens();
      await discardPersistedRefreshToken();
      log.info('signed_out', {});
      return ipcOk(EMPTY_SESSION);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_CURRENT_SESSION,
    emptyRequestSchema,
    async (): Promise<IpcResult<SessionResponse>> => {
      if (accessToken() !== null) {
        return currentSession();
      }

      // Cold start: a remembered refresh token is exchanged by the 401 retry
      // path on the first authenticated call.
      const remembered = await loadPersistedRefreshToken();
      if (!remembered) {
        return ipcOk(EMPTY_SESSION);
      }

      return currentSession();
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_FORGOT_PASSWORD,
    forgotPasswordRequestSchema,
    async ({ email }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.forgotPassword,
        body: { email },
        schema: ignoredDataSchema,
        allowRefresh: false,
      });

      // The address is never echoed back: the whole point of this endpoint is
      // that it answers identically for a known and an unknown account (A01).
      // A new request also voids any token a previous one left behind.
      heldResetToken = null;
      log.info(result.ok ? 'password_reset_requested' : 'password_reset_request_failed', {});
      return result.ok ? ipcOk(ACKNOWLEDGED) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_VERIFY_RESET_OTP,
    verifyResetOtpRequestSchema,
    async ({ email, code }): Promise<IpcResult<AcknowledgedResponse>> => {
      const verified = await verifyOtp(email, code);
      if (!verified.ok) {
        log.info('reset_otp_rejected', {});
        return verified;
      }
      if (verified.data.purpose !== 'RESET_PASSWORD') {
        log.info('otp_purpose_mismatch', { expected: 'RESET_PASSWORD' });
        return wrongPurpose();
      }

      heldResetToken = verified.data.resetToken;
      log.info('reset_otp_verified', {});
      return ipcOk(ACKNOWLEDGED);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_RESET_PASSWORD,
    resetPasswordRequestSchema,
    async ({ newPassword }): Promise<IpcResult<AcknowledgedResponse>> => {
      const token = heldResetToken;
      if (token === null) {
        return ipcFail('API', 'Verify the emailed code first.', {
          apiCode: 'RESET_TOKEN_INVALID',
        });
      }

      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.resetPassword,
        body: { token, newPassword },
        schema: ignoredDataSchema,
        allowRefresh: false,
      });

      // Spent on success, and dropped when the server says it is dead (expired
      // or already used) — a retry cannot revive it. A network blip or a
      // rejected password keeps it, so that retry does not need a new code.
      if (result.ok || result.error.apiCode === 'RESET_TOKEN_INVALID') {
        heldResetToken = null;
      }

      // Neither the token nor the password reaches the log (A09).
      log.info(result.ok ? 'password_reset_completed' : 'password_reset_failed', {});
      return result.ok ? ipcOk(ACKNOWLEDGED) : result;
    },
  );
}
