import type { ReactNode } from 'react';

import { WindowControls } from './WindowControls';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * The centred canvas the sign-in screens sit on: the dark ground with one
 * soft brand glow behind the card. The window is frameless, so this layout
 * also carries the drag region and controls.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="bg-background relative flex h-full flex-col overflow-hidden">
      <div
        aria-hidden
        className="bg-primary-container/15 pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full blur-3xl"
      />
      <div className="app-drag h-topbar px-md relative flex shrink-0 items-center justify-end">
        <WindowControls />
      </div>
      <div className="px-margin-desktop pb-xl relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
