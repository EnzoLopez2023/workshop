import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  ArrowLeft,
  Check,
  Cable,
  Download,
  KeyRound,
  LogIn,
  LogOut,
  Monitor,
  Paintbrush,
  Settings2,
  Trash2,
  Unplug,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import { getDeletionScopeCopy, getWebAccountSummary } from '../auth/accountIdentity';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { ACCENT_PRESETS, useSettings, type AccentColor } from '../contexts/SettingsContext';
import { exitDemoMode, isDemoMode } from '../demo/demoMode';
import {
  deleteAccount,
  disconnectThingiverse,
  getProviderConnections,
  listProjects,
  saveThingiverseToken,
} from '../services/api';
import type { ThingiverseConnectionStatus } from '../types/project';

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
  const [thingiverse, setThingiverse] = useState<ThingiverseConnectionStatus | null>(null);
  const [thingiverseToken, setThingiverseToken] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(!demo);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    if (demo) return;
    getProviderConnections()
      .then(result => setThingiverse(result.thingiverse))
      .catch(error => {
        console.error('Provider connections load failed', error);
        setConnectionError('Workshop could not load provider connections. Try reloading Settings.');
      })
      .finally(() => setConnectionLoading(false));
  }, [demo]);

  const handleSaveThingiverse = async () => {
    if (!thingiverseToken.trim() || connectionSaving) return;
    setConnectionSaving(true);
    setConnectionError('');
    setConnectionStatus('');
    try {
      const status = await saveThingiverseToken(thingiverseToken.trim());
      setThingiverse(status);
      setThingiverseToken('');
      setConnectionStatus('Thingiverse is connected for this Workshop account.');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Thingiverse could not be connected.');
    } finally {
      setConnectionSaving(false);
    }
  };

  const handleDisconnectThingiverse = async () => {
    if (connectionSaving) return;
    setConnectionSaving(true);
    setConnectionError('');
    setConnectionStatus('');
    try {
      const status = await disconnectThingiverse();
      setThingiverse(status);
      setThingiverseToken('');
      setConnectionStatus(status.source === 'server'
        ? 'Your account token was removed. Workshop is using the server connection.'
        : 'Thingiverse was disconnected from this Workshop account.');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Thingiverse could not be disconnected.');
    } finally {
      setConnectionSaving(false);
    }
  };

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
        description="Appearance, project defaults, provider connections, and account controls."
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

      {!demo && (
        <SettingsGroup
          icon={<Cable size={18} aria-hidden="true" />}
          title="Provider connections"
          description="Use official provider tokens for imports that require API authentication."
        >
          <SettingsRow
            label="Thingiverse"
            description={thingiverseDescription(thingiverse, connectionLoading)}
          >
            <div className="settings-connection-control">
              <span className={`settings-connection-state ${thingiverse?.connected ? 'is-connected' : ''}`}>
                {connectionLoading
                  ? 'Checking…'
                  : thingiverse?.source === 'account'
                    ? 'Account token'
                    : thingiverse?.source === 'server'
                      ? 'Server connection'
                      : 'Not connected'}
              </span>
              {thingiverse?.storage_configured !== false && (
                <div className="settings-token-entry">
                  <input
                    type="password"
                    name="thingiverse-token"
                    autoComplete="off"
                    value={thingiverseToken}
                    onChange={event => setThingiverseToken(event.target.value)}
                    placeholder={thingiverse?.source === 'account' ? 'Replace official token' : 'Official API token'}
                    aria-label="Thingiverse API token"
                    disabled={connectionLoading || connectionSaving}
                  />
                  <Button
                    onClick={() => void handleSaveThingiverse()}
                    disabled={connectionLoading || connectionSaving || !thingiverseToken.trim()}
                  >
                    <KeyRound size={16} aria-hidden="true" />
                    {connectionSaving ? 'Saving…' : 'Connect'}
                  </Button>
                </div>
              )}
              {thingiverse?.source === 'account' && (
                <Button
                  variant="ghost"
                  onClick={() => void handleDisconnectThingiverse()}
                  disabled={connectionSaving}
                >
                  <Unplug size={16} aria-hidden="true" /> Disconnect account token
                </Button>
              )}
            </div>
          </SettingsRow>
          {connectionStatus && <p className="settings-status" role="status">{connectionStatus}</p>}
          {connectionError && <p className="settings-connection-error" role="alert">{connectionError}</p>}
        </SettingsGroup>
      )}

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
                Permanently removes Workshop projects, photos, lists, Shaper and Bambu
                projects, downloaded files, provider tokens, templates, and account data
                from the current workspace. This cannot be undone.
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

function thingiverseDescription(
  status: ThingiverseConnectionStatus | null,
  loading: boolean,
) {
  if (loading) return 'Checking the shared Workshop backend.';
  if (!status) return 'Connection status is unavailable.';
  if (status.source === 'server') {
    return status.storage_configured
      ? 'Thingiverse imports are available through the shared server connection.'
      : 'Thingiverse imports use the shared server connection; personal token storage is unavailable.';
  }
  if (!status.storage_configured) {
    return 'Encrypted token storage is not configured on the Workshop server.';
  }
  if (status.source === 'account') {
    return 'Your official token is encrypted per account and is never returned to this browser.';
  }
  return 'Connect an official Thingiverse API token to import complete metadata, images, and files.';
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
