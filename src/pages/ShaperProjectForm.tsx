import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cpu, ScanLine, Plus, Trash2, AlertCircle, Loader, ImagePlus } from 'lucide-react';
import type { ShaperMaterial } from '../types/project';
import {
  analyzeShaperUrl, createShaperProject, getShaperProject, updateShaperProject,
  uploadShaperImage, addShaperCutItem, updateCutItem, deleteCutItem, addShaperImageUrl,
} from '../services/api';

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
        setMaterials(p.materials.length > 0 ? p.materials.map(m => makeMat(m.name, m.qty)) : [makeMat()]);
        setInstructions(p.instructions ?? '');
        setCutRows(p.cut_list.map(c => ({
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
      const payload = {
        title:        title.trim(),
        shaper_url:   shaperUrl.trim(),
        description:  description.trim() || null,
        photo_url:    photoUrl.trim()    || null,
        materials:    materials.filter(m => m.name.trim()).map(m => ({ name: m.name.trim(), qty: m.qty.trim() })),
        instructions: instructions.trim() || null,
      };
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
      try { await deleteCutItem(row.serverId); } catch { /* ignore — UI removal still happens */ }
    }
    setCutRows(prev => prev.filter(r => r._id !== id));
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '80px 40px', textAlign: 'center', color: 'var(--color-muted)' }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 760 }}>
      {/* Back */}
      <button onClick={goBack} className="btn btn-ghost" style={{ marginBottom: 24, gap: 6 }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">
            <Cpu size={20} strokeWidth={2.2} style={{ color: 'var(--color-amber)', display: 'inline-block', verticalAlign: '-2px', marginRight: 10 }} />
            {isEdit ? 'Edit Shaper Hub project' : 'New Shaper Hub project'}
          </h1>
          <p className="page-sub">Paste a Shaper Tools Hub share URL — the parts, dimensions and bit list come across with it.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* URL + Analyze */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <label className="label-caps">SHAPER HUB URL</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <input
              value={shaperUrl}
              onChange={e => setShaperUrl(e.target.value)}
              placeholder="https://hub.shapertools.com/creators/…/shares/…"
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-muted"
              onClick={handleAnalyze}
              disabled={analyzing || !shaperUrl.trim()}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {analyzing
                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</>
                : <><ScanLine size={14} /> Read the page</>}
            </button>
          </div>
          {analyzeError && (
            <div className="inline-error" style={{ marginTop: 10 }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {analyzeError}
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="label-caps">TITLE <span style={{ color: 'var(--color-amber)' }}>*</span></label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Project name"
            style={{ marginTop: 6, width: '100%' }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="label-caps">DESCRIPTION</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What are you building?"
            rows={3}
            style={{ marginTop: 6, width: '100%', resize: 'vertical' }}
          />
        </div>

        {/* Photos */}
        <div>
          <label className="label-caps">PHOTOS</label>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => fileRef.current?.click()}
              style={{ alignSelf: 'flex-start', gap: 6 }}
            >
              <ImagePlus size={14} /> Upload Photos
            </button>
            {queuedFiles.length > 0 && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                {queuedFiles.length} photo{queuedFiles.length > 1 ? 's' : ''} queued — will upload on save
              </div>
            )}
            {uploadMsg && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>{uploadMsg}</div>
            )}
          </div>
        </div>

        {/* Photo URL override */}
        <div>
          <label className="label-caps">PHOTO URL <span style={{ color: 'var(--color-muted)', fontWeight: 400, letterSpacing: 0 }}>(fallback / auto-filled by Analyze)</span></label>
          <input
            value={photoUrl}
            onChange={e => setPhotoUrl(e.target.value)}
            placeholder="https://…"
            style={{ marginTop: 6, width: '100%' }}
          />
        </div>

        {photoUrl && !photoBroken && (
          <div style={{ borderRadius: 3, overflow: 'hidden', maxHeight: 260, position: 'relative' }}>
            <img
              src={photoUrl}
              alt="Project preview"
              style={{ width: '100%', height: 260, objectFit: 'cover', display: 'block' }}
              onError={() => setPhotoBroken(true)}
            />
          </div>
        )}

        {queuedImageUrls.length > 0 && (
          <div>
            <label className="label-caps">
              ADDITIONAL PHOTOS FROM ANALYZE
              <span style={{ fontWeight: 400, letterSpacing: 0, marginLeft: 6 }}>
                ({queuedImageUrls.length} — will save with project)
              </span>
            </label>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {queuedImageUrls.map((url, i) => (
                <div key={url} style={{ position: 'relative', width: 100, height: 100, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--color-line)' }}>
                  <img
                    src={url}
                    alt={`Extra image ${i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setQueuedImageUrls(prev => prev.filter(u => u !== url))}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 2,
                      width: 22, height: 22, cursor: 'pointer',
                      color: '#fff', fontSize: 13, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Materials */}
        <div>
          <label className="label-caps">MATERIALS</label>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 140px auto',
              gap: 8, paddingRight: 4,
              fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-muted)', letterSpacing: '0.06em',
            }}>
              <span>MATERIAL / ITEM</span><span>QTY</span><span />
            </div>
            {materials.map(m => (
              <div key={m._id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8, alignItems: 'center' }}>
                <input
                  value={m.name}
                  onChange={e => updateMat(m._id, { name: e.target.value })}
                  placeholder="e.g. ¾″ Baltic birch plywood"
                />
                <input
                  value={m.qty}
                  onChange={e => updateMat(m._id, { qty: e.target.value })}
                  placeholder="e.g. 1 sheet"
                />
                <button
                  onClick={() => removeMat(m._id)}
                  disabled={materials.length === 1}
                  style={{
                    background: 'none', border: 'none', padding: 4,
                    cursor: materials.length === 1 ? 'default' : 'pointer',
                    color: materials.length === 1 ? 'var(--color-line)' : 'var(--color-muted)',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              onClick={() => setMaterials(prev => [...prev, makeMat()])}
              style={{ alignSelf: 'flex-start', fontSize: '0.8rem', marginTop: 2 }}
            >
              <Plus size={13} /> Add Material
            </button>
          </div>
        </div>

        {/* Cut List */}
        <div>
          <label className="label-caps">CUT LIST <span style={{ color: 'var(--color-muted)', fontWeight: 400, letterSpacing: 0 }}>(optional — enables Cut Plan Optimizer)</span></label>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cutRows.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 56px 1fr 1fr 1fr 1fr auto',
                gap: 6,
                fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-muted)', letterSpacing: '0.06em',
                paddingRight: 4,
              }}>
                <span>PART NAME</span><span>QTY</span><span>LENGTH</span><span>WIDTH</span><span>THICK</span><span>MATERIAL</span><span />
              </div>
            )}
            {cutRows.map(r => (
              <div key={r._id} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 56px 1fr 1fr 1fr 1fr auto',
                gap: 6, alignItems: 'center',
              }}>
                <input value={r.part_name} onChange={e => updateCut(r._id, { part_name: e.target.value })} placeholder="e.g. Side Panel" />
                <input type="number" min={1} value={r.qty} onChange={e => updateCut(r._id, { qty: e.target.value })} placeholder="1" />
                <input value={r.length} onChange={e => updateCut(r._id, { length: e.target.value })} placeholder='e.g. 24"' />
                <input value={r.width} onChange={e => updateCut(r._id, { width: e.target.value })} placeholder='e.g. 12"' />
                <input value={r.thickness} onChange={e => updateCut(r._id, { thickness: e.target.value })} placeholder='3/4"' />
                <input value={r.material} onChange={e => updateCut(r._id, { material: e.target.value })} placeholder="Plywood" />
                <button
                  onClick={() => removeCut(r._id)}
                  style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--color-muted)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              onClick={() => setCutRows(prev => [...prev, makeCut()])}
              style={{ alignSelf: 'flex-start', fontSize: '0.8rem', marginTop: 2 }}
            >
              <Plus size={13} /> Add Part
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label className="label-caps">INSTRUCTIONS</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Step-by-step build instructions…"
            rows={10}
            style={{ marginTop: 6, width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.88rem' }}
          />
        </div>

        {/* Save */}
        {saveError && (
          <div className="inline-error">
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {saveError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Project'}
          </button>
          <button className="btn btn-ghost" onClick={goBack}>Cancel</button>
        </div>

      </div>
    </div>
  );
}

