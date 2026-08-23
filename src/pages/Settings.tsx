import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  ArrowLeft,
  Check,
  Download,
  LogIn,
  LogOut,
  Monitor,
  Paintbrush,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import { getDeletionScopeCopy, getWebAccountSummary } from '../auth/accountIdentity';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { ACCENT_PRESETS, useSettings, type AccentColor } from '../contexts/SettingsContext';
import { exitDemoMode, isDemoMode } from '../demo/demoMode';
import { deleteAccount, listProjects } from '../services/api';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

const TEXT_SIZE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
] as const;

export default function Settings() {
  const navigate = useNavigate();
  const { instance, accounts } = useMsal();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, setSetting } = useSettings();
  const demo = isDemoMode();
  const account = instance.getActiveAccount() ?? accounts[0] ?? null;
  const accountSummary = getWebAccountSummary(account);
  const deletionScopeCopy = getDeletionScopeCopy(accountSummary.providerLabel);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleExportJson = async () => {
    if (exporting) return;
    setExporting(true);
    setExportStatus('');
    try {
      const projects = await listProjects();
      const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `workshop-project-summary-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportStatus(`Downloaded ${projects.length} project${projects.length === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('Export failed', error);
      setExportStatus('Workshop could not prepare the project summary. Check the connection and try again.');
    } finally {
      setExporting(false);
    }
  };

  const signOut = () => {
    if (demo) {
      exitDemoMode();
      window.location.assign('/');
      return;
    }
    void instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  const handleDeleteAccount = async () => {
    if (deleting || demo) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
    } catch (error) {
      console.error('Account deletion failed', error);
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Workshop could not confirm account deletion. Your data remains intact.',
      );
      setDeleting(false);
      return;
    }

    try {
      await instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
    } catch (error) {
      console.error('Remote sign-out failed after account deletion', error);
      instance.setActiveAccount(null);
      try {
        await instance.clearCache(account ? { account } : undefined);
      } catch (clearError) {
        console.error('Local account cache cleanup failed after account deletion', clearError);
      }
      window.location.replace('/');
    }
  };

  return (
    <PageFrame maxWidth={860} className="settings-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Settings"
        description="Appearance, project defaults, local preferences, and account controls for this browser."
      />

      <SettingsGroup
        icon={<Paintbrush size={18} aria-hidden="true" />}
        title="Appearance"
        description="Choose how the living plan table reads on this device."
      >
        <SettingsRow label="Theme" description={`Current rendition: ${resolvedTheme}.`}>
          <SegmentedControl
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            onChange={(value: Theme) => setTheme(value)}
          />
        </SettingsRow>

        <SettingsRow
          label="Annotation color"
          description="Marks selected controls, links, counts, and drafting notes."
        >
          <div className="settings-swatches" role="group" aria-label="Annotation color">
            {(Object.entries(ACCENT_PRESETS) as [
              AccentColor,
              typeof ACCENT_PRESETS[AccentColor],
            ][]).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className="settings-swatch"
                aria-pressed={settings.accentColor === key}
                aria-label={preset.label}
                onClick={() => setSetting('accentColor', key)}
              >
                <span style={{ background: preset.fill }} aria-hidden="true">
                  {settings.accentColor === key && <Check size={15} />}
                </span>
                <small>{preset.label}</small>
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Text size"
          description="Large raises the app's base size while preserving browser zoom."
        >
          <SegmentedControl
            label="Text size"
            value={settings.fontSize}
            options={TEXT_SIZE_OPTIONS}
            onChange={value => setSetting('fontSize', value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<Settings2 size={18} aria-hidden="true" />}
        title="Project defaults"
        description="These values preselect common choices without changing existing projects."
      >
        <SettingsRow label="Default status" description="Preselected when a new project opens.">
          <select
            aria-label="Default project status"
            value={settings.defaultProjectStatus}
            onChange={event => setSetting(
              'defaultProjectStatus',
              event.target.value as typeof settings.defaultProjectStatus,
            )}
          >
            <option value="idea">Idea</option>
            <option value="planning">Planning</option>
            <option value="in_progress">In progress</option>
          </select>
        </SettingsRow>

        <SettingsRow label="Dashboard sort" description="The default order of the project library.">
          <select
            aria-label="Default dashboard sort"
            value={settings.defaultDashboardSort}
            onChange={event => setSetting(
              'defaultDashboardSort',
              event.target.value as typeof settings.defaultDashboardSort,
            )}
          >
            <option value="updated">Last updated</option>
            <option value="created">Date created</option>
            <option value="title">Title (A–Z)</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Completed projects"
          description="Include completed work when the dashboard first opens."
        >
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.showCompletedByDefault}
              onChange={event => setSetting('showCompletedByDefault', event.target.checked)}
            />
            <span>{settings.showCompletedByDefault ? 'Shown by default' : 'Hidden by default'}</span>
          </label>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        icon={<Download size={18} aria-hidden="true" />}
        title="Data"
        description="Keep a portable reference copy of project metadata."
      >
        <SettingsRow
          label="JSON project summary"
          description={demo
            ? 'Downloads list metadata from the read-only demo workspace.'
            : 'Downloads the project list and its current summary metadata.'}
        >
          <Button onClick={() => void handleExportJson()} disabled={exporting}>
            <Download size={16} aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Download summary'}
          </Button>
        </SettingsRow>
        {exportStatus && <p className="settings-status" role="status">{exportStatus}</p>}
      </SettingsGroup>

      <SettingsGroup
        icon={demo
          ? <Monitor size={18} aria-hidden="true" />
          : <UserRound size={18} aria-hidden="true" />}
        title="Account"
        description={demo
          ? 'The demo is session-scoped and cannot save changes.'
          : 'Your sign-in provider determines which private workspace opens.'}
      >
        <div className="settings-account">
          <div className="settings-account-identity">
            <span>{demo ? 'Mode' : 'Signed in as'}</span>
            <strong>{demo ? 'Demo workspace · Read only' : accountSummary.displayName}</strong>
            {!demo && accountSummary.secondaryLabel && <small>{accountSummary.secondaryLabel}</small>}
            {!demo && (
              <>
                <dl className="settings-account-provider">
                  <div>
                    <dt>Current provider</dt>
                    <dd>{accountSummary.providerLabel}</dd>
                  </div>
                </dl>
                <p className="settings-account-scope">
                  Sign in with the same provider again to return to this workspace.
                  Choosing another provider creates a separate workspace; Apple and
                  Microsoft accounts are not linked or merged.
                </p>
              </>
            )}
          </div>
          <Button variant="ghost" onClick={signOut}>
            {demo
              ? <LogIn size={16} aria-hidden="true" />
              : <LogOut size={16} aria-hidden="true" />}
            {demo ? 'Sign in' : 'Sign out'}
          </Button>
        </div>

        {!demo && (
          <div className="settings-danger-zone">
            <div>
              <strong>Delete account</strong>
              <p>
                Permanently removes Workshop projects, photos, lists, Shaper projects,
                templates, and account data from the current workspace. This cannot be undone.
              </p>
              <p>{deletionScopeCopy}</p>
            </div>
            {confirmDelete ? (
              <div className="settings-delete-confirm" role="alert">
                <span>
                  Delete this {accountSummary.providerLabel === 'Microsoft'
                    ? 'Microsoft workspace'
                    : 'provider workspace'} permanently?
                </span>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void handleDeleteAccount()} disabled={deleting}>
                  <Trash2 size={16} aria-hidden="true" />
                  {deleting ? 'Deleting…' : 'Delete account'}
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" />
                Delete account
              </Button>
            )}
            {deleteError && <p className="settings-delete-error" role="alert">{deleteError}</p>}
          </div>
        )}
      </SettingsGroup>

      <footer className="settings-version">
        <span>Workshop</span>
        <span>{__WORKSHOP_VERSION__}</span>
      </footer>
    </PageFrame>
  );
}

function SettingsGroup({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group" aria-labelledby={`settings-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <header>
        <span aria-hidden="true">{icon}</span>
        <div>
          <h2 id={`settings-${title.toLowerCase().replace(/\s+/g, '-')}`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
