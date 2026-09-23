/**
 * Appearance beyond the theme: accent, density, text size, motion and the
 * activity rail.
 *
 * The same shape as `theme.ts`, and for the same reasons: every choice is
 * stamped on <html> as a data attribute before React renders, so the first
 * paint is already right, and the CSS does the rest — no component reads these
 * values except the activity rail and whatever needs to know about motion in
 * script. Stored in localStorage as a per-machine convenience (it is not
 * account data), read and written inside a try/catch because storage can be
 * absent or refused, and parsed field by field so one stale or hand-edited
 * value falls back alone instead of discarding the rest.
 */
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const ACCENTS = ['yellow', 'orange', 'green', 'blue', 'violet', 'pink'] as const;
export type Accent = (typeof ACCENTS)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const TEXT_SIZES = ['small', 'default', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface Appearance {
  accent: Accent;
  density: Density;
  textSize: TextSize;
  reduceMotion: boolean;
  /** The right-hand rail: recent chats and trending projects. */
  showActivityRail: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: 'yellow',
  density: 'comfortable',
  textSize: 'default',
  reduceMotion: false,
  showActivityRail: true,
};

const STORAGE_KEY = 'yello.appearance';

const storedSchema = z.object({
  accent: z.enum(ACCENTS).catch(DEFAULT_APPEARANCE.accent),
  density: z.enum(DENSITIES).catch(DEFAULT_APPEARANCE.density),
  textSize: z.enum(TEXT_SIZES).catch(DEFAULT_APPEARANCE.textSize),
  reduceMotion: z.boolean().catch(DEFAULT_APPEARANCE.reduceMotion),
  showActivityRail: z.boolean().catch(DEFAULT_APPEARANCE.showActivityRail),
});

const listeners = new Set<() => void>();
let current: Appearance = readStored();

function readStored(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_APPEARANCE;
    }
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Writes the current choices onto the document; defaults leave no attribute behind. */
export function applyAppearance(): void {
  const root = document.documentElement;
  const stamp = (attribute: string, value: string, isDefault: boolean): void => {
    if (isDefault) {
      root.removeAttribute(attribute);
    } else {
      root.setAttribute(attribute, value);
    }
  };
  stamp('data-accent', current.accent, current.accent === DEFAULT_APPEARANCE.accent);
  stamp('data-density', current.density, current.density === DEFAULT_APPEARANCE.density);
  stamp('data-text-size', current.textSize, current.textSize === DEFAULT_APPEARANCE.textSize);
  stamp('data-reduce-motion', 'true', !current.reduceMotion);
}

export function setAppearance(patch: Partial<Appearance>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not persisting is fine; the session still gets the choice.
  }
  applyAppearance();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
  const appearance = useSyncExternalStore(subscribe, () => current);
  return [appearance, setAppearance];
}

/**
 * Whether motion should be cut, for the few places that animate from script:
 * either the OS asked for it or the viewer did in Settings.
 */
export function prefersReducedMotion(): boolean {
  return current.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
