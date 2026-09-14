import { Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { forgotPassword, type AuthError } from '@/features/auth/api';
import { useVerifyResetOtp } from '@/features/auth/hooks';
import { EMAIL_MAX_LENGTH } from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';

import { ApiErrorNotice } from './components/ApiErrorNotice';
import { AuthBrand } from './components/AuthBrand';
import { OtpCodeForm } from './components/OtpCodeForm';

const forgotPasswordFormSchema = z.object({
  email: z.email('Enter a valid email address.').max(EMAIL_MAX_LENGTH),
});

const INITIAL_VALUES = { email: '' };

/**
 * The first two steps of a password reset: ask for the code, then check it.
 *
 * The API answers `200` whether or not the address is registered, so the
 * wording after sending must not imply the account was found — that is what
 * keeps the endpoint from being an account-enumeration oracle (OWASP A01/A07).
 *
 * A correct code gives the main process a reset token; nothing about it comes
 * back here. The new-password screen is reached with the address in navigation
 * state, which is how it knows a code was checked on this run.
 */
export function ForgotPasswordPage() {
  const emailId = useId();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const verify = useVerifyResetOtp();
  const form = useZodForm<typeof INITIAL_VALUES, { email: string }>(
    forgotPasswordFormSchema,
    INITIAL_VALUES,
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    void forgotPassword(validated.data.email).then((result) => {
      setIsSubmitting(false);
      if (result.ok) {
        setSentTo(validated.data.email);
      } else {
        setError(result.error);
      }
    });
  };

  const handleCode = (code: string): void => {
    if (sentTo === null) {
      return;
    }
    void verify.submit(sentTo, code).then((result) => {
      if (result?.ok === true) {
        void navigate('/reset-password', { replace: true, state: { email: sentTo } });
      }
    });
  };

  return (
    <AuthLayout>
      <main className="max-w-auth-canvas flex w-full flex-col">
        <AuthBrand tagline="Let's get you back in." />

        <Card elevation="floating" className="p-lg md:p-xl rounded-3xl">
          {sentTo !== null ? (
            <OtpCodeForm
              email={sentTo}
              isSubmitting={verify.isSubmitting}
              error={verify.error}
              submitLabel="Continue"
              submittingLabel="Checking…"
              onSubmit={handleCode}
            />
          ) : (
            <form className="gap-lg flex flex-col" onSubmit={handleSubmit} noValidate>
              <div className="gap-xs flex flex-col">
                <h2 className="font-heading text-h3 text-on-surface">Forgot your password?</h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Enter the email you signed up with. If it&apos;s registered, we&apos;ll send a
                  code to reset your password.
                </p>
              </div>

              <FormField id={emailId} label="Email" error={form.errors.email}>
                <Input
                  id={emailId}
                  type="email"
                  autoComplete="username"
                  placeholder="name@example.com"
                  value={form.values.email}
                  isInvalid={form.errors.email !== undefined}
                  leadingIcon={<Mail className="size-5" />}
                  onChange={(event) => {
                    form.setField('email', event.target.value);
                  }}
                />
              </FormField>

              {error !== null && <ApiErrorNotice error={error} />}

              <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset code'}
              </Button>
            </form>
          )}
        </Card>

        <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg text-center">
          {sentTo === null ? 'Remembered it?' : 'Wrong address?'}{' '}
          {sentTo === null ? (
            <Link
              to="/login"
              className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
            >
              Back to sign in
            </Link>
          ) : (
            <button
              type="button"
              className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
              onClick={() => {
                setSentTo(null);
              }}
            >
              Start over
            </button>
          )}
        </p>
      </main>
    </AuthLayout>
  );
}
