import { createContext, useContext, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  readSettingsValue,
  type AccentColor,
  type Settings,
} from '../lib/settingsPreferences';

export { DEFAULT_SETTINGS, readSettingsValue };
export type {
  AccentColor,
  DashboardSort,
  DefaultProjectStatus,
  FontSize,
  Settings,
} from '../lib/settingsPreferences';

export const ACCENT_PRESETS: Record<
  AccentColor,
  {
    label: string;
    ink: string;
    inkDark: string;
    deep: string;
    deepDark: string;
    fill: string;
    fillDark: string;
  }
> = {
  amber: {
    label: 'Spruce',
    ink: '#176B5B',
    inkDark: '#68C7B0',
    deep: '#125447',
    deepDark: '#8AD8C5',
    fill: '#1E7666',
    fillDark: '#2A927E',
  },
  signal: {
    label: 'Clay',
    ink: '#96513E',
    inkDark: '#E9A08A',
    deep: '#743D2F',
    deepDark: '#F0B6A5',
    fill: '#A95F49',
    fillDark: '#C97C65',
  },
  platform: {
    label: 'Moss',
    ink: '#557A43',
    inkDark: '#9BCB82',
    deep: '#3F5E32',
    deepDark: '#B5DEA0',
    fill: '#668E50',
    fillDark: '#79A962',
  },
  beacon: {
    label: 'Pencil Blue',
    ink: '#356D85',
    inkDark: '#7AB9D3',
    deep: '#29566A',
    deepDark: '#A0D0E2',
    fill: '#477F97',
    fillDark: '#5B9DB8',
  },
  violet: {
    label: 'Iris',
    ink: '#66568E',
    inkDark: '#B5A4DE',
    deep: '#4D416D',
    deepDark: '#CFC3EB',
    fill: '#7868A2',
    fillDark: '#9281BD',
  },
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
  return readSettingsValue(localStorage.getItem('workshop-settings'));
}

function applySettings(s: Settings) {
  const root = document.documentElement;
  const accent = ACCENT_PRESETS[s.accentColor] ?? ACCENT_PRESETS.amber;
  const dark = root.dataset.theme === 'dark';
  root.style.setProperty('--color-annotation', dark ? accent.inkDark : accent.ink);
  root.style.setProperty('--color-annotation-strong', dark ? accent.deepDark : accent.deep);
  root.style.setProperty('--color-annotation-fill', dark ? accent.fillDark : accent.fill);
  root.style.fontSize = s.fontSize === 'large' ? '106.25%' : '';
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readSettings);

  useEffect(() => {
    applySettings(settings);
    // Annotation ink is adaptive, so re-apply whenever the rendition changes.
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
