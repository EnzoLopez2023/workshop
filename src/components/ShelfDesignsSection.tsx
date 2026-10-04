import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import { Button, SectionRail } from './ui';
import { deleteLibraryShelfDesign, listLibraryShelfDesigns } from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import { buildShelfPlan, formatLength, readSavedShelfDesign } from '../lib/shelving';
import { designThumbnailSvg, thumbnailDataUrl } from '../lib/shelfTemplates';
import type { LibraryShelfDesign } from '../types/project';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; designs: LibraryShelfDesign[] };

/** Thumbnail and a one-line size summary, or null when the saved design can't be read. */
function describe(entry: LibraryShelfDesign): { thumb: string; summary: string } | null {
  const saved = readSavedShelfDesign(entry.design);
  if (!saved) return null;
  const plan = buildShelfPlan(saved.config);
  if (plan.errors.length) return null;
  const f = (inches: number) => formatLength(inches, saved.units);
  const bays = plan.bays.length;
  return {
    thumb: thumbnailDataUrl(designThumbnailSvg(plan, saved.config.thickness)),
    summary: `${f(plan.overallWidth)} × ${f(plan.overallHeight)} · ${bays} bay${bays === 1 ? '' : 's'}${plan.doors.length ? ` · ${plan.doors.length} door${plan.doors.length === 1 ? '' : 's'}` : ''}`,
  };
}

function savedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Saved Shelf Builder designs on the Projects page, each one click from editing. */
export default function ShelfDesignsSection() {
  const navigate = useNavigate();
  const demo = isDemoMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLibraryShelfDesigns()
      .then(designs => !cancelled && setLoad({ state: 'ready', designs }))
      .catch(err => !cancelled && setLoad({ state: 'error', message: err instanceof Error && err.message ? err.message : 'the request failed' }));
    return () => { cancelled = true; };
  }, []);

  const remove = async (entry: LibraryShelfDesign) => {
    setError(null);
    try {
      await deleteLibraryShelfDesign(entry.id);
      setLoad(prev => (prev.state === 'ready' ? { state: 'ready', designs: prev.designs.filter(d => d.id !== entry.id) } : prev));
    } catch (err) {
      setError(`“${entry.name}” wasn’t deleted: ${err instanceof Error && err.message ? err.message : 'the request failed'}`);
    } finally {
      setConfirmDelete(null);
    }
  };

  const designs = load.state === 'ready' ? load.designs : [];

  return (
    <section className="dashboard-section" aria-labelledby="shelf-designs-title">
      <SectionRail
        title={<span id="shelf-designs-title"><Rows3 size={16} aria-hidden="true" /> Shelf designs</span>}
        count={load.state === 'ready' ? designs.length : '—'}
        actions={(
          <Button variant="ghost" onClick={() => navigate('/shelves')}>
            <Plus size={16} aria-hidden="true" /> New shelf design
          </Button>
        )}
      />
      {load.state === 'loading' && <p className="is-muted" role="status">Loading your shelf designs…</p>}
      {load.state === 'error' && (
        <p className="inline-error" role="alert">Your shelf designs couldn’t be loaded: {load.message}</p>
      )}
      {load.state === 'ready' && designs.length === 0 && (
        <p className="is-muted">
          Designs you save in the <Link to="/shelves">Shelf Builder</Link> appear here, ready to open and keep editing.
        </p>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {designs.length > 0 && (
        <div className="shelf-designs-grid">
          {designs.map(entry => {
            const info = describe(entry);
            return (
              <article key={entry.id} className="card shelf-design-card">
                <Link to={`/shelves?design=${entry.id}`} aria-label={`Edit ${entry.name}`}>
                  {info ? <img src={info.thumb} alt="" /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                </Link>
                <h3>{entry.name}</h3>
                <p>{info ? info.summary : 'This design can’t be read'}</p>
                <p>{savedOn(entry.updated_at)}</p>
                <div className="shelf-design-card-actions">
                  {confirmDelete === entry.id ? (
                    <>
                      <Button variant="danger" onClick={() => void remove(entry)}>Delete</Button>
                      <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => navigate(`/shelves?design=${entry.id}`)} disabled={!info}>
                        <Pencil size={16} aria-hidden="true" /> Edit
                      </Button>
                      {!demo && (
                        <Button variant="ghost" onClick={() => setConfirmDelete(entry.id)} aria-label={`Delete ${entry.name}`}>
                          <Trash2 size={17} aria-hidden="true" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
