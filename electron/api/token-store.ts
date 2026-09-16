/**
 * Where the live credentials sit: main-process memory, and nowhere else.
 *
 * The access token and the current refresh token are held here for the duration
 * of the process. Persistence across restarts — and across account switches —
 * belongs to `account-vault.ts`, which encrypts what it writes through
 * safeStorage; this module deliberately knows nothing about disk.
 *
 * The renderer has no way to read any of this: there is no IPC channel that
 * returns a token (OWASP A02/A04).
 */
import { isSecureStorageAvailable as vaultEncryptionAvailable } from './account-vault';

interface TokenState {
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
}

const state: TokenState = {
  accessToken: null,
  accessTokenExpiresAt: null,
  refreshToken: null,
};

export function accessToken(): string | null {
  if (state.accessToken === null || state.accessTokenExpiresAt === null) {
    return null;
  }
  return state.accessTokenExpiresAt > Date.now() ? state.accessToken : null;
}

export function accessTokenExpiresAt(): number | null {
  return state.accessTokenExpiresAt;
}

export function refreshToken(): string | null {
  return state.refreshToken;
}

export function setTokens(tokens: {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string | null;
}): void {
  state.accessToken = tokens.accessToken;
  state.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
  if (tokens.refreshToken !== null) {
    state.refreshToken = tokens.refreshToken;
  }
}

export function clearTokens(): void {
  state.accessToken = null;
  state.accessTokenExpiresAt = null;
  state.refreshToken = null;
}

/**
 * Adopts a token recovered from the vault, without an access token yet — a
 * cold start and an account switch both begin here, then exchange it.
 */
export function adoptRefreshToken(token: string): void {
  state.accessToken = null;
  state.accessTokenExpiresAt = null;
  state.refreshToken = token;
}

export function isSecureStorageAvailable(): boolean {
  return vaultEncryptionAvailable();
}
