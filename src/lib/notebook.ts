import type { TabloomPageDetail } from '../services/tabloomApi';

function timestampValue(iso: string): number {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  return new Date(normalized).getTime();
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = timestampValue(iso);
  if (!Number.isFinite(timestamp)) return 'recently';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function notebookHasUnsavedChanges(
  baseline: { title: string; body_md: string } | null,
  title: string,
  bodyMd: string,
): boolean {
  return baseline !== null && (title !== baseline.title || bodyMd !== baseline.body_md);
}

export function buildNotebookUpdate(
  page: TabloomPageDetail,
  title: string,
  bodyMd: string,
) {
  return {
    title: title.trim() || page.title,
    body_md: bodyMd,
    expected_edited_at: page.edited_at,
  };
}

export function canLeaveNotebook(
  dirty: boolean,
  confirmLeave: (message: string) => boolean,
): boolean {
  return !dirty || confirmLeave('Leave this page? Your unsaved Notebook changes will be lost.');
}
