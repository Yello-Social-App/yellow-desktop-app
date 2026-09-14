/**
 * Auth hooks: the only way components touch session state.
 */
import type { Session, User } from '@shared/ipc-types';
import { useCallback, useEffect, useState } from 'react';

import { OTP_RESEND_COOLDOWN_MS, SESSION_EXPIRY_CHECK_MS } from '@/lib/constants';
import type { Result } from '@/lib/result';

import {
  login,
  register,
  resendOtp,
  resetPassword,
  verifyOtp,
  verifyResetOtp,
  type AuthError,
} from './api';
import { useAuthStore, type AuthStatus } from './store';

export function useAuthStatus(): AuthStatus {
  return useAuthStore((state) => state.status);
}

export function useCurrentUser(): User | null {
  return useAuthStore((state) => state.user);
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.status === 'authenticated');
}

/**
 * Restores a remembered session once at startup, then re-checks expiry so a
 * lapsed session is noticed even while the window sits idle.
 */
export function useSessionLifecycle(): void {
  const restore = useAuthStore((state) => state.restore);
  const enforceExpiry = useAuthStore((state) => state.enforceExpiry);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const timer = setInterval(enforceExpiry, SESSION_EXPIRY_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enforceExpiry]);
}

interface Submission<TArgs extends unknown[], TData> {
  submit: (...args: TArgs) => Promise<Result<TData, AuthError> | null>;
  isSubmitting: boolean;
  error: AuthError | null;
  clearError: () => void;
}

function useSubmission<TArgs extends unknown[], TData>(
  operation: (...args: TArgs) => Promise<Result<TData, AuthError>>,
  onSuccess?: (data: TData) => void,
): Submission<TArgs, TData> {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const submit = useCallback(
    async (...args: TArgs) => {
      setIsSubmitting(true);
      setError(null);

      const result = await operation(...args);

      if (result.ok) {
        onSuccess?.(result.data);
      } else {
        setError(result.error);
      }

      setIsSubmitting(false);
      return result;
    },
    [operation, onSuccess],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { submit, isSubmitting, error, clearError };
}

export function useLogin() {
  const adoptSession = useAuthStore((state) => state.adoptSession);
  const onSuccess = useCallback(
    (session: Session | null) => {
      adoptSession(session);
    },
    [adoptSession],
  );
  return useSubmission(login, onSuccess);
}

export function useRegister() {
  return useSubmission(register);
}

export function useVerifyOtp() {
  const adoptSession = useAuthStore((state) => state.adoptSession);
  const onSuccess = useCallback(
    (session: Session | null) => {
      adoptSession(session);
    },
    [adoptSession],
  );
  return useSubmission(verifyOtp, onSuccess);
}

export function useVerifyResetOtp() {
  return useSubmission(verifyResetOtp);
}

export function useResetPassword() {
  return useSubmission(resetPassword);
}

export interface ResendOtp {
  resend: () => void;
  isResending: boolean;
  /** Seconds until the button is offered again; 0 when it is. */
  cooldownSeconds: number;
  /** True once a resend was accepted, until the next attempt. */
  hasResent: boolean;
  error: AuthError | null;
}

/**
 * The "Resend code" button, for either OTP screen.
 *
 * The server refuses a second code within 60 seconds of the first — silently,
 * with the same 200 — so the button holds itself back for that long after a
 * resend rather than letting the user press it into a cooldown they cannot see.
 */
export function useResendOtp(email: string): ResendOtp {
  const [hasResent, setHasResent] = useState(false);
  const [availableAt, setAvailableAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const onSuccess = useCallback(() => {
    setHasResent(true);
    setAvailableAt(Date.now() + OTP_RESEND_COOLDOWN_MS);
  }, []);
  const { submit, isSubmitting, error } = useSubmission(resendOtp, onSuccess);

  const cooldownSeconds =
    availableAt === null ? 0 : Math.max(0, Math.ceil((availableAt - now) / 1000));
  const isCoolingDown = cooldownSeconds > 0;

  // Ticks only while there is a countdown to show.
  useEffect(() => {
    if (!isCoolingDown) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [isCoolingDown]);

  const resend = useCallback(() => {
    if (isCoolingDown) {
      return;
    }
    setHasResent(false);
    void submit(email);
  }, [isCoolingDown, submit, email]);

  return { resend, isResending: isSubmitting, cooldownSeconds, hasResent, error };
}

export function useSignOut(): () => Promise<void> {
  return useAuthStore((state) => state.signOut);
}
