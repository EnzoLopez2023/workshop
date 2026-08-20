import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Pencil, Clock, Layers, DollarSign, Gauge, Trash2, ExternalLink, FileText, X, Scissors,
  BookOpen, Droplets, Link2, Plus, Camera, ChevronUp, LayoutTemplate, Printer, Download, Check, Hammer,
} from 'lucide-react';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import {
  getProject, imageUrl, deleteProject,
  addBuildLogEntry, deleteBuildLogEntry, buildLogImageUrl,
  addFinishLogEntry, deleteFinishLogEntry,
  addProjectLink, removeProjectLink,
  listProjects, togglePurchased as apiTogglePurchased,
  saveAsTemplate,
} from '../services/api';
import type {
  ProjectDetail as Project, FinishLogEntry, ProjectListItem,
} from '../types/project';
import StatusBadge from '../components/StatusBadge';
import { ProjectDetailSkeleton } from '../components/Skeleton';
import { Button, PageFrame, StatePanel } from '../components/ui';
import { PROJECT_NEXT_ACTION, PROJECT_STATUS_ORDER } from '../lib/coreWorkflows';

export default function ProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; pdf: boolean } | null>(null);
  const [showCutPlan, setShowCutPlan] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Build log
  const [showBuildForm, setShowBuildForm] = useState(false);
  const [buildNote, setBuildNote] = useState('');
  const [buildFile, setBuildFile] = useState<File | null>(null);
  const [buildAdding, setBuildAdding] = useState(false);
  const buildFileRef = useRef<HTMLInputElement>(null);

  // Finish log
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [finishForm, setFinishForm] = useState({ product_name: '', finish_type: '', color: '', coats: '', notes: '', applied_at: new Date().toISOString().slice(0, 10) });
  const [finishAdding, setFinishAdding] = useState(false);

  // Linked projects
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
  const [linkProjectId, setLinkProjectId] = useState('');
  const [linkRelationship, setLinkRelationship] = useState('related');
  const [linkAdding, setLinkAdding] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getProject(projectId)
      .then(setProject)
      .catch(error => {
        console.error('Project load failed', error);
        setLoadError('Workshop could not load this project. Check the connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePurchased = async (matId: number, purchased: boolean) => {
    if (!project) return;
    setProject({ ...project, materials: project.materials.map(m => m.id === matId ? { ...m, purchased } : m) });
    try {
      await apiTogglePurchased(matId, purchased);
    } catch (err) {
      console.error(err);
      load();
    }
  };

  const handleAddBuildLog = async () => {
    if (!project || (!buildNote.trim() && !buildFile)) return;
    setBuildAdding(true);
    try {
      const entry = await addBuildLogEntry(project.id, buildNote.trim(), buildFile ?? undefined);
      setProject({ ...project, build_log: [entry, ...project.build_log] });
      setBuildNote(''); setBuildFile(null); setShowBuildForm(false);
      if (buildFileRef.current) buildFileRef.current.value = '';
      toast.success('Build note saved');
    } catch (err) { console.error(err); toast.error('Could not save note'); }
    setBuildAdding(false);
  };

  const handleDeleteBuildLog = async (id: number) => {
    if (!project) return;
    setProject({ ...project, build_log: project.build_log.filter(e => e.id !== id) });
    try {
      await deleteBuildLogEntry(id);
      toast.success('Note deleted');
    } catch (err) { console.error(err); load(); }
  };

  const handleAddFinishLog = async () => {
    if (!project || !finishForm.product_name.trim()) return;
    setFinishAdding(true);
    try {
      await addFinishLogEntry(project.id, {
        product_name: finishForm.product_name,
        finish_type: finishForm.finish_type || null,
        color: finishForm.color || null,
        coats: finishForm.coats ? Number(finishForm.coats) : null,
        notes: finishForm.notes || null,
        applied_at: finishForm.applied_at || new Date().toISOString().slice(0, 10),
      });
      load();
      setFinishForm({ product_name: '', finish_type: '', color: '', coats: '', notes: '', applied_at: new Date().toISOString().slice(0, 10) });
      setShowFinishForm(false);
      toast.success('Finish entry saved');
    } catch (err) { console.error(err); toast.error('Could not save entry'); }
    setFinishAdding(false);
  };

  const handleDeleteFinishLog = async (id: number) => {
    if (!project) return;
    setProject({ ...project, finish_log: project.finish_log.filter(e => e.id !== id) });
    try {
      await deleteFinishLogEntry(id);
      toast.success('Entry deleted');
    } catch (err) { console.error(err); load(); }
  };

  const handleOpenLinkForm = async () => {
    setShowLinkForm(true);
    if (allProjects.length === 0) {
      try { setAllProjects(await listProjects()); } catch (err) { console.error(err); }
    }
  };

  const handleAddLink = async () => {
    if (!project || !linkProjectId) return;
    setLinkAdding(true);
    try {
      await addProjectLink(project.id, Number(linkProjectId), linkRelationship);
      load();
      setLinkProjectId(''); setShowLinkForm(false);
      toast.success('Project linked');
    } catch (err) { console.error(err); toast.error('Could not link project'); }
    setLinkAdding(false);
  };

  const handleRemoveLink = async (id: number) => {
    if (!project) return;
    setProject({ ...project, links: project.links.filter(l => l.id !== id) });
    try {
      await removeProjectLink(id);
      toast.success('Link removed');
    } catch (err) { console.error(err); load(); }
  };

  const handleSaveAsTemplate = async () => {
    if (!project) return;
    try {
      await saveAsTemplate(project.id, project.title);
      setSavedAsTemplate(true);
      setTimeout(() => setSavedAsTemplate(false), 3000);
      toast.success('Saved as template');
    } catch (err) { console.error(err); toast.error('Could not save template'); }
  };

  const handleDelete = async () => {
    if (!project) return;
    setDeleting(true);
    try {
      await deleteProject(project.id);
      navigate('/');
    } catch (err) {
      console.error(err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) return <ProjectDetailSkeleton />;
  if (loadError) {
    return (
      <PageFrame maxWidth={900}>
        <StatePanel
          title="Project unavailable"
          description={loadError}
          tone="danger"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      </PageFrame>
    );
  }
  if (!project) {
    return (
      <PageFrame maxWidth={900}>
        <StatePanel title="Project not found" description="This project may have been deleted or the link is no longer valid." />
      </PageFrame>
    );
  }

  const sketches = project.images.filter(i => i.kind === 'sketch');
  const inspiration = project.images.filter(i => i.kind === 'inspiration');
  const heroImage = sketches.find(i => i.image_type !== 'application/pdf');

  return <ProjectDetailView project={project} heroImage={heroImage ?? null} sketches={sketches} inspiration={inspiration} onNavigate={navigate} setLightbox={setLightbox} lightbox={lightbox} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} deleting={deleting} savedAsTemplate={savedAsTemplate} showCutPlan={showCutPlan} setShowCutPlan={setShowCutPlan} showBuildForm={showBuildForm} setShowBuildForm={setShowBuildForm} buildNote={buildNote} setBuildNote={setBuildNote} buildFile={buildFile} setBuildFile={setBuildFile} buildAdding={buildAdding} buildFileRef={buildFileRef} showFinishForm={showFinishForm} setShowFinishForm={setShowFinishForm} finishForm={finishForm} setFinishForm={setFinishForm} finishAdding={finishAdding} showLinkForm={showLinkForm} setShowLinkForm={setShowLinkForm} allProjects={allProjects} linkProjectId={linkProjectId} setLinkProjectId={setLinkProjectId} linkRelationship={linkRelationship} setLinkRelationship={setLinkRelationship} linkAdding={linkAdding} projectId={projectId} handleAddBuildLog={handleAddBuildLog} handleDeleteBuildLog={handleDeleteBuildLog} handleAddFinishLog={handleAddFinishLog} handleDeleteFinishLog={handleDeleteFinishLog} handleOpenLinkForm={handleOpenLinkForm} handleAddLink={handleAddLink} handleRemoveLink={handleRemoveLink} handleSaveAsTemplate={handleSaveAsTemplate} handleDelete={handleDelete} togglePurchased={togglePurchased} />;
}

function ProjectDetailView({ project, heroImage, sketches, inspiration, onNavigate, setLightbox, lightbox, confirmDelete, setConfirmDelete, deleting, savedAsTemplate, showCutPlan, setShowCutPlan, showBuildForm, setShowBuildForm, buildNote, setBuildNote, buildFile, setBuildFile, buildAdding, buildFileRef, showFinishForm, setShowFinishForm, finishForm, setFinishForm, finishAdding, showLinkForm, setShowLinkForm, allProjects, linkProjectId, setLinkProjectId, linkRelationship, setLinkRelationship, linkAdding, projectId, handleAddBuildLog, handleDeleteBuildLog, handleAddFinishLog, handleDeleteFinishLog, handleOpenLinkForm, handleAddLink, handleRemoveLink, handleSaveAsTemplate, handleDelete, togglePurchased }: {
  project: import('../types/project').ProjectDetail;
  heroImage: import('../types/project').ProjectImage | null;
  sketches: import('../types/project').ProjectImage[];
  inspiration: import('../types/project').ProjectImage[];
  onNavigate: ReturnType<typeof useNavigate>;
  setLightbox: (v: { src: string; pdf: boolean } | null) => void;
  lightbox: { src: string; pdf: boolean } | null;
  confirmDelete: boolean; setConfirmDelete: (v: boolean) => void;
  deleting: boolean; savedAsTemplate: boolean;
  showCutPlan: boolean; setShowCutPlan: (v: (prev: boolean) => boolean) => void;
  showBuildForm: boolean; setShowBuildForm: (v: (prev: boolean) => boolean) => void;
  buildNote: string; setBuildNote: (v: string) => void;
  buildFile: File | null; setBuildFile: (v: File | null) => void;
  buildAdding: boolean;
  buildFileRef: React.RefObject<HTMLInputElement | null>;
  showFinishForm: boolean; setShowFinishForm: (v: (prev: boolean) => boolean) => void;
  finishForm: { product_name: string; finish_type: string; color: string; coats: string; notes: string; applied_at: string };
  setFinishForm: React.Dispatch<React.SetStateAction<{ product_name: string; finish_type: string; color: string; coats: string; notes: string; applied_at: string }>>;
  finishAdding: boolean;
  showLinkForm: boolean; setShowLinkForm: (v: boolean) => void;
  allProjects: import('../types/project').ProjectListItem[];
  linkProjectId: string; setLinkProjectId: (v: string) => void;
  linkRelationship: string; setLinkRelationship: (v: string) => void;
  linkAdding: boolean;
  projectId: number;
  handleAddBuildLog: () => Promise<void>;
  handleDeleteBuildLog: (id: number) => Promise<void>;
  handleAddFinishLog: () => Promise<void>;
  handleDeleteFinishLog: (id: number) => Promise<void>;
  handleOpenLinkForm: () => Promise<void>;
  handleAddLink: () => Promise<void>;
  handleRemoveLink: (id: number) => Promise<void>;
  handleSaveAsTemplate: () => Promise<void>;
  handleDelete: () => Promise<void>;
  togglePurchased: (matId: number, purchased: boolean) => Promise<void>;
}) {
  const navigate = onNavigate;
  const nextAction = PROJECT_NEXT_ACTION[project.status];
  const currentStage = PROJECT_STATUS_ORDER.indexOf(project.status);

  return (
    <>
      <PageFrame maxWidth={1000} className="project-detail-page">
        <div className="project-detail-toolbar">
          <Button variant="ghost" onClick={() => navigate('/')} className="workflow-back">
            <ArrowLeft size={16} aria-hidden="true" /> All projects
          </Button>
          <div className="project-detail-actions">
            <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}/edit`)}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Button>
            <Button variant="ghost" onClick={() => void handleSaveAsTemplate()} title="Save a reusable copy">
              <LayoutTemplate size={16} aria-hidden="true" />
              {savedAsTemplate ? 'Template saved' : 'Save as template'}
            </Button>
            {confirmDelete ? (
              <span className="inline-confirm" role="group" aria-label="Confirm project deletion">
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

        <section className="project-detail-hero" aria-labelledby="project-title">
          <div className="project-detail-hero-media">
            {heroImage ? (
              <img src={imageUrl(heroImage.id)} alt="" />
            ) : (
              <div className="project-plan-fallback" aria-hidden="true">
                <Hammer size={64} strokeWidth={1.3} />
              </div>
            )}
          </div>
          <div className="project-detail-tracing">
            <StatusBadge status={project.status} />
            <h1 id="project-title">{project.title}</h1>
            {project.description && <p className="project-detail-description">{project.description}</p>}

            {(project.source_url || project.cut_plan_url) && (
              <div className="project-reference-links">
                {project.source_url && (
                  <a href={project.source_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden="true" /> Original plans
                  </a>
                )}
                {project.cut_plan_url && (
                  <a href={project.cut_plan_url} target="_blank" rel="noreferrer">
                    <Scissors size={15} aria-hidden="true" /> OptiCutter plan
                  </a>
                )}
              </div>
            )}

            <dl className="project-detail-meta">
              <Stat icon={<Gauge size={15} />} label="Difficulty" value={project.difficulty} />
              <Stat icon={<Clock size={15} />} label="Shop time" value={`${project.estimated_hours} h`} />
              <Stat icon={<Layers size={15} />} label="Parts" value={String(project.parts_count)} />
              <Stat icon={<DollarSign size={15} />} label="Estimate" value={formatMoney(project.total_cost)} />
            </dl>

            <div className="stage-track" role="img" aria-label={`Project stage: ${project.status.replace('_', ' ')}`}>
              {PROJECT_STATUS_ORDER.map((status, index) => (
                <span
                  key={status}
                  className={index < currentStage ? 'is-complete' : index === currentStage ? 'is-current' : ''}
                >
                  <i aria-hidden="true" />
                  <b>{status === 'in_progress' ? 'Build' : status === 'completed' ? 'Done' : status}</b>
                </span>
              ))}
            </div>

            <div className="project-next-action">
              <span>
                <strong>{nextAction.title}</strong>
                <small>{nextAction.description}</small>
              </span>
              <Button variant="next" onClick={() => navigate(`/projects/${projectId}/edit`)}>
                {project.status === 'completed' ? 'Update project record' : 'Take the next step'}
              </Button>
            </div>
          </div>
        </section>

        <div className="project-detail-content">
        {(project.wood_types.length > 0 || project.tools_needed.length > 0) && (
          <div className="chip-groups board">
            <ChipGroup label="Wood" items={project.wood_types} />
            <ChipGroup label="Tools" items={project.tools_needed} />
          </div>
        )}

        {/* Sketches */}
        {sketches.length > 0 && (
          <Section title="Sketches & Plans">
            <ImageGrid>
              {sketches.map(img => {
                const isPdf = img.image_type === 'application/pdf';
                const src = imageUrl(img.id);
                if (isPdf) {
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightbox({ src, pdf: true })}
                      className="document-tile"
                    >
                      <FileText size={36} />
                      <span>Open PDF</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={img.id}
                    onClick={() => setLightbox({ src, pdf: false })}
                    type="button"
                    className="media-gallery-item"
                    aria-label="Open sketch preview"
                  >
                    <img src={src} alt="Sketch" />
                  </button>
                );
              })}
            </ImageGrid>
          </Section>
        )}

        {/* Inspiration */}
        {inspiration.length > 0 && (
          <Section title="Inspiration">
            <ImageGrid>
              {inspiration.map(img => {
                const src = img.image_url ?? imageUrl(img.id);
                return (
                  <button
                    key={img.id}
                    onClick={() => setLightbox({ src, pdf: false })}
                    type="button"
                    className="media-gallery-item"
                    aria-label="Open inspiration preview"
                  >
                    <img src={src} alt="Inspiration" />
                  </button>
                );
              })}
            </ImageGrid>
          </Section>
        )}

        {/* Cut List */}
        {project.cut_list.length > 0 && (
          <Section title="Cut List" right={
            <div className="workflow-section-actions">
              <button className="btn btn-ghost" onClick={() => printCutList(project)}>
                <Printer size={13} />
                <span className="header-nav-label">Print</span>
              </button>
              <button className="btn btn-ghost" onClick={() => exportCutListCsv(project)}>
                <Download size={13} />
                <span className="header-nav-label">CSV</span>
              </button>
            </div>
          }>
            <div className="card table-scroll workflow-table-wrap">
              <table className="workflow-table">
                <thead>
                  <tr>
                    <Th>PART</Th>
                    <Th>QTY</Th>
                    <Th>DIMENSIONS (L × W × T)</Th>
                    <Th>MATERIAL</Th>
                  </tr>
                </thead>
                <tbody>
                  {project.cut_list.map(c => (
                    <tr key={c.id}>
                      <Td>{c.part_name}</Td>
                      <Td>{c.qty}</Td>
                      <Td muted>
                        {formatDims(c.length, c.width, c.thickness)}
                      </Td>
                      <Td>{c.material ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Cut Plan Optimizer */}
        {project.cut_list.length > 0 && (
          <section className="workflow-section">
            <div className={`rail ${showCutPlan ? 'rail-with-content' : ''}`}>
              <Scissors size={13} />
              <h2>Cut Plan Optimizer</h2>
              <div className="rail-actions">
                <button className="btn btn-ghost" onClick={() => setShowCutPlan(v => !v)}>
                  {showCutPlan ? 'Hide' : 'Plan Cuts'}
                </button>
              </div>
            </div>
            {showCutPlan && <CutPlanOptimizer cutList={project.cut_list} projectId={projectId} />}
          </section>
        )}

        {/* Materials */}
        {project.materials.length > 0 && (
          <Section
            title="Materials & Hardware"
            right={
              <div className="material-section-summary">
                <span>
                  Total <strong>{formatMoney(project.total_cost)}</strong>
                </span>
                <button className="btn btn-ghost" onClick={() => exportMaterialsCsv(project)}>
                  <Download size={13} />
                  <span className="header-nav-label">CSV</span>
                </button>
              </div>
            }
          >
            <div className="card material-list">
              {project.materials.map(m => (
                <label
                  key={m.id}
                  className={`material-row ${m.purchased ? 'is-purchased' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={m.purchased}
                    onChange={e => togglePurchased(m.id, e.target.checked)}
                  />
                  <div className="material-row-copy">
                    <strong>{m.name}</strong>
                    {m.qty_label && (
                      <small>{m.qty_label}</small>
                    )}
                  </div>
                  <span className="material-row-cost">{formatMoney(m.cost)}</span>
                  {m.purchased && <Check size={16} strokeWidth={3} className="material-row-check" />}
                </label>
              ))}
            </div>
          </Section>
        )}

        {/* Finish Log */}
        <Section
          title="Finish Log"
          icon={<Droplets size={16} />}
          right={
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (showFinishForm) setFinishForm({ product_name: '', finish_type: '', color: '', coats: '', notes: '', applied_at: new Date().toISOString().slice(0, 10) });
                setShowFinishForm(v => !v);
              }}
            >
              {showFinishForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showFinishForm ? 'Cancel' : 'Add Entry'}
            </button>
          }
        >
          {showFinishForm && (
            <div className="card inline-editor">
              <div className="finish-form-grid form-grid">
                <FieldGroup>
                  <label className="label">Product Name *</label>
                  <input value={finishForm.product_name} onChange={e => setFinishForm(f => ({ ...f, product_name: e.target.value }))} placeholder="e.g. Minwax Early American" />
                </FieldGroup>
                <FieldGroup>
                  <label className="label">Type</label>
                  <select value={finishForm.finish_type} onChange={e => setFinishForm(f => ({ ...f, finish_type: e.target.value }))}>
                    <option value="">— select —</option>
                    {['Stain', 'Oil', 'Wax', 'Varnish', 'Lacquer', 'Sealant', 'Primer', 'Paint', 'Other'].map(t => <option key={t} value={t.toLowerCase()}>{t}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup>
                  <label className="label">Color</label>
                  <input value={finishForm.color} onChange={e => setFinishForm(f => ({ ...f, color: e.target.value }))} placeholder="e.g. Early American" />
                </FieldGroup>
                <FieldGroup>
                  <label className="label">Coats</label>
                  <input type="number" min={1} value={finishForm.coats} onChange={e => setFinishForm(f => ({ ...f, coats: e.target.value }))} placeholder="2" />
                </FieldGroup>
                <FieldGroup>
                  <label className="label">Date Applied</label>
                  <input type="date" value={finishForm.applied_at} onChange={e => setFinishForm(f => ({ ...f, applied_at: e.target.value }))} />
                </FieldGroup>
                <FieldGroup>
                  <label className="label">Notes</label>
                  <input value={finishForm.notes} onChange={e => setFinishForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
                </FieldGroup>
              </div>
              <button className="btn btn-primary inline-editor-submit" onClick={handleAddFinishLog} disabled={finishAdding || !finishForm.product_name.trim()}>
                {finishAdding ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          )}
          {project.finish_log.length === 0 && !showFinishForm ? (
            <p className="section-placeholder">No finish entries yet.</p>
          ) : (
            <div className="card">
              {project.finish_log.map((entry, i) => (
                <FinishLogRow key={entry.id} entry={entry} borderTop={i > 0} onDelete={() => handleDeleteFinishLog(entry.id)} />
              ))}
            </div>
          )}
        </Section>

        {/* Build Log */}
        <Section
          title="Build Log"
          icon={<BookOpen size={16} />}
          right={
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (showBuildForm) { setBuildNote(''); setBuildFile(null); if (buildFileRef.current) buildFileRef.current.value = ''; }
                setShowBuildForm(v => !v);
              }}
            >
              {showBuildForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showBuildForm ? 'Cancel' : 'Add Note'}
            </button>
          }
        >
          {showBuildForm && (
            <div className="card inline-editor">
              <label className="label">Note</label>
              <textarea
                value={buildNote}
                onChange={e => setBuildNote(e.target.value)}
                placeholder="Cut all the legs to length… First coat looks great…"
                className="inline-editor-textarea"
              />
              <div className="attachment-control">
                <label className="attachment-picker">
                  <Camera size={14} />
                  {buildFile ? buildFile.name : 'Attach photo'}
                  <input ref={buildFileRef} type="file" accept="image/*" className="sr-only" onChange={e => setBuildFile(e.target.files?.[0] ?? null)} />
                </label>
                {buildFile && <button className="text-action" onClick={() => { setBuildFile(null); if (buildFileRef.current) buildFileRef.current.value = ''; }}><X size={12} strokeWidth={2.5} /> Remove</button>}
              </div>
              <button className="btn btn-primary inline-editor-submit" onClick={handleAddBuildLog} disabled={buildAdding || (!buildNote.trim() && !buildFile)}>
                {buildAdding ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          )}
          {project.build_log.length === 0 && !showBuildForm ? (
            <p className="section-placeholder">No build notes yet. Document your progress here.</p>
          ) : (
            <div className="build-log-list">
              {project.build_log.map(entry => (
                <article key={entry.id} className="card build-log-entry">
                  <div className="build-log-entry-copy">
                    <time className="build-log-date" dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </time>
                    {entry.note && <p>{entry.note}</p>}
                    {entry.file_path && (
                      <button
                        onClick={() => setLightbox({ src: buildLogImageUrl(entry.id), pdf: false })}
                        className="build-log-image"
                        aria-label="Open build photo"
                      >
                        <img src={buildLogImageUrl(entry.id)} alt="Build progress" />
                      </button>
                    )}
                  </div>
                  <button className="icon-button" aria-label="Delete build note" onClick={() => handleDeleteBuildLog(entry.id)}>
                    <Trash2 size={13} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </Section>

        {/* Linked Projects */}
        <Section
          title="Linked Projects"
          icon={<Link2 size={16} />}
          right={
            <button className="btn btn-ghost" onClick={showLinkForm ? () => setShowLinkForm(false) : handleOpenLinkForm}>
              {showLinkForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showLinkForm ? 'Cancel' : 'Link Project'}
            </button>
          }
        >
          {showLinkForm && (
            <div className="card inline-editor link-editor">
              <FieldGroup className="link-editor-project">
                <label className="label">Project</label>
                <select value={linkProjectId} onChange={e => setLinkProjectId(e.target.value)}>
                  <option value="">— select a project —</option>
                  {allProjects.filter(p => p.id !== project.id).map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </FieldGroup>
              <FieldGroup>
                <label className="label">Relationship</label>
                <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}>
                  {['related', 'parent', 'child', 'sequel', 'variant'].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </FieldGroup>
              <button className="btn btn-primary" onClick={handleAddLink} disabled={linkAdding || !linkProjectId}>
                {linkAdding ? 'Linking…' : 'Link'}
              </button>
            </div>
          )}
          {project.links.length === 0 && !showLinkForm ? (
            <p className="section-placeholder">No linked projects.</p>
          ) : (
            <div className="card linked-project-list">
              {project.links.map(link => (
                <div key={link.id} className="linked-project-row">
                  <Link2 size={13} />
                  <span className="linked-project-title">{link.linked_title}</span>
                  <span className="linked-project-relationship">{link.relationship}</span>
                  <StatusBadge status={link.linked_status} />
                  <button className="icon-button" aria-label={`Unlink ${link.linked_title}`} onClick={() => handleRemoveLink(link.id)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Footer tag */}
        <div className="board-plate">Measure twice &middot; Cut once</div>
        </div>
      </PageFrame>
      {lightbox && <Lightbox src={lightbox.src} pdf={lightbox.pdf} onClose={() => setLightbox(null)} />}
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="stat-label">
        {icon}
        {label}
      </dt>
      <dd className="stat-value">{value}</dd>
    </div>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return <div />;
  return (
    <div className="chip-group">
      <div className="rail">{label}</div>
      <div className="chip-group-items">
        {items.map((x, i) => <span key={i} className="chip">{x}</span>)}
      </div>
    </div>
  );
}

function Section({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="workflow-section" aria-labelledby={id}>
      <div className="rail">
        {icon}
        <h2 id={id}>{title}</h2>
        {right && <div className="rail-actions">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/* Lamp glass, one colour per finish class — saturated so a 10px square still
   reads as a lit signal rather than a smudge. */
const FINISH_TYPE_COLORS: Record<string, string> = {
  stain: '#A85A2A', oil: '#D69A2E', wax: '#C9B45A', varnish: '#B8792C',
  lacquer: '#5590B5', sealant: '#3F8A64', primer: '#8A9A98', paint: '#8A78B8', other: '#6E5F9E',
};

function FinishLogRow({ entry, borderTop, onDelete }: { entry: FinishLogEntry; borderTop: boolean; onDelete: () => void }) {
  return (
    <div className={`finish-log-row ${borderTop ? 'has-divider' : ''}`}>
      {entry.finish_type && (
        <span className="finish-log-color" style={{ backgroundColor: FINISH_TYPE_COLORS[entry.finish_type] ?? 'var(--color-muted)' }} />
      )}
      <div className="finish-log-copy">
        <strong>{entry.product_name}</strong>
        <div>
          {entry.finish_type && <span className="text-capitalize">{entry.finish_type}</span>}
          {entry.color && <span>· {entry.color}</span>}
          {entry.coats != null && <span>· {entry.coats} coat{entry.coats !== 1 ? 's' : ''}</span>}
          {entry.notes && <span>· {entry.notes}</span>}
        </div>
      </div>
      <time dateTime={entry.applied_at}>
        {new Date(entry.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </time>
      <button className="icon-button" aria-label={`Delete ${entry.product_name} finish entry`} onClick={onDelete}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function ImageGrid({ children }: { children: React.ReactNode }) {
  return <div className="media-gallery">{children}</div>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th>{children}</th>;
}

function Td({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <td className={muted ? 'is-muted' : undefined}>{children}</td>;
}

function FieldGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`form-field ${className}`.trim()}>{children}</div>;
}

function formatMoney(n: number) {
  return `$${(n || 0).toFixed(2)}`;
}

function formatDims(l: string | null, w: string | null, t: string | null) {
  const parts = [l, w, t].filter(Boolean);
  return parts.length > 0 ? parts.join(' × ') : '—';
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCutListCsv(project: import('../types/project').ProjectDetail) {
  const lines = ['Part,Qty,Length,Width,Thickness,Material'];
  for (const c of project.cut_list) {
    lines.push(`"${c.part_name}",${c.qty},"${c.length ?? ''}","${c.width ?? ''}","${c.thickness ?? ''}","${c.material ?? ''}"`);
  }
  downloadCsv(lines.join('\n'), `${project.title.replace(/[^a-z0-9]/gi, '-')}-cut-list.csv`);
}

function exportMaterialsCsv(project: import('../types/project').ProjectDetail) {
  const lines = ['Name,Qty,Cost,Purchased'];
  for (const m of project.materials) {
    lines.push(`"${m.name}","${m.qty_label ?? ''}",${m.cost ?? 0},${m.purchased ? 'Yes' : 'No'}`);
  }
  downloadCsv(lines.join('\n'), `${project.title.replace(/[^a-z0-9]/gi, '-')}-materials.csv`);
}

function printCutList(project: import('../types/project').ProjectDetail) {
  const totalQty = project.cut_list.reduce((s, c) => s + (c.qty || 0), 0);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const rows = project.cut_list.map(c => `
    <tr>
      <td>${escHtml(c.part_name)}</td>
      <td>${c.qty}</td>
      <td class="dim">${escHtml(formatDims(c.length, c.width, c.thickness))}</td>
      <td class="mat">${escHtml(c.material ?? '—')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(project.title)} — Cut List</title>
<style>
  @page { size: letter portrait; margin: 0.7in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         font-size: 1rem; color: #15332E; margin: 0; }
  .brand { border-bottom: 2px solid #125447; padding-bottom: 10px; margin-bottom: 4px; }
  .brand::after { content: ''; display: block; height: 1px; background: #C9DAD5; margin-top: 3px; }
  h1 { font-size: 1.22rem; font-weight: 700; margin: 0 0 5px; letter-spacing: -0.025em; }
  .meta { font-size: 0.76rem; color: #58716B; letter-spacing: 0.015em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th { text-align: left; padding: 7px 10px; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.015em;
       color: #F7FCFA; background: #125447; text-transform: uppercase; }
  td { padding: 9px 10px; border-bottom: 1px solid #C9DAD5; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #EEF4F2; }
  .dim { color: #58716B; }
  .mat { color: #995D08; }
  tfoot td { font-weight: 700; border-top: 2px solid #125447; border-bottom: none; background: none;
             text-transform: uppercase; letter-spacing: 0.015em; }
  .plate { margin-top: 26px; font-size: 0.76rem; letter-spacing: 0.015em; color: #58716B; text-transform: uppercase; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="brand"><h1>${escHtml(project.title)}</h1><div class="meta">Cut List &middot; ${escHtml(date)} &middot; ${project.cut_list.length} parts</div></div>
<table>
  <thead><tr><th>PART</th><th>QTY</th><th>DIMENSIONS (L &times; W &times; T)</th><th>MATERIAL</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>Total</td><td>${totalQty} pcs</td><td></td><td></td></tr></tfoot>
</table>
<div class="plate">Measure twice &middot; Cut once</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { toast.error('Pop-up blocked — allow pop-ups and try again'); return; }
  win.document.write(html);
  win.document.close();
}

function Lightbox({ src, pdf, onClose }: { src: string; pdf?: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus management: remember the previously-focused element, focus the close
  // button on open, restore focus on close. Trap Tab inside the dialog so
  // keyboard users can't escape to the page behind.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // Only one focusable control (the close button) — trap by keeping it focused.
      e.preventDefault();
      closeRef.current?.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pdf ? 'PDF preview' : 'Image preview'}
      onClick={onClose}
      onKeyDown={onKeyDown}
      className="media-lightbox"
    >
      <button
        ref={closeRef}
        onClick={onClose}
        aria-label="Close preview"
        className="icon-button media-lightbox-close"
      >
        <X size={18} />
      </button>
      {pdf ? (
        <iframe
          src={src}
          title="PDF preview"
          onClick={e => e.stopPropagation()}
          className="media-lightbox-document"
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={e => e.stopPropagation()}
        />
      )}
    </div>
  );
}
