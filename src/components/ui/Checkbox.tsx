import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className="group gap-sm flex cursor-pointer items-center">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'border-outline-variant accent-primary-container size-4 cursor-pointer rounded-sm border',
          className,
        )}
        {...rest}
      />
      <span className="font-body-sm text-body-sm text-on-surface-variant group-hover:text-on-surface transition-tone">
        {label}
      </span>
    </label>
  );
});
