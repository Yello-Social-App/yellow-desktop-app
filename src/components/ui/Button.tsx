import { LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Pills, always. Primary is the one filled-yellow control on a screen; the
 * rest shift tone on hover rather than lift.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-container text-on-primary-container hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
  outline:
    'border border-outline-variant bg-transparent text-on-surface hover:bg-surface-container-low',
  ghost:
    'bg-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
  danger: 'bg-error text-on-error hover:brightness-110',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small font-semibold',
  md: 'h-9 px-4 text-label',
  lg: 'h-11 px-6 text-body-sm font-semibold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    fullWidth = false,
    leadingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading}
      className={cn(
        'font-label inline-flex shrink-0 items-center justify-center gap-2 rounded-full whitespace-nowrap',
        'transition-tone disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {isLoading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : leadingIcon}
      {children}
    </button>
  );
});
