import { createContext, useContext, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  readSettingsValue,
  type AccentColor,
  type Palette,
  type Settings,
} from '../lib/settingsPreferences';

export { DEFAULT_SETTINGS, readSettingsValue };
export type {
  AccentColor,
  Palette,
  DashboardSort,
  DefaultProjectStatus,
  FontSize,
  Settings,
} from '../lib/settingsPreferences';

/** Swatches for the color theme picker: canvas, surface, primary action, annotation (light / dark). */
export const PALETTE_PRESETS: Record<Palette, { label: string; description: string; light: string[]; dark: string[] }> = {
  spruce: { label: 'Spruce', description: 'Cool green vellum — the original.', light: ['#EEF4F2', '#FAFCFB', '#125447', '#176B5B'], dark: ['#0C1513', '#182823', '#68C7B0', '#68C7B0'] },
  blueprint: { label: 'Blueprint', description: 'Blue drafting paper with navy ink.', light: ['#E9F0F9', '#F8FBFF', '#1B4C8C', '#1C6696'], dark: ['#0A1830', '#142B4F', '#86B9FF', '#8CD3FF'] },
  graphite: { label: 'Graphite', description: 'Neutral pencil gray.', light: ['#F1F2F3', '#FBFBFC', '#2F3A45', '#356687'], dark: ['#111315', '#1F2327', '#CBD3DC', '#8FBAE0'] },
  walnut: { label: 'Walnut', description: 'Warm wood tones with teal notes.', light: ['#F5EFE8', '#FCF9F5', '#784322', '#2C6A6D'], dark: ['#17110C', '#281E16', '#E6AC7C', '#7EC6C6'] },
  slate: { label: 'Slate', description: 'Cool blue-gray with violet notes.', light: ['#EEF1F5', '#FAFBFD', '#324E78', '#5853A6'], dark: ['#10141B', '#1D2430', '#A0B8E2', '#B0ACF2'] },
};

export const ACCENT_PRESETS: Record<
  Exclude<AccentColor, 'theme'>,
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
  // The color theme lives in CSS (index.css); index.html sets it before first paint too.
  root.dataset.palette = s.palette;
  const props = ['--color-annotation', '--color-annotation-strong', '--color-annotation-fill'] as const;
  if (s.accentColor === 'theme') {
    // "Match theme": let the theme's own annotation colors through.
    props.forEach(p => root.style.removeProperty(p));
  } else {
    const accent = ACCENT_PRESETS[s.accentColor] ?? ACCENT_PRESETS.amber;
    const dark = root.dataset.theme === 'dark';
    root.style.setProperty(props[0], dark ? accent.inkDark : accent.ink);
    root.style.setProperty(props[1], dark ? accent.deepDark : accent.deep);
    root.style.setProperty(props[2], dark ? accent.fillDark : accent.fill);
  }
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
