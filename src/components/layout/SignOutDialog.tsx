import { LogOut } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useCurrentUser, useSignOut } from '@/features/auth/hooks';

interface SignOutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Sign out, confirmed.
 *
 * One dialog for both places that offer it — the top bar and Settings — so
 * the wording and the busy state cannot drift. The sign-out itself lives
 * here too: the caller only decides when to open it.
 */
export function SignOutDialog({ isOpen, onClose }: SignOutDialogProps) {
  const user = useCurrentUser();
  const signOut = useSignOut();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const confirm = (): void => {
    setIsSigningOut(true);
    // The store drops the session first, which unmounts this dialog with the
    // shell; nothing to reset afterwards.
    void signOut();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title="Sign out of Yello?"
      description={
        user === null
          ? 'You will need your password to sign back in.'
          : `You are signed in as @${user.username}. You will need your password to sign back in.`
      }
      footer={
        <>
          <Button variant="ghost" disabled={isSigningOut} onClick={onClose}>
            Stay signed in
          </Button>
          <Button
            variant="danger"
            leadingIcon={<LogOut className="size-4" />}
            isLoading={isSigningOut}
            onClick={confirm}
          >
            Sign out
          </Button>
        </>
      }
    />
  );
}
