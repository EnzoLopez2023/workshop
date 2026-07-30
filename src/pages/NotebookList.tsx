import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Plus } from 'lucide-react';
import { listTabloomWorkshopPages, type TabloomPageSummary } from '../services/tabloomApi';

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

export default function NotebookList() {
  const navigate = useNavigate();
  const [pages, setPages] = useState<TabloomPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listTabloomWorkshopPages()
      .then(setPages)
      .catch(err => {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ gap: 6, marginBottom: 24 }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">
            <BookOpen size={20} strokeWidth={2.2} style={{ color: 'var(--color-amber)', display: 'inline-block', verticalAlign: '-2px', marginRight: 10 }} />
            Notebook
          </h1>
          <p className="page-sub">
            {pages.length === 0 && !loading
              ? 'Edit any page or start a new one — changes sync back to Tabloom.'
              : `${pages.length} page${pages.length !== 1 ? 's' : ''} · synced with Tabloom`}
          </p>
        </div>
        <div className="page-head-actions">
          <button onClick={() => navigate('/notebook/new')} className="btn btn-primary" style={{ gap: 6 }}>
            <Plus size={14} /> New page
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      ) : loadError === 'workshop_notebook_missing' ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
          No "Workshop" notebook found in Tabloom. Create one in Tabloom to populate this view.
        </div>
      ) : loadError ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-amber)' }}>
          Could not load pages: {loadError}
        </div>
      ) : pages.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
          No pages yet. Tap “New page” to start one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pages.map(page => (
            <div
              key={page.id}
              className="card"
              style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer' }}
              onClick={() => navigate(`/notebook/${page.id}`)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-board)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-ink)', marginBottom: 4 }}>
                  {page.title || 'Untitled'}
                </div>
                {page.snippet && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
                    {page.snippet}
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>
                  {relativeTime(page.edited_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
