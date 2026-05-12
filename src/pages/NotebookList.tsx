import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Plus, Trash2 } from 'lucide-react';
import { listNotebookPages, createNotebookPage, deleteNotebookPage } from '../services/api';
import type { NotebookPageSummary } from '../types/project';

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
  const [pages, setPages] = useState<NotebookPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    listNotebookPages()
      .then(setPages)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleNew = async () => {
    setCreating(true);
    try {
      const page = await createNotebookPage();
      navigate(`/notebook/${page.id}`);
    } catch (err) {
      console.error(err);
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    setPages(prev => prev.filter(p => p.id !== id));
    setConfirmDelete(null);
    try {
      await deleteNotebookPage(id);
    } catch (err) {
      console.error(err);
      listNotebookPages().then(setPages).catch(() => {});
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 12 }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ gap: 6 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <button className="btn btn-primary" onClick={handleNew} disabled={creating} style={{ gap: 6 }}>
          <Plus size={15} strokeWidth={2.4} />
          {creating ? 'Creating…' : 'New Page'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <BookOpen size={22} style={{ color: 'var(--color-rust)' }} />
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '2rem', fontWeight: 700 }}>Notebook</h1>
      </div>
      <p style={{ margin: '0 0 36px', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
        {pages.length === 0 && !loading ? 'No pages yet.' : `${pages.length} page${pages.length !== 1 ? 's' : ''}`}
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      ) : pages.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
          Create your first page with the button above.
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
                <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-ink)', marginBottom: 4 }}>
                  {page.title || 'Untitled'}
                </div>
                {page.body_preview && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
                    {page.body_preview}
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>
                  {relativeTime(page.updated_at)}
                </div>
              </div>
              <div onClick={e => e.stopPropagation()}>
                {confirmDelete === page.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.75rem', color: 'var(--color-rust)', padding: '4px 10px' }}
                      onClick={() => handleDelete(page.id)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--color-muted)', padding: '6px 8px' }}
                    onClick={() => setConfirmDelete(page.id)}
                    title="Delete page"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
