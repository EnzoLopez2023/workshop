import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Tooltip } from '../components/Tooltip';
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, Save, Upload, Link as LinkIcon, Plus, Trash2, X, Sparkles, FileText, CheckCircle, AlertCircle, Loader, GripVertical } from 'lucide-react';
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
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : undefined;
  const editing = projectId !== undefined;
  const goBack = () => editing ? navigate(`/projects/${projectId}`) : navigate('/');

  const [form, setForm] = useState<ProjectFormPayload>({
    title: '',
    description: '',
    source_url: '',
    cut_plan_url: '',
    status: 'idea',
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
    getProject(projectId).then((p: ProjectDetail) => {
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
    });
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
    setSaving(true);
    try {
      const payload: ProjectFormPayload = {
        ...form,
        wood_types: csvToArr(woodInput),
        tools_needed: csvToArr(toolsInput),
      };
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

  return (
    <div className="page-container" style={{ maxWidth: 820 }}>
      {/* Sticky save bar — appears when top actions scroll out of view (edit mode only) */}
      <AnimatePresence>
        {editing && showStickyBar && (
          <motion.div
            initial={{ y: -56, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -56, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed', top: 65, left: 0, right: 0, zIndex: 15,
              backgroundColor: 'var(--color-paper)',
              borderBottom: '1px solid var(--color-line)',
              boxShadow: '0 4px 16px rgba(28,15,7,0.08)',
            }}
          >
            <div style={{
              maxWidth: 820, margin: '0 auto',
              padding: '10px 40px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            }}>
              <span style={{
                fontFamily: 'var(--font-serif)', fontWeight: 600,
                fontSize: '1rem', color: 'var(--color-ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {form.title || 'Untitled project'}
              </span>
              <button
                className="btn btn-muted"
                onClick={() => { setSaveError(null); handleSave(); }}
                disabled={saving}
                style={{ flexShrink: 0 }}
              >
                <Save size={14} />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={topActionsRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <button className="btn btn-ghost" onClick={goBack} style={{ background: 'transparent', border: 'none' }}>
          <ArrowLeft size={15} />
          Back
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button className="btn btn-muted" onClick={() => { setSaveError(null); handleSave(); }} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
          </button>
          {saveError && <div style={{ fontSize: '0.78rem', color: 'var(--color-rust)' }}>{saveError}</div>}
        </div>
      </div>

      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', fontWeight: 700, margin: '0 0 28px' }}>
        {editing ? 'Edit project' : 'New project'}
      </h1>

      <Field label="Title">
        <input
          value={form.title}
          onChange={e => patch('title', e.target.value)}
          placeholder="e.g. Walnut Dining Table"
        />
      </Field>

      <Field label="Plans URL">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url"
            value={form.source_url}
            onChange={e => patch('source_url', e.target.value)}
            placeholder="https://learn.kregtool.com/plans/…"
            style={{ flex: 1 }}
          />
          <Tooltip content="AI fills in title, description, cut list & materials from this URL">
            <button
              type="button"
              className="btn btn-muted"
              onClick={handleAnalyze}
              disabled={analyzing || !form.source_url.trim()}
              style={{ whiteSpace: 'nowrap' }}
            >
              <Sparkles size={14} />
              {analyzing ? 'Analyzing…' : 'Analyze with AI'}
            </button>
          </Tooltip>
        </div>
        {analyzeError ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-rust)', marginTop: 6 }}>{analyzeError}</div>
        ) : (
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
            AI will pre-fill empty fields and append cut-list / materials rows. Review before saving.
          </div>
        )}
      </Field>

      <Field label="OptiCutter Cut Plan">
        <input
          type="url"
          value={form.cut_plan_url}
          onChange={e => patch('cut_plan_url', e.target.value)}
          placeholder="https://www.opticutter.com/plan2d-detail/…"
        />
      </Field>

      <Field label="Description & Notes">
        <textarea
          value={form.description}
          onChange={e => patch('description', e.target.value)}
          placeholder="What's the vision? Dimensions, joinery, finish…"
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
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

      <Divider />

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
        style={{ display: 'none' }}
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
          <div style={{ display: 'flex', gap: 8 }}>
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            value={inspirationUrlInput}
            onChange={e => setInspirationUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddInspirationUrl(); if (e.key === 'Escape') { setShowInspirationUrlInput(false); setInspirationUrlInput(''); } }}
            placeholder="https://…"
            autoFocus
          />
          <button className="btn btn-muted" onClick={handleAddInspirationUrl} disabled={!inspirationUrlInput.trim()} style={{ whiteSpace: 'nowrap' }}>
            Add
          </button>
        </div>
      )}
      <input
        ref={inspirationFileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files, 'inspiration')}
      />
      <ImageDropzone
        images={inspiration}
        disabled={!editing}
        onClick={() => inspirationFileRef.current?.click()}
        onRemove={id => removeImage(id, 'inspiration')}
      />

      <Divider />

      <SectionHeader title="Cut List" subtitle="Every piece you'll need to mill." />
      <div className="card" style={{ padding: 4 }}>
        {cutList.length === 0 ? (
          <div className="empty-state" style={{ padding: 24, fontSize: '0.88rem' }}>
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
      <button className="btn btn-ghost" onClick={addCutRow} style={{ marginTop: 10 }}>
        <Plus size={14} /> Add Part
      </button>

      <Divider />

      <SectionHeader title="Materials & Hardware" subtitle="Screws, glue, finish, and everything else." />
      <div className="card" style={{ padding: 4 }}>
        {materials.length === 0 ? (
          <div className="empty-state" style={{ padding: 24, fontSize: '0.88rem' }}>
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
      <button className="btn btn-ghost" onClick={addMatRow} style={{ marginTop: 10 }}>
        <Plus size={14} /> Add Material
      </button>

      <div style={{
        textAlign: 'center', marginTop: 56, color: 'var(--color-muted)',
        fontSize: '0.85rem', letterSpacing: '0.06em', fontStyle: 'italic',
      }}>
        Measure twice · Cut once
      </div>

      <UploadProgressPanel
        uploads={uploads}
        onDismiss={id => setUploads(prev => prev.filter(u => u.id !== id))}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-line)', margin: '32px 0 24px' }} />;
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && (
          <div className="muted" style={{ fontSize: '0.86rem', marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {action}
    </div>
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
    <div style={{ marginBottom: 24 }}>
      {images.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 10, marginBottom: 10,
        }}>
          {images.map(img => {
            const src = img.image_url ?? imageUrl(img.id);
            const isPdf = img.image_type === 'application/pdf';
            return (
              <div key={img.id} style={{ position: 'relative' }}>
                {isPdf ? (
                  <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 8,
                      width: '100%', aspectRatio: 1, borderRadius: 10,
                      backgroundColor: 'var(--color-cream-2)',
                      border: '1px solid var(--color-line)',
                      color: 'var(--color-ink)', textDecoration: 'none',
                      padding: 8, textAlign: 'center', fontSize: '0.78rem',
                    }}
                  >
                    <FileText size={28} style={{ color: 'var(--color-rust)' }} />
                    <span>PDF</span>
                  </a>
                ) : (
                  <img
                    src={src}
                    alt=""
                    style={{ width: '100%', aspectRatio: 1, objectFit: 'cover', borderRadius: 10 }}
                  />
                )}
                <button
                  onClick={() => onRemove(img.id)}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    backgroundColor: 'rgba(28,15,7,0.8)', color: 'white',
                    border: 'none', borderRadius: '50%', width: 22, height: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
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
        style={{
          width: '100%', padding: '36px 16px',
          border: '1.5px dashed var(--color-line)', borderRadius: 14,
          backgroundColor: 'var(--color-paper)',
          color: disabled ? 'var(--color-muted)' : 'var(--color-ink)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          fontSize: '0.88rem',
        }}
      >
        <Upload size={18} style={{ color: 'var(--color-muted)' }} />
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
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      width: 300, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {uploads.map(u => (
        <div key={u.id} style={{
          backgroundColor: 'var(--color-paper)',
          border: '1px solid var(--color-line)',
          borderRadius: 10,
          padding: '10px 12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          pointerEvents: 'all',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: u.status === 'uploading' ? 8 : 0 }}>
            {u.status === 'uploading' && (
              <Loader size={14} style={{ color: 'var(--color-rust)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            )}
            {u.status === 'done' && (
              <CheckCircle size={14} style={{ color: '#4a9b6f', flexShrink: 0 }} />
            )}
            {u.status === 'error' && (
              <AlertCircle size={14} style={{ color: '#c0392b', flexShrink: 0 }} />
            )}
            <span style={{
              fontSize: '0.82rem', fontWeight: 500,
              color: 'var(--color-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {u.name}
            </span>
            {u.status !== 'uploading' && (
              <button
                onClick={() => onDismiss(u.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 0, lineHeight: 1, flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          {u.status === 'uploading' && (
            <div>
              <div style={{ height: 5, backgroundColor: 'var(--color-line)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${u.progress}%`,
                  backgroundColor: 'var(--color-rust)',
                  borderRadius: 3,
                  transition: 'width 0.15s ease',
                }} />
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--color-muted)', marginTop: 4 }}>
                {u.progress}%
              </div>
            </div>
          )}
          {u.status === 'error' && (
            <div style={{ fontSize: '0.78rem', color: '#c0392b', marginTop: 4 }}>
              {u.error ?? 'Upload failed'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function csvToArr(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(Boolean);
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
    display: 'grid',
    gridTemplateColumns: 'auto 2fr 0.7fr 1fr 1fr 1fr 1.4fr auto',
    gap: 8, alignItems: 'center',
    padding: '8px 8px',
    borderTop: isFirst ? 'none' : '1px solid var(--color-line)',
    background: 'var(--color-paper)',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        {...attributes} {...listeners}
        style={{ background: 'none', border: 'none', cursor: 'grab', color: 'var(--color-muted)', padding: '4px 2px', touchAction: 'none' }}
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
      <button onClick={onRemove} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 8 }}>
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
    display: 'grid',
    gridTemplateColumns: 'auto auto 2.2fr 1.2fr 1fr auto',
    gap: 8, alignItems: 'center',
    padding: '8px 10px',
    borderTop: isFirst ? 'none' : '1px solid var(--color-line)',
    background: 'var(--color-paper)',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        {...attributes} {...listeners}
        style={{ background: 'none', border: 'none', cursor: 'grab', color: 'var(--color-muted)', padding: '4px 2px', touchAction: 'none' }}
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <input
        type="checkbox" checked={!!row.purchased}
        onChange={e => onChange({ purchased: e.target.checked })}
        style={{ width: 16, height: 16, accentColor: 'var(--color-ink-soft)', cursor: 'pointer' }}
      />
      <input placeholder="Name" value={row.name ?? ''} onChange={e => onChange({ name: e.target.value })} />
      <input placeholder="Qty (e.g. 4 pcs, 1 quart)" value={row.qty_label ?? ''} onChange={e => onChange({ qty_label: e.target.value })} />
      <input type="number" min={0} step="0.01" placeholder="Cost" value={row.cost ?? 0} onChange={e => onChange({ cost: Number(e.target.value) || 0 })} />
      <button onClick={onRemove} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 8 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
