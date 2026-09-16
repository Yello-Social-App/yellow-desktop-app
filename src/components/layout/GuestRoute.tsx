import { Navigate, Outlet } from 'react-router-dom';

import { Spinner } from '@/components/ui/Spinner';
import { useAccountsStore } from '@/features/auth/accounts-store';
import { useAuthStatus } from '@/features/auth/hooks';

/**
 * The mirror of ProtectedRoute: an authenticated user has no business on the
 * login or register screens, and a successful sign-in leaves them through here.
 *
 * The one exception is adding a second account, which is a sign-in performed
 * while a session is already live. That is a deliberate act the user just asked
 * for, so it opens the gate rather than routing around it — and the flag is set
 * only by the account switcher, never by a URL.
 */
export function GuestRoute() {
  const status = useAuthStatus();
  const isAddingAccount = useAccountsStore((state) => state.isAddingAccount);

  if (status === 'restoring') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting Yello…" />
      </div>
    );
  }

  if (status === 'authenticated' && !isAddingAccount) {
    return <Navigate to="/feed" replace />;
  }

  return <Outlet />;
}
