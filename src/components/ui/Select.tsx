import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface SelectOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface SelectProps<TValue extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children' | 'value' | 'onChange'
> {
  options: readonly SelectOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  leadingIcon?: ReactNode;
  isInvalid?: boolean;
}

/**
 * A native `<select>` wearing the Input styling.
 *
 * Native rather than a custom listbox on purpose: the options are a short
 * closed set, and the platform control brings keyboard handling and the OS
 * popup for free — a popup no CSP rule can interfere with.
 */
function SelectInner<TValue extends string>(
  {
    options,
    value,
    onValueChange,
    leadingIcon,
    isInvalid = false,
    className,
    ...rest
  }: SelectProps<TValue>,
  ref: React.ForwardedRef<HTMLSelectElement>,
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
      <select
        ref={ref}
        value={value}
        aria-invalid={isInvalid}
        onChange={(event) => {
          onValueChange(event.target.value as TValue);
        }}
        className={cn(
          'font-body-sm text-body-sm text-on-surface transition-tone w-full appearance-none rounded-lg border py-2',
          'bg-surface-container-low cursor-pointer',
          'focus:ring-2 focus:outline-none',
          isInvalid
            ? 'border-error focus:border-error focus:ring-error/20'
            : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20',
          leadingIcon === undefined ? 'pl-md' : 'pl-10',
          'pr-9',
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="text-outline right-sm pointer-events-none absolute top-1/2 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export const Select = forwardRef(SelectInner) as <TValue extends string>(
  props: SelectProps<TValue> & { ref?: React.ForwardedRef<HTMLSelectElement> },
) => ReturnType<typeof SelectInner>;
