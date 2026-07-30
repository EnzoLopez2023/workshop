import type { ProjectStatus } from '../types/project';
import { STATUS_LABELS } from '../types/project';

// A status is a lettered flap in a signal colour — the fill carries the meaning,
// so there is no coloured dot doing the same job twice.
const TONE: Record<ProjectStatus, string> = {
  idea:        'flag-idle',
  planning:    'flag-steel',
  in_progress: 'flag-amber',
  completed:   'flag-green',
};

export default function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`pill ${TONE[status]}`}>{STATUS_LABELS[status]}</span>;
}
