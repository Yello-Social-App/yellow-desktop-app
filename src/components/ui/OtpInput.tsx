import { useRef } from 'react';

import { cn } from '@/lib/cn';

interface OtpInputProps {
  id: string;
  length: number;
  value: string;
  onChange: (value: string) => void;
  isInvalid?: boolean;
  disabled?: boolean;
}

/**
 * One box per digit.
 *
 * Six inputs read as six digits — the shape of the thing being typed — and
 * each box knows only its own digit, so the rules are few: a digit fills the
 * box and moves on, Backspace clears and moves back, the arrow keys move
 * without changing anything, and a paste of the whole code fills every box
 * from wherever it landed. The value handed up is always the joined string,
 * so the form validates exactly what it did with one field.
 *
 * The first box carries `autocomplete="one-time-code"`, which is what lets a
 * platform offer the code straight from the email.
 */
export function OtpInput({
  id,
  length,
  value,
  onChange,
  isInvalid = false,
  disabled = false,
}: OtpInputProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, position) => value[position] ?? '');

  const focus = (position: number): void => {
    boxes.current[Math.max(0, Math.min(length - 1, position))]?.select();
  };

  const write = (next: string[]): void => {
    onChange(next.join(''));
  };

  const handleInput = (position: number, raw: string): void => {
    const typed = raw.replace(/\D/g, '');
    if (typed === '') {
      // A non-digit keypress: leave the box as it was.
      write(digits);
      return;
    }

    // More than one digit at once is a paste, or an autofill: spread it from
    // this box onwards and land after the last digit written.
    const next = [...digits];
    let cursor = position;
    for (const digit of typed) {
      if (cursor >= length) {
        break;
      }
      next[cursor] = digit;
      cursor += 1;
    }
    write(next);
    focus(cursor < length ? cursor : length - 1);
  };

  const handleKeyDown = (position: number, event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        const next = [...digits];
        if (next[position] !== '') {
          next[position] = '';
          write(next);
        } else if (position > 0) {
          next[position - 1] = '';
          write(next);
          focus(position - 1);
        }
        break;
      }
      case 'ArrowLeft':
        event.preventDefault();
        focus(position - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focus(position + 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="gap-sm flex justify-center" role="group" aria-label="Verification code">
      {digits.map((digit, position) => (
        <input
          key={position}
          ref={(element) => {
            boxes.current[position] = element;
          }}
          id={position === 0 ? id : `${id}-${String(position + 1)}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={position === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${String(position + 1)} of ${String(length)}`}
          aria-invalid={isInvalid}
          disabled={disabled}
          // Not `maxLength={1}`: that would truncate a paste before we see it.
          value={digit}
          onChange={(event) => {
            handleInput(position, event.target.value);
          }}
          onKeyDown={(event) => {
            handleKeyDown(position, event);
          }}
          onFocus={(event) => {
            event.target.select();
          }}
          className={cn(
            'font-heading text-h2 text-on-surface bg-surface-container-low transition-tone size-12 rounded-lg border text-center caret-transparent sm:size-14',
            'focus:ring-2 focus:outline-none',
            isInvalid
              ? 'border-error focus:border-error focus:ring-error/20'
              : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20',
            digit !== '' && !isInvalid && 'border-primary-container',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      ))}
    </div>
  );
}
