import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type CardElevation = 'flat' | 'floating' | 'canvas';

const ELEVATION_CLASSES: Record<CardElevation, string> = {
  flat: '',
  floating: 'shadow-floating',
  canvas: 'shadow-canvas',
};

/** Semantics vary by use (a post is an <article>), the surface does not. */
type CardElement = 'div' | 'article' | 'section';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
  as?: CardElement;
  /** Lifts the tone on hover, for cards that are also a link. */
  interactive?: boolean;
  children: ReactNode;
}

/**
 * Level 1 surface: one tone above the canvas with a hairline. Depth comes
 * from tone and outline; shadows are reserved for things that float.
 */
export function Card({
  elevation = 'flat',
  as: Element = 'div',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      className={cn(
        'bg-surface-container-lowest border-outline-variant rounded-2xl border',
        interactive && 'transition-tone hover:border-outline/40 hover:bg-surface-container-low',
        ELEVATION_CLASSES[elevation],
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}
