import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cpu, ScanLine, Plus, Trash2, AlertCircle, Loader, ImagePlus } from 'lucide-react';
import type { ShaperMaterial } from '../types/project';
import {
  analyzeShaperUrl, createShaperProject, getShaperProject, updateShaperProject,
  uploadShaperImage, addShaperCutItem, updateCutItem, deleteCutItem, addShaperImageUrl,
} from '../services/api';
import { Button, PageFrame, PageHeader, StatePanel } from '../components/ui';
import { Field, FormSection } from '../components/workflows';
import { buildShaperProjectPayload } from '../lib/coreWorkflows';

// ── Local row types ───────────────────────────────────────────

interface MaterialRow extends ShaperMaterial { _id: string }
interface CutRow {
  _id: string;
  serverId?: number;
  part_name: string;
  qty: string;
  length: string;
  width: string;
  thickness: string;
  material: string;
}

function makeMat(name = '', qty = ''): MaterialRow { return { _id: crypto.randomUUID(), name, qty }; }
function makeCut(): CutRow { return { _id: crypto.randomUUID(), part_name: '', qty: '1', length: '', width: '', thickness: '', material: '' }; }

export default function ShaperProjectForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : undefined;
  const isEdit = projectId != null;
  const goBack = () => isEdit ? navigate(`/shaper/${projectId}`) : navigate('/');
  const fileRef = useRef<HTMLInputElement>(null);

  const [shaperUrl,    setShaperUrl]    = useState('');
  const [title,        setTitle]        = useState('');
  const [description,  setDescription]  = useState('');
  const [photoUrl,     setPhotoUrl]     = useState('');
  const [photoBroken,  setPhotoBroken]  = useState(false);
  useEffect(() => { setPhotoBroken(false); }, [photoUrl]);
  const [materials,    setMaterials]    = useState<MaterialRow[]>([makeMat()]);
  const [instructions, setInstructions] = useState('');
  const [cutRows,      setCutRows]      = useState<CutRow[]>([]);
  const [queuedFiles,     setQueuedFiles]     = useState<File[]>([]);
  const [queuedImageUrls, setQueuedImageUrls] = useState<string[]>([]);

  const [analyzing,    setAnalyzing]    = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [loading,      setLoading]      = useState(isEdit);
  const [uploadMsg,    setUploadMsg]    = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    getShaperProject(projectId)
      .then(p => {
        setShaperUrl(p.shaper_url ?? '');
        setTitle(p.title ?? '');
        setDescription(p.description ?? '');
        setPhotoUrl(p.photo_url ?? '');
        setMaterials((p.materials ?? []).length > 0 ? p.materials!.map(m => makeMat(m.name, m.qty)) : [makeMat()]);
        setInstructions(p.instructions ?? '');
        setCutRows((p.cut_list ?? []).map(c => ({
          _id: crypto.randomUUID(),
          serverId: c.id,
          part_name: c.part_name,
          qty: String(c.qty),
          length: c.length ?? '',
          width: c.width ?? '',
          thickness: c.thickness ?? '',
          material: c.material ?? '',
        })));
      })
      .catch(err => setSaveError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, isEdit]);

  const handleAnalyze = async () => {
    if (!shaperUrl.trim()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const data = await analyzeShaperUrl(shaperUrl.trim());
      if (!title.trim() && data.title)              setTitle(data.title);
      if (!description.trim() && data.description)  setDescription(data.description);
      // Decide the final photo URL deterministically before any state writes,
      // so the dedupe filter below matches the value the save payload will use.
      const finalPhotoUrl = (!photoUrl.trim() && data.photo_url) ? data.photo_url : photoUrl;
      if (finalPhotoUrl !== photoUrl) setPhotoUrl(finalPhotoUrl);
      if (data.materials?.length > 0)               setMaterials(data.materials.map(m => makeMat(m.name, m.qty ?? '')));
      if (!instructions.trim() && data.instructions) setInstructions(data.instructions);
      if (data.image_urls?.length) {
        setQueuedImageUrls(data.image_urls.filter(u => u !== finalPhotoUrl));
      }
    } catch (err: unknown) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (isEdit && projectId != null) {
      // Upload immediately in edit mode
      setUploadMsg(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      try {
        for (const f of files) await uploadShaperImage(projectId, f);
        setUploadMsg(`${files.length} photo${files.length > 1 ? 's' : ''} uploaded`);
        setTimeout(() => setUploadMsg(null), 3000);
      } catch (err: unknown) {
        setUploadMsg(err instanceof Error ? err.message : 'Upload failed');
      }
    } else {
      setQueuedFiles(prev => [...prev, ...files]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSave = async () => {
    if (!title.trim())     { setSaveError('Title is required'); return; }
    if (!shaperUrl.trim()) { setSaveError('Shaper Hub URL is required'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = buildShaperProjectPayload({
        title,
        shaperUrl,
        description,
        photoUrl,
        materials,
        instructions,
      });
      const saved = isEdit
        ? await updateShaperProject(projectId, payload)
        : await createShaperProject(payload);

      const id = saved.id;

      // Upload queued images (new project only); collect failures rather than
      // silently dropping them, so the user knows something didn't save.
      const failedItems = [];
      for (const f of queuedFiles) {
        try { await uploadShaperImage(id, f); }
        catch (e) { failedItems.push(`image "${f.name}": ${e instanceof Error ? e.message : 'failed'}`); }
      }
      for (const url of queuedImageUrls) {
        try { await addShaperImageUrl(id, url); }
        catch (e) { failedItems.push(`image url ${url}: ${e instanceof Error ? e.message : 'failed'}`); }
      }

      // Sync cut list: update existing rows, insert new ones. A failure here
      // throws to the outer catch — the project itself is already saved on
      // the server, but the user sees the error and stays on the form.
      for (const r of cutRows) {
        if (!r.part_name.trim()) continue;
        const payload = {
          part_name: r.part_name.trim(),
          qty: parseInt(r.qty, 10) || 1,
          length: r.length.trim() || null,
          width: r.width.trim() || null,
          thickness: r.thickness.trim() || null,
          material: r.material.trim() || null,
          sort_order: 0,
        };
        if (r.serverId != null) {
          await updateCutItem(r.serverId, payload);
        } else {
          await addShaperCutItem(id, payload);
        }
      }

      if (failedItems.length > 0) {
        setSaveError(`Saved, but ${failedItems.length} item(s) failed: ${failedItems.join('; ')}`);
        setSaving(false);
        return;
      }

      navigate(`/shaper/${id}`);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const updateMat = (id: string, patch: Partial<MaterialRow>) =>
    setMaterials(prev => prev.map(m => m._id === id ? { ...m, ...patch } : m));
  const removeMat = (id: string) =>
    setMaterials(prev => prev.filter(m => m._id !== id));
  const updateCut = (id: string, patch: Partial<CutRow>) =>
    setCutRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));
  const removeCut = async (id: string) => {
    const row = cutRows.find(r => r._id === id);
    if (row?.serverId != null) {
      try {
        await deleteCutItem(row.serverId);
      } catch (error) {
        console.error('Shaper cut row delete failed', error);
        setSaveError('That cut-list row could not be deleted. Try again.');
        return;
      }
    }
    setCutRows(prev => prev.filter(r => r._id !== id));
  };

  if (loading) {
    return (
      <PageFrame maxWidth={860}>
        <StatePanel title="Loading Shaper project" description="Preparing the imported plan, stock, parts, and instructions." />
      </PageFrame>
    );
  }

  return (
    <PageFrame maxWidth={860} className="project-form-page shaper-form-page">
      <div className="form-toolbar">
        <Button variant="ghost" onClick={goBack} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create Shaper project'}
        </Button>
      </div>

      <PageHeader
        title={isEdit ? 'Edit Shaper Hub project' : 'New Shaper Hub project'}
        description="Import a Shaper Tools Hub share URL, then review every part, material, and instruction before saving."
      />

      {saveError && (
        <StatePanel title="Shaper project needs attention" description={saveError} tone="danger" />
      )}

      <FormSection
        title="Import from Shaper Hub"
        description="The importer pre-fills structure without locking it. Everything remains editable."
      >
        <Field label="Shaper Hub URL" required>
          <div className="input-action-row">
            <input
              type="url"
              value={shaperUrl}
              onChange={e => setShaperUrl(e.target.value)}
              placeholder="https://hub.shapertools.com/creators/…/shares/…"
              required
            />
            <Button
              onClick={() => void handleAnalyze()}
              disabled={analyzing || !shaperUrl.trim()}
            >
              {analyzing
                ? <><Loader className="spinner" size={16} aria-hidden="true" /> Analyzing…</>
                : <><ScanLine size={16} aria-hidden="true" /> Read the page</>}
            </Button>
          </div>
          {analyzeError && (
            <span className="inline-error"><AlertCircle size={16} aria-hidden="true" /> {analyzeError}</span>
          )}
        </Field>

        <div className="form-field">
          <span className="form-field-label">Project photos</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={handleFileChange}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" /> Upload photos
          </Button>
          {queuedFiles.length > 0 && (
            <small>{queuedFiles.length} photo{queuedFiles.length === 1 ? '' : 's'} queued for upload after creation.</small>
          )}
          {uploadMsg && <small aria-live="polite">{uploadMsg}</small>}
        </div>

        <Field label="Photo URL" hint="Optional fallback; the importer may fill this from the Shaper page.">
          <input
            type="url"
            value={photoUrl}
            onChange={e => setPhotoUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        {photoUrl && !photoBroken && (
          <div className="form-photo-preview">
            <img src={photoUrl} alt="Shaper project preview" onError={() => setPhotoBroken(true)} />
          </div>
        )}

        {queuedImageUrls.length > 0 && (
          <div className="form-field">
            <span className="form-field-label">Additional imported photos</span>
            <div className="image-dropzone-grid">
              {queuedImageUrls.map((url, index) => (
                <div key={url} className="image-dropzone-item">
                  <img src={url} alt={`Imported reference ${index + 1}`} className="image-dropzone-image" />
                  <button
                    type="button"
                    className="image-dropzone-remove"
                    onClick={() => setQueuedImageUrls(current => current.filter(item => item !== url))}
                    aria-label={`Remove imported reference ${index + 1}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title="Project essentials" description="Name the CNC project and preserve the source description.">
        <Field label="Title" required>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Project name"
            required
            aria-invalid={Boolean(saveError && !title.trim())}
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What are you building?"
            rows={3}
          />
        </Field>
      </FormSection>

      <FormSection title="Materials" description="Stock and supporting supplies for the CNC operation.">
          <div className="editable-table shaper-material-editor">
            {materials.map(m => (
              <div key={m._id} className="shaper-material-row">
                <input
                  value={m.name}
                  onChange={e => updateMat(m._id, { name: e.target.value })}
                  placeholder="e.g. ¾″ Baltic birch plywood"
                  aria-label="Material name"
                />
                <input
                  value={m.qty}
                  onChange={e => updateMat(m._id, { qty: e.target.value })}
                  placeholder="e.g. 1 sheet"
                  aria-label="Material quantity"
                />
                <Button
                  variant="ghost"
                  onClick={() => removeMat(m._id)}
                  disabled={materials.length === 1}
                  aria-label="Remove material"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setMaterials(current => [...current, makeMat()])}>
            <Plus size={16} aria-hidden="true" /> Add material
          </Button>
      </FormSection>

      <FormSection title="Cut list" description="Optional measured parts; adding rows enables the exact-match Cut Plan Optimizer.">
          <div className="editable-table shaper-cut-editor">
            {cutRows.map(r => (
              <div key={r._id} className="shaper-cut-row">
                <input value={r.part_name} onChange={e => updateCut(r._id, { part_name: e.target.value })} placeholder="Part name" aria-label="Part name" />
                <input type="number" min={1} value={r.qty} onChange={e => updateCut(r._id, { qty: e.target.value })} placeholder="Qty" aria-label="Quantity" />
                <input value={r.length} onChange={e => updateCut(r._id, { length: e.target.value })} placeholder="Length" aria-label="Length" />
                <input value={r.width} onChange={e => updateCut(r._id, { width: e.target.value })} placeholder="Width" aria-label="Width" />
                <input value={r.thickness} onChange={e => updateCut(r._id, { thickness: e.target.value })} placeholder="Thickness" aria-label="Thickness" />
                <input value={r.material} onChange={e => updateCut(r._id, { material: e.target.value })} placeholder="Material" aria-label="Material" />
                <Button variant="ghost" onClick={() => void removeCut(r._id)} aria-label="Remove cut-list part">
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setCutRows(current => [...current, makeCut()])}>
            <Plus size={16} aria-hidden="true" /> Add part
          </Button>
      </FormSection>

      <FormSection title="Instructions" description="Preserve setup, tooling, and operation notes in shop order.">
        <Field label="Build instructions">
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Step-by-step build instructions…"
            rows={10}
          />
        </Field>
      </FormSection>

      <div className="form-footer-actions">
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create Shaper project'}
        </Button>
        <Button variant="ghost" onClick={goBack}>Cancel</Button>
      </div>
      <p className="board-plate"><Cpu size={14} aria-hidden="true" /> Shaper context stays separate from regular projects</p>
    </PageFrame>
  );
}
