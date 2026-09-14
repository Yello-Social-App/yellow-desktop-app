import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { copyShareLink } from '@/features/feed/api';
import type { Post } from '@/features/feed/types';
import { displayName } from '@/lib/user-display';

interface ShareDialogProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The share dialog: shows the link, and copies it on request.
 *
 * The URL shown is the `shareUrl` the post arrived with. Copying goes through
 * the main process, which re-reads the post and writes the server's own URL
 * to the clipboard — the page holds no clipboard permission and must not be
 * the thing that decides what gets written (OWASP A01).
 */
export function ShareDialog({ post, isOpen, onClose }: ShareDialogProps) {
  // The copy answers with the server's current URL, which wins over the one
  // the post arrived with; until then the post's own is shown.
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = copiedUrl ?? post.shareUrl ?? null;

  const copy = (): void => {
    setIsCopying(true);
    setError(null);

    void copyShareLink(post.id).then((result) => {
      setIsCopying(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCopiedUrl(result.data.url);
      setHasCopied(result.data.copied);
      if (!result.data.copied) {
        setError('The clipboard was unavailable. Copy the link by hand.');
      }
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share this post"
      description={`Anyone with this link can read ${displayName(post.author)}'s post.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button
            leadingIcon={hasCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
            isLoading={isCopying}
            disabled={url === null}
            onClick={copy}
          >
            {hasCopied ? 'Copied' : 'Copy link'}
          </Button>
        </>
      }
    >
      {url !== null && (
        <>
          <label className="sr-only" htmlFor={`share-url-${post.id}`}>
            Link to this post
          </label>
          <Input
            id={`share-url-${post.id}`}
            value={url}
            readOnly
            spellCheck={false}
            onFocus={(event) => {
              event.target.select();
            }}
          />
        </>
      )}

      {error !== null && (
        <p
          role="alert"
          className="text-on-error-container bg-error-container/40 font-body-sm text-body-sm gap-sm px-md py-sm flex items-center rounded-lg"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}
    </Modal>
  );
}
