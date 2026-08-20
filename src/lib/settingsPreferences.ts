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

export const DEFAULT_SETTINGS: Settings = {
  accentColor: 'amber',
  fontSize: 'normal',
  defaultProjectStatus: 'idea',
  defaultDashboardSort: 'updated',
  showCompletedByDefault: false,
};

const ACCENT_COLORS = new Set<AccentColor>(['amber', 'signal', 'platform', 'beacon', 'violet']);

export function readSettingsValue(raw: string | null): Settings {
  try {
    if (!raw) return DEFAULT_SETTINGS;
    const next: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    if (!ACCENT_COLORS.has(next.accentColor)) next.accentColor = DEFAULT_SETTINGS.accentColor;
    return next;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
