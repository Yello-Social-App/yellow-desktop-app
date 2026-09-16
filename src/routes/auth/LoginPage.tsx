import { ArrowLeft, Mail } from 'lucide-react';
import { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { useAccountsStore } from '@/features/auth/accounts-store';
import { useLogin } from '@/features/auth/hooks';
import { loginFormSchema, type LoginFormValues } from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';

import { ApiErrorNotice } from './components/ApiErrorNotice';
import { AuthBrand } from './components/AuthBrand';
import { PasswordField } from './components/PasswordField';

const INITIAL_VALUES = { email: '', password: '', rememberMe: false };

export function LoginPage() {
  const emailId = useId();
  const navigate = useNavigate();
  const { submit, isSubmitting, error } = useLogin();
  // Reached from the account switcher while another session is already live.
  const isAddingAccount = useAccountsStore((state) => state.isAddingAccount);
  const cancelAddAccount = useAccountsStore((state) => state.cancelAddAccount);
  const form = useZodForm<typeof INITIAL_VALUES, LoginFormValues>(loginFormSchema, INITIAL_VALUES);

  // A successful sign-in flips auth status; GuestRoute performs the redirect.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (validated.ok) {
      void submit(validated.data.email, validated.data.password, validated.data.rememberMe);
    }
  };

  return (
    <AuthLayout>
      <main className="max-w-auth-canvas flex w-full flex-col">
        {isAddingAccount && (
          <button
            type="button"
            onClick={() => {
              cancelAddAccount();
              void navigate('/feed');
            }}
            className="text-on-surface-variant hover:text-on-surface transition-tone gap-xs mb-md -ml-1 flex items-center self-start text-[14px] font-semibold"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to Yello
          </button>
        )}

        <AuthBrand
          tagline={
            isAddingAccount
              ? 'Sign in to the account you want to add.'
              : 'Sign in to catch up with your friends.'
          }
        />

        <Card elevation="floating" className="p-lg md:p-xl rounded-3xl">
          <form className="gap-lg flex flex-col" onSubmit={handleSubmit} noValidate>
            <div className="gap-md flex flex-col">
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

              <PasswordField
                label="Password"
                showLeadingIcon
                autoComplete="current-password"
                value={form.values.password}
                error={form.errors.password}
                onChange={(value) => {
                  form.setField('password', value);
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <Checkbox
                label="Remember me"
                checked={form.values.rememberMe}
                onChange={(event) => {
                  form.setField('rememberMe', event.target.checked);
                }}
              />
              <Link
                to="/forgot-password"
                className="font-label text-label text-primary hover:text-primary-fixed-dim transition-tone"
              >
                Forgot password?
              </Link>
            </div>

            {error !== null && <ApiErrorNotice error={error} />}

            <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Login'}
            </Button>
          </form>
        </Card>

        <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg text-center">
          {isAddingAccount ? 'Need a new account?' : "Don't have an account?"}{' '}
          <Link
            to="/register"
            className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
          >
            Register
          </Link>
        </p>
      </main>
    </AuthLayout>
  );
}
