import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Tooltip } from '../components/Tooltip';
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, Save, Upload, Link as LinkIcon, Plus, Trash2, X, ScanLine, FileText, CheckCircle, AlertCircle, Loader, GripVertical } from 'lucide-react';
import {
  createProject, updateProject, getProject,
  uploadImage, addInspirationUrl, deleteImage,
  addCutItem, updateCutItem, deleteCutItem,
  addMaterial, updateMaterial, deleteMaterial,
  analyzeProjectUrl,
  imageUrl,
} from '../services/api';
import type {
  ProjectStatus, Difficulty, ProjectFormPayload, ProjectDetail,
  CutListItem, Material, ProjectImage,
} from '../types/project';
import { STATUS_LABELS } from '../types/project';
import { Button, PageFrame, StatePanel } from '../components/ui';
import { Field, FormSection } from '../components/workflows';
import { buildProjectPayload } from '../lib/coreWorkflows';
import { useSettings } from '../contexts/SettingsContext';

const STATUSES: ProjectStatus[] = ['idea', 'planning', 'in_progress', 'completed'];
const DIFFICULTIES: Difficulty[] = ['Beginner', 'Intermediate', 'Advanced'];

type CutDraft = Partial<CutListItem> & { _localId?: string };
type MatDraft = Partial<Material> & { _localId?: string };
type UploadEntry = {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
};

export default function ProjectForm() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : undefined;
  const editing = projectId !== undefined;
  const goBack = () => editing ? navigate(`/projects/${projectId}`) : navigate('/');

  const [form, setForm] = useState<ProjectFormPayload>({
    title: '',
    description: '',
    source_url: '',
    cut_plan_url: '',
    status: settings.defaultProjectStatus,
    difficulty: 'Intermediate',
    estimated_hours: 0,
    wood_types: [],
    tools_needed: [],
  });

  const [woodInput, setWoodInput] = useState('');
  const [toolsInput, setToolsInput] = useState('');
  const [sketches, setSketches] = useState<ProjectImage[]>([]);
  const [inspiration, setInspiration] = useState<ProjectImage[]>([]);
  const [cutList, setCutList] = useState<CutDraft[]>([]);
  const [materials, setMaterials] = useState<MatDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [inspirationUrlInput, setInspirationUrlInput] = useState('');
  const [showInspirationUrlInput, setShowInspirationUrlInput] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  const sketchFileRef = useRef<HTMLInputElement>(null);
  const inspirationFileRef = useRef<HTMLInputElement>(null);
  const topActionsRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    const el = topActionsRef.current;
    if (!el || !editing) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-72px 0px 0px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [editing]);

  // Load existing project when editing
  useEffect(() => {
    if (!editing || projectId === undefined) return;
    setLoading(true);
    getProject(projectId)
      .then((p: ProjectDetail) => {
        setForm({
          title: p.title,
          description: p.description ?? '',
          source_url: p.source_url ?? '',
          cut_plan_url: p.cut_plan_url ?? '',
          status: p.status,
          difficulty: p.difficulty,
          estimated_hours: p.estimated_hours,
          wood_types: p.wood_types,
          tools_needed: p.tools_needed,
        });
        setWoodInput(p.wood_types.join(', '));
        setToolsInput(p.tools_needed.join(', '));
        setSketches(p.images.filter(i => i.kind === 'sketch'));
        setInspiration(p.images.filter(i => i.kind === 'inspiration'));
        setCutList(p.cut_list);
        setMaterials(p.materials);
      })
      .catch(error => {
        console.error('Project form load failed', error);
        setSaveError('Workshop could not load this project for editing.');
      })
      .finally(() => setLoading(false));
  }, [editing, projectId]);

  const patch = <K extends keyof ProjectFormPayload>(k: K, v: ProjectFormPayload[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // ── Analyze URL with AI ─────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    const url = form.source_url.trim();
    if (!url) { setAnalyzeError('Paste the plans URL first.'); return; }
    if (!/^https?:\/\//i.test(url)) { setAnalyzeError('URL must start with http:// or https://'); return; }
    setAnalyzeError(null);

    setAnalyzing(true);
    try {
      const data = await analyzeProjectUrl(url);

      // Pre-fill — only overwrite fields the user hasn't already filled in.
      setForm(prev => ({
        ...prev,
        title: prev.title.trim() ? prev.title : data.title,
        description: prev.description.trim() ? prev.description : data.description,
        difficulty: data.difficulty ?? prev.difficulty,
        estimated_hours: prev.estimated_hours || data.estimated_hours || 0,
      }));

      if (data.wood_types?.length && !woodInput.trim()) {
        setWoodInput(data.wood_types.join(', '));
      }
      if (data.tools_needed?.length && !toolsInput.trim()) {
        setToolsInput(data.tools_needed.join(', '));
      }

      // Append AI-suggested cut list rows (don't drop user's existing rows).
      if (data.cut_list?.length) {
        setCutList(prev => [
          ...prev,
          ...data.cut_list.map(c => ({
            _localId: crypto.randomUUID(),
            part_name: c.part_name,
            qty: c.qty || 1,
            length: c.length,
            width: c.width,
            thickness: c.thickness,
            material: c.material,
          })),
        ]);
      }

      if (data.materials?.length) {
        setMaterials(prev => [
          ...prev,
          ...data.materials.map(m => ({
            _localId: crypto.randomUUID(),
            name: m.name,
            qty_label: m.qty_label,
            cost: 0,
            purchased: false,
          })),
        ]);
      }

      toast.success('Fields pre-filled — review before saving');
    } catch (err) {
      setAnalyzeError('Could not analyze: ' + (err as Error).message);
      toast.error('AI analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Image handlers ──────────────────────────────────────────────────────────

  const handleFiles = async (files: FileList | null, kind: 'sketch' | 'inspiration') => {
    if (!files || files.length === 0 || projectId === undefined) return;
    for (const f of Array.from(files)) {
      const entryId = crypto.randomUUID();
      setUploads(prev => [...prev, { id: entryId, name: f.name, progress: 0, status: 'uploading' }]);
      try {
        const { id } = await uploadImage(projectId, kind, f, (pct) => {
          setUploads(prev => prev.map(u => u.id === entryId ? { ...u, progress: pct } : u));
        });
        setUploads(prev => prev.map(u => u.id === entryId ? { ...u, progress: 100, status: 'done' } : u));
        const newImg: ProjectImage = { id, project_id: projectId, kind, image_type: f.type, image_url: null, sort_order: Date.now() };
        if (kind === 'sketch') setSketches(prev => [...prev, newImg]);
        else setInspiration(prev => [...prev, newImg]);
        setTimeout(() => setUploads(prev => prev.filter(u => u.id !== entryId)), 3000);
      } catch (err) {
        setUploads(prev => prev.map(u =>
          u.id === entryId ? { ...u, status: 'error', error: (err as Error).message } : u
        ));
      }
    }
  };

  const handleAddInspirationUrl = async () => {
    const url = inspirationUrlInput.trim();
    if (!url) return;
    if (projectId === undefined) return;
    try {
      const { id } = await addInspirationUrl(projectId, url);
      setInspiration(prev => [...prev, { id, project_id: projectId, kind: 'inspiration', image_type: null, image_url: url, sort_order: Date.now() }]);
      setInspirationUrlInput('');
      setShowInspirationUrlInput(false);
    } catch (err) { console.error(err); }
  };

  const removeImage = async (id: number, kind: 'sketch' | 'inspiration') => {
    await deleteImage(id);
    if (kind === 'sketch') setSketches(prev => prev.filter(i => i.id !== id));
    else setInspiration(prev => prev.filter(i => i.id !== id));
  };

  // ── Cut list ────────────────────────────────────────────────────────────────

  const addCutRow = () =>
    setCutList(prev => [...prev, { _localId: crypto.randomUUID(), part_name: '', qty: 1, material: '' }]);

  const updateCutRow = (idx: number, patch: Partial<CutDraft>) =>
    setCutList(prev => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));

  const removeCutRow = async (idx: number) => {
    const row = cutList[idx];
    if (row.id) await deleteCutItem(row.id);
    setCutList(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Materials ───────────────────────────────────────────────────────────────

  const addMatRow = () =>
    setMaterials(prev => [...prev, { _localId: crypto.randomUUID(), name: '', qty_label: '', cost: 0, purchased: false }]);

  const updateMatRow = (idx: number, patch: Partial<MatDraft>) =>
    setMaterials(prev => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));

  const removeMatRow = async (idx: number) => {
    const row = materials[idx];
    if (row.id) await deleteMaterial(row.id);
    setMaterials(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Drag to reorder ─────────────────────────────────────────────────────────

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleCutDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCutList(prev => {
      const oldIdx = prev.findIndex(r => (r.id ?? r._localId) === active.id);
      const newIdx = prev.findIndex(r => (r.id ?? r._localId) === over.id);
      const reordered = arrayMove(prev, oldIdx, newIdx);
      reordered.forEach((row, idx) => {
        if (row.id) updateCutItem(row.id, { sort_order: idx } as Parameters<typeof updateCutItem>[1]).catch(() => {});
      });
      return reordered;
    });
  }, []);

  const handleMatDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setMaterials(prev => {
      const oldIdx = prev.findIndex(r => (r.id ?? r._localId) === active.id);
      const newIdx = prev.findIndex(r => (r.id ?? r._localId) === over.id);
      const reordered = arrayMove(prev, oldIdx, newIdx);
      reordered.forEach((row, idx) => {
        if (row.id) updateMaterial(row.id, { sort_order: idx } as Parameters<typeof updateMaterial>[1]).catch(() => {});
      });
      return reordered;
    });
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.title.trim()) {
      setSaveError('Add a project title before saving.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = buildProjectPayload(form, woodInput, toolsInput);
      const saved = editing && projectId !== undefined
        ? await updateProject(projectId, payload)
        : await createProject(payload);

      const savedId = saved.id;

      // Sync cut list rows
      for (const row of cutList) {
        if (!row.part_name?.trim()) continue;
        if (row.id) {
          await updateCutItem(row.id, row);
        } else {
          await addCutItem(savedId, row);
        }
      }

      // Sync materials rows
      for (const row of materials) {
        if (!row.name?.trim()) continue;
        if (row.id) {
          await updateMaterial(row.id, row);
        } else {
          await addMaterial(savedId, row);
        }
      }

      navigate(`/projects/${savedId}`);
    } catch (err) {
      console.error(err);
      const msg = 'Could not save: ' + (err as Error).message;
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageFrame maxWidth={860}>
        <StatePanel title="Loading project" description="Preparing the current plan, images, parts, and materials." />
      </PageFrame>
    );
  }

  return (
    <PageFrame maxWidth={860} className="project-form-page">
      {/* Sticky save bar — appears when top actions scroll out of view (edit mode only) */}
      {editing && showStickyBar && (
        <div className="form-save-bar">
          <div>
              <span>
                {form.title || 'Untitled project'}
              </span>
              <Button
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save size={16} aria-hidden="true" />
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
          </div>
        </div>
      )}

      <div ref={topActionsRef} className="form-toolbar">
        <Button variant="ghost" onClick={goBack} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Button>
        <div className="form-toolbar-save">
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            <Save size={16} aria-hidden="true" />
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
          </Button>
        </div>
      </div>

      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">{editing ? 'Edit project' : 'New project'}</h1>
          <p className="page-sub">Start with the plan source, then confirm the essentials before adding parts and materials.</p>
        </div>
      </div>

      {saveError && (
        <StatePanel title="Project could not be saved" description={saveError} tone="danger" />
      )}

      <FormSection
        title="Start with the plan"
        description="Paste a plan URL to pre-fill empty fields, or begin with your own project details."
      >
      <Field label="Plans URL" hint="AI fills empty fields and appends suggested cut-list and material rows. Review everything before saving.">
        <div className="input-action-row">
          <input
            type="url"
            value={form.source_url}
            onChange={e => patch('source_url', e.target.value)}
            placeholder="https://learn.kregtool.com/plans/…"
          />
          <Tooltip content="Read the page and pre-fill this project">
            <Button
              onClick={() => void handleAnalyze()}
              disabled={analyzing || !form.source_url.trim()}
            >
              <ScanLine size={16} aria-hidden="true" />
              {analyzing ? 'Reading…' : 'Read the page'}
            </Button>
          </Tooltip>
        </div>
        {analyzeError && <span className="inline-error">{analyzeError}</span>}
      </Field>

      <Field label="OptiCutter cut plan">
        <input
          type="url"
          value={form.cut_plan_url}
          onChange={e => patch('cut_plan_url', e.target.value)}
          placeholder="https://www.opticutter.com/plan2d-detail/…"
        />
      </Field>
      </FormSection>

      <FormSection title="Project essentials" description="These details define the plan and its current place in the build.">
      <Field label="Title" required>
        <input
          value={form.title}
          onChange={e => patch('title', e.target.value)}
          placeholder="e.g. Walnut Dining Table"
          required
          aria-invalid={Boolean(saveError && !form.title.trim())}
        />
      </Field>

      <Field label="Description & Notes">
        <textarea
          value={form.description}
          onChange={e => patch('description', e.target.value)}
          placeholder="What's the vision? Dimensions, joinery, finish…"
        />
      </Field>

      <div className="form-grid form-grid-three">
        <Field label="Status">
          <select value={form.status} onChange={e => patch('status', e.target.value as ProjectStatus)}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <select value={form.difficulty} onChange={e => patch('difficulty', e.target.value as Difficulty)}>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Estimated Hours">
          <input
            type="number" min={0}
            value={form.estimated_hours}
            onChange={e => patch('estimated_hours', Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <Field label="Wood Types">
        <input
          value={woodInput}
          onChange={e => setWoodInput(e.target.value)}
          placeholder="Walnut, Oak, Maple… (comma-separated)"
        />
      </Field>

      <Field label="Tools Needed">
        <input
          value={toolsInput}
          onChange={e => setToolsInput(e.target.value)}
          placeholder="Table saw, router, chisel… (comma-separated)"
        />
      </Field>
      </FormSection>

      <FormSection
        title="Project files"
        description={editing
          ? 'Keep measured drawings and visual references with the plan.'
          : 'Create the project first, then add images and PDF plans from the edit screen.'}
      >
      <SectionHeader
        title="Sketches & Plans"
        action={
          <button
            className="btn btn-ghost"
            onClick={() => sketchFileRef.current?.click()}
            disabled={!editing}
            title={editing ? undefined : 'Save the project first'}
          >
            <Upload size={14} /> Upload
          </button>
        }
      />
      <input
        ref={sketchFileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        onChange={e => handleFiles(e.target.files, 'sketch')}
      />
      <ImageDropzone
        images={sketches}
        disabled={!editing}
        acceptPdf
        onClick={() => sketchFileRef.current?.click()}
        onRemove={id => removeImage(id, 'sketch')}
      />

      <SectionHeader
        title="Inspiration"
        action={
          <div className="workflow-section-actions">
            <button
              className="btn btn-ghost"
              onClick={() => setShowInspirationUrlInput(v => !v)}
              disabled={!editing}
              title={editing ? undefined : 'Save the project first'}
            >
              <LinkIcon size={14} /> Add URL
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => inspirationFileRef.current?.click()}
              disabled={!editing}
              title={editing ? undefined : 'Save the project first'}
            >
              <Upload size={14} /> Upload
            </button>
          </div>
        }
      />
      {showInspirationUrlInput && (
        <div className="input-action-row inspiration-url-editor">
          <input
            value={inspirationUrlInput}
            onChange={e => setInspirationUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddInspirationUrl(); if (e.key === 'Escape') { setShowInspirationUrlInput(false); setInspirationUrlInput(''); } }}
            placeholder="https://…"
            autoFocus
          />
          <button className="btn btn-muted" onClick={handleAddInspirationUrl} disabled={!inspirationUrlInput.trim()}>
            Add
          </button>
        </div>
      )}
      <input
        ref={inspirationFileRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={e => handleFiles(e.target.files, 'inspiration')}
      />
      <ImageDropzone
        images={inspiration}
        disabled={!editing}
        onClick={() => inspirationFileRef.current?.click()}
        onRemove={id => removeImage(id, 'inspiration')}
      />
      </FormSection>

      <FormSection title="Cut list" description="Every measured piece you will need to mill. Drag existing rows to preserve shop order.">
      <div className="card editable-table">
        {cutList.length === 0 ? (
          <div className="empty-state editable-table-empty">
            No parts yet. Add your first cut.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCutDragEnd}>
            <SortableContext
              items={cutList.map(r => String(r.id ?? r._localId ?? ''))}
              strategy={verticalListSortingStrategy}
            >
              {cutList.map((row, i) => (
                <SortableCutRow
                  key={String(row.id ?? row._localId)}
                  id={String(row.id ?? row._localId ?? '')}
                  row={row}
                  isFirst={i === 0}
                  onChange={patch => updateCutRow(i, patch)}
                  onRemove={() => removeCutRow(i)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <button className="btn btn-ghost section-add-action" onClick={addCutRow}>
        <Plus size={14} /> Add Part
      </button>
      </FormSection>

      <FormSection title="Materials & hardware" description="Stock, fasteners, glue, finish, and every acquisition that belongs with this build.">
      <div className="card editable-table">
        {materials.length === 0 ? (
          <div className="empty-state editable-table-empty">
            No materials yet.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMatDragEnd}>
            <SortableContext
              items={materials.map(r => String(r.id ?? r._localId ?? ''))}
              strategy={verticalListSortingStrategy}
            >
              {materials.map((row, i) => (
                <SortableMatRow
                  key={String(row.id ?? row._localId)}
                  id={String(row.id ?? row._localId ?? '')}
                  row={row}
                  isFirst={i === 0}
                  onChange={patch => updateMatRow(i, patch)}
                  onRemove={() => removeMatRow(i)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <button className="btn btn-ghost section-add-action" onClick={addMatRow}>
        <Plus size={14} /> Add Material
      </button>
      </FormSection>

      <div className="board-plate">Measure twice &middot; Cut once</div>

      <UploadProgressPanel
        uploads={uploads}
        onDismiss={id => setUploads(prev => prev.filter(u => u.id !== id))}
      />
    </PageFrame>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <>
      <div className="rail">
        <h2>{title}</h2>
        {action && <div className="rail-actions">{action}</div>}
      </div>
      {subtitle && (
        <p className="section-description">{subtitle}</p>
      )}
    </>
  );
}

function ImageDropzone({
  images, disabled, acceptPdf, onClick, onRemove,
}: {
  images: ProjectImage[];
  disabled: boolean;
  acceptPdf?: boolean;
  onClick: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="image-dropzone">
      {images.length > 0 && (
        <div className="image-dropzone-grid">
          {images.map(img => {
            const src = img.image_url ?? imageUrl(img.id);
            const isPdf = img.image_type === 'application/pdf';
            return (
              <div key={img.id} className="image-dropzone-item">
                {isPdf ? (
                  <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="image-dropzone-pdf"
                  >
                    <FileText size={28} />
                    <span>PDF</span>
                  </a>
                ) : (
                  <img
                    src={src}
                    alt=""
                    className="image-dropzone-image"
                  />
                )}
                <button
                  onClick={() => onRemove(img.id)}
                  className="image-dropzone-remove"
                  aria-label="Remove file"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={onClick}
        disabled={disabled}
        className="image-dropzone-target"
      >
        <Upload size={18} />
        {disabled
          ? `Save the project first to add ${acceptPdf ? 'files' : 'images'}`
          : `Click to upload ${acceptPdf ? 'images or PDFs' : 'images'}`}
      </button>
    </div>
  );
}

function UploadProgressPanel({
  uploads, onDismiss,
}: {
  uploads: UploadEntry[];
  onDismiss: (id: string) => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <div className="upload-progress-panel" aria-live="polite">
      {uploads.map(u => (
        <div key={u.id} className={`upload-progress-entry is-${u.status}`}>
          <div className="upload-progress-heading">
            {u.status === 'uploading' && (
              <Loader size={14} className="spinner" />
            )}
            {u.status === 'done' && (
              <CheckCircle size={14} />
            )}
            {u.status === 'error' && (
              <AlertCircle size={14} />
            )}
            <span>{u.name}</span>
            {u.status !== 'uploading' && (
              <button
                onClick={() => onDismiss(u.id)}
                className="icon-button"
                aria-label={`Dismiss ${u.name} upload`}
              >
                <X size={12} />
              </button>
            )}
          </div>
          {u.status === 'uploading' && (
            <div className="upload-progress-body">
              <div className="upload-progress-track">
                <div style={{
                  width: '100%',
                  transformOrigin: 'left center',
                  transform: `scaleX(${u.progress / 100})`,
                }} />
              </div>
              <div className="readout upload-progress-value">
                {String(u.progress).padStart(2, '0')}%
              </div>
            </div>
          )}
          {u.status === 'error' && (
            <div className="upload-progress-error">
              {u.error ?? 'Upload failed'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SortableCutRow({
  id, row, isFirst, onChange, onRemove,
}: {
  id: string;
  row: CutDraft;
  isFirst: boolean;
  onChange: (patch: Partial<CutDraft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`sortable-cut-row ${isFirst ? '' : 'has-divider'}`}>
      <button
        {...attributes} {...listeners}
        className="drag-handle"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <input placeholder="Part name" value={row.part_name ?? ''} onChange={e => onChange({ part_name: e.target.value })} />
      <input type="number" min={1} placeholder="Qty" value={row.qty ?? 1} onChange={e => onChange({ qty: Number(e.target.value) || 1 })} />
      <input placeholder="Length" value={row.length ?? ''} onChange={e => onChange({ length: e.target.value })} />
      <input placeholder="Width" value={row.width ?? ''} onChange={e => onChange({ width: e.target.value })} />
      <input placeholder="Thickness" value={row.thickness ?? ''} onChange={e => onChange({ thickness: e.target.value })} />
      <input placeholder="Material" value={row.material ?? ''} onChange={e => onChange({ material: e.target.value })} />
      <button onClick={onRemove} className="icon-button" aria-label={`Remove ${row.part_name || 'cut-list row'}`}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SortableMatRow({
  id, row, isFirst, onChange, onRemove,
}: {
  id: string;
  row: MatDraft;
  isFirst: boolean;
  onChange: (patch: Partial<MatDraft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`sortable-material-row ${isFirst ? '' : 'has-divider'}`}>
      <button
        {...attributes} {...listeners}
        className="drag-handle"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <input
        type="checkbox" checked={!!row.purchased}
        onChange={e => onChange({ purchased: e.target.checked })}
        className="row-checkbox"
      />
      <input placeholder="Name" value={row.name ?? ''} onChange={e => onChange({ name: e.target.value })} />
      <input placeholder="Qty (e.g. 4 pcs, 1 quart)" value={row.qty_label ?? ''} onChange={e => onChange({ qty_label: e.target.value })} />
      <input type="number" min={0} step="0.01" placeholder="Cost" value={row.cost ?? 0} onChange={e => onChange({ cost: Number(e.target.value) || 0 })} />
      <button onClick={onRemove} className="icon-button" aria-label={`Remove ${row.name || 'material row'}`}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
