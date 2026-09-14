import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

type IconButtonTone = 'default' | 'danger' | 'brand';
type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the button has no text of its own. */
  label: string;
  icon: ReactNode;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  /** Draws the pressed/selected state (a toggle that is on). */
  isActive?: boolean;
}

const TONE_CLASSES: Record<IconButtonTone, string> = {
  default: 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  danger: 'text-on-surface-variant hover:bg-error-container hover:text-on-error-container',
  brand: 'text-on-surface-variant hover:bg-primary-fixed hover:text-on-primary-fixed',
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'size-8',
  md: 'size-9',
};

/** A round, tone-shifting button around one icon. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', size = 'md', isActive = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isActive || undefined}
      className={cn(
        'transition-tone inline-flex shrink-0 items-center justify-center rounded-full',
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        isActive && 'bg-primary-fixed text-on-primary-fixed',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
