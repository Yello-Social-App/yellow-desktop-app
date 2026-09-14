import { useState } from 'react';

import { reactionTotal, type Post } from '@/features/feed/types';
import { cn } from '@/lib/cn';

import { ReactorsDialog } from './ReactorsDialog';

interface ReactionBreakdownProps {
  post: Post;
}

/**
 * The reaction count, which opens into who reacted and with what.
 *
 * A post carries `reactionCounts` from whichever list loaded it, which can be
 * minutes old by the time someone looks; the dialog re-reads the summary and
 * the reactor list fresh, so the count here is only the invitation.
 */
export function ReactionBreakdown({ post }: ReactionBreakdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const total = reactionTotal(post);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={total === 0}
        onClick={() => {
          setIsOpen(true);
        }}
        className={cn(
          'font-small text-small text-on-surface-variant transition-tone rounded-md text-left',
          total > 0 && 'hover:text-on-surface underline-offset-2 hover:underline',
        )}
      >
        {total} reactions
      </button>

      {isOpen && (
        <ReactorsDialog
          post={post}
          isOpen
          onClose={() => {
            setIsOpen(false);
          }}
        />
      )}
    </>
  );
}
