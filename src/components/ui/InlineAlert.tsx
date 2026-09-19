import { TriangleAlert } from 'lucide-react';

import { Button } from './Button';

interface InlineAlertProps {
  message: string;
  /** A retry or a dismiss; omitted, the alert is text alone. */
  actionLabel?: string;
  onAction?: () => void;
}

/** The feed's and the friends screen's error strip, as one component. */
export function InlineAlert({ message, actionLabel, onAction }: InlineAlertProps) {
  return (
    <p
      role="alert"
      className="text-on-error-container bg-error-container/40 m-lg gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {actionLabel !== undefined && onAction !== undefined && (
        <Button size="sm" variant="ghost" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </p>
  );
}
