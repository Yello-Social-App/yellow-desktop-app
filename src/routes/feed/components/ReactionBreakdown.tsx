import { useState } from 'react';

import {
  REACTION_LABELS,
  reactionTotal,
  type PostTargetType,
  type Reactable,
} from '@/features/feed/types';
import { cn } from '@/lib/cn';

import { ReactorsDialog } from './ReactorsDialog';

interface ReactionBreakdownProps {
  post: Reactable;
  /** Which kind of post `post` is; community posts are their own target. */
  targetType?: PostTargetType;
}

/** The reaction types on a post, most used first, zero entries dropped. */
function topReactions(post: Reactable): string[] {
  return Object.entries(post.reactionCounts)
    .filter(([key, count]) => key !== 'total' && count > 0 && key in REACTION_LABELS)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key]) => REACTION_LABELS[key as keyof typeof REACTION_LABELS].emoji);
}

/**
 * The stacked reaction emoji, which open into who reacted and with what.
 *
 * A post carries `reactionCounts` from whichever list loaded it, which can be
 * minutes old by the time someone looks; the dialog re-reads the summary and
 * the reactor list fresh, so the stack here is only the invitation. Renders
 * nothing when nobody has reacted.
 */
export function ReactionBreakdown({ post, targetType = 'POST' }: ReactionBreakdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const total = reactionTotal(post);
  const emoji = topReactions(post);

  if (total === 0 || emoji.length === 0) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${String(total)} reactions — see who`}
        title="See who reacted"
        onClick={() => {
          setIsOpen(true);
        }}
        className={cn(
          'transition-tone hover:bg-surface-container-high flex items-center rounded-full px-1.5 py-1 text-[14px] leading-none',
        )}
      >
        {emoji.map((symbol, index) => (
          <span key={symbol} className={cn(index > 0 && '-ml-1')}>
            {symbol}
          </span>
        ))}
      </button>

      {isOpen && (
        <ReactorsDialog
          targetType={targetType}
          postId={post.id}
          isOpen
          onClose={() => {
            setIsOpen(false);
          }}
        />
      )}
    </>
  );
}
