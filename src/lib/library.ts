import type { LibraryModel, LibraryStatus } from '../types/project';

export const LIBRARY_STATUS_TONE: Record<LibraryStatus, string> = {
  inbox: 'flag-idle',
  want: 'flag-steel',
  queued: 'flag-amber',
  printed: 'flag-green',
  failed: 'flag-red',
  skip: 'flag-idle',
};

export const LIBRARY_STATUS_ORDER: LibraryStatus[] = ['inbox', 'want', 'queued', 'printed', 'failed', 'skip'];

const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/** "New" = arrived in the last week and nobody has triaged it yet. */
export function isNewModel(model: Pick<LibraryModel, 'first_seen_at' | 'status'>, now = Date.now()) {
  return model.status === 'inbox' && now - Date.parse(model.first_seen_at) < NEW_FOR_MS;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatGrams(grams: number | null | undefined) {
  if (grams == null) return '—';
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDimensions(bbox: [number, number, number] | null | undefined) {
  if (!bbox) return '—';
  return bbox.map(v => Math.round(v)).join(' × ') + ' mm';
}

export function formatLabel(format: string) {
  return format === 'sliced' ? 'Sliced' : format.toUpperCase();
}

/** Categories starting with "_" are organizer folders; show them as plain words. */
export function categoryLabel(category: string) {
  if (category === '_Inbox') return 'Inbox';
  if (category === '_Archive') return 'Archive';
  return category;
}

export function sourceLabel(site: string | null) {
  switch (site) {
    case 'makerworld': return 'MakerWorld';
    case 'printables': return 'Printables';
    case 'thingiverse': return 'Thingiverse';
    case 'shapepilot': return 'ShapePilot';
    default: return null;
  }
}

export function relativeDate(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—';
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
