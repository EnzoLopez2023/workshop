import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Box, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileBox, FolderOpen, FolderInput, Heart, Printer,
  RotateCw, Trash2, XCircle,
} from 'lucide-react';
import {
  deleteLibraryPrint, getLibraryModel, libraryThumbUrl, listBambuProjects, listLibraryModelIds, logLibraryPrint,
  updateLibraryModel,
  type LibraryModelUpdate,
} from '../services/api';
import type { BambuProject, LibraryFile, LibraryModelDetail as Detail, LibraryStatus } from '../types/project';
import { LIBRARY_STATUS_LABELS } from '../types/project';
import {
  LIBRARY_STATUS_ORDER, LIBRARY_STATUS_TONE, categoryLabel, formatBytes, formatDimensions, formatDuration,
  formatGrams, relativeDate, sourceLabel,
} from '../lib/library';
import { libraryFiltersQuery, readLibraryFilters } from '../lib/libraryFilters';
import { libraryHelper, useLibraryHelper } from '../lib/libraryHelper';
import { Button, IconButton, PageFrame, SectionRail, StatePanel } from '../components/ui';
import { isDemoMode } from '../demo/demoMode';

const ModelViewer3D = lazy(() => import('../components/ModelViewer3D'));

/** The file Bambu Studio should open: an editable 3MF project first, then a sliced one, then meshes. */
function primaryFile(files: LibraryFile[]) {
  return files.find(f => f.kind === '3mf' && !f.is_sliced)
    ?? files.find(f => f.kind === '3mf')
    ?? files.find(f => f.kind === 'stl')
    ?? files[0]
    ?? null;
}

/**
 * Steps through the Library hub's current filtered list with Previous/Next and
 * the arrow keys. The order is captured once when the page opens, so an edit
 * that moves this model out of the filter doesn't reshuffle the sequence.
 */
export default function LibraryModelDetailRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLibraryModelIds(libraryFiltersQuery(readLibraryFilters()))
      .then(result => { if (!cancelled) setIds(result.ids); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const index = ids ? ids.indexOf(id) : -1;
  const prevId = ids && index > 0 ? ids[index - 1] : null;
  const nextId = ids && index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  // Replace, so the browser's Back still returns to the Library rather than through every model.
  const go = useCallback((target: string | null) => {
    if (target) navigate(`/library/${encodeURIComponent(target)}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (index < 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"]'))) return;
      const destination = event.key === 'ArrowLeft' ? prevId : nextId;
      if (!destination) return;
      event.preventDefault();
      go(destination);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, prevId, nextId, go]);

  const stepper = ids && index >= 0 && ids.length > 1 ? (
    <nav className="library-stepper" aria-label="Browse filtered models">
      <IconButton label="Previous model (←)" disabled={!prevId} onClick={() => go(prevId)}>
        <ChevronLeft size={18} aria-hidden="true" />
      </IconButton>
      <span className="library-stepper-count" aria-live="polite">{index + 1} of {ids.length}</span>
      <IconButton label="Next model (→)" disabled={!nextId} onClick={() => go(nextId)}>
        <ChevronRight size={18} aria-hidden="true" />
      </IconButton>
    </nav>
  ) : null;

  // Keyed by id so per-model state (images, viewer file, drafts) starts fresh on each step.
  return <LibraryModelDetail key={id} id={id} stepper={stepper} />;
}

function LibraryModelDetail({ id, stepper }: { id: string; stepper: ReactNode }) {
  const helper = useLibraryHelper();
  const demo = isDemoMode();
  const [model, setModel] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'image' | '3d'>('image');
  const [image, setImage] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<LibraryFile | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [bambuProjects, setBambuProjects] = useState<BambuProject[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getLibraryModel(id);
      setModel(next);
      setNotes(next.notes);
      setTitle(next.title);
      setImage(current => current ?? next.thumb_hash);
      setViewerFile(current => current ?? next.files.find(f => f.kind === 'stl' || f.kind === '3mf') ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model not found');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!helper.available) return;
    libraryHelper.categories().then(r => setCategories(r.categories)).catch(() => undefined);
  }, [helper.available]);

  useEffect(() => {
    if (demo) return;
    listBambuProjects().then(setBambuProjects).catch(() => undefined);
  }, [demo]);

  const save = async (update: LibraryModelUpdate, success?: string) => {
    if (!model) return;
    try {
      const next = await updateLibraryModel(model.id, update);
      setModel(current => (current ? { ...current, ...next } : current));
      if (success) toast.success(success);
    } catch (err) {
      toast.error('Could not save', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const runHelper = async (label: string, job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
      toast.success(label);
    } catch (err) {
      toast.error(`${label} failed`, { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const logPrint = async (result: 'completed' | 'failed') => {
    if (!model) return;
    try {
      await logLibraryPrint(model.id, { result });
      toast.success(result === 'completed' ? 'Print logged' : 'Failed print logged');
      await load();
    } catch (err) {
      toast.error('Could not log the print', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const moveModel = async () => {
    const target = (moveTo === '__new' ? newCategory : moveTo).trim();
    if (!model || !target) return;
    await runHelper(`Moved to ${categoryLabel(target)}`, async () => {
      await libraryHelper.file(model.id, target);
      setModel(current => (current ? { ...current, category: target } : current));
      setMoveTo('');
      setNewCategory('');
    });
  };

  const addTag = (event: FormEvent) => {
    event.preventDefault();
    if (!model) return;
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.length) return;
    void save({ tags: [...model.tags, ...tags] });
    setTagInput('');
  };

  if (error) {
    return (
      <PageFrame maxWidth={1100}>
        <StatePanel title="Model unavailable" description={error} tone="danger" action={<Link className="btn btn-muted" to="/">Back to Library</Link>} />
      </PageFrame>
    );
  }
  if (!model) {
    return <PageFrame maxWidth={1100}><p className="page-sub" role="status">Loading model…</p></PageFrame>;
  }

  const primary = primaryFile(model.files);
  const images = [model.thumb_hash, ...model.gallery].filter((h): h is string => Boolean(h));
  const canView = helper.available && viewerFile && (viewerFile.kind === 'stl' || viewerFile.kind === '3mf');
  const helperHint = helper.available ? undefined : 'Available on your Mac while the Library helper is running';
  const source = sourceLabel(model.source_site);

  return (
    <PageFrame maxWidth={1100} className="library-detail">
      <div className="library-detail-nav">
        <Link to="/" className="library-back"><ArrowLeft size={16} aria-hidden="true" /> Library</Link>
        {stepper}
      </div>

      <header className="library-detail-head">
        <form
          className="library-title-form"
          onSubmit={event => {
            event.preventDefault();
            if (title.trim() && title !== model.title) void save({ title: title.trim() }, 'Title saved');
          }}
        >
          <label className="sr-only" htmlFor="library-title">Title</label>
          <input
            id="library-title"
            className="library-title-input"
            value={title}
            disabled={demo}
            onChange={event => setTitle(event.target.value)}
            onBlur={() => title.trim() && title !== model.title && void save({ title: title.trim() })}
          />
        </form>
        <div className="library-detail-meta">
          <span className={`pill ${LIBRARY_STATUS_TONE[model.status]}`}>{LIBRARY_STATUS_LABELS[model.status]}</span>
          <span>{categoryLabel(model.category)}</span>
          {model.designer && <span>by {model.designer}</span>}
          {model.state === 'missing' && <span className="pill flag-red">Missing on disk</span>}
          <IconButton
            label={model.favorite ? 'Remove favorite' : 'Mark favorite'}
            aria-pressed={model.favorite}
            className={model.favorite ? 'library-favorite-on' : undefined}
            disabled={demo}
            onClick={() => void save({ favorite: !model.favorite })}
          >
            <Heart size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <div className="library-detail-grid">
        <section className="library-media card" aria-label="Preview">
          {helper.available && (
            <div className="segmented-control library-media-toggle" role="group" aria-label="Preview mode">
              <button type="button" aria-pressed={view === 'image'} onClick={() => setView('image')}>Images</button>
              <button type="button" aria-pressed={view === '3d'} disabled={!canView} onClick={() => setView('3d')}>3D</button>
            </div>
          )}
          {view === '3d' && canView && viewerFile ? (
            <Suspense fallback={<div className="library-viewer"><p className="library-viewer-status">Loading viewer…</p></div>}>
              <ModelViewer3D
                url={libraryHelper.fileUrl(model.id, viewerFile.rel_path)}
                kind={viewerFile.kind as 'stl' | '3mf'}
                label={viewerFile.filename}
              />
            </Suspense>
          ) : (
            <div className="library-media-main">
              {image ? <img src={libraryThumbUrl(image)} alt={`${model.title} preview`} /> : (
                <span className="bambu-card-placeholder" aria-hidden="true"><Box size={64} strokeWidth={1.2} /></span>
              )}
            </div>
          )}
          {images.length > 1 && view === 'image' && (
            <div className="library-thumbs" role="list" aria-label="Plates and parts">
              {images.map(hash => (
                <button key={hash} type="button" role="listitem" aria-pressed={image === hash} onClick={() => setImage(hash)}>
                  <img src={libraryThumbUrl(hash)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="library-side">
          <div className="library-actions card">
            <Button
              variant="primary"
              disabled={!helper.available || !primary || busy}
              title={helperHint}
              onClick={() => primary && void runHelper('Opened in Bambu Studio', () => libraryHelper.open(model.id, primary.rel_path))}
            >
              <Printer size={16} aria-hidden="true" /> Open in Bambu Studio
            </Button>
            <Button
              disabled={!helper.available || busy}
              title={helperHint}
              onClick={() => void runHelper('Revealed in Finder', () => libraryHelper.reveal(model.id))}
            >
              <FolderOpen size={16} aria-hidden="true" /> Reveal in Finder
            </Button>
            <div className="library-action-row">
              <Button variant="ghost" disabled={demo} onClick={() => void logPrint('completed')}>
                <CheckCircle2 size={16} aria-hidden="true" /> Printed it
              </Button>
              <Button variant="ghost" disabled={demo} onClick={() => void logPrint('failed')}>
                <XCircle size={16} aria-hidden="true" /> Print failed
              </Button>
            </div>
            {!helper.available && !helper.checking && (
              <p className="library-hint">
                File actions work on the Mac that holds your library, while <code>workshop-library serve</code> is running.
              </p>
            )}
          </div>

          <div className="library-panel card">
            <label className="library-field">
              <span className="stat-label">Status</span>
              <select value={model.status} disabled={demo} onChange={event => void save({ status: event.target.value as LibraryStatus })}>
                {LIBRARY_STATUS_ORDER.map(s => <option key={s} value={s}>{LIBRARY_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
            <div className="library-field">
              <span className="stat-label">Category</span>
              <div className="library-move">
                <select value={moveTo} disabled={!helper.available} title={helperHint} onChange={event => setMoveTo(event.target.value)}>
                  <option value="">{categoryLabel(model.category)}</option>
                  {categories.filter(c => c !== model.category).map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                  <option value="__new">New category…</option>
                </select>
                {moveTo === '__new' && (
                  <input value={newCategory} placeholder="Category name" onChange={event => setNewCategory(event.target.value)} />
                )}
                <Button disabled={!moveTo || busy} onClick={() => void moveModel()}>
                  <FolderInput size={16} aria-hidden="true" /> Move
                </Button>
              </div>
            </div>
            <div className="library-field">
              <span className="stat-label">Tags</span>
              <div className="library-tags">
                {model.tags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    className="chip library-tag"
                    disabled={demo}
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => void save({ tags: model.tags.filter(t => t !== tag) })}
                  >
                    {tag} <span aria-hidden="true">×</span>
                  </button>
                ))}
                <form onSubmit={addTag}>
                  <input value={tagInput} disabled={demo} placeholder="Add tag" aria-label="Add tag" onChange={event => setTagInput(event.target.value)} />
                </form>
              </div>
            </div>
            <label className="library-field">
              <span className="stat-label">Bambu Hub project</span>
              <select
                value={model.bambu_project_id ?? ''}
                disabled={demo}
                onChange={event => void save({ bambu_project_id: event.target.value ? Number(event.target.value) : null }, 'Link saved')}
              >
                <option value="">Not linked</option>
                {bambuProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {model.bambu_project_id && <Link to={`/bambu/${model.bambu_project_id}`}>Open project</Link>}
            </label>
          </div>

          <dl className="library-facts card">
            <div>
              <dt>Print estimate</dt>
              <dd className="readout">
                {model.est_seconds || model.est_grams != null
                  ? `${formatDuration(model.est_seconds)} · ${formatGrams(model.est_grams)}`
                  : 'Not sliced yet'}
              </dd>
            </div>
            <div><dt>Size</dt><dd className="readout">{formatDimensions(model.bbox)}</dd></div>
            <div><dt>Plates</dt><dd className="readout">{model.plate_count || '—'}</dd></div>
            <div><dt>Printer</dt><dd>{model.printer ?? '—'}</dd></div>
            {model.filaments.length > 0 && (
              <div>
                <dt>Filaments</dt>
                <dd className="library-swatches">
                  {model.filaments.map((f, i) => (
                    <span key={i} className="library-swatch" title={`${f.type ?? ''} ${f.color ?? ''}`.trim()}>
                      <span style={{ background: f.color ?? 'transparent' }} aria-hidden="true" />
                      {f.type}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {source && (
              <div>
                <dt>Source</dt>
                <dd>
                  {model.source_url
                    ? <a href={model.source_url} target="_blank" rel="noreferrer">{source} <ExternalLink size={12} aria-hidden="true" /></a>
                    : source}
                </dd>
              </div>
            )}
            {model.license && <div><dt>License</dt><dd>{model.license}</dd></div>}
            <div><dt>Folder</dt><dd className="library-path">{model.folder ?? '—'}</dd></div>
            <div><dt>Added</dt><dd>{relativeDate(model.first_seen_at)}</dd></div>
          </dl>
        </aside>
      </div>

      <section className="library-section">
        <SectionRail title={<span><FileBox size={16} aria-hidden="true" /> Files</span>} count={`${model.files.length} · ${formatBytes(model.total_bytes)}`} />
        <ul className="library-files">
          {model.files.map(file => (
            <li key={file.id}>
              <span className={`library-format library-format-${file.is_sliced ? 'sliced' : file.kind}`}>{file.is_sliced ? 'Sliced' : file.kind.toUpperCase()}</span>
              <span className="library-file-name">
                <strong>{file.filename}</strong>
                <small>
                  {formatBytes(file.size)}
                  {file.triangles ? ` · ${file.triangles.toLocaleString()} triangles` : ''}
                  {file.bbox ? ` · ${formatDimensions(file.bbox)}` : ''}
                  {file.is_sliced ? ` · ${formatDuration(file.seconds)} · ${formatGrams(file.grams)}` : ''}
                </small>
              </span>
              <span className="library-file-actions">
                {helper.available && (file.kind === 'stl' || file.kind === '3mf') && (
                  <IconButton label="View in 3D" onClick={() => { setViewerFile(file); setView('3d'); }}>
                    <RotateCw size={16} aria-hidden="true" />
                  </IconButton>
                )}
                <IconButton label="Open in Bambu Studio" disabled={!helper.available} onClick={() => void runHelper('Opened in Bambu Studio', () => libraryHelper.open(model.id, file.rel_path))}>
                  <Printer size={16} aria-hidden="true" />
                </IconButton>
                <IconButton label="Reveal in Finder" disabled={!helper.available} onClick={() => void runHelper('Revealed in Finder', () => libraryHelper.reveal(model.id, file.rel_path))}>
                  <FolderOpen size={16} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Move file to Trash"
                  disabled={!helper.available || busy}
                  onClick={() => {
                    if (!window.confirm(`Move “${file.filename}” to the Trash? You can undo this from Organize → History.`)) return;
                    void runHelper('Moved to Trash', async () => {
                      await libraryHelper.trashFile(model.id, file.rel_path);
                      setModel(current => (current ? { ...current, files: current.files.filter(f => f.id !== file.id) } : current));
                    });
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="library-section">
        <SectionRail title={<span><Printer size={16} aria-hidden="true" /> Print log</span>} count={model.printed_count ? `${model.printed_count} printed` : undefined} />
        {model.prints.length === 0 ? (
          <p className="library-hint">No prints yet. Prints from ShapePilot's Bambu history link here automatically when their names match.</p>
        ) : (
          <ol className="library-prints">
            {model.prints.map(p => (
              <li key={p.id}>
                <span className={`pill ${p.result === 'completed' ? 'flag-green' : p.result === 'failed' ? 'flag-red' : 'flag-idle'}`}>
                  {p.result === 'completed' ? 'Printed' : p.result === 'failed' ? 'Failed' : p.result}
                </span>
                <span>
                  <strong>{relativeDate(p.started_at)}</strong>
                  <small>
                    {p.source === 'shapepilot' ? `Bambu job “${p.title}”` : 'Logged by hand'}
                    {p.seconds ? ` · ${formatDuration(p.seconds)}` : ''}
                    {p.grams ? ` · ${formatGrams(p.grams)}` : ''}
                    {p.notes ? ` · ${p.notes}` : ''}
                  </small>
                </span>
                {p.source === 'manual' && !demo && (
                  <IconButton label="Delete this entry" onClick={() => void deleteLibraryPrint(p.id).then(load)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="library-section">
        <SectionRail title="Notes" />
        <textarea
          className="library-notes"
          value={notes}
          disabled={demo}
          placeholder="Settings that worked, filament, what to change next time…"
          onChange={event => setNotes(event.target.value)}
          onBlur={() => notes !== model.notes && void save({ notes }, 'Notes saved')}
        />
      </section>

      {model.description && (
        <details className="library-section library-description">
          <summary>Designer's description</summary>
          <p>{model.description}</p>
        </details>
      )}
    </PageFrame>
  );
}
