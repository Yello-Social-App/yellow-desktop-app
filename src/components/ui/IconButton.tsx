import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the button has no text of its own. */
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'danger';
}

const TONE_CLASSES: Record<'default' | 'danger', string> = {
  default: 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary',
  danger: 'text-on-surface-variant hover:bg-error hover:text-on-error',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'transition-tone inline-flex size-9 items-center justify-center rounded-lg',
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
