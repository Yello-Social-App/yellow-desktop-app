import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'count';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  brand: 'bg-primary-fixed text-on-primary-fixed',
  success: 'bg-tertiary-fixed text-on-tertiary-fixed',
  warning: 'bg-error-container text-on-error-container',
  /** The unread-count dot: filled yellow, dark text, tabular digits. */
  count: 'bg-primary-container text-on-primary-container min-w-5 justify-center tabular-nums',
};

interface BadgeProps {
  tone?: BadgeTone;
  children: string;
}

/** A small pill chip. */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={cn(
        'font-label text-caption inline-flex h-5 items-center rounded-full px-2',
        tone !== 'count' && 'uppercase',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}
