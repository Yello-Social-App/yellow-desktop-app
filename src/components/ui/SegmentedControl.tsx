import { useRef, type KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** A small count after the label, such as how many are in a list. */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  /** Names the group for assistive technology. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

/**
 * A choice of one from a few, as a row of segments in a well.
 *
 * A radio group underneath: one tab stop, with the arrow keys moving the
 * choice along, the way native radios behave.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option !== undefined) {
      onChange(option.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="bg-surface-container-low border-outline-strong flex shrink-0 gap-0.5 rounded-[10px] border p-[3px]"
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'transition-tone flex items-center gap-1.5 rounded-[7px] font-medium',
              size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-[30px] px-3.5 text-[13px]',
              isSelected
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="text-outline font-mono text-[11px] tabular-nums">
                {String(option.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
