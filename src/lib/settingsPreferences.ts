/** 'theme' follows the color theme's own annotation colors. */
export type AccentColor = 'theme' | 'amber' | 'signal' | 'platform' | 'beacon' | 'violet';
/** Base color theme: the app's backgrounds, text, navigation and primary actions. */
export type Palette = 'spruce' | 'blueprint' | 'graphite' | 'walnut' | 'slate';
export type FontSize = 'normal' | 'large';
export type DefaultProjectStatus = 'idea' | 'planning' | 'in_progress';
export type DashboardSort = 'manual' | 'updated' | 'created' | 'title';

export interface Settings {
  palette: Palette;
  accentColor: AccentColor;
  fontSize: FontSize;
  defaultProjectStatus: DefaultProjectStatus;
  defaultDashboardSort: DashboardSort;
  showCompletedByDefault: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  palette: 'spruce',
  accentColor: 'theme',
  fontSize: 'normal',
  defaultProjectStatus: 'idea',
  defaultDashboardSort: 'updated',
  showCompletedByDefault: false,
};

const ACCENT_COLORS = new Set<AccentColor>(['theme', 'amber', 'signal', 'platform', 'beacon', 'violet']);
export const PALETTES: readonly Palette[] = ['spruce', 'blueprint', 'graphite', 'walnut', 'slate'];
const PALETTE_SET = new Set<Palette>(PALETTES);

export function readSettingsValue(raw: string | null): Settings {
  try {
    if (!raw) return DEFAULT_SETTINGS;
    const next: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    if (!ACCENT_COLORS.has(next.accentColor)) next.accentColor = DEFAULT_SETTINGS.accentColor;
    if (!PALETTE_SET.has(next.palette)) next.palette = DEFAULT_SETTINGS.palette;
    return next;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
