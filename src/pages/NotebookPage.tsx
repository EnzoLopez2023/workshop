import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, ArrowLeft, Eye, Pencil, Save } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Button, PageFrame, StatePanel } from '../components/ui';
import { isDemoMode } from '../demo/demoMode';
import {
  buildNotebookUpdate,
  canLeaveNotebook,
  formatRelativeTime,
  notebookHasUnsavedChanges,
} from '../lib/notebook';
import {
  createTabloomWorkshopPage,
  getTabloomWorkshopPage,
  updateTabloomWorkshopPage,
  type TabloomPageDetail,
} from '../services/tabloomApi';
import '../styles/tabloom-content.css';

marked.setOptions({ gfm: true, breaks: false });
const TABLOOM_URI_PATTERN = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|tabloom):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

type ConflictState = { current: TabloomPageDetail } | null;
type Tab = 'edit' | 'preview';

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const demo = isDemoMode();
  const isNew = id === 'new';
  const [page, setPage] = useState<TabloomPageDetail | null>(null);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [tab, setTab] = useState<Tab>(isNew ? 'edit' : 'preview');
  const [loading, setLoading] = useState(!isNew && !demo);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [baseline, setBaseline] = useState<{ title: string; body_md: string } | null>(null);
  const [savedRedirect, setSavedRedirect] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    setSaveError(null);
    setSaveStatus('');
    setConflict(null);
    setTab(isNew ? 'edit' : 'preview');

    if (demo) {
      setLoading(false);
      return;
    }
    if (isNew) {
      setPage(null);
      setBaseline({ title: '', body_md: '' });
      setTitle('');
      setBodyMd('');
      setLoading(false);
      return;
    }
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    getTabloomWorkshopPage(id)
      .then(nextPage => {
        if (cancelled) return;
        setPage(nextPage);
        setTitle(nextPage.title);
        setBodyMd(nextPage.body_md);
        setBaseline({ title: nextPage.title, body_md: nextPage.body_md });
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Notebook page load failed', error);
        setLoadError(error instanceof Error ? error.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, id, isNew]);

  const dirty = useMemo(
    () => notebookHasUnsavedChanges(baseline, title, bodyMd),
    [baseline, bodyMd, title],
  );

  const previewHtml = useMemo(() => {
    try {
      return DOMPurify.sanitize(marked.parse(bodyMd) as string, {
        ALLOWED_URI_REGEXP: TABLOOM_URI_PATTERN,
      });
    } catch (error) {
      console.error('Notebook Markdown preview failed', error);
      return '';
    }
  }, [bodyMd]);

  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (canLeaveNotebook(true, window.confirm)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const persistPage = useCallback(async (overwriteBase?: TabloomPageDetail) => {
    if (saving || demo) return;
    setSaveError(null);
    setSaveStatus('');
    setConflict(null);
    setSaving(true);
    try {
      if (isNew) {
        const created = await createTabloomWorkshopPage({
          title: title.trim() || 'Untitled',
          body_md: bodyMd,
        });
        setPage(created);
        setTitle(created.title);
        setBodyMd(created.body_md);
        setBaseline({ title: created.title, body_md: created.body_md });
        setSavedRedirect(`/notebook/${created.id}`);
        return;
      }

      const basePage = overwriteBase ?? page;
      if (!basePage) {
        setSaveError('The page has not finished loading. Try again.');
        return;
      }
      const result = await updateTabloomWorkshopPage(
        basePage.id,
        buildNotebookUpdate(basePage, title, bodyMd),
      );
      if (result.ok) {
        setPage(result.page);
        setTitle(result.page.title);
        setBodyMd(result.page.body_md);
        setBaseline({ title: result.page.title, body_md: result.page.body_md });
        setSaveStatus('Saved to Tabloom.');
      } else {
        setConflict({ current: result.current });
      }
    } catch (error) {
      console.error('Notebook save failed', error);
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [bodyMd, demo, isNew, page, saving, title]);

  useEffect(() => {
    if (!savedRedirect || dirty) return;
    navigate(savedRedirect, { replace: true });
    setSavedRedirect(null);
  }, [dirty, navigate, savedRedirect]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving) void persistPage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, persistPage, saving]);

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const leaveNotebook = () => {
    navigate('/notebook');
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextTab: Tab | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'Home') nextTab = 'preview';
    if (event.key === 'ArrowRight' || event.key === 'End') nextTab = 'edit';
    if (!nextTab) return;
    event.preventDefault();
    setTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`notebook-${nextTab}-tab`)?.focus());
  };

  const acceptReload = () => {
    if (!conflict) return;
    const fresh = conflict.current;
    setPage(fresh);
    setTitle(fresh.title);
    setBodyMd(fresh.body_md);
    setBaseline({ title: fresh.title, body_md: fresh.body_md });
    setConflict(null);
    setSaveStatus('Loaded the latest Tabloom version.');
  };

  if (demo) {
    return (
      <PageFrame maxWidth={920}>
        <Button variant="ghost" onClick={() => navigate('/notebook')} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Notebook
        </Button>
        <StatePanel
          title="Notebook is unavailable in the demo"
          description="Sign in with Microsoft to connect Workshop to your Tabloom notebook."
        />
      </PageFrame>
    );
  }

  if (loading) {
    return (
      <PageFrame maxWidth={1040} className="notebook-editor-page">
        <div
          className="notebook-editor-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label="Loading notebook page"
        >
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
        </div>
      </PageFrame>
    );
  }

  if (loadError) {
    return (
      <PageFrame maxWidth={920}>
        <Button variant="ghost" onClick={() => navigate('/notebook')} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Notebook
        </Button>
        <StatePanel
          title="Notebook page unavailable"
          description={`Workshop could not load this Tabloom page: ${loadError}`}
          tone="danger"
          action={<Button onClick={() => window.location.reload()}>Try again</Button>}
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame maxWidth={1040} className="notebook-editor-page">
      <header className="notebook-editor-toolbar">
        <Button variant="ghost" onClick={leaveNotebook} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Notebook
        </Button>
        <div className="notebook-sync-state" aria-live="polite">
          {saving
            ? 'Saving to Tabloom…'
            : saveStatus
              ? saveStatus
              : dirty
                ? 'Unsaved changes'
                : isNew
                  ? 'New page'
                  : page
                    ? `Edited ${formatRelativeTime(page.edited_at)}`
                    : ''}
        </div>
        <Button
          variant="primary"
          onClick={() => void persistPage()}
          disabled={saving || (!isNew && !dirty)}
        >
          <Save size={16} aria-hidden="true" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </header>

      <label className="notebook-title-field">
        <span className="sr-only">Page title</span>
        <input
          type="text"
          value={title}
          readOnly={saving}
          onChange={event => {
            setTitle(event.target.value);
            setSaveStatus('');
          }}
          placeholder="Untitled"
          autoComplete="off"
        />
      </label>

      {conflict && (
        <section className="notebook-conflict" role="alert" aria-labelledby="notebook-conflict-title">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <h2 id="notebook-conflict-title">This page changed in Tabloom</h2>
            <p>
              Tabloom was edited {formatRelativeTime(conflict.current.edited_at)}.
              Reload its latest version, or overwrite it with the work currently here.
            </p>
            <div>
              <Button variant="ghost" onClick={acceptReload}>Reload latest</Button>
              <Button onClick={() => void persistPage(conflict.current)}>Overwrite with mine</Button>
            </div>
          </div>
        </section>
      )}

      {saveError && !conflict && (
        <div className="notebook-save-error" role="alert">
          <strong>Save failed.</strong> {saveError}
        </div>
      )}

      <div className="notebook-tabs" role="tablist" aria-label="Notebook page view">
        <NotebookTab
          id="notebook-preview-tab"
          active={tab === 'preview'}
          controls="notebook-preview-panel"
          onClick={() => setTab('preview')}
          onKeyDown={handleTabKeyDown}
          icon={<Eye size={16} aria-hidden="true" />}
        >
          Preview
        </NotebookTab>
        <NotebookTab
          id="notebook-edit-tab"
          active={tab === 'edit'}
          controls="notebook-edit-panel"
          onClick={() => setTab('edit')}
          onKeyDown={handleTabKeyDown}
          icon={<Pencil size={16} aria-hidden="true" />}
        >
          Edit
        </NotebookTab>
      </div>

      {tab === 'edit' ? (
        <section
          id="notebook-edit-panel"
          role="tabpanel"
          aria-labelledby="notebook-edit-tab"
          className="notebook-edit-panel"
        >
          <label htmlFor="notebook-body">Markdown source</label>
          <textarea
            id="notebook-body"
            value={bodyMd}
            readOnly={saving}
            onChange={event => {
              setBodyMd(event.target.value);
              setSaveStatus('');
            }}
            placeholder="# Start writing in Markdown…"
            spellCheck
          />
          <p>Press ⌘S or Ctrl-S to save. Tabloom-only blocks remain visible in source and round-trip unchanged.</p>
        </section>
      ) : (
        <section
          id="notebook-preview-panel"
          role="tabpanel"
          aria-labelledby="notebook-preview-tab"
          tabIndex={0}
          className="tabloom-content notebook-preview-panel"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </PageFrame>
  );
}

function NotebookTab({
  id,
  active,
  controls,
  onClick,
  onKeyDown,
  icon,
  children,
}: {
  id: string;
  active: boolean;
  controls: string;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
      {children}
    </button>
  );
}
