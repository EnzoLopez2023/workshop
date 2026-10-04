import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Check, FolderOpen, Loader2, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button, IconButton } from './ui';
import {
  createLibraryShelfDesign, deleteLibraryShelfDesign, listLibraryShelfDesigns, updateLibraryShelfDesign,
} from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import { buildShelfPlan, readSavedShelfDesign, toSavedShelfDesign, type HeightMode, type LengthUnit, type SavedShelfDesign, type ShelfConfig } from '../lib/shelving';
import { designThumbnailSvg, SHELF_TEMPLATES, thumbnailDataUrl, type ShelfTemplate } from '../lib/shelfTemplates';
import type { LibraryShelfDesign } from '../types/project';

interface Props {
  config: ShelfConfig | null;
  units: LengthUnit;
  heightMode: HeightMode;
  /** The library design currently open, if any — "Save changes" updates it. */
  openId: number | null;
  /** Builds a preview config for a template (template fields are inches). */
  templateConfig: (template: ShelfTemplate) => ShelfConfig | null;
  onUseTemplate: (template: ShelfTemplate) => void;
  onOpen: (entry: { id: number; name: string; saved: SavedShelfDesign }) => void;
  onSaved: (entry: { id: number; name: string }) => void;
  onClose: () => void;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; designs: LibraryShelfDesign[] };

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'the request failed');

function thumbFor(config: ShelfConfig | null): string | null {
  if (!config) return null;
  const plan = buildShelfPlan(config);
  return plan.errors.length ? null : thumbnailDataUrl(designThumbnailSvg(plan, config.thickness));
}

function whenSaved(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ShelfLibrary({ config, units, heightMode, openId, templateConfig, onUseTemplate, onOpen, onSaved, onClose }: Props) {
  const demo = isDemoMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    listLibraryShelfDesigns()
      .then(designs => !cancelled && setLoad({ state: 'ready', designs }))
      .catch(err => !cancelled && setLoad({ state: 'error', message: errorText(err) }));
    return () => { cancelled = true; };
  }, [reloadKey]);

  const designs = load.state === 'ready' ? load.designs : [];
  const open = designs.find(d => d.id === openId) ?? null;
  const templateThumbs = useMemo(() => new Map(SHELF_TEMPLATES.map(t => [t.id, thumbFor(templateConfig(t))])), [templateConfig]);

  const replaceInList = (entry: LibraryShelfDesign) =>
    setLoad(prev => (prev.state === 'ready'
      ? { state: 'ready', designs: [entry, ...prev.designs.filter(d => d.id !== entry.id)] }
      : prev));

  const saveNew = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!config || busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setMessage({ ok: false, text: 'Give the design a name first.' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const entry = await createLibraryShelfDesign(trimmed, toSavedShelfDesign(config, units, heightMode));
      replaceInList(entry);
      onSaved({ id: entry.id, name: entry.name });
      setName('');
      setMessage({ ok: true, text: `Saved “${entry.name}” to your library.` });
    } catch (err) {
      setMessage({ ok: false, text: `The design wasn’t saved: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async () => {
    if (!config || !open || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const entry = await updateLibraryShelfDesign(open.id, { design: toSavedShelfDesign(config, units, heightMode) });
      replaceInList(entry);
      setMessage({ ok: true, text: `Saved your changes to “${entry.name}”.` });
    } catch (err) {
      setMessage({ ok: false, text: `Your changes weren’t saved: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming || busy) return;
    const trimmed = renaming.name.trim();
    if (!trimmed) { setMessage({ ok: false, text: 'A design needs a name.' }); return; }
    setBusy(true);
    try {
      const entry = await updateLibraryShelfDesign(renaming.id, { name: trimmed });
      replaceInList(entry);
      if (entry.id === openId) onSaved({ id: entry.id, name: entry.name });
      setRenaming(null);
      setMessage({ ok: true, text: `Renamed to “${entry.name}”.` });
    } catch (err) {
      setMessage({ ok: false, text: `It wasn’t renamed: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: LibraryShelfDesign) => {
    setBusy(true);
    try {
      await deleteLibraryShelfDesign(entry.id);
      setLoad(prev => (prev.state === 'ready' ? { state: 'ready', designs: prev.designs.filter(d => d.id !== entry.id) } : prev));
      setConfirmDelete(null);
      setMessage({ ok: true, text: `Deleted “${entry.name}”. Projects made from it keep their own copy.` });
    } catch (err) {
      setMessage({ ok: false, text: `“${entry.name}” wasn’t deleted: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const openEntry = (entry: LibraryShelfDesign) => {
    const saved = readSavedShelfDesign(entry.design);
    if (!saved) {
      setMessage({ ok: false, text: `“${entry.name}” couldn’t be read, so your current design was kept.` });
      return;
    }
    onOpen({ id: entry.id, name: entry.name, saved });
  };

  return (
    <section className="shelf-library" aria-labelledby="shelf-library-title">
      <header className="shelf-library-head">
        <h2 id="shelf-library-title">Design library</h2>
        <IconButton label="Close the library" onClick={onClose}><X size={18} aria-hidden="true" /></IconButton>
      </header>

      <div className="shelf-library-save">
        <h3>Save this design</h3>
        {demo ? (
          <p className="is-muted">Demo mode is read-only — sign in with Microsoft to save designs.</p>
        ) : (
          <>
            {open && (
              <Button variant="primary" onClick={() => void saveChanges()} disabled={busy || !config}>
                {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                Save changes to “{open.name}”
              </Button>
            )}
            <form className="shelf-library-new" onSubmit={e => void saveNew(e)}>
              <label className="form-field">
                <span className="form-field-label">{open ? 'Or save as a new design' : 'Name'}</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Garage wall, left of the door" maxLength={120} />
              </label>
              <Button type="submit" variant={open ? 'ghost' : 'primary'} disabled={busy || !config}>
                <Save size={16} aria-hidden="true" /> Save as new
              </Button>
            </form>
            {!config && <p className="shelf-library-error"><AlertCircle size={15} aria-hidden="true" /> Fix the highlighted measurements before saving.</p>}
          </>
        )}
        {message && (
          <p className={message.ok ? 'shelf-add-project-ok' : 'shelf-add-project-error'} role="status">
            {message.ok ? <Check size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
            <span>{message.text}</span>
          </p>
        )}
      </div>

      <div className="shelf-library-group">
        <h3>My designs</h3>
        {load.state === 'loading' && <p className="is-muted" role="status">Loading your designs…</p>}
        {load.state === 'error' && (
          <p className="shelf-library-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" /> Your designs couldn’t be loaded: {load.message}{' '}
            <button type="button" className="shelf-link-button" onClick={() => setReloadKey(k => k + 1)}>Try again</button>
          </p>
        )}
        {load.state === 'ready' && designs.length === 0 && (
          <p className="is-muted">Nothing saved yet. Save the current design above, or start from a template below.</p>
        )}
        {designs.length > 0 && (
          <ul className="shelf-library-list">
            {designs.map(entry => {
              const saved = readSavedShelfDesign(entry.design);
              const thumb = thumbFor(saved?.config ?? null);
              return (
                <li key={entry.id} className={entry.id === openId ? 'is-open' : undefined}>
                  {thumb ? <img src={thumb} alt="" /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                  <div className="shelf-library-entry">
                    {renaming?.id === entry.id ? (
                      <form className="shelf-library-rename" onSubmit={e => void rename(e)}>
                        <input
                          value={renaming.name}
                          onChange={e => setRenaming({ id: entry.id, name: e.target.value })}
                          aria-label={`New name for ${entry.name}`}
                          maxLength={120}
                          autoFocus
                        />
                        <Button type="submit" variant="ghost" disabled={busy}>Save</Button>
                        <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <>
                        <strong>{entry.name}{entry.id === openId ? <span className="shelf-optional"> open</span> : null}</strong>
                        <small>Saved {whenSaved(entry.updated_at)}{saved ? '' : ' · can’t be read'}</small>
                      </>
                    )}
                  </div>
                  {confirmDelete === entry.id ? (
                    <span className="shelf-library-actions">
                      <span className="is-muted">Delete for good?</span>
                      <Button variant="danger" onClick={() => void remove(entry)} disabled={busy}>Delete</Button>
                      <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                    </span>
                  ) : (
                    <span className="shelf-library-actions">
                      <Button variant="ghost" onClick={() => openEntry(entry)} disabled={!saved}>
                        <FolderOpen size={16} aria-hidden="true" /> Open
                      </Button>
                      {!demo && (
                        <>
                          <IconButton label={`Rename ${entry.name}`} onClick={() => setRenaming({ id: entry.id, name: entry.name })}>
                            <Pencil size={16} aria-hidden="true" />
                          </IconButton>
                          <IconButton label={`Delete ${entry.name}`} onClick={() => setConfirmDelete(entry.id)}>
                            <Trash2 size={16} aria-hidden="true" />
                          </IconButton>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shelf-library-group">
        <h3>Templates</h3>
        <ul className="shelf-library-templates">
          {SHELF_TEMPLATES.map(template => {
            const thumb = templateThumbs.get(template.id);
            return (
              <li key={template.id}>
                {thumb ? <img src={thumb} alt="" /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                <strong>{template.name}</strong>
                <small>{template.description}</small>
                <Button variant="ghost" onClick={() => onUseTemplate(template)}>Start from this</Button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
