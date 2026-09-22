import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

/** A group inside a settings pane: the caption heading the page has always used. */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="gap-sm flex flex-col">
      <h2 className="text-on-surface-variant text-caption font-semibold tracking-wider uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface PaneHeaderProps {
  title: string;
  description: string;
}

/** The pane's own title, as the design has it: heading plus one line of why. */
export function PaneHeader({ title, description }: PaneHeaderProps) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="font-heading text-h1 text-on-surface">{title}</h1>
      <p className="text-on-surface-variant text-[14px]">{description}</p>
    </header>
  );
}
