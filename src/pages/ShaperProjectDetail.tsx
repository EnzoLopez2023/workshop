import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Cpu,
  ExternalLink,
  Hammer,
  Pencil,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { deleteShaperProject, getShaperProject, imageUrl } from '../services/api';
import type { ShaperProject } from '../types/project';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import { Button, PageFrame, StatePanel } from '../components/ui';
import { WorkflowSection } from '../components/workflows';
import { ProjectDetailSkeleton } from '../components/Skeleton';

export default function ShaperProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<ShaperProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showCutPlan, setShowCutPlan] = useState(false);
  const [heroBroken, setHeroBroken] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getShaperProject(projectId)
      .then(setProject)
      .catch(error => {
        console.error('Shaper project load failed', error);
        setLoadError('Workshop could not load this Shaper Hub project. Check the connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteShaperProject(projectId);
      navigate('/');
    } catch (error) {
      console.error('Shaper project delete failed', error);
      toast.error('Workshop could not delete this Shaper project. Try again.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) return <ProjectDetailSkeleton />;
  if (loadError) {
    return (
      <PageFrame maxWidth={980}>
        <StatePanel
          title="Shaper project unavailable"
          description={loadError}
          tone="danger"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      </PageFrame>
    );
  }
  if (!project) {
    return (
      <PageFrame maxWidth={980}>
        <StatePanel title="Shaper project not found" description="This project may have been deleted or the link is no longer valid." />
      </PageFrame>
    );
  }

  const images = project.images ?? [];
  const cutList = project.cut_list ?? [];
  const heroSrc = images.length > 0 ? imageUrl(images[0].id) : project.photo_url;

  return (
    <>
      <PageFrame maxWidth={1000} className="project-detail-page shaper-detail-page">
        <div className="project-detail-toolbar">
          <Button variant="ghost" onClick={() => navigate('/')} className="workflow-back">
            <ArrowLeft size={16} aria-hidden="true" /> Shaper Hub
          </Button>
          <div className="project-detail-actions">
            <Button variant="ghost" onClick={() => navigate(`/shaper/${projectId}/edit`)}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Button>
            {confirmDelete ? (
              <span className="inline-confirm" role="group" aria-label="Confirm Shaper project deletion">
                <span>Delete this project?</span>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
                  <Trash2 size={16} aria-hidden="true" />
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" className="danger-text" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </Button>
            )}
          </div>
        </div>

        <section className="project-detail-hero shaper-detail-hero" aria-labelledby="shaper-project-title">
          <div className="project-detail-hero-media">
            {heroSrc && !heroBroken ? (
              <img src={heroSrc} alt="" onError={() => setHeroBroken(true)} />
            ) : (
              <div className="project-plan-fallback" aria-hidden="true">
                <Hammer size={64} strokeWidth={1.3} />
              </div>
            )}
          </div>
          <div className="project-detail-tracing">
            <span className="pill flag-steel"><Cpu size={14} aria-hidden="true" /> Shaper Hub</span>
            <h1 id="shaper-project-title">{project.title || 'Untitled Shaper project'}</h1>
            {project.description && <p className="project-detail-description">{project.description}</p>}
            <a className="shaper-source-link" href={project.shaper_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" /> Open the source on Shaper Hub
            </a>
            <dl className="project-detail-meta shaper-detail-meta">
              <div><dt>Parts</dt><dd>{cutList.length}</dd></div>
              <div><dt>Materials</dt><dd>{project.materials.length}</dd></div>
            </dl>
            <div className="project-next-action">
              <span>
                <strong>Review the CNC setup</strong>
                <small>Confirm the stock, measured parts, source file, and shop instructions before cutting.</small>
              </span>
              <Button variant="next" onClick={() => navigate(`/shaper/${projectId}/edit`)}>
                Update setup
              </Button>
            </div>
          </div>
        </section>

        <div className="project-detail-content">
          {project.materials.length > 0 && (
            <WorkflowSection id="shaper-materials" title="Materials" description="Stock and supplies imported from the Shaper project.">
              <div className="board data-list">
                {project.materials.map((material, index) => (
                  <div className="data-list-row" key={`${material.name}-${index}`}>
                    <strong>{material.name}</strong>
                    {material.qty && <span>{material.qty}</span>}
                  </div>
                ))}
              </div>
            </WorkflowSection>
          )}

          {project.instructions && (
            <WorkflowSection id="shaper-instructions" title="Instructions">
              <div className="prose-panel">{project.instructions}</div>
            </WorkflowSection>
          )}

          {images.length > 1 && (
            <WorkflowSection id="shaper-photos" title="Photos" description={`${images.length} project references`}>
              <div className="media-gallery">
                {images.map(image => (
                  <button
                    key={image.id}
                    type="button"
                    className="media-gallery-item"
                    onClick={() => setLightbox(imageUrl(image.id))}
                    aria-label="Open project image"
                  >
                    <img src={imageUrl(image.id)} alt="" />
                  </button>
                ))}
              </div>
            </WorkflowSection>
          )}

          {cutList.length > 0 && (
            <WorkflowSection id="shaper-cut-list" title="Cut list" description="Dimensions remain exactly as imported or entered.">
              <div className="card table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Qty</th>
                      <th>Length</th>
                      <th>Width</th>
                      <th>Thickness</th>
                      <th>Material</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cutList.map(row => (
                      <tr key={row.id}>
                        <th scope="row">{row.part_name}</th>
                        <td>{row.qty}</td>
                        <td>{row.length ?? '—'}</td>
                        <td>{row.width ?? '—'}</td>
                        <td>{row.thickness ?? '—'}</td>
                        <td>{row.material ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WorkflowSection>
          )}

          {cutList.length > 0 && (
            <WorkflowSection
              id="shaper-cut-plan"
              title="Cut plan optimizer"
              description="Use the same exact-match board layout engine as regular projects."
              actions={(
                <Button variant="ghost" onClick={() => setShowCutPlan(current => !current)}>
                  <Scissors size={16} aria-hidden="true" /> {showCutPlan ? 'Hide plan' : 'Plan cuts'}
                </Button>
              )}
            >
              {showCutPlan
                ? <CutPlanOptimizer cutList={cutList} projectId={project.id} />
                : <p className="section-placeholder">Add available stock and kerf when you are ready to calculate the layout.</p>}
            </WorkflowSection>
          )}
        </div>
      </PageFrame>
      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Project image preview"
      onClick={onClose}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          event.preventDefault();
          closeRef.current?.focus();
        }
      }}
    >
      <Button ref={closeRef} variant="ghost" className="media-lightbox-close" onClick={onClose} aria-label="Close preview">
        <X size={20} aria-hidden="true" />
      </Button>
      <img src={src} alt="" onClick={event => event.stopPropagation()} />
    </div>
  );
}
