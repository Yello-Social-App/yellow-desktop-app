import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inside the field, 16px from the left edge. */
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  isInvalid?: boolean;
}

/**
 * Focus state matches the design system: a 1px yellow border plus a 2px soft
 * outer glow.
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
          'font-body text-body text-on-surface transition-tone w-full rounded-lg border py-3',
          'bg-surface-container-low placeholder:text-outline-variant',
          'focus:ring-2 focus:outline-none',
          isInvalid
            ? 'border-error bg-error-container/20 focus:border-error focus:ring-error/20'
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
