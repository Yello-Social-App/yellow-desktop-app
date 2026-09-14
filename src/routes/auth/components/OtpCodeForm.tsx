import { MailCheck } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { OtpInput } from '@/components/ui/OtpInput';
import type { AuthError } from '@/features/auth/api';
import { useResendOtp } from '@/features/auth/hooks';
import { OTP_LENGTH, verifyOtpFormSchema, type VerifyOtpFormValues } from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';

import { ApiErrorNotice } from './ApiErrorNotice';

const INITIAL_VALUES = { code: '' };

interface OtpCodeFormProps {
  email: string;
  isSubmitting: boolean;
  error: AuthError | null;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (code: string) => void;
  /** Extra controls between the code and the button — the "keep me signed in" box. */
  children?: ReactNode;
}

/**
 * The emailed-code step, shared by registration and the password reset.
 *
 * One endpoint checks every code and one re-sends it, so one form collects it.
 * What differs per flow — what a valid code leads to — is the caller's, passed
 * in as `onSubmit`.
 */
export function OtpCodeForm({
  email,
  isSubmitting,
  error,
  submitLabel,
  submittingLabel,
  onSubmit,
  children,
}: OtpCodeFormProps) {
  const codeId = useId();
  const form = useZodForm<typeof INITIAL_VALUES, VerifyOtpFormValues>(
    verifyOtpFormSchema,
    INITIAL_VALUES,
  );
  const resend = useResendOtp(email);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (validated.ok) {
      onSubmit(validated.data.code);
    }
  };

  return (
    <>
      <div className="mb-lg gap-sm flex flex-col items-center text-center">
        <span
          aria-hidden
          className="bg-surface-container-low text-primary flex size-12 items-center justify-center rounded-xl"
        >
          <MailCheck className="size-6" />
        </span>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          We sent a {OTP_LENGTH}-digit code to <strong className="text-on-surface">{email}</strong>.
          It expires in five minutes.
        </p>
      </div>

      <form className="gap-lg flex flex-col" onSubmit={handleSubmit} noValidate>
        <FormField id={codeId} label="Verification code" error={form.errors.code}>
          <OtpInput
            id={codeId}
            length={OTP_LENGTH}
            value={form.values.code}
            isInvalid={form.errors.code !== undefined}
            disabled={isSubmitting}
            onChange={(code) => {
              form.setField('code', code);
            }}
          />
        </FormField>

        {children}

        {error !== null && <ApiErrorNotice error={error} />}
        {resend.error !== null && <ApiErrorNotice error={resend.error} />}

        <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>

        <div
          aria-live="polite"
          className="font-body-sm text-body-sm text-on-surface-variant gap-xs flex flex-col text-center"
        >
          {/* The server answers the same whether or not it sent anything, so
              this promises a check, not an email. */}
          {resend.hasResent && <p>If that address is registered, a new code is on its way.</p>}
          <p>
            Didn&apos;t get it?{' '}
            <button
              type="button"
              disabled={resend.isResending || resend.cooldownSeconds > 0}
              onClick={resend.resend}
              className="font-label text-label text-primary hover:text-primary-fixed-dim disabled:text-on-surface-variant transition-tone disabled:cursor-not-allowed"
            >
              {resend.cooldownSeconds > 0
                ? `Resend in ${String(resend.cooldownSeconds)}s`
                : resend.isResending
                  ? 'Sending…'
                  : 'Resend code'}
            </button>
          </p>
        </div>
      </form>
    </>
  );
}
