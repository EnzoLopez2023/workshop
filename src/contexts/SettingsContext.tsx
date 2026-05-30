import { createContext, useContext, useEffect, useState } from 'react';

export type AccentColor = 'rust' | 'forest' | 'slate' | 'amber' | 'navy';
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
  accentColor: 'rust',
  fontSize: 'normal',
  defaultProjectStatus: 'idea',
  defaultDashboardSort: 'updated',
  showCompletedByDefault: false,
};

export const ACCENT_PRESETS: Record<AccentColor, { label: string; main: string; dark: string }> = {
  rust:   { label: 'Rust',   main: '#A0522D', dark: '#7C3E1F' },
  forest: { label: 'Forest', main: '#2E7D52', dark: '#1E5C3A' },
  slate:  { label: 'Slate',  main: '#5B6AA7', dark: '#404E8A' },
  amber:  { label: 'Amber',  main: '#B07A2A', dark: '#8A5F1C' },
  navy:   { label: 'Navy',   main: '#2A4B7C', dark: '#1E3860' },
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applySettings(s: Settings) {
  const accent = ACCENT_PRESETS[s.accentColor];
  document.documentElement.style.setProperty('--color-rust', accent.main);
  document.documentElement.style.setProperty('--color-rust-dark', accent.dark);
  document.documentElement.style.fontSize = s.fontSize === 'large' ? '106.25%' : '';
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readSettings);

  useEffect(() => {
    applySettings(settings);
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
