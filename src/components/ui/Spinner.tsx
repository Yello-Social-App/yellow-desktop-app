import { LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

interface SpinnerProps {
  label?: string;
  className?: string;
}

export function Spinner({ label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('gap-sm inline-flex items-center', className)}
    >
      <LoaderCircle aria-hidden className="text-primary size-5 animate-spin" />
      <span className="font-body-sm text-body-sm text-on-surface-variant">{label}</span>
    </span>
  );
}
