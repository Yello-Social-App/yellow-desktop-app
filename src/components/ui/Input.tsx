import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inside the field, 16px from the left edge. */
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  isInvalid?: boolean;
}

/**
 * A tonal field: one step above the canvas, a hairline that turns yellow on
 * focus with a soft outer glow.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leadingIcon, trailingSlot, isInvalid = false, className, ...rest },
  ref,
) {
  return (
    <div className="relative">
      {leadingIcon !== undefined && (
        <span
          aria-hidden
          className="text-outline left-md pointer-events-none absolute top-1/2 -translate-y-1/2"
        >
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={isInvalid}
        className={cn(
          'font-body text-body text-on-surface transition-tone h-11 w-full rounded-xl border',
          'bg-surface-container-low placeholder:text-outline',
          'focus:bg-surface-container-lowest focus:ring-2 focus:outline-none',
          isInvalid
            ? 'border-error focus:border-error focus:ring-error/20'
            : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20',
          leadingIcon === undefined ? 'pl-md' : 'pl-11',
          trailingSlot === undefined ? 'pr-md' : 'pr-11',
          className,
        )}
        {...rest}
      />
      {trailingSlot !== undefined && (
        <span className="right-sm absolute top-1/2 -translate-y-1/2">{trailingSlot}</span>
      )}
    </div>
  );
});
