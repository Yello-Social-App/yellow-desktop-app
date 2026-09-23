import { CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  /** The control on the right: a switch, a segmented choice, a button. */
  control: ReactNode;
  /** Drops the hairline above, for the first row in a card. */
  isFirst?: boolean;
  /** Ties the label to the control for assistive technology. */
  labelId?: string;
}

/** One setting inside a card: what it is and why on the left, its control on the right. */
export function SettingRow({
  label,
  description,
  control,
  isFirst = false,
  labelId,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        'px-lg py-md flex items-center gap-5',
        !isFirst && 'border-outline-variant border-t',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="text-on-surface text-[14px] font-medium">
          {label}
        </span>
        {description !== undefined && (
          <span className="text-on-surface-variant text-[12px] leading-snug">{description}</span>
        )}
      </div>
      {control}
    </div>
  );
}

interface CardHeadingProps {
  title: string;
  description?: string;
  /** Sits on the right of the heading: a switch, a tab row, a small button. */
  action?: ReactNode;
}

/** The heading strip across the top of a card, above its rows. */
export function CardHeading({ title, description, action }: CardHeadingProps) {
  return (
    <div className="border-outline-variant flex items-center gap-3 border-b px-[18px] py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-on-surface text-[14px] font-semibold">{title}</h2>
        {description !== undefined && (
          <p className="text-on-surface-variant text-[12px]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** The small capitals over a side column: "Live preview", "Your recent feedback". */
export function AsideLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-outline text-[11px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </h2>
  );
}

/** A green "that worked" line at the top of a form. */
export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="bg-tertiary-fixed text-on-tertiary-fixed flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px]"
    >
      <CircleCheck aria-hidden className="size-4 shrink-0" />
      {children}
    </p>
  );
}
