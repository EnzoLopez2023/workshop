import type { LibraryModelQuery, LibraryStatus } from '../types/project';
import { LIBRARY_STATUS_ORDER } from './library';

export const LIBRARY_SORTS: { value: NonNullable<LibraryModelQuery['sort']>; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'printed', label: 'Recently printed' },
  { value: 'updated', label: 'Recently edited' },
  { value: 'size', label: 'Largest' },
];

export const LIBRARY_FORMATS = [
  { value: '', label: 'Any format' },
  { value: '3mf', label: '3MF' },
  { value: 'stl', label: 'STL' },
  { value: 'sliced', label: 'Sliced' },
  { value: 'step', label: 'STEP' },
];

// The hub's filters survive opening a model and coming back (per browser tab),
// and the model page steps through the same filtered list.
const FILTERS_STORAGE_KEY = 'workshop.library.filters';

export interface LibraryFilters {
  search: string;
  status: LibraryStatus | '';
  category: string;
  format: string;
  sort: NonNullable<LibraryModelQuery['sort']>;
}

const DEFAULT_FILTERS: LibraryFilters = { search: '', status: '', category: '', format: '', sort: 'recent' };

export function readLibraryFilters(): LibraryFilters {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? 'null') as Partial<LibraryFilters> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_FILTERS;
    return {
      search: typeof saved.search === 'string' ? saved.search : '',
      status: saved.status && LIBRARY_STATUS_ORDER.includes(saved.status) ? saved.status : '',
      category: typeof saved.category === 'string' ? saved.category : '',
      format: LIBRARY_FORMATS.some(f => f.value === saved.format) ? saved.format! : '',
      sort: LIBRARY_SORTS.find(s => s.value === saved.sort)?.value ?? 'recent',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function writeLibraryFilters(filters: LibraryFilters) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage unavailable (private mode): filters just reset on return.
  }
}

export function libraryFiltersQuery(filters: LibraryFilters): LibraryModelQuery {
  const { search, status, category, format, sort } = filters;
  return { q: search.trim(), status, category, format, sort };
}
