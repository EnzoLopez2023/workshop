import type { ProjectStatus } from '../types/project';
import { STATUS_LABELS } from '../types/project';

const STYLES: Record<ProjectStatus, { bg: string; fg: string; dot: string }> = {
  idea:         { bg: '#F8E7DC', fg: '#B06B3F', dot: '#C77C4A' },
  planning:     { bg: '#E8EBF5', fg: '#5B6AA7', dot: '#7A88C4' },
  in_progress:  { bg: '#FCEBDA', fg: '#B96F1F', dot: '#D6842E' },
  completed:    { bg: '#E6EFE2', fg: '#4F7A3E', dot: '#6FA057' },
};

interface Props {
  status: ProjectStatus;
  withBackdrop?: boolean;
}

export default function StatusBadge({ status, withBackdrop = false }: Props) {
  const style = STYLES[status];
  return (
    <span
      className="pill"
      style={{
        backgroundColor: withBackdrop ? 'rgba(255,255,255,0.92)' : style.bg,
        color: style.fg,
        backdropFilter: withBackdrop ? 'blur(4px)' : undefined,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 999, backgroundColor: style.dot,
      }} />
      {STATUS_LABELS[status]}
    </span>
  );
}
