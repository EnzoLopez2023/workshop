import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { useSettings, ACCENT_PRESETS, type AccentColor } from '../contexts/SettingsContext';
import { listProjects } from '../services/api';

export default function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, setSetting } = useSettings();

  return (
    <div className="page-container" style={{ maxWidth: 680 }}>
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 28 }}>
        <ArrowLeft size={15} />
        Back
      </button>

      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">How the board reads and behaves. Every preference is stored on this device.</p>
        </div>
      </div>

      {/* ── Appearance ─────────────────────────────────────────────────────────── */}
      <SettingsSection title="Appearance">
        <SettingsRow
          label="Theme"
          description="Choose light, dark, or follow your system setting."
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark', 'system'] as Theme[]).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={theme === t ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ fontSize: '0.85rem', padding: '8px 16px' }}
              >
                {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
                {t === 'system' && theme === 'system' && (
                  <span style={{ opacity: 0.65, fontSize: '0.75rem', marginLeft: 4 }}>
                    ({resolvedTheme})
                  </span>
                )}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          label="Signal Lamp"
          description="The colour every button, link and live indicator burns."
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(Object.entries(ACCENT_PRESETS) as [AccentColor, typeof ACCENT_PRESETS[AccentColor]][]).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className="lamp"
                aria-pressed={settings.accentColor === key}
                aria-label={preset.label}
                onClick={() => setSetting('accentColor', key)}
              >
                <span className="lamp-glass" style={{ background: preset.fill }} />
                <span className="lamp-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          label="Text Size"
          description="Slightly increases base font size for better readability."
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {(['normal', 'large'] as const).map(size => (
              <button
                key={size}
                onClick={() => setSetting('fontSize', size)}
                className={settings.fontSize === size ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ fontSize: '0.85rem', padding: '8px 16px' }}
              >
                {size === 'normal' ? 'Normal' : 'Large'}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* ── Projects ───────────────────────────────────────────────────────────── */}
      <SettingsSection title="Projects">
        <SettingsRow
          label="Default Status"
          description="Status pre-selected when creating a new project."
        >
          <select
            value={settings.defaultProjectStatus}
            onChange={e => setSetting('defaultProjectStatus', e.target.value as typeof settings.defaultProjectStatus)}
            style={{ maxWidth: 200 }}
          >
            <option value="idea">Idea</option>
            <option value="planning">Planning</option>
            <option value="in_progress">In Progress</option>
          </select>
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          label="Dashboard Sort"
          description="How projects are ordered on the dashboard."
        >
          <select
            value={settings.defaultDashboardSort}
            onChange={e => setSetting('defaultDashboardSort', e.target.value as typeof settings.defaultDashboardSort)}
            style={{ maxWidth: 200 }}
          >
            <option value="updated">Last Updated</option>
            <option value="created">Date Created</option>
            <option value="title">Title (A–Z)</option>
          </select>
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          label="Show Completed"
          description="Include completed projects in the default dashboard view."
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.showCompletedByDefault}
              onChange={e => setSetting('showCompletedByDefault', e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--color-amber)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.88rem', color: 'var(--color-ink)' }}>
              {settings.showCompletedByDefault ? 'Shown by default' : 'Hidden by default'}
            </span>
          </label>
        </SettingsRow>
      </SettingsSection>

      {/* ── Data ───────────────────────────────────────────────────────────────── */}
      <SettingsSection title="Data">
        <SettingsRow
          label="Export JSON Backup"
          description="Download all your projects and their metadata as a JSON file."
        >
          <button
            className="btn btn-ghost"
            onClick={handleExportJson}
            style={{ fontSize: '0.85rem' }}
          >
            Download backup
          </button>
        </SettingsRow>
      </SettingsSection>

      <div className="board-plate">Measure twice &middot; Cut once</div>
    </div>
  );
}

async function handleExportJson() {
  try {
    const projects = await listProjects();
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workshop-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed', err);
  }
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div className="board">
        <div className="rail">{title}</div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function SettingsRow({ label, description, children }: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 24, padding: '18px 24px', flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div className="board-caps" style={{ fontSize: '0.72rem', letterSpacing: '0.09em', marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>{description}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function SettingsDivider() {
  return <div style={{ borderTop: '1px solid var(--color-line)', margin: '0 24px' }} />;
}
