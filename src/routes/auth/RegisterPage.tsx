import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useRegister } from '@/features/auth/hooks';
import { registerFormSchema, type RegisterFormValues } from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';

import { ApiErrorNotice } from './components/ApiErrorNotice';
import { AuthBrand } from './components/AuthBrand';
import { RegisterFields, type RegisterDraft } from './components/RegisterFields';

const INITIAL_VALUES: RegisterDraft = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

export function RegisterPage() {
  const navigate = useNavigate();
  const { submit, isSubmitting, error } = useRegister();
  const form = useZodForm<RegisterDraft, RegisterFormValues>(registerFormSchema, INITIAL_VALUES);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }

    void submit(validated.data).then((result) => {
      if (result?.ok === true) {
        // The account exists but is unverified: the code is on its way by email.
        void navigate('/verify', { state: { email: validated.data.email } });
      }
    });
  };

  return (
    <AuthLayout>
      <main className="max-w-auth-wide py-lg flex w-full flex-col">
        <AuthBrand tagline="Create an account and start posting." />

        <Card elevation="canvas" className="overflow-hidden rounded-3xl">
          <div aria-hidden className="bg-primary-container h-2 w-full" />
          <form className="gap-lg p-lg md:p-xl flex flex-col" onSubmit={handleSubmit} noValidate>
            <RegisterFields form={form} />

            {error !== null && <ApiErrorNotice error={error} />}

            <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </Card>

        <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg text-center">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
          >
            Log in here
          </Link>
        </p>
      </main>
    </AuthLayout>
  );
}
