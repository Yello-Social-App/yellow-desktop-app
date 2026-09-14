import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useResetPassword } from '@/features/auth/hooks';
import {
  REGISTER_PASSWORD_MIN_LENGTH,
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';

import { ApiErrorNotice } from './components/ApiErrorNotice';
import { AuthBrand } from './components/AuthBrand';
import { PasswordField } from './components/PasswordField';

const INITIAL_VALUES = { newPassword: '', confirmPassword: '' };

interface ResetLocationState {
  email?: string;
}

/**
 * The last step of a password reset.
 *
 * There is nothing to paste: the reset token was minted when the emailed code
 * was checked and is held by the main process, which spends it here. The token
 * is good for fifteen minutes and one use, so a rejection sends the user back
 * to ask for a new code rather than letting them retry a dead one.
 */
export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as ResetLocationState | null)?.email;
  const { submit, isSubmitting, error } = useResetPassword();
  const form = useZodForm<typeof INITIAL_VALUES, ResetPasswordFormValues>(
    resetPasswordFormSchema,
    INITIAL_VALUES,
  );

  // Reached directly: no code has been checked on this run, so there is no
  // token to spend.
  if (email === undefined) {
    return <Navigate to="/forgot-password" replace />;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }

    void submit(validated.data.newPassword).then((result) => {
      if (result?.ok === true) {
        // Straight to sign-in: the reset does not issue a session, and it
        // revokes every existing one.
        void navigate('/login', { replace: true });
      }
    });
  };

  return (
    <AuthLayout>
      <main className="max-w-auth-canvas flex w-full flex-col">
        <AuthBrand tagline="Choose a new password." />

        <Card elevation="floating" className="p-lg md:p-xl rounded-3xl">
          <form className="gap-lg flex flex-col" onSubmit={handleSubmit} noValidate>
            <div className="gap-xs flex flex-col">
              <h2 className="font-heading text-h3 text-on-surface">Reset your password</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Code accepted for <strong className="text-on-surface">{email}</strong>. Pick a new
                password of at least {REGISTER_PASSWORD_MIN_LENGTH} characters.
              </p>
            </div>

            <div className="gap-md flex flex-col">
              <PasswordField
                label="New password"
                showLeadingIcon
                autoComplete="new-password"
                value={form.values.newPassword}
                error={form.errors.newPassword}
                onChange={(value) => {
                  form.setField('newPassword', value);
                }}
              />

              <PasswordField
                label="Confirm password"
                showLeadingIcon
                autoComplete="new-password"
                value={form.values.confirmPassword}
                error={form.errors.confirmPassword}
                onChange={(value) => {
                  form.setField('confirmPassword', value);
                }}
              />
            </div>

            {error !== null && <ApiErrorNotice error={error} />}

            <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        </Card>

        <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg text-center">
          Code expired?{' '}
          <Link
            to="/forgot-password"
            className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
          >
            Start again
          </Link>
        </p>
      </main>
    </AuthLayout>
  );
}
