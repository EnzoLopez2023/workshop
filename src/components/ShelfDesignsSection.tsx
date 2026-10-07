import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import { Button, SectionRail } from './ui';
import { deleteLibraryDrawerDesign, deleteLibraryShelfDesign, listLibraryDrawerDesigns, listLibraryShelfDesigns } from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import { buildShelfPlan, formatLength, readSavedShelfDesign } from '../lib/shelving';
import { designThumbnailSvg, thumbnailDataUrl } from '../lib/shelfTemplates';
import { BASE_LABELS, buildDrawerPlan, readSavedDrawerDesign } from '../lib/drawerUnit';
import { drawerThumbnailDataUrl } from '../lib/drawerTemplates';
import type { LibraryShelfDesign } from '../types/project';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; designs: LibraryShelfDesign[] };

type Described = { thumb: string; summary: string } | null;

/** Thumbnail and a one-line size summary, or null when the saved design can't be read. */
function describeShelf(entry: LibraryShelfDesign): Described {
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

function describeDrawers(entry: LibraryShelfDesign): Described {
  const saved = readSavedDrawerDesign(entry.design);
  if (!saved) return null;
  const plan = buildDrawerPlan(saved.config);
  if (plan.errors.length) return null;
  const f = (inches: number) => formatLength(inches, saved.units);
  const n = plan.drawers.filter(d => !d.open).length;
  const base = saved.config.base !== 'none' && plan.mount === 'floor' ? ` · ${BASE_LABELS[saved.config.base].toLowerCase()}` : '';
  return {
    thumb: drawerThumbnailDataUrl(plan, saved.config.pull, 120, saved.config.finish?.front),
    summary: `${f(plan.overallWidth)} × ${f(plan.overallHeight)} · ${n} drawer${n === 1 ? '' : 's'}${base}`,
  };
}

function savedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

interface SectionProps {
  id: string;
  title: string;
  icon: ReactNode;
  /** Builder route, e.g. /shelves. */
  path: string;
  builder: string;
  noun: string;
  list: () => Promise<LibraryShelfDesign[]>;
  remove: (id: number) => Promise<unknown>;
  describe: (entry: LibraryShelfDesign) => Described;
}

/** Saved Shelf Builder designs on the Projects page, each one click from editing. */
export default function ShelfDesignsSection() {
  return (
    <DesignsSection
      id="shelf-designs-title" title="Shelf designs" icon={<Rows3 size={16} aria-hidden="true" />} path="/shelves"
      builder="Shelf Builder" noun="shelf" list={listLibraryShelfDesigns} remove={deleteLibraryShelfDesign} describe={describeShelf}
    />
  );
}

/** Saved Drawer Builder designs, the same way. */
export function DrawerDesignsSection() {
  return (
    <DesignsSection
      id="drawer-designs-title" title="Drawer designs" icon={<Archive size={16} aria-hidden="true" />} path="/drawers"
      builder="Drawer Builder" noun="drawer" list={listLibraryDrawerDesigns} remove={deleteLibraryDrawerDesign} describe={describeDrawers}
    />
  );
}

function DesignsSection({ id, title, icon, path, builder, noun, list, remove: removeDesign, describe }: SectionProps) {
  const navigate = useNavigate();
  const demo = isDemoMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    list()
      .then(designs => !cancelled && setLoad({ state: 'ready', designs }))
      .catch(err => !cancelled && setLoad({ state: 'error', message: err instanceof Error && err.message ? err.message : 'the request failed' }));
    return () => { cancelled = true; };
  }, [list]);

  const remove = async (entry: LibraryShelfDesign) => {
    setError(null);
    try {
      await removeDesign(entry.id);
      setLoad(prev => (prev.state === 'ready' ? { state: 'ready', designs: prev.designs.filter(d => d.id !== entry.id) } : prev));
    } catch (err) {
      setError(`“${entry.name}” wasn’t deleted: ${err instanceof Error && err.message ? err.message : 'the request failed'}`);
    } finally {
      setConfirmDelete(null);
    }
  };

  const designs = load.state === 'ready' ? load.designs : [];

  return (
    <section className="dashboard-section" aria-labelledby={id}>
      <SectionRail
        title={<span id={id}>{icon} {title}</span>}
        count={load.state === 'ready' ? designs.length : '—'}
        actions={(
          <Button variant="ghost" onClick={() => navigate(path)}>
            <Plus size={16} aria-hidden="true" /> New {noun} design
          </Button>
        )}
      />
      {load.state === 'loading' && <p className="is-muted" role="status">Loading your {noun} designs…</p>}
      {load.state === 'error' && (
        <p className="inline-error" role="alert">Your {noun} designs couldn’t be loaded: {load.message}</p>
      )}
      {load.state === 'ready' && designs.length === 0 && (
        <p className="is-muted">
          Designs you save in the <Link to={path}>{builder}</Link> appear here, ready to open and keep editing.
        </p>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {designs.length > 0 && (
        <div className="shelf-designs-grid">
          {designs.map(entry => {
            const info = describe(entry);
            return (
              <article key={entry.id} className="card shelf-design-card">
                <Link to={`${path}?design=${entry.id}`} aria-label={`Edit ${entry.name}`}>
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
                      <Button onClick={() => navigate(`${path}?design=${entry.id}`)} disabled={!info}>
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
