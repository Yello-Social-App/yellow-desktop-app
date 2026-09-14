import { TriangleAlert } from 'lucide-react';

import type { AuthError } from '@/features/auth/api';

/** Codes the API returns that deserve wording better than its own message. */
const FRIENDLY_MESSAGES: Record<string, string> = {
  RATE_LIMIT_EXCEEDED: 'Too many attempts. Wait a few minutes and try again.',
  ACCOUNT_NOT_VERIFIED: 'This account still needs its email code. Register again to get a new one.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact support to restore it.',
  OTP_INVALID: 'That code is wrong or has expired. Check the email, or ask for a new one.',
  OTP_TOO_MANY_ATTEMPTS: 'Too many wrong codes. Ask for a new one.',
  RESET_TOKEN_INVALID: 'This reset has expired. Start again to get a new code.',
  NETWORK: 'Could not reach Yello. Check your connection and try again.',
};

interface ApiErrorNoticeProps {
  error: AuthError;
}

/** One consistent error line for the auth screens. */
export function ApiErrorNotice({ error }: ApiErrorNoticeProps) {
  const friendly =
    (error.apiCode === undefined ? undefined : FRIENDLY_MESSAGES[error.apiCode]) ??
    FRIENDLY_MESSAGES[error.code];

  return (
    <p
      role="alert"
      className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      {friendly ?? error.message}
    </p>
  );
}
