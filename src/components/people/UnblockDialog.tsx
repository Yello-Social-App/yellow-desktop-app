import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface UnblockDialogProps {
  /** The display name of the person being unblocked. */
  name: string;
  /** Carries out the unblock; resolves to whether the server accepted it. */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}

/**
 * Unblock, confirmed.
 *
 * One dialog for every place that offers it — a profile, a friends row,
 * Settings and a blocked chat — so the wording cannot drift between them.
 * Callers mount it only while it is open, and each passes its own unblock:
 * the chat also clears a refused send, and sample people never reach the API.
 * It closes only once the unblock went through; a refusal stays on screen with
 * the way to try again.
 */
export function UnblockDialog({ name, onConfirm, onClose }: UnblockDialogProps) {
  const [isUnblocking, setIsUnblocking] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = (): void => {
    setIsUnblocking(true);
    setFailed(false);
    void onConfirm().then((done) => {
      if (done) {
        onClose();
        return;
      }
      setIsUnblocking(false);
      setFailed(true);
    });
  };

  return (
    <Modal
      isOpen
      onClose={isUnblocking ? () => undefined : onClose}
      size="sm"
      title={`Unblock ${name}?`}
      description={`${name} will be able to see your profile and send you messages and friend requests again. Unblocking doesn’t make you friends again.`}
      footer={
        <>
          <Button variant="ghost" disabled={isUnblocking} onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={isUnblocking} onClick={confirm}>
            Unblock
          </Button>
        </>
      }
    >
      {failed && (
        <p role="alert" className="text-error text-[13px]">
          That didn’t go through. Try again.
        </p>
      )}
    </Modal>
  );
}
