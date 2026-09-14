import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/** The shared "nothing here yet" surface. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="gap-md px-lg py-xl flex flex-col items-center text-center">
      <span
        aria-hidden
        className="bg-surface-container text-primary ring-outline-variant flex size-14 items-center justify-center rounded-2xl ring-1"
      >
        {icon}
      </span>
      <div className="gap-xs flex flex-col">
        <h3 className="font-heading text-h2 text-on-surface">{title}</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-copy">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
