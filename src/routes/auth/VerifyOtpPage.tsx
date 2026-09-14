import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import { AuthLayout } from '@/components/layout/AuthLayout';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { useVerifyOtp } from '@/features/auth/hooks';

import { AuthBrand } from './components/AuthBrand';
import { OtpCodeForm } from './components/OtpCodeForm';

interface VerifyLocationState {
  email?: string;
}

/**
 * The second half of registration: the API leaves an account
 * PENDING_VERIFICATION until the emailed code is exchanged for tokens.
 */
export function VerifyOtpPage() {
  const location = useLocation();
  const email = (location.state as VerifyLocationState | null)?.email;
  const [rememberMe, setRememberMe] = useState(false);
  const { submit, isSubmitting, error } = useVerifyOtp();

  // Reached directly, with no address to verify against.
  if (email === undefined) {
    return <Navigate to="/register" replace />;
  }

  return (
    <AuthLayout>
      <main className="max-w-auth-canvas flex w-full flex-col">
        <AuthBrand tagline="One code and you're in." />

        <Card elevation="floating" className="p-lg md:p-xl rounded-3xl">
          <OtpCodeForm
            email={email}
            isSubmitting={isSubmitting}
            error={error}
            submitLabel="Verify and continue"
            submittingLabel="Verifying…"
            onSubmit={(code) => {
              void submit(email, code, rememberMe);
            }}
          >
            <Checkbox
              label="Keep me signed in on this device"
              checked={rememberMe}
              onChange={(event) => {
                setRememberMe(event.target.checked);
              }}
            />
          </OtpCodeForm>
        </Card>

        <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg text-center">
          Wrong address?{' '}
          <Link
            to="/register"
            className="font-label text-label text-primary hover:text-primary-fixed-dim ml-xs transition-tone"
          >
            Start over
          </Link>
        </p>
      </main>
    </AuthLayout>
  );
}
