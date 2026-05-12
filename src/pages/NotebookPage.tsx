import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, X, Plus } from 'lucide-react';
import {
  getNotebookPage, updateNotebookPage, addNotebookLink, deleteNotebookLink,
} from '../services/api';
import type { NotebookLink, NotebookPageDetail } from '../types/project';

const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractYouTubeId(url: string): string | null {
  const m = url.match(YT_RE);
  return m ? m[1] : null;
}

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
  const pageId = Number(id);

  const [page, setPage] = useState<NotebookPageDetail | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [links, setLinks] = useState<NotebookLink[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [addingLink, setAddingLink] = useState(false);

  const serverTitle = useRef('');
  const serverBody = useRef('');
  const dirty = title !== serverTitle.current || body !== serverBody.current;

  useEffect(() => {
    getNotebookPage(pageId).then(p => {
      setPage(p);
      setTitle(p.title);
      setBody(p.body);
      setLinks(p.links);
      serverTitle.current = p.title;
      serverBody.current = p.body;
    }).catch(err => console.error(err));
  }, [pageId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const updated = await updateNotebookPage(pageId, title, body);
      serverTitle.current = updated.title;
      serverBody.current = updated.body;
      setPage(updated);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLink = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setAddingLink(true);
    try {
      const link = await addNotebookLink(pageId, url);
      setLinks(prev => [...prev, link]);
      setUrlInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setAddingLink(false);
    }
  };

  const handleDeleteLink = async (linkId: number) => {
    setLinks(prev => prev.filter(l => l.id !== linkId));
    try {
      await deleteNotebookLink(linkId);
    } catch (err) {
      console.error(err);
      getNotebookPage(pageId).then(p => setLinks(p.links)).catch(() => {});
    }
  };

  if (!page) {
    return (
      <div className="page-container" style={{ maxWidth: 780 }}>
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={() => navigate('/notebook')} className="btn btn-ghost" style={{ gap: 6, flexShrink: 0 }}>
          <ArrowLeft size={14} /> Notebook
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Untitled"
          style={{
            flex: 1, fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1.2rem',
            border: 'none', borderBottom: '1px solid var(--color-line)', background: 'transparent',
            color: 'var(--color-ink)', padding: '4px 0', outline: 'none', minWidth: 0,
          }}
        />
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{ flexShrink: 0 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {saveError && (
        <div style={{ color: 'var(--color-rust)', fontSize: '0.82rem', marginBottom: 12 }}>{saveError}</div>
      )}

      <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginBottom: 20, letterSpacing: '0.04em' }}>
        Updated {relativeTime(page.updated_at)} · Created {relativeTime(page.created_at)}
      </div>

      {/* Body */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Start writing…"
        style={{
          width: '100%', minHeight: 220, resize: 'vertical', padding: '14px 16px',
          fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.65,
          border: '1px solid var(--color-line)', borderRadius: 10,
          background: 'var(--color-cream)', color: 'var(--color-ink)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />

      {/* Links & Embeds */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 14 }}>
          Links &amp; Embeds
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddLink(); }}
            placeholder="Paste a URL…"
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8,
              border: '1px solid var(--color-line)', background: 'var(--color-cream)',
              color: 'var(--color-ink)', fontSize: '0.88rem', outline: 'none',
            }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddLink}
            disabled={!urlInput.trim() || addingLink}
            style={{ gap: 6, flexShrink: 0 }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {links.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {links.map(link => {
              const ytId = extractYouTubeId(link.url);
              return (
                <div key={link.id} style={{ position: 'relative' }}>
                  <button
                    onClick={() => handleDeleteLink(link.id)}
                    title="Remove"
                    style={{
                      position: 'absolute', top: 8, right: 8, zIndex: 1,
                      background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%',
                      width: 24, height: 24, cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#fff',
                    }}
                  >
                    <X size={12} />
                  </button>
                  {ytId ? (
                    <div style={{ borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                      <iframe
                        width="100%"
                        height="280"
                        src={`https://www.youtube.com/embed/${ytId}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ display: 'block', border: 'none' }}
                        title={link.caption ?? link.url}
                      />
                    </div>
                  ) : (
                    <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ExternalLink size={14} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {link.caption && (
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 2, color: 'var(--color-ink)' }}>{link.caption}</div>
                        )}
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '0.78rem', color: 'var(--color-muted)', wordBreak: 'break-all' }}
                          onClick={e => e.stopPropagation()}
                        >
                          {link.url}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
