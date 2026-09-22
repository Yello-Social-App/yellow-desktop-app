import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { useTheme, type Theme } from '@/lib/theme';

import { PaneHeader, SettingsSection } from './SettingsSection';

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: ReactNode }[] = [
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
  { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
];

export function AppearanceSettings() {
  const [theme, setTheme] = useTheme();

  return (
    <>
      <PaneHeader title="Appearance" description="How Yello looks on this computer." />
      <SettingsSection title="Theme">
        <Card className="p-md">
          <div role="radiogroup" aria-label="Theme" className="gap-sm grid grid-cols-3">
            {THEME_OPTIONS.map((option) => {
              const isSelected = option.value === theme;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => {
                    setTheme(option.value);
                  }}
                  className={cn(
                    'gap-xs transition-tone flex flex-col items-center rounded-xl border py-4 text-[14px] font-semibold',
                    isSelected
                      ? 'border-primary-container bg-primary-fixed text-on-primary-fixed'
                      : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              );
            })}
          </div>
        </Card>
      </SettingsSection>
    </>
  );
}
