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
 *
 * Changing the password while signed in ends the same way: the server answers
 * with a new token pair, and it is adopted here. The renderer sends a code and
 * a new password, and learns only that the change went through.
 */
import { createLogger } from '../../../shared/logger';
import { ENDPOINTS } from '../../api/endpoints';
import {
  adoptTokenPair,
  apiRequest,
  exchangeExplicitRefreshToken,
  tokenPairResponseSchema,
} from '../../api/http-client';
import {
  accessToken,
  accessTokenExpiresAt,
  adoptRefreshToken,
  clearTokens,
} from '../../api/token-store';
import {
  MAX_REMEMBERED_ACCOUNTS,
  accountProfileOf,
  activeAccountId,
  clearActiveAccount,
  forgetAccount,
  hasAccount,
  listAccounts,
  loadVault,
  markAccountActive,
  rememberAccount,
  refreshTokenFor,
  startupRefreshToken,
  isSecureStorageAvailable,
} from '../../api/account-vault';
import { chatAlerts } from '../../chat/alerts';
import { chatSocket } from '../../chat/socket';
import { notificationWatcher } from '../../notifications/watcher';
import { IPC_CHANNELS } from '../channels';
import { registerIpcHandler } from '../register';

import {
  accountIdRequestSchema,
  accountListResponseSchema,
  acknowledgedResponseSchema,
  changePasswordOtpRequestSchema,
  changePasswordRequestSchema,
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
  type AccountListResponse,
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

  // Keep the switcher's copy of who this is current. It also completes the
  // migration from the single-account vault, which stored a token with no idea
  // whose it was — this profile is what finally names it.
  const identity = accountProfileOf(profile.data);
  if (hasAccount(identity.userId)) {
    await markAccountActive(identity);
  } else if (activeAccountId() === null && startupRefreshToken() !== null) {
    const token = startupRefreshToken();
    if (token !== null) {
      await rememberAccount(identity, token);
    }
  }

  return ipcOk(
    sessionResponseSchema.parse({
      session: { user: profile.data, expiresAt: accessTokenExpiresAt() ?? Date.now() },
    }),
  );
}

/**
 * Tears down everything scoped to the account being left.
 *
 * The socket and the watcher both authenticate with the outgoing token, so
 * they stop before it does — a re-auth or a poll racing the swap would spend
 * the wrong account's credential (A07).
 */
function endSessionScopedWork(): void {
  chatSocket.disconnect();
  notificationWatcher.stop();
  // An alert left up would name a conversation of the account just left.
  chatAlerts.reset();
}

/** Adopts a freshly issued pair, then resolves the profile behind it. */
async function establishSession(
  pair: z.infer<typeof tokenPairResponseSchema>,
  remember: boolean,
): Promise<IpcResult<SessionResponse>> {
  adoptTokenPair(pair);

  const session = await currentSession();

  if (!session.ok || session.data.session === null) {
    return session;
  }

  const identity = accountProfileOf(session.data.session.user);

  if (remember) {
    const token = refreshTokenOf(pair);
    if (token === null) {
      // Nothing to remember it by; the session still works, it just will not
      // survive a restart or be switchable back to.
      log.warn('session_persist_skipped', { reason: 'no_refresh_token' });
    } else {
      await rememberAccount(identity, token);
    }
  } else {
    // Declining to be remembered has to erase an earlier decision to be, or
    // the account stays switchable after the user asked that it not be.
    await forgetAccount(identity.userId);
  }

  return session;
}

function refreshTokenOf(pair: z.infer<typeof tokenPairResponseSchema>): string | null {
  return pair.refreshToken ?? null;
}

/**
 * Becomes a remembered account, using the token the vault holds for it.
 *
 * The order matters and is the whole reason this is not three lines. The target
 * account's token is exchanged *first*, against the live server, while the
 * current session is still intact. Only once a usable pair comes back is
 * anything torn down. Doing it the obvious way round — clear, then try — turns
 * every expired stored token into a double sign-out: the user loses the account
 * they were using as well as the one they were reaching for (A10).
 *
 * A token the server rejects is a session that is genuinely over, so the
 * account is forgotten rather than left in the list to fail again.
 */
async function resumeAccount(userId: string): Promise<IpcResult<SessionResponse>> {
  // Only an account this process already remembers can be resumed. The renderer
  // names a user id and nothing else — it cannot supply a token, and a id that
  // is not in the vault is simply not a thing that can be switched to (A01).
  const token = refreshTokenFor(userId);
  if (token === null) {
    log.warn('switch_rejected_unknown_account', {});
    return ipcFail('API', 'That account is not signed in on this device.');
  }

  const pair = await exchangeExplicitRefreshToken(token);
  if (pair === null) {
    // Distinguish "the server said no" from "we could not reach the server":
    // only the former means the stored credential is spent.
    await forgetAccount(userId);
    log.info('switch_failed_token_rejected', {});
    return ipcFail(
      'UNAUTHENTICATED',
      'That account needs to sign in again. Its saved session has expired.',
    );
  }

  // Past this point the swap is committed: the old session's workers stop
  // before its token is replaced underneath them.
  endSessionScopedWork();
  clearTokens();
  adoptTokenPair(pair);

  const session = await currentSession();
  if (!session.ok || session.data.session === null) {
    // Authenticated but unreadable: leave the credential in place rather than
    // forgetting an account over one failed profile fetch.
    log.warn('switch_profile_unreadable', {});
    return session.ok ? ipcFail('API', 'That account could not be opened.') : session;
  }

  // `currentSession` already refreshed the snapshot; this records the token the
  // exchange just rotated into, so the next switch has a live one.
  const refreshed = refreshTokenOf(pair);
  if (refreshed !== null) {
    await rememberAccount(accountProfileOf(session.data.session.user), refreshed);
  }

  log.info('account_switched', {});
  return session;
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
      endSessionScopedWork();

      const leaving = activeAccountId();

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

      // Signing out erases this account's stored credential rather than leaving
      // it to age out: the point of signing out is that the token is gone.
      if (leaving === null) {
        await clearActiveAccount();
      } else {
        await forgetAccount(leaving);
      }
      log.info('signed_out', {});

      // Another remembered account means the user has somewhere to land. Falling
      // through to it beats a sign-in screen they would answer by picking that
      // same account — and it is the behaviour that makes signing out of one of
      // several accounts feel like leaving a room rather than the building.
      const [next] = listAccounts();
      if (next !== undefined) {
        const resumed = await resumeAccount(next.userId);
        if (resumed.ok) {
          log.info('signed_out_into_next_account', {});
          return resumed;
        }
      }

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

      // Cold start: read the vault, then let the 401 retry path exchange the
      // remembered token on the first authenticated call.
      await loadVault();
      const remembered = startupRefreshToken();
      if (remembered === null) {
        return ipcOk(EMPTY_SESSION);
      }

      adoptRefreshToken(remembered);
      return currentSession();
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_LIST_ACCOUNTS,
    emptyRequestSchema,
    async (): Promise<IpcResult<AccountListResponse>> => {
      await loadVault();
      const active = activeAccountId();
      return ipcOk(
        accountListResponseSchema.parse({
          accounts: listAccounts().map((account) => ({
            ...account,
            isActive: account.userId === active,
          })),
          canRemember: isSecureStorageAvailable(),
          maxAccounts: MAX_REMEMBERED_ACCOUNTS,
        }),
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_SWITCH_ACCOUNT,
    accountIdRequestSchema,
    async ({ userId }): Promise<IpcResult<SessionResponse>> => {
      if (userId === activeAccountId() && accessToken() !== null) {
        // Already there. Re-running the swap would spend a refresh for nothing.
        return currentSession();
      }
      return resumeAccount(userId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_FORGET_ACCOUNT,
    accountIdRequestSchema,
    async ({ userId }): Promise<IpcResult<AcknowledgedResponse>> => {
      if (userId === activeAccountId()) {
        // Removing the account you are using is a sign-out, and sign-out has
        // server-side revocation to do. Refuse rather than half-do it.
        return ipcFail('API', 'Sign out of this account instead of removing it.');
      }
      await forgetAccount(userId);
      log.info('account_removed', {});
      return ipcOk(ACKNOWLEDGED);
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

  registerIpcHandler(
    IPC_CHANNELS.AUTH_CHANGE_PASSWORD_OTP,
    changePasswordOtpRequestSchema,
    async ({ currentPassword }): Promise<IpcResult<AcknowledgedResponse>> => {
      // Authenticated, so a stale access token is refreshed and retried like
      // any other call. A wrong password is a 400, not a 401: the session is
      // fine and nothing here signs the user out.
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.changePasswordOtp,
        body: { currentPassword },
        schema: ignoredDataSchema,
      });

      // Only the outcome's code: never the password (A09).
      log.info(result.ok ? 'change_password_code_sent' : 'change_password_code_failed', {
        ...(result.ok ? {} : { apiCode: result.error.apiCode }),
      });
      return result.ok ? ipcOk(ACKNOWLEDGED) : result;
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
    changePasswordRequestSchema,
    async ({ code, newPassword }): Promise<IpcResult<AcknowledgedResponse>> => {
      const result = await apiRequest({
        method: 'post',
        url: ENDPOINTS.auth.changePassword,
        body: { code, newPassword },
        schema: tokenPairResponseSchema,
      });

      if (!result.ok) {
        log.info('change_password_failed', { apiCode: result.error.apiCode });
        return result;
      }

      // The token that made this call is already revoked, as is every other
      // session: only this pair works now. Adopting it also rotates the vault's
      // copy, so a remembered account still resumes after a restart (A07).
      adoptTokenPair(result.data);

      // The socket authenticated with the revoked token. Reconnecting makes it
      // fetch the new one rather than trust a session the server has ended.
      chatSocket.disconnect();
      chatSocket.connect();

      log.info('password_changed', {});
      return ipcOk(ACKNOWLEDGED);
    },
  );
}
