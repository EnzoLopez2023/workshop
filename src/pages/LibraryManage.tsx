import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Filter, FolderPlus, Plus, RefreshCw } from 'lucide-react';
import {
  createLibraryCollection, deleteLibraryCollection, getLibraryOverview, listLibraryCollections, updateLibraryCollection,
} from '../services/api';
import type { LibraryCollection } from '../types/project';
import { LIBRARY_STATUS_LABELS } from '../types/project';
import { categoryLabel } from '../lib/library';
import { HELPER_CATEGORY_VERSION, libraryHelper, useLibraryHelper, type HelperCategory } from '../lib/libraryHelper';
import {
  LIBRARY_FORMATS, LIBRARY_SORTS, filtersForCollection, readLibraryFilters, writeLibraryFilters,
} from '../lib/libraryFilters';
import { DASHBOARD_PAGE_STORAGE_KEY } from '../navigation';
import { isDemoMode } from '../demo/demoMode';
import { Button, PageFrame, PageHeader, SectionRail, StatePanel } from '../components/ui';

const HELPER_RESTART = 'launchctl kickstart -k gui/$(id -u)/com.nintek.workshop-library.helper';

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/** Keeps the Library hub's remembered category pointing at the right folder after a change. */
function followCategory(from: string, to: string) {
  const filters = readLibraryFilters();
  if (filters.category === from) writeLibraryFilters({ ...filters, category: to });
}

export default function LibraryManage() {
  return (
    <PageFrame className="library-manage" maxWidth={900}>
      <Link to="/" className="library-back"><ArrowLeft size={16} aria-hidden="true" /> Library</Link>
      <PageHeader
        title="Categories & collections"
        description="Categories are the folders your models live in on your Mac. Collections group models across categories without moving any files."
      />
      <Categories />
      <Collections />
    </PageFrame>
  );
}

// ── Categories ────────────────────────────────────────────────────────────────

function Categories() {
  const helper = useLibraryHelper();
  const capable = helper.available && (helper.health?.version ?? 0) >= HELPER_CATEGORY_VERSION;
  const [details, setDetails] = useState<HelperCategory[] | null>(null);
  const [synced, setSynced] = useState<{ category: string; count: number }[] | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (capable) {
      libraryHelper.categories().then(r => setDetails(r.details ?? [])).catch(() => setDetails([]));
    } else {
      getLibraryOverview().then(o => setSynced(o.byCategory)).catch(() => setSynced([]));
    }
  }, [capable]);

  useEffect(load, [load]);

  /** Runs a helper change, then offers Undo (every category change is logged on the Mac). */
  const run = async (job: () => Promise<{ batch: string | null }>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      const { batch } = await job();
      after?.();
      if (batch) {
        toast.success(success, {
          action: {
            label: 'Undo',
            onClick: () => {
              libraryHelper.undo(batch)
                .then(() => {
                  toast.success('Undone');
                  load();
                })
                .catch(err => toast.error('Undo failed', { description: errorText(err) }));
            },
          },
        });
      }
      load();
    } catch (err) {
      toast.error('Category change failed', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run(() => libraryHelper.createCategory(name), `Created ${name}`, () => setNewName(''));
  };

  return (
    <section className="library-section" aria-labelledby="manage-categories">
      <SectionRail title={<span id="manage-categories">Categories</span>} count={capable ? details?.length ?? '—' : synced?.length ?? '—'} />
      {helper.checking ? (
        <p className="page-sub" role="status">Looking for the Library helper on this Mac…</p>
      ) : !helper.available ? (
        <>
          <p className="library-hint">
            Renaming or merging a category moves folders on the Mac that holds your library, so it works there while the
            Library helper is running. Here is what Workshop last synced:
          </p>
          <SyncedCategories categories={synced} />
        </>
      ) : !capable ? (
        <>
          <div className="library-callout">
            <RefreshCw size={22} aria-hidden="true" />
            <div>
              <strong>Restart the Library helper to manage categories</strong>
              <p>The helper running on this Mac predates category management. Restart it in Terminal, then check again:</p>
              <code className="library-command">{HELPER_RESTART}</code>
            </div>
            <Button onClick={helper.recheck}>Check again</Button>
          </div>
          <SyncedCategories categories={synced} />
        </>
      ) : details === null ? (
        <p className="page-sub" role="status">Loading categories…</p>
      ) : (
        <>
          <ul className="library-manage-list">
            {details.map(category => (
              <CategoryRow key={category.name} category={category} all={details} busy={busy} run={run} />
            ))}
          </ul>
          <form className="library-inline-form library-manage-new" onSubmit={create}>
            <input
              value={newName}
              maxLength={120}
              placeholder="New category name"
              aria-label="New category name"
              onChange={event => setNewName(event.target.value)}
            />
            <Button type="submit" disabled={!newName.trim() || busy}>
              <FolderPlus size={16} aria-hidden="true" /> Create category
            </Button>
          </form>
        </>
      )}
    </section>
  );
}

function SyncedCategories({ categories }: { categories: { category: string; count: number }[] | null }) {
  if (!categories) return <p className="page-sub" role="status">Loading categories…</p>;
  if (!categories.length) return <StatePanel title="No categories yet" description="Categories appear once your Mac syncs organized models." />;
  return (
    <ul className="library-manage-list">
      {categories.map(c => (
        <li key={c.category} className="library-manage-row card">
          <div className="library-manage-name">
            <strong>{categoryLabel(c.category)}</strong>
            <small>{c.count} model{c.count === 1 ? '' : 's'}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Run = (job: () => Promise<{ batch: string | null }>, success: string, after?: () => void) => Promise<void>;

function CategoryRow({ category, all, busy, run }: { category: HelperCategory; all: HelperCategory[]; busy: boolean; run: Run }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'merge'>('view');
  const [name, setName] = useState(category.name);
  const [into, setInto] = useState('');
  const targets = all.filter(c => c.name !== category.name);
  const models = `${category.models} model${category.models === 1 ? '' : 's'}`;

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const to = name.trim();
    if (!to || to === category.name) return setMode('view');
    void run(
      () => libraryHelper.renameCategory(category.name, to),
      `Renamed ${category.name} to ${to}`,
      () => followCategory(category.name, to),
    );
  };

  const merge = () => {
    if (!into) return;
    void run(
      () => libraryHelper.mergeCategory(category.name, into),
      `Moved ${models} from ${category.name} into ${categoryLabel(into)}`,
      () => followCategory(category.name, into),
    );
  };

  return (
    <li className="library-manage-row card">
      {mode === 'rename' ? (
        <form className="library-inline-form" onSubmit={rename}>
          <input
            autoFocus
            value={name}
            maxLength={120}
            aria-label={`New name for ${category.name}`}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => event.key === 'Escape' && setMode('view')}
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>Rename</Button>
          <Button variant="ghost" onClick={() => { setName(category.name); setMode('view'); }}>Cancel</Button>
        </form>
      ) : (
        <div className="library-manage-name">
          <strong>{categoryLabel(category.name)}</strong>
          <small>{models}{category.protected ? ' · managed by the organizer' : ''}</small>
        </div>
      )}
      {mode === 'merge' && (
        <div className="library-inline-form">
          <select value={into} aria-label={`Merge ${category.name} into`} onChange={event => setInto(event.target.value)}>
            <option value="">Merge into…</option>
            {targets.map(c => <option key={c.name} value={c.name}>{categoryLabel(c.name)}</option>)}
          </select>
          <Button variant="primary" disabled={!into || busy} onClick={merge}>Merge</Button>
          <Button variant="ghost" onClick={() => { setInto(''); setMode('view'); }}>Cancel</Button>
        </div>
      )}
      {mode === 'view' && !category.protected && (
        <div className="library-manage-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setMode('rename')}>Rename</Button>
          {targets.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => setMode('merge')}>Merge…</Button>}
          {category.models === 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(
                () => libraryHelper.deleteCategory(category.name),
                `Removed ${category.name}`,
                () => followCategory(category.name, ''),
              )}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Collections ───────────────────────────────────────────────────────────────

function describeSmart(collection: LibraryCollection) {
  const q = collection.query ?? {};
  const parts = [
    q.q && `“${q.q}”`,
    q.status && LIBRARY_STATUS_LABELS[q.status],
    q.category && categoryLabel(q.category),
    q.format && LIBRARY_FORMATS.find(f => f.value === q.format)?.label,
    q.sort && q.sort !== 'recent' && LIBRARY_SORTS.find(s => s.value === q.sort)?.label,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Every model';
}

function Collections() {
  const demo = isDemoMode();
  const navigate = useNavigate();
  const [collections, setCollections] = useState<LibraryCollection[] | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(() => {
    listLibraryCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  useEffect(load, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await createLibraryCollection({ name, kind: 'manual' });
      setNewName('');
      load();
    } catch (err) {
      toast.error('Could not create the collection', { description: errorText(err) });
    }
  };

  const open = (collection: LibraryCollection) => {
    writeLibraryFilters(filtersForCollection(collection));
    try {
      localStorage.setItem(DASHBOARD_PAGE_STORAGE_KEY, 'library');
    } catch {
      // The dashboard just opens on its last tab.
    }
    navigate('/');
  };

  return (
    <section className="library-section" aria-labelledby="manage-collections">
      <SectionRail title={<span id="manage-collections">Collections</span>} count={collections?.length ?? '—'} />
      <p className="library-hint">
        Add models to a collection from their page. Smart collections are saved Library filters: set the filters in the
        Library, then choose <strong>Save this view</strong>.
      </p>
      {collections === null ? (
        <p className="page-sub" role="status">Loading collections…</p>
      ) : (
        <ul className="library-manage-list">
          {collections.map(c => (
            <CollectionRow key={c.id} collection={c} demo={demo} onOpen={() => open(c)} onChanged={load} />
          ))}
        </ul>
      )}
      {!demo && (
        <form className="library-inline-form library-manage-new" onSubmit={event => void create(event)}>
          <input
            value={newName}
            maxLength={80}
            placeholder="New collection name"
            aria-label="New collection name"
            onChange={event => setNewName(event.target.value)}
          />
          <Button type="submit" disabled={!newName.trim()}>
            <Plus size={16} aria-hidden="true" /> Create collection
          </Button>
        </form>
      )}
    </section>
  );
}

function CollectionRow({ collection, demo, onOpen, onChanged }: {
  collection: LibraryCollection;
  demo: boolean;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(collection.name);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const to = name.trim();
    if (!to || to === collection.name) return setMode('view');
    try {
      await updateLibraryCollection(collection.id, { name: to });
      setMode('view');
      onChanged();
    } catch (err) {
      toast.error('Could not rename the collection', { description: errorText(err) });
    }
  };

  const remove = async () => {
    try {
      await deleteLibraryCollection(collection.id);
      toast.success(`Deleted ${collection.name}`, { description: 'Its models are still in the Library.' });
      onChanged();
    } catch (err) {
      toast.error('Could not delete the collection', { description: errorText(err) });
    }
  };

  const summary = collection.kind === 'smart' ? describeSmart(collection) : 'Chosen models';

  return (
    <li className="library-manage-row card">
      {mode === 'rename' ? (
        <form className="library-inline-form" onSubmit={event => void rename(event)}>
          <input
            autoFocus
            value={name}
            maxLength={80}
            aria-label={`New name for ${collection.name}`}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => event.key === 'Escape' && setMode('view')}
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>Rename</Button>
          <Button variant="ghost" onClick={() => { setName(collection.name); setMode('view'); }}>Cancel</Button>
        </form>
      ) : (
        <button type="button" className="library-manage-name library-manage-open" onClick={onOpen}>
          <strong>
            {collection.kind === 'smart' && <Filter size={13} aria-hidden="true" />} {collection.name}
          </strong>
          <small>{collection.count} model{collection.count === 1 ? '' : 's'} · {summary}</small>
        </button>
      )}
      {mode === 'view' && !demo && (
        <div className="library-manage-actions">
          <Button variant="ghost" onClick={() => setMode('rename')}>Rename</Button>
          <Button variant="ghost" onClick={() => setMode('delete')}>Delete</Button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="library-manage-actions">
          <span className="library-hint">Delete this collection? Its models stay in the Library.</span>
          <Button variant="danger" onClick={() => void remove()}>Delete</Button>
          <Button variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
        </div>
      )}
    </li>
  );
}
