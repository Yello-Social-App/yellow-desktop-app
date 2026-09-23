/**
 * The colour theme: dark by default, light on request, or whatever the OS says.
 *
 * Stamped on <html> as `data-theme` before React renders, so the first paint
 * is already the right one. Stored in localStorage as a per-machine
 * convenience — it is not account data, and it is read and written inside a
 * try/catch because storage can be absent or refused.
 */
import { useSyncExternalStore } from 'react';

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'yello.theme';
export const DEFAULT_THEME: Theme = 'dark';

const listeners = new Set<() => void>();
let current: Theme = readStoredTheme();

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function resolved(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') {
    return theme;
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Writes the current choice onto the document. */
export function applyTheme(): void {
  document.documentElement.dataset.theme = resolved(current);
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisting is fine; the session still gets the choice.
  }
  applyTheme();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = (): void => {
    if (current === 'system') {
      applyTheme();
    }
  };
  media.addEventListener('change', onChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onChange);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current);
  return [theme, setTheme];
}
