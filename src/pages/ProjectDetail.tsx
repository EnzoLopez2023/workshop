import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowLeft, Pencil, Clock, Layers, DollarSign, Gauge, Trash2, ExternalLink, FileText, X, Scissors,
  BookOpen, Droplets, Link2, Plus, Camera, ChevronUp, LayoutTemplate, Printer, Download, Check,
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

export default function ProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
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

  const load = () => {
    setLoading(true);
    getProject(projectId)
      .then(setProject)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId]);

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
  if (!project) return <div className="empty-state">Project not found</div>;

  const sketches = project.images.filter(i => i.kind === 'sketch');
  const inspiration = project.images.filter(i => i.kind === 'inspiration');
  const heroImage = sketches.find(i => i.image_type !== 'application/pdf');

  return <ProjectDetailView project={project} heroImage={heroImage ?? null} sketches={sketches} inspiration={inspiration} onNavigate={navigate} onLoad={load} setLightbox={setLightbox} lightbox={lightbox} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} deleting={deleting} savedAsTemplate={savedAsTemplate} showCutPlan={showCutPlan} setShowCutPlan={setShowCutPlan} showBuildForm={showBuildForm} setShowBuildForm={setShowBuildForm} buildNote={buildNote} setBuildNote={setBuildNote} buildFile={buildFile} setBuildFile={setBuildFile} buildAdding={buildAdding} buildFileRef={buildFileRef} showFinishForm={showFinishForm} setShowFinishForm={setShowFinishForm} finishForm={finishForm} setFinishForm={setFinishForm} finishAdding={finishAdding} showLinkForm={showLinkForm} setShowLinkForm={setShowLinkForm} allProjects={allProjects} linkProjectId={linkProjectId} setLinkProjectId={setLinkProjectId} linkRelationship={linkRelationship} setLinkRelationship={setLinkRelationship} linkAdding={linkAdding} projectId={projectId} handleAddBuildLog={handleAddBuildLog} handleDeleteBuildLog={handleDeleteBuildLog} handleAddFinishLog={handleAddFinishLog} handleDeleteFinishLog={handleDeleteFinishLog} handleOpenLinkForm={handleOpenLinkForm} handleAddLink={handleAddLink} handleRemoveLink={handleRemoveLink} handleSaveAsTemplate={handleSaveAsTemplate} handleDelete={handleDelete} togglePurchased={togglePurchased} />;
}

function ProjectDetailView({ project, heroImage, sketches, inspiration, onNavigate, onLoad: _onLoad, setLightbox, lightbox, confirmDelete, setConfirmDelete, deleting, savedAsTemplate, showCutPlan, setShowCutPlan, showBuildForm, setShowBuildForm, buildNote, setBuildNote, buildFile, setBuildFile, buildAdding, buildFileRef, showFinishForm, setShowFinishForm, finishForm, setFinishForm, finishAdding, showLinkForm, setShowLinkForm, allProjects, linkProjectId, setLinkProjectId, linkRelationship, setLinkRelationship, linkAdding, projectId, handleAddBuildLog, handleDeleteBuildLog, handleAddFinishLog, handleDeleteFinishLog, handleOpenLinkForm, handleAddLink, handleRemoveLink, handleSaveAsTemplate, handleDelete, togglePurchased }: {
  project: import('../types/project').ProjectDetail;
  heroImage: import('../types/project').ProjectImage | null;
  sketches: import('../types/project').ProjectImage[];
  inspiration: import('../types/project').ProjectImage[];
  onNavigate: ReturnType<typeof useNavigate>;
  onLoad: () => void;
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
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroImgY = useTransform(scrollYProgress, [0, 1], ['0%', '22%']);
  const heroOverlayOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const navigate = onNavigate;

  return (
    <div style={{ position: 'relative', paddingBottom: 80 }}>
      {/* Hero banner */}
      <div
        ref={heroRef}
        style={{
          position: 'relative', width: '100%',
          height: heroImage ? 380 : 66,
          backgroundColor: heroImage ? 'var(--color-flap-shade)' : 'transparent',
          borderBottom: heroImage ? '1px solid var(--color-steel-dark)' : 'none',
          overflow: heroImage ? 'hidden' : 'visible',
        }}
      >
        {heroImage && (
          <motion.img
            src={imageUrl(heroImage.id)}
            alt={project.title}
            style={{ width: '100%', height: '115%', objectFit: 'cover', y: heroImgY }}
          />
        )}
        <motion.div
          style={{
            position: 'absolute', inset: 0,
            background: heroImage
              ? 'linear-gradient(180deg, rgb(0 0 0 / 0.05) 0%, var(--color-concourse) 100%)'
              : 'transparent',
            opacity: heroOverlayOpacity,
          }}
        />

        <button
          onClick={() => navigate('/')}
          className="btn btn-ghost"
          style={heroImage
            ? { position: 'absolute', top: 20, left: 40, zIndex: 2, background: 'var(--color-flap)' }
            : { position: 'absolute', top: 22, left: 40, zIndex: 3 }}
        >
          <ArrowLeft size={15} />
          All Projects
        </button>
      </div>

      <div className="detail-container">
        {/* Floating meta card */}
        <div
          className="card"
          style={{
            marginTop: heroImage ? -120 : 20,
            padding: '28px 32px',
            position: 'relative', zIndex: 2,
            boxShadow: 'var(--shadow-card-hover)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <StatusBadge status={project.status} />
              <h1 style={{
                margin: '12px 0 0', fontFamily: 'var(--font-board)',
                fontSize: '2.4rem', fontWeight: 700, letterSpacing: '-0.02em',
              }}>
                {project.title}
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => navigate(`/projects/${projectId}/edit`)}>
                <Pencil size={14} />
                Edit
              </button>
              <button className="btn btn-ghost" onClick={handleSaveAsTemplate} title="Save a copy as a reusable template" style={{ fontSize: '0.82rem' }}>
                <LayoutTemplate size={13} />
                {savedAsTemplate ? 'Saved as template' : 'Save as Template'}
              </button>
              {confirmDelete ? (
                <>
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-amber)', whiteSpace: 'nowrap' }}>
                    Delete this project?
                  </span>
                  <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{ gap: 6, color: 'var(--color-amber)' }}
                  >
                    <Trash2 size={13} />
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmDelete(true)}
                  style={{ color: 'var(--color-amber)' }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>
          </div>

          {project.description && (
            <p style={{
              margin: '12px 0 0', color: 'var(--color-muted)',
              lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {project.description}
            </p>
          )}

          {(project.source_url || project.cut_plan_url) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
              {project.source_url && (
                <a
                  href={project.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', textDecoration: 'none' }}
                >
                  <ExternalLink size={13} />
                  View original plans
                </a>
              )}
              {project.cut_plan_url && (
                <a
                  href={project.cut_plan_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', textDecoration: 'none' }}
                >
                  <Scissors size={13} />
                  OptiCutter cut plan
                </a>
              )}
            </div>
          )}

          <div className="stat-grid" style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20, marginTop: 24, paddingTop: 22,
            borderTop: '1px solid var(--color-line)',
          }}>
            <Stat icon={<Gauge size={14} />} label="Difficulty" value={project.difficulty.replace('_', ' ').toUpperCase()} />
            <Stat icon={<Clock size={14} />} label="Est. Hours" value={`${project.estimated_hours}h`} />
            <Stat icon={<Layers size={14} />} label="Parts" value={String(project.parts_count)} />
            <Stat icon={<DollarSign size={14} />} label="Est. Cost" value={formatMoney(project.total_cost)} />
          </div>
        </div>

        {/* Wood + Tools chips */}
        {(project.wood_types.length > 0 || project.tools_needed.length > 0) && (
          <div className="chip-groups board" style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 0, marginTop: 26, marginBottom: 34,
          }}>
            <ChipGroup label="WOOD" items={project.wood_types} />
            <ChipGroup label="TOOLS" items={project.tools_needed} />
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
                      style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 10,
                        width: '100%', aspectRatio: '1', borderRadius: 3,
                        backgroundColor: 'var(--color-flap-shade)',
                        border: '1px solid var(--color-line)',
                        color: 'var(--color-ink)',
                        padding: 12, textAlign: 'center', cursor: 'zoom-in',
                        font: 'inherit',
                      }}
                    >
                      <FileText size={36} style={{ color: 'var(--color-amber)' }} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Open PDF</span>
                    </button>
                  );
                }
                return (
                  <img
                    key={img.id}
                    src={src}
                    alt="Sketch"
                    onClick={() => setLightbox({ src, pdf: false })}
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 3, cursor: 'zoom-in' }}
                  />
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
                  <img
                    key={img.id}
                    src={src}
                    alt="Inspiration"
                    onClick={() => setLightbox({ src, pdf: false })}
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 3, cursor: 'zoom-in' }}
                  />
                );
              })}
            </ImageGrid>
          </Section>
        )}

        {/* Cut List */}
        {project.cut_list.length > 0 && (
          <Section title="Cut List" right={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost" onClick={() => printCutList(project)} style={{ fontSize: '0.8rem', padding: '7px 11px' }}>
                <Printer size={13} />
                <span className="header-nav-label">Print</span>
              </button>
              <button className="btn btn-ghost" onClick={() => exportCutListCsv(project)} style={{ fontSize: '0.8rem', padding: '7px 11px' }}>
                <Download size={13} />
                <span className="header-nav-label">CSV</span>
              </button>
            </div>
          }>
            <div className="card table-scroll" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
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
                    <tr key={c.id} style={{ borderTop: '1px solid var(--color-line)' }}>
                      <Td>{c.part_name}</Td>
                      <Td>{c.qty}</Td>
                      <Td style={{ color: 'var(--color-muted)' }}>
                        {formatDims(c.length, c.width, c.thickness)}
                      </Td>
                      <Td style={{ color: 'var(--color-ink)' }}>{c.material ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Cut Plan Optimizer */}
        {project.cut_list.length > 0 && (
          <section style={{ marginBottom: 34 }}>
            <div className="rail" style={{ marginBottom: showCutPlan ? 14 : 0 }}>
              <Scissors size={13} />
              <h2 style={{ margin: 0, font: 'inherit', letterSpacing: 'inherit' }}>Cut Plan Optimizer</h2>
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
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: 'rgb(237 241 238 / 0.66)' }}>
                  Total <strong className="readout" style={{ color: 'var(--color-amber-fill)', fontSize: '0.7rem' }}>{formatMoney(project.total_cost)}</strong>
                </span>
                <button className="btn btn-ghost" onClick={() => exportMaterialsCsv(project)} style={{ fontSize: '0.8rem', padding: '7px 11px' }}>
                  <Download size={13} />
                  <span className="header-nav-label">CSV</span>
                </button>
              </div>
            }
          >
            <div className="card">
              {project.materials.map((m, i) => (
                <label
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--color-line)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={m.purchased}
                    onChange={e => togglePurchased(m.id, e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--color-steel)', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontWeight: 500,
                      textDecoration: m.purchased ? 'line-through' : 'none',
                      color: m.purchased ? 'var(--color-muted)' : 'var(--color-ink)',
                    }}>
                      {m.name}
                    </div>
                    {m.qty_label && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginTop: 2 }}>
                        {m.qty_label}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: m.purchased ? 'var(--color-muted)' : 'var(--color-ink)',
                    textDecoration: m.purchased ? 'line-through' : 'none',
                  }}>
                    {formatMoney(m.cost)}
                  </div>
                  {m.purchased && <Check size={13} strokeWidth={3} style={{ color: 'var(--color-green)', flexShrink: 0 }} />}
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
              style={{ fontSize: '0.82rem' }}
            >
              {showFinishForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showFinishForm ? 'Cancel' : 'Add Entry'}
            </button>
          }
        >
          {showFinishForm && (
            <div className="card" style={{ padding: '20px 22px', marginBottom: 16 }}>
              <div className="finish-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label">Product Name *</label>
                  <input value={finishForm.product_name} onChange={e => setFinishForm(f => ({ ...f, product_name: e.target.value }))} placeholder="e.g. Minwax Early American" />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select value={finishForm.finish_type} onChange={e => setFinishForm(f => ({ ...f, finish_type: e.target.value }))}>
                    <option value="">— select —</option>
                    {['Stain', 'Oil', 'Wax', 'Varnish', 'Lacquer', 'Sealant', 'Primer', 'Paint', 'Other'].map(t => <option key={t} value={t.toLowerCase()}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Color</label>
                  <input value={finishForm.color} onChange={e => setFinishForm(f => ({ ...f, color: e.target.value }))} placeholder="e.g. Early American" />
                </div>
                <div>
                  <label className="label">Coats</label>
                  <input type="number" min={1} value={finishForm.coats} onChange={e => setFinishForm(f => ({ ...f, coats: e.target.value }))} placeholder="2" />
                </div>
                <div>
                  <label className="label">Date Applied</label>
                  <input type="date" value={finishForm.applied_at} onChange={e => setFinishForm(f => ({ ...f, applied_at: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Notes</label>
                  <input value={finishForm.notes} onChange={e => setFinishForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleAddFinishLog} disabled={finishAdding || !finishForm.product_name.trim()} style={{ marginTop: 14 }}>
                {finishAdding ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          )}
          {project.finish_log.length === 0 && !showFinishForm ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', margin: 0 }}>No finish entries yet.</p>
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
              style={{ fontSize: '0.82rem' }}
            >
              {showBuildForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showBuildForm ? 'Cancel' : 'Add Note'}
            </button>
          }
        >
          {showBuildForm && (
            <div className="card" style={{ padding: '20px 22px', marginBottom: 16 }}>
              <label className="label">Note</label>
              <textarea
                value={buildNote}
                onChange={e => setBuildNote(e.target.value)}
                placeholder="Cut all the legs to length… First coat looks great…"
                style={{ marginBottom: 12 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--color-muted)', cursor: 'pointer' }}>
                  <Camera size={14} />
                  {buildFile ? buildFile.name : 'Attach photo'}
                  <input ref={buildFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setBuildFile(e.target.files?.[0] ?? null)} />
                </label>
                {buildFile && <button onClick={() => { setBuildFile(null); if (buildFileRef.current) buildFileRef.current.value = ''; }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} strokeWidth={2.5} /> Remove</button>}
              </div>
              <button className="btn btn-primary" onClick={handleAddBuildLog} disabled={buildAdding || (!buildNote.trim() && !buildFile)} style={{ marginTop: 14 }}>
                {buildAdding ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          )}
          {project.build_log.length === 0 && !showBuildForm ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', margin: 0 }}>No build notes yet. Document your progress here.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {project.build_log.map(entry => (
                <div key={entry.id} className="card" style={{ padding: '16px 20px', display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="board-caps" style={{ fontSize: '0.6rem', letterSpacing: '0.12em', color: 'var(--color-muted)', marginBottom: 7 }}>
                      {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    {entry.note && <p style={{ margin: '0 0 10px', fontSize: '0.93rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.note}</p>}
                    {entry.file_path && (
                      <img
                        src={buildLogImageUrl(entry.id)}
                        alt="Build photo"
                        onClick={() => setLightbox({ src: buildLogImageUrl(entry.id), pdf: false })}
                        style={{ maxWidth: 280, maxHeight: 200, objectFit: 'cover', borderRadius: 3, cursor: 'zoom-in', display: 'block' }}
                      />
                    )}
                  </div>
                  <button onClick={() => handleDeleteBuildLog(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', flexShrink: 0, alignSelf: 'flex-start', padding: 4 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Linked Projects */}
        <Section
          title="Linked Projects"
          icon={<Link2 size={16} />}
          right={
            <button className="btn btn-ghost" onClick={showLinkForm ? () => setShowLinkForm(false) : handleOpenLinkForm} style={{ fontSize: '0.82rem' }}>
              {showLinkForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showLinkForm ? 'Cancel' : 'Link Project'}
            </button>
          }
        >
          {showLinkForm && (
            <div className="card" style={{ padding: '18px 22px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 160 }}>
                <label className="label">Project</label>
                <select value={linkProjectId} onChange={e => setLinkProjectId(e.target.value)}>
                  <option value="">— select a project —</option>
                  {allProjects.filter(p => p.id !== project.id).map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label className="label">Relationship</label>
                <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}>
                  {['related', 'parent', 'child', 'sequel', 'variant'].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={handleAddLink} disabled={linkAdding || !linkProjectId} style={{ flexShrink: 0 }}>
                {linkAdding ? 'Linking…' : 'Link'}
              </button>
            </div>
          )}
          {project.links.length === 0 && !showLinkForm ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', margin: 0 }}>No linked projects.</p>
          ) : (
            <div className="card">
              {project.links.map((link, i) => (
                <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: i > 0 ? '1px solid var(--color-line)' : 'none' }}>
                  <Link2 size={13} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem' }}>{link.linked_title}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', background: 'var(--color-flap-shade)', padding: '2px 8px', borderRadius: 2 }}>{link.relationship}</span>
                  <StatusBadge status={link.linked_status} />
                  <button onClick={() => handleRemoveLink(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 4 }}>
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

      {lightbox && <Lightbox src={lightbox.src} pdf={lightbox.pdf} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        {label}
      </div>
      <div className="stat-value" style={{ fontSize: '1.25rem' }}>
        {value}
      </div>
    </div>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return <div />;
  return (
    <div style={{ borderLeft: '1px solid var(--color-line)', marginLeft: -1 }}>
      <div className="rail">{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '14px 16px' }}>
        {items.map((x, i) => <span key={i} className="chip">{x}</span>)}
      </div>
    </div>
  );
}

function Section({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <div className="rail" style={{ marginBottom: 14 }}>
        {icon}
        <h2 style={{ margin: 0, font: 'inherit', letterSpacing: 'inherit' }}>{title}</h2>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderTop: borderTop ? '1px solid var(--color-line)' : 'none' }}>
      {entry.finish_type && (
        <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, backgroundColor: FINISH_TYPE_COLORS[entry.finish_type] ?? 'var(--color-muted)' }} />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{entry.product_name}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
          {entry.finish_type && <span style={{ textTransform: 'capitalize' }}>{entry.finish_type}</span>}
          {entry.color && <span>· {entry.color}</span>}
          {entry.coats != null && <span>· {entry.coats} coat{entry.coats !== 1 ? 's' : ''}</span>}
          {entry.notes && <span>· {entry.notes}</span>}
        </div>
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', flexShrink: 0 }}>
        {new Date(entry.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 4 }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function ImageGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 12,
    }}>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: 'left', padding: '14px 20px',
      fontSize: '0.72rem', fontWeight: 700,
      letterSpacing: '0.08em', color: 'var(--color-muted)',
    }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '14px 20px', ...style }}>
      {children}
    </td>
  );
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
  body { font-family: ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace;
         font-size: 10.5px; color: #14181A; margin: 0; }
  .brand { border-bottom: 2px solid #232A2F; padding-bottom: 10px; margin-bottom: 4px; }
  .brand::after { content: ''; display: block; height: 1px; background: #C0CAC6; margin-top: 3px; }
  h1 { font-size: 19px; font-weight: 700; margin: 0 0 5px; letter-spacing: 0.01em; text-transform: uppercase; }
  .meta { font-size: 9px; color: #59686A; letter-spacing: 0.1em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th { text-align: left; padding: 7px 10px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.14em;
       color: #EDF1EE; background: #2B3238; text-transform: uppercase; }
  td { padding: 9px 10px; border-bottom: 1px solid #DCE2DE; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #F1F4F1; }
  .dim { color: #59686A; }
  .mat { color: #8A4F00; }
  tfoot td { font-weight: 700; border-top: 2px solid #232A2F; border-bottom: none; background: none;
             text-transform: uppercase; letter-spacing: 0.08em; }
  .plate { margin-top: 26px; font-size: 8px; letter-spacing: 0.24em; color: #59686A; text-transform: uppercase; }
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
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        backgroundColor: 'rgba(10, 6, 3, 0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
    >
      <button
        ref={closeRef}
        onClick={onClose}
        aria-label="Close preview"
        style={{
          position: 'absolute', top: 20, right: 20,
          background: 'rgba(255,255,255,0.12)', border: 'none',
          borderRadius: 2, width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'white', zIndex: 1,
        }}
      >
        <X size={18} />
      </button>
      {pdf ? (
        <iframe
          src={src}
          title="PDF preview"
          onClick={e => e.stopPropagation()}
          style={{
            width: '90vw', height: '90vh',
            border: 'none', borderRadius: 3,
            backgroundColor: 'white',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          }}
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={e => e.stopPropagation()}
          style={{
            maxWidth: '90vw', maxHeight: '90vh',
            objectFit: 'contain', borderRadius: 3,
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          }}
        />
      )}
    </div>
  );
}
