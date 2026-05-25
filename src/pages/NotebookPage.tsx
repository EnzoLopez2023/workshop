import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getTabloomWorkshopPage, type TabloomPageDetail } from '../services/tabloomApi';
import '../styles/tabloom-content.css';

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

  const [page, setPage] = useState<TabloomPageDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getTabloomWorkshopPage(id)
      .then(setPage)
      .catch(err => {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, [id]);

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

  if (!page) {
    return (
      <div className="page-container" style={{ maxWidth: 780 }}>
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/notebook')} className="btn btn-ghost" style={{ gap: 6, flexShrink: 0 }}>
          <ArrowLeft size={14} /> Notebook
        </button>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>
          Edited {relativeTime(page.edited_at)} · from Tabloom
        </div>
      </div>

      <div
        className="tabloom-content card"
        style={{ padding: '24px 28px' }}
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </div>
  );
}
