import { createContext, useContext, useEffect, useState } from 'react';

export type AccentColor = 'amber' | 'signal' | 'platform' | 'beacon' | 'violet';
export type FontSize = 'normal' | 'large';
export type DefaultProjectStatus = 'idea' | 'planning' | 'in_progress';
export type DashboardSort = 'updated' | 'created' | 'title';

export interface Settings {
  accentColor: AccentColor;
  fontSize: FontSize;
  defaultProjectStatus: DefaultProjectStatus;
  defaultDashboardSort: DashboardSort;
  showCompletedByDefault: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  accentColor: 'amber',
  fontSize: 'normal',
  defaultProjectStatus: 'idea',
  defaultDashboardSort: 'updated',
  showCompletedByDefault: false,
};

/**
 * Lamp colours for the board's signal. `ink` reads on the light concourse,
 * `inkDark` on the night board, `fill` lights the lamps and flap faces in both.
 */
export const ACCENT_PRESETS: Record<
  AccentColor,
  { label: string; ink: string; inkDark: string; deep: string; fill: string }
> = {
  amber:    { label: 'Amber',    ink: '#8A4F00', inkDark: '#FFC24D', deep: '#C77800', fill: '#FFB400' },
  signal:   { label: 'Signal',   ink: '#A81E16', inkDark: '#FF8A80', deep: '#8A1810', fill: '#E04A3C' },
  platform: { label: 'Platform', ink: '#1D6741', inkDark: '#6BD79B', deep: '#155031', fill: '#3FA96A' },
  beacon:   { label: 'Beacon',   ink: '#12587F', inkDark: '#6EC8F5', deep: '#0D4260', fill: '#2E9BD6' },
  violet:   { label: 'Violet',   ink: '#59379B', inkDark: '#BFA3FF', deep: '#432878', fill: '#8B6BE0' },
};

interface SettingsContextValue {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  setSetting: () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem('workshop-settings');
    if (!raw) return DEFAULT_SETTINGS;
    const next: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // Older builds stored retired accent names.
    if (!ACCENT_PRESETS[next.accentColor]) next.accentColor = DEFAULT_SETTINGS.accentColor;
    return next;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applySettings(s: Settings) {
  const root = document.documentElement;
  const accent = ACCENT_PRESETS[s.accentColor] ?? ACCENT_PRESETS.amber;
  const dark = root.dataset.theme === 'dark';
  root.style.setProperty('--color-amber', dark ? accent.inkDark : accent.ink);
  root.style.setProperty('--color-amber-deep', accent.deep);
  root.style.setProperty('--color-amber-fill', accent.fill);
  root.style.fontSize = s.fontSize === 'large' ? '106.25%' : '';
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readSettings);

  useEffect(() => {
    applySettings(settings);
    // The lamp ink differs between the lit and the night board, so re-apply
    // whenever ThemeProvider flips data-theme.
    const obs = new MutationObserver(() => applySettings(settings));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, [settings]);

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('workshop-settings', JSON.stringify(next));
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, setSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}
