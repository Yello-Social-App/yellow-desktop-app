import {
  Bookmark,
  Check,
  HardDrive,
  Heart,
  MessageCircle,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import { useCurrentUser } from '@/features/auth/hooks';
import {
  DEFAULT_APPEARANCE,
  setAppearance,
  useAppearance,
  type Accent,
  type Density,
  type TextSize,
} from '@/lib/appearance';
import { cn } from '@/lib/cn';
import { DEFAULT_THEME, setTheme, useTheme, type Theme } from '@/lib/theme';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { AsideLabel, SettingRow } from './SettingsSection';

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Each swatch in its dark-theme tone: the one it reads as. Written out whole
 * because the production CSP refuses inline styles, so a colour has to be a
 * class the build can see.
 */
const ACCENT_OPTIONS: readonly { value: Accent; label: string; swatch: string }[] = [
  { value: 'yellow', label: 'Yellow', swatch: 'bg-[#ffce2b] ring-[#ffce2b]' },
  { value: 'orange', label: 'Orange', swatch: 'bg-[#fb923c] ring-[#fb923c]' },
  { value: 'green', label: 'Green', swatch: 'bg-[#4ade80] ring-[#4ade80]' },
  { value: 'blue', label: 'Blue', swatch: 'bg-[#60a5fa] ring-[#60a5fa]' },
  { value: 'violet', label: 'Violet', swatch: 'bg-[#a78bfa] ring-[#a78bfa]' },
  { value: 'pink', label: 'Pink', swatch: 'bg-[#f472b6] ring-[#f472b6]' },
];

const DENSITY_OPTIONS: readonly { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const TEXT_SIZE_OPTIONS: readonly { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
];

/**
 * Settings → Appearance: theme, accent, density, text size, the activity rail
 * and motion, with a sample post that shows the result.
 *
 * Every choice applies the moment it is made and is kept on this computer
 * (lib/theme.ts and lib/appearance.ts); there is nothing to save. The preview
 * is drawn with the same tokens the app uses, so it changes because the app
 * did — it holds no copy of the settings of its own.
 */
export function AppearanceSettings() {
  const [theme] = useTheme();
  const [appearance] = useAppearance();

  return (
    <div className="flex flex-col gap-8 @3xl:flex-row">
      <section aria-label="Appearance settings" className="flex min-w-0 flex-1 flex-col gap-7">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-on-surface text-[15px] font-semibold">Theme</h2>
            <p className="text-on-surface-variant text-[13px]">
              Pick a theme, or let Yello follow your system.
            </p>
          </div>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
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
                    'bg-surface-container-lowest transition-tone flex flex-col gap-2.5 rounded-[14px] border-[1.5px] px-2 pt-2 pb-3 text-left',
                    isSelected
                      ? 'border-primary-container'
                      : 'border-outline-strong hover:border-outline',
                  )}
                >
                  <ThemeThumbnail theme={option.value} />
                  <span className="text-on-surface flex items-center gap-2 px-1 text-[13px] font-medium">
                    <option.icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1">{option.label}</span>
                    {isSelected && (
                      <span className="bg-primary-container text-on-primary-container flex size-[18px] items-center justify-center rounded-full">
                        <Check aria-hidden className="size-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Card className="flex flex-col">
          <SettingRow
            isFirst
            label="Accent color"
            description="Buttons, links and highlights."
            control={
              <div role="group" aria-label="Accent color" className="flex shrink-0 gap-2.5">
                {ACCENT_OPTIONS.map((option) => {
                  const isSelected = option.value === appearance.accent;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={isSelected}
                      title={option.label}
                      onClick={() => {
                        setAppearance({ accent: option.value });
                      }}
                      className={cn(
                        'ring-offset-surface-container-lowest size-6 rounded-full ring-offset-2 transition-shadow',
                        option.swatch,
                        isSelected ? 'ring-2' : 'ring-0 hover:ring-1',
                      )}
                    />
                  );
                })}
              </div>
            }
          />
          <SettingRow
            label="Density"
            description="Spacing in feeds and lists."
            control={
              <SegmentedControl
                label="Density"
                options={DENSITY_OPTIONS}
                value={appearance.density}
                onChange={(density) => {
                  setAppearance({ density });
                }}
              />
            }
          />
          <SettingRow
            label="Text size"
            description="Posts, comments and messages."
            control={
              <SegmentedControl
                label="Text size"
                options={TEXT_SIZE_OPTIONS}
                value={appearance.textSize}
                onChange={(textSize) => {
                  setAppearance({ textSize });
                }}
              />
            }
          />
          <SettingRow
            label="Show activity sidebar"
            description="Messages and trending projects on the right."
            control={
              <Switch
                label="Show activity sidebar"
                checked={appearance.showActivityRail}
                onChange={(showActivityRail) => {
                  setAppearance({ showActivityRail });
                }}
              />
            }
          />
          <SettingRow
            label="Reduce motion"
            description="Minimise animations and transitions."
            control={
              <Switch
                label="Reduce motion"
                checked={appearance.reduceMotion}
                onChange={(reduceMotion) => {
                  setAppearance({ reduceMotion });
                }}
              />
            }
          />
        </Card>
      </section>

      <aside aria-label="Live preview" className="flex shrink-0 flex-col gap-3 @3xl:w-[300px]">
        <AsideLabel>Live preview</AsideLabel>
        <LivePreview />
        <p className="text-on-surface-variant flex items-center gap-2 text-[12px]">
          <HardDrive aria-hidden className="size-3.5 shrink-0" />
          Saved on this device
        </p>
      </aside>
    </div>
  );
}

/** A miniature of the app in one theme; "System" shows both halves. */
function ThemeThumbnail({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    return (
      <span
        aria-hidden
        className="flex h-[84px] overflow-hidden rounded-lg border border-[#1c1c20]"
      >
        <span className="flex w-1/2 gap-1.5 bg-[#f7f7f5] py-2 pl-2">
          <span className="w-[22px] rounded bg-[#e4e4e0]" />
          <span className="flex flex-1 flex-col gap-[5px]">
            <span className="h-[7px] w-[70%] rounded-[3px] bg-[#d4d4cf]" />
            <span className="h-5 rounded-l bg-white" />
            <span className="h-5 rounded-l bg-white" />
          </span>
        </span>
        <span className="flex w-1/2 flex-col gap-[5px] bg-[#0b0b0c] py-2 pr-2">
          <span className="h-[7px] w-[20%] rounded-r-[3px] bg-[#26262b]" />
          <span className="h-5 rounded-r bg-[#16161a]" />
          <span className="h-5 rounded-r bg-[#16161a]" />
          <span className="bg-primary-container ml-2.5 h-1.5 w-[40%] rounded-[3px]" />
        </span>
      </span>
    );
  }
  const isLight = theme === 'light';
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[84px] gap-1.5 rounded-lg border p-2',
        isLight ? 'border-[#e2e2de] bg-[#f7f7f5]' : 'border-[#1c1c20] bg-[#0b0b0c]',
      )}
    >
      <span className={cn('w-[22px] rounded', isLight ? 'bg-[#e4e4e0]' : 'bg-[#16161a]')} />
      <span className="flex flex-1 flex-col gap-[5px]">
        <span
          className={cn('h-[7px] w-[60%] rounded-[3px]', isLight ? 'bg-[#d4d4cf]' : 'bg-[#26262b]')}
        />
        <span className={cn('h-5 rounded', isLight ? 'bg-white' : 'bg-[#16161a]')} />
        <span className={cn('h-5 rounded', isLight ? 'bg-white' : 'bg-[#16161a]')} />
        <span className="bg-primary-container h-1.5 w-[30%] rounded-[3px]" />
      </span>
    </span>
  );
}

/**
 * A sample post in the real tokens: the accent, the content text size and the
 * density's spacing all reach it the way they reach the feed. Nothing in it is
 * interactive, so nothing in it takes focus.
 */
function LivePreview() {
  const user = useCurrentUser();
  const name = user === null ? 'You' : displayName(user);
  const handle = user === null ? '@you' : handleOf(user);

  return (
    <Card className="overflow-hidden">
      <div className="border-outline-variant flex gap-1 border-b p-2.5">
        <span className="bg-surface-container text-on-surface flex h-7 items-center rounded-lg px-3 text-[12px] font-medium shadow-[inset_0_-2px_0_var(--color-primary-container)]">
          For you
        </span>
        <span className="text-on-surface-variant flex h-7 items-center px-3 text-[12px]">
          Following
        </span>
      </div>
      <div className="p-md gap-md flex flex-col">
        <div className="flex items-center gap-2.5">
          <Avatar
            initials={user === null ? 'Y' : initialsOf(user)}
            name={name}
            imageUrl={user?.avatarUrl}
            size="sm"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-on-surface truncate text-[13px] font-semibold">{name}</span>
            <span className="text-outline truncate text-[12px]">{handle} · 2m</span>
          </div>
          <span className="bg-primary-container text-on-primary-container flex h-[26px] items-center rounded-full px-3 text-[12px] font-semibold">
            Follow
          </span>
        </div>
        <p className="text-on-surface text-content leading-relaxed">
          This is how posts will look with your settings. Mention{' '}
          <span className="text-primary">@friends</span> and tag{' '}
          <span className="text-primary">#showcase</span> projects.
        </p>
        <div className="bg-surface-container border-outline-variant h-24 rounded-[10px] border" />
        <div className="text-outline flex gap-[18px] text-[12px]">
          <span className="text-primary flex items-center gap-1.5">
            <Heart aria-hidden className="size-4 fill-current" />
            24
          </span>
          <span className="flex items-center gap-1.5">
            <MessageCircle aria-hidden className="size-4" />6
          </span>
          <span className="flex items-center gap-1.5">
            <Bookmark aria-hidden className="size-4" />
            Save
          </span>
        </div>
      </div>
    </Card>
  );
}

/** The page header's "Reset to defaults", shown while Appearance is open. */
export function AppearanceReset() {
  const [theme] = useTheme();
  const [appearance] = useAppearance();
  const isDefault =
    theme === DEFAULT_THEME &&
    (Object.keys(DEFAULT_APPEARANCE) as (keyof typeof DEFAULT_APPEARANCE)[]).every(
      (key) => appearance[key] === DEFAULT_APPEARANCE[key],
    );

  return (
    <Button
      variant="outline"
      size="sm"
      leadingIcon={<RotateCcw className="size-4" />}
      disabled={isDefault}
      onClick={() => {
        setTheme(DEFAULT_THEME);
        setAppearance(DEFAULT_APPEARANCE);
      }}
    >
      Reset to defaults
    </Button>
  );
}
