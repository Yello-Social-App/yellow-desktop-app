import { cn } from '@/lib/cn';

type SwitchSize = 'sm' | 'md';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Required: the switch has no text of its own. */
  label: string;
  disabled?: boolean;
  size?: SwitchSize;
}

const TRACK_CLASSES: Record<SwitchSize, string> = {
  sm: 'h-6 w-10',
  md: 'h-[26px] w-11',
};

const THUMB_CLASSES: Record<SwitchSize, { base: string; on: string }> = {
  sm: { base: 'size-[18px]', on: 'translate-x-4' },
  md: { base: 'size-5', on: 'translate-x-[18px]' },
};

/**
 * An on/off setting that takes effect at once, as a pill with a sliding thumb.
 * A real `role="switch"` button, so it is announced as on or off rather than
 * as pressed, and Space and Enter both flip it.
 */
export function Switch({ checked, onChange, label, disabled = false, size = 'md' }: SwitchProps) {
  const thumb = THUMB_CLASSES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        'transition-tone flex shrink-0 items-center rounded-full p-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        TRACK_CLASSES[size],
        checked ? 'bg-primary-container' : 'bg-surface-container-highest',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'rounded-full bg-white shadow-sm transition-transform',
          thumb.base,
          checked && thumb.on,
        )}
      />
    </button>
  );
}
