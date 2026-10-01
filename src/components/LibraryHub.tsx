import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderInput, Inbox, Laptop, Library, Link2, Search, Sparkles } from 'lucide-react';
import { getLibraryOverview, listLibraryModels } from '../services/api';
import type { LibraryModel, LibraryModelQuery, LibraryOverview, LibraryStatus } from '../types/project';
import { LIBRARY_STATUS_LABELS } from '../types/project';
import { LIBRARY_STATUS_ORDER, categoryLabel, relativeDate } from '../lib/library';
import LibraryModelCard from './LibraryModelCard';
import { ProjectCardSkeleton } from './Skeleton';
import { Button, SectionRail, StatePanel } from './ui';

const PAGE_SIZE = 60;
const SORTS: { value: NonNullable<LibraryModelQuery['sort']>; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'printed', label: 'Recently printed' },
  { value: 'updated', label: 'Recently edited' },
  { value: 'size', label: 'Largest' },
];
const FORMATS = [
  { value: '', label: 'Any format' },
  { value: '3mf', label: '3MF' },
  { value: 'stl', label: 'STL' },
  { value: 'sliced', label: 'Sliced' },
  { value: 'step', label: 'STEP' },
];

// Filters survive opening a model and coming back (per browser tab).
const FILTERS_STORAGE_KEY = 'workshop.library.filters';

interface LibraryFilters {
  search: string;
  status: LibraryStatus | '';
  category: string;
  format: string;
  sort: NonNullable<LibraryModelQuery['sort']>;
}

const DEFAULT_FILTERS: LibraryFilters = { search: '', status: '', category: '', format: '', sort: 'recent' };

function readFilters(): LibraryFilters {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? 'null') as Partial<LibraryFilters> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_FILTERS;
    return {
      search: typeof saved.search === 'string' ? saved.search : '',
      status: saved.status && LIBRARY_STATUS_ORDER.includes(saved.status) ? saved.status : '',
      category: typeof saved.category === 'string' ? saved.category : '',
      format: FORMATS.some(f => f.value === saved.format) ? saved.format! : '',
      sort: SORTS.find(s => s.value === saved.sort)?.value ?? 'recent',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function LibraryHub() {
  const [initialFilters] = useState(readFilters);
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [models, setModels] = useState<LibraryModel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialFilters.search);
  const [status, setStatus] = useState<LibraryStatus | ''>(initialFilters.status);
  const [category, setCategory] = useState(initialFilters.category);
  const [format, setFormat] = useState(initialFilters.format);
  const [sort, setSort] = useState<NonNullable<LibraryModelQuery['sort']>>(initialFilters.sort);
  const [debounced, setDebounced] = useState(initialFilters.search.trim());

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ search, status, category, format, sort }));
    } catch {
      // Storage unavailable (private mode): filters just reset on return.
    }
  }, [search, status, category, format, sort]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo<LibraryModelQuery>(
    () => ({ q: debounced, status, category, format, sort, limit: PAGE_SIZE }),
    [debounced, status, category, format, sort],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, page] = await Promise.all([getLibraryOverview(), listLibraryModels(query)]);
      setOverview(nextOverview);
      setModels(page.items);
      setTotal(page.total);
    } catch (err) {
      console.error('Library load failed', err);
      setError('Workshop could not load the library. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const page = await listLibraryModels({ ...query, offset: models.length });
    setModels(current => [...current, ...page.items]);
  };

  // A remembered category can vanish (renamed folder, last model moved out).
  useEffect(() => {
    if (category && overview && !overview.byCategory.some(c => c.category === category)) setCategory('');
  }, [category, overview]);

  const counts = overview?.byStatus ?? {};
  const allCount = Object.values(counts).reduce((n, v) => n + (v ?? 0), 0);
  const pending = overview?.planSummary?.pending ?? 0;
  const neverSynced = overview && !overview.lastSync;

  return (
    <section className="library-hub" aria-labelledby="library-title">
      {overview && neverSynced && (
        <div className="library-callout">
          <Laptop size={22} aria-hidden="true" />
          <div>
            <strong>Connect the Mac that holds your print files</strong>
            <p>
              The Library indexes STL and 3MF files where they live in OneDrive. Create a device token in
              Settings, then run <code>npm run library -- connect &lt;token&gt;</code> and{' '}
              <code>npm run library -- install</code> on the Mac.
            </p>
          </div>
          <Link className="btn btn-primary" to="/settings#library">Set up</Link>
        </div>
      )}

      {pending > 0 && (
        <Link to="/library/organize" className="library-callout library-callout-link">
          <FolderInput size={22} aria-hidden="true" />
          <div>
            <strong>{pending} model{pending === 1 ? '' : 's'} waiting to be organized</strong>
            <p>
              Review where each one goes, what it is called, and which duplicate copies go to the Trash.
              Nothing moves until you approve it.
            </p>
          </div>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}

      <div className="library-shortcuts">
        <Link to="/library/inbox" className="library-shortcut">
          <Inbox size={18} aria-hidden="true" />
          <span>Triage inbox</span>
          <span className="readout">{counts.inbox ?? 0}</span>
        </Link>
        <Link to="/library/review" className="library-shortcut">
          <Sparkles size={18} aria-hidden="true" />
          <span>Print matches</span>
          <span className="readout">{overview?.suggestions ?? 0}</span>
        </Link>
        <Link to="/library/review?tab=duplicates" className="library-shortcut">
          <Link2 size={18} aria-hidden="true" />
          <span>Same geometry</span>
          <span className="readout">{overview?.duplicateGroups ?? 0}</span>
        </Link>
      </div>

      <div className="dashboard-tools">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search the library</span>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search titles, designers, tags, filenames, notes"
          />
        </label>
        <div className="filter-strip" role="group" aria-label="Status">
          <button type="button" aria-pressed={status === ''} onClick={() => setStatus('')}>
            All <span className="library-count">{allCount}</span>
          </button>
          {LIBRARY_STATUS_ORDER.map(key => (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}>
              {LIBRARY_STATUS_LABELS[key]} <span className="library-count">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="library-selects">
          <label>
            <span className="stat-label">Category</span>
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {overview?.byCategory.map(c => (
                <option key={c.category} value={c.category}>{categoryLabel(c.category)} ({c.count})</option>
              ))}
            </select>
          </label>
          <label>
            <span className="stat-label">Format</span>
            <select value={format} onChange={event => setFormat(event.target.value)}>
              {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label>
            <span className="stat-label">Sort</span>
            <select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <StatePanel title="Library unavailable" description={error} tone="danger" action={<Button onClick={() => void load()}>Try again</Button>} />
      )}

      <SectionRail
        title={<span id="library-title"><Library size={16} aria-hidden="true" /> Model library</span>}
        count={loading ? '—' : total}
        actions={overview?.lastSync
          ? <span className="library-sync-note">Synced {relativeDate(overview.lastSync.at)} from {overview.lastSync.device}</span>
          : undefined}
      />

      {loading ? (
        <div className="project-library-grid">
          {Array.from({ length: 6 }, (_, i) => <ProjectCardSkeleton key={i} />)}
        </div>
      ) : models.length === 0 ? (
        <StatePanel
          title={allCount === 0 ? 'No models yet' : 'No matching models'}
          description={allCount === 0
            ? pending > 0
              ? 'Your files have been found but not organized yet. Review the plan to file them into the library.'
              : 'Once your Mac syncs, every organized model folder appears here.'
            : 'Change the search or filters to bring models back into view.'}
          action={allCount === 0 && pending > 0
            ? <Link className="btn btn-primary" to="/library/organize">Review the plan</Link>
            : undefined}
        />
      ) : (
        <>
          <div className="project-library-grid library-grid">
            {models.map(model => <LibraryModelCard key={model.id} model={model} to={`/library/${model.id}`} />)}
          </div>
          {models.length < total && (
            <div className="library-more">
              <Button onClick={() => void loadMore()}>Show more ({total - models.length} left)</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
