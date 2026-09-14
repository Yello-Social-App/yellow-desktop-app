/**
 * Session state.
 *
 * The store holds a profile and an expiry — never a token. Credentials live in
 * the main process, which is the only place that can reach the API, so an XSS
 * payload in this renderer has nothing to steal (OWASP A02).
 */
import type { Session, User } from '@shared/ipc-types';
import { create } from 'zustand';

import { onUnauthenticated } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';

import { currentSession, logout } from './api';

const log = createLogger('auth.store');

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  expiresAt: number | null;
  adoptSession: (session: Session | null) => void;
  /** Replaces the cached profile after an edit, leaving the session intact. */
  adoptUser: (user: User) => void;
  signOut: () => Promise<void>;
  restore: () => Promise<void>;
  /** Drops the session if the access token has expired. Returns true when valid. */
  enforceExpiry: () => boolean;
}

const signedOutState = { status: 'unauthenticated', user: null, expiresAt: null } as const;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'restoring',
  user: null,
  expiresAt: null,

  adoptSession: (session) => {
    if (session === null) {
      set(signedOutState);
      return;
    }
    set({ status: 'authenticated', user: session.user, expiresAt: session.expiresAt });
  },

  adoptUser: (user) => {
    set({ user });
  },

  signOut: async () => {
    set(signedOutState);
    await logout();
    log.info('signed_out', {});
  },

  restore: async () => {
    const result = await currentSession();

    if (!result.ok || result.data === null) {
      set(signedOutState);
      return;
    }

    set({ status: 'authenticated', user: result.data.user, expiresAt: result.data.expiresAt });
    log.info('session_restored', {});
  },

  enforceExpiry: () => {
    const { expiresAt, status } = get();

    if (status !== 'authenticated' || expiresAt === null) {
      return false;
    }

    // The main process refreshes silently on a 401, so an elapsed expiry is not
    // itself a sign-out — it just means the next call will renew the token.
    return expiresAt > Date.now();
  },
}));

/**
 * A call that came back UNAUTHENTICATED means the main process could not
 * refresh: the session is revoked or expired for good. Drop to the sign-in
 * screen rather than leave a screen showing the API's 401 text. Only while
 * signed in — a rejected sign-in attempt is that form's own business.
 */
onUnauthenticated(() => {
  if (useAuthStore.getState().status === 'authenticated') {
    log.info('session_ended_by_server', {});
    useAuthStore.setState(signedOutState);
  }
});
