import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Eye, Pencil, AlertTriangle } from 'lucide-react';
import { marked } from 'marked';
import {
  createTabloomWorkshopPage,
  getTabloomWorkshopPage,
  updateTabloomWorkshopPage,
  type TabloomPageDetail,
} from '../services/tabloomApi';
import '../styles/tabloom-content.css';

// CommonMark + GFM with raw HTML kept intact — the Tabloom-only callout /
// figure wrappers travel as raw HTML and we want to round-trip them in the
// preview just like Tabloom's html export does.
marked.setOptions({ gfm: true, breaks: false });

type ConflictState = { current: TabloomPageDetail } | null;
type Tab = 'edit' | 'preview';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso + 'Z').getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso + 'Z').toLocaleDateString();
}

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [page, setPage] = useState<TabloomPageDetail | null>(null);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [tab, setTab] = useState<Tab>('edit');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState>(null);

  // Track the server's last-known state so we can dirty-check and send
  // expected_edited_at on save.
  const [baseline, setBaseline] = useState<{ title: string; body_md: string } | null>(null);

  useEffect(() => {
    if (isNew) {
      setPage(null);
      setBaseline({ title: '', body_md: '' });
      setTitle('');
      setBodyMd('');
      return;
    }
    if (!id) return;
    let cancelled = false;
    getTabloomWorkshopPage(id)
      .then(p => {
        if (cancelled) return;
        setPage(p);
        setTitle(p.title);
        setBodyMd(p.body_md);
        setBaseline({ title: p.title, body_md: p.body_md });
      })
      .catch(err => {
        if (cancelled) return;
        console.error(err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => { cancelled = true };
  }, [id, isNew]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    return title !== baseline.title || bodyMd !== baseline.body_md;
  }, [title, bodyMd, baseline]);

  const previewHtml = useMemo(() => {
    try { return marked.parse(bodyMd) as string; }
    catch { return ''; }
  }, [bodyMd]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaveError(null);
    setConflict(null);
    setSaving(true);
    try {
      if (isNew) {
        const created = await createTabloomWorkshopPage({ title: title.trim() || 'Untitled', body_md: bodyMd });
        navigate(`/notebook/${created.id}`, { replace: true });
        return;
      }
      if (!page) return;
      const result = await updateTabloomWorkshopPage(page.id, {
        title: title.trim() || page.title,
        body_md: bodyMd,
        expected_edited_at: page.edited_at,
      });
      if (result.ok) {
        setPage(result.page);
        setTitle(result.page.title);
        setBodyMd(result.page.body_md);
        setBaseline({ title: result.page.title, body_md: result.page.body_md });
      } else {
        setConflict({ current: result.current });
      }
    } catch (err) {
      console.error(err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [saving, isNew, page, title, bodyMd, navigate]);

  // Cmd/Ctrl-S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, handleSave]);

  if (loadError) {
    return (
      <div className="page-container" style={{ maxWidth: 780 }}>
        <button onClick={() => navigate('/notebook')} className="btn btn-ghost" style={{ gap: 6, marginBottom: 24 }}>
          <ArrowLeft size={14} /> Notebook
        </button>
        <div className="card" style={{ padding: 32, color: 'var(--color-rust)' }}>
          Could not load page: {loadError}
        </div>
      </div>
    );
  }

  if (!isNew && !page) {
    return (
      <div className="page-container" style={{ maxWidth: 780 }}>
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      </div>
    );
  }

  const acceptReload = () => {
    if (!conflict) return;
    const fresh = conflict.current;
    setPage(fresh);
    setTitle(fresh.title);
    setBodyMd(fresh.body_md);
    setBaseline({ title: fresh.title, body_md: fresh.body_md });
    setConflict(null);
  };

  const forceOverwrite = async () => {
    if (!conflict) return;
    const fresh = conflict.current;
    // Pretend our base is the latest server state, but keep the in-memory
    // edits as the new save payload. Next save call will succeed because
    // expected_edited_at now matches.
    setPage(fresh);
    setBaseline({ title: fresh.title, body_md: fresh.body_md });
    setConflict(null);
    // Defer so React commits the state before the next save round-trip.
    setTimeout(() => { void handleSave(); }, 0);
  };

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/notebook')} className="btn btn-ghost" style={{ gap: 6, flexShrink: 0 }}>
          <ArrowLeft size={14} /> Notebook
        </button>
        <div style={{ flex: 1, minWidth: 120, fontSize: '0.72rem', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>
          {isNew
            ? 'New page · syncs to Tabloom on save'
            : page ? `Edited ${relativeTime(page.edited_at)} · syncs to Tabloom` : ''}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || (!isNew && !dirty)}
          className="btn btn-primary"
          style={{ gap: 6, opacity: saving || (!isNew && !dirty) ? 0.55 : 1 }}
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Untitled"
        style={{
          width: '100%',
          fontFamily: 'var(--font-serif)',
          fontSize: '1.8rem',
          fontWeight: 700,
          padding: '6px 4px',
          border: 'none',
          background: 'transparent',
          outline: 'none',
          marginBottom: 12,
          color: 'var(--color-ink)',
        }}
      />

      {conflict && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 16,
            backgroundColor: '#fff7ed',
            borderColor: '#fdba74',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={18} style={{ color: '#c2410c', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, fontSize: '0.85rem', color: '#7c2d12' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>This page changed in Tabloom while you were editing.</div>
            <div style={{ marginBottom: 10 }}>
              Edited {relativeTime(conflict.current.edited_at)}. Reload pulls Tabloom's latest in;
              Overwrite saves yours anyway.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={acceptReload} className="btn btn-ghost" style={{ padding: '6px 12px' }}>
                Reload
              </button>
              <button onClick={forceOverwrite} className="btn btn-muted" style={{ padding: '6px 12px' }}>
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}

      {saveError && !conflict && (
        <div
          className="card"
          style={{ padding: 12, marginBottom: 16, color: 'var(--color-rust)', borderColor: 'var(--color-rust)' }}
        >
          Save failed: {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--color-line)' }}>
        <TabButton active={tab === 'edit'}    onClick={() => setTab('edit')}    icon={<Pencil size={13} />}>Edit</TabButton>
        <TabButton active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Eye size={13} />}>Preview</TabButton>
      </div>

      {tab === 'edit' ? (
        <textarea
          value={bodyMd}
          onChange={e => setBodyMd(e.target.value)}
          placeholder="# Start writing in Markdown…"
          spellCheck
          style={{
            width: '100%',
            minHeight: 480,
            padding: '20px 24px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.9rem',
            lineHeight: 1.6,
            background: 'var(--color-paper)',
            border: '1px solid var(--color-line)',
            borderRadius: 12,
            outline: 'none',
            color: 'var(--color-ink)',
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
          }}
        />
      ) : (
        <div
          className="tabloom-content card"
          style={{ padding: '24px 28px' }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--color-rust)' : 'transparent'}`,
        color: active ? 'var(--color-ink)' : 'var(--color-muted)',
        fontWeight: active ? 600 : 500,
        fontSize: '0.82rem',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {icon}
      {children}
    </button>
  );
}
