import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Pencil, Trash2, Cpu, Scissors, X } from 'lucide-react';
import { getShaperProject, deleteShaperProject, imageUrl } from '../services/api';
import type { ShaperProject } from '../types/project';
import CutPlanOptimizer from '../components/CutPlanOptimizer';

export default function ShaperProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<ShaperProject | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showCutPlan, setShowCutPlan] = useState(false);
  const [heroBroken, setHeroBroken] = useState(false);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox]);

  useEffect(() => {
    setLoading(true);
    getShaperProject(projectId)
      .then(setProject)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleDelete = async () => {
    if (!project) return;
    setDeleting(true);
    try {
      await deleteShaperProject(projectId);
      navigate('/');
    } catch (err) {
      console.error(err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) {
    return <div className="empty-state" style={{ paddingTop: 80 }}>Loading…</div>;
  }

  if (!project) {
    return <div className="empty-state" style={{ paddingTop: 80 }}>Project not found.</div>;
  }

  return (
    <>
    <div className="page-container" style={{ maxWidth: 900 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 12 }}>
        <button onClick={() => navigate('/')} className="btn btn-ghost" style={{ gap: 6 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => navigate(`/shaper/${projectId}/edit`)} style={{ gap: 6 }}>
            <Pencil size={13} /> Edit
          </button>
          {confirmDelete ? (
            <>
              <span style={{ fontSize: '0.82rem', color: 'var(--color-rust)', whiteSpace: 'nowrap' }}>
                Delete this project?
              </span>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleDelete}
                disabled={deleting}
                style={{ gap: 6, color: 'var(--color-rust)' }}
              >
                <Trash2 size={13} />
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmDelete(true)}
              style={{ gap: 6, color: 'var(--color-rust)' }}
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Hero photo — prefer uploaded images, fall back to photo_url */}
      {(project.images.length > 0 || project.photo_url) && !heroBroken && (
        <div style={{
          width: '100%', maxHeight: 420, borderRadius: 14, overflow: 'hidden', marginBottom: 36,
        }}>
          <img
            src={project.images.length > 0 ? imageUrl(project.images[0].id) : project.photo_url!}
            alt={project.title}
            style={{ width: '100%', height: 420, objectFit: 'cover', display: 'block' }}
            onError={() => setHeroBroken(true)}
          />
        </div>
      )}

      {/* Title + badge */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{
          flexShrink: 0, width: 38, height: 38, borderRadius: 9,
          backgroundColor: 'var(--color-ink-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Cpu size={18} color="var(--color-cream)" strokeWidth={2} />
        </div>
        <div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.6rem,3vw,2.2rem)',
            fontWeight: 700, lineHeight: 1.1, color: 'var(--color-ink)',
          }}>
            {project.title}
          </h1>
          <a
            href={project.shaper_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: '0.82rem', color: 'var(--color-muted)',
              textDecoration: 'none',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <ExternalLink size={13} /> View on Shaper Hub
          </a>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginTop: 28 }}>

        {/* Description */}
        {project.description && (
          <section>
            <SectionLabel>About This Project</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.96rem', color: 'var(--color-ink)', lineHeight: 1.65 }}>
              {project.description}
            </p>
          </section>
        )}

        {/* Materials */}
        {project.materials.length > 0 && (
          <section>
            <SectionLabel>Materials</SectionLabel>
            <div className="card" style={{ padding: '4px 0' }}>
              {project.materials.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 18px',
                    borderBottom: i < project.materials.length - 1 ? '1px solid var(--color-line)' : 'none',
                  }}
                >
                  <span style={{ fontSize: '0.9rem', color: 'var(--color-ink)' }}>{m.name}</span>
                  {m.qty && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-muted)', flexShrink: 0, marginLeft: 16 }}>
                      {m.qty}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Instructions */}
        {project.instructions && (
          <section>
            <SectionLabel>Instructions</SectionLabel>
            <div className="card" style={{ padding: '20px 22px' }}>
              <pre style={{
                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontSize: '0.88rem', color: 'var(--color-ink)', lineHeight: 1.7,
                fontFamily: 'inherit',
              }}>
                {project.instructions}
              </pre>
            </div>
          </section>
        )}

        {/* Photo gallery (all uploaded images) */}
        {project.images.length > 1 && (
          <section>
            <SectionLabel>Photos</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {project.images.map(img => (
                <button
                  key={img.id}
                  onClick={() => setLightbox(imageUrl(img.id))}
                  style={{
                    padding: 0, border: '1px solid var(--color-line)', borderRadius: 8,
                    overflow: 'hidden', cursor: 'pointer', aspectRatio: '4/3', background: 'none',
                  }}
                >
                  <img
                    src={imageUrl(img.id)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Cut list */}
        {project.cut_list.length > 0 && (
          <section>
            <SectionLabel>Cut List</SectionLabel>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-cream-2)' }}>
                    {['Part', 'Qty', 'L', 'W', 'T', 'Material'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', color: 'var(--color-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.cut_list.map((row, i) => (
                    <tr key={row.id} style={{ borderTop: i > 0 ? '1px solid var(--color-line)' : undefined }}>
                      <td style={{ padding: '8px 14px', fontWeight: 600 }}>{row.part_name}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--color-muted)' }}>{row.qty}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--color-muted)' }}>{row.length ?? '—'}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--color-muted)' }}>{row.width ?? '—'}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--color-muted)' }}>{row.thickness ?? '—'}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--color-muted)' }}>{row.material ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Cut Plan Optimizer */}
        {project.cut_list.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: showCutPlan ? 16 : 0 }}>
              <SectionLabel>Cut Plan Optimizer</SectionLabel>
              <button className="btn btn-ghost" onClick={() => setShowCutPlan(v => !v)} style={{ fontSize: '0.8rem', gap: 6, marginBottom: 12 }}>
                <Scissors size={14} />
                {showCutPlan ? 'Hide' : 'Plan Cuts'}
              </button>
            </div>
            {showCutPlan && <CutPlanOptimizer cutList={project.cut_list} projectId={project.id} />}
          </section>
        )}

      </div>
    </div>

    {/* Lightbox */}
    {lightbox && (
      <div
        onClick={closeLightbox}
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <button
          onClick={closeLightbox}
          style={{
            position: 'absolute', top: 20, right: 20,
            background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer',
            color: '#fff', borderRadius: 8, padding: 8,
            display: 'flex', alignItems: 'center',
          }}
        >
          <X size={20} />
        </button>
        <img
          src={lightbox}
          alt=""
          style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 10, objectFit: 'contain' }}
          onClick={e => e.stopPropagation()}
        />
      </div>
    )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow" style={{ marginBottom: 12 }}>{children}</div>;
}
