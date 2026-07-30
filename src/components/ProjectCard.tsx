import type { ProjectListItem } from '../types/project';
import { imageUrl } from '../services/api';
import StatusBadge from './StatusBadge';

interface Props {
  project: ProjectListItem;
  onClick: () => void;
}

// A departure card: status flap top-right, destination in tracked caps, and the
// three figures that decide whether you can start it today.
export default function ProjectCard({ project, onClick }: Props) {
  const img = project.hero_image_id ? imageUrl(project.hero_image_id) : null;

  return (
    <button onClick={onClick} className="card card-hover depart-card">
      {img && (
        <span className="depart-photo">
          <img src={img} alt="" />
        </span>
      )}

      <span className="depart-head">
        <span className="board-caps depart-title">{project.title}</span>
        <StatusBadge status={project.status} />
      </span>

      {project.description && <span className="depart-desc">{project.description}</span>}

      <span className="depart-foot">
        <span>
          <span className="stat-label">Stock</span>
          <span className="readout">
            {project.wood_types.length ? project.wood_types.join(' · ') : '—'}
          </span>
        </span>
        <span>
          <span className="stat-label">Parts</span>
          <span className="readout">{String(project.parts_count ?? 0).padStart(2, '0')}</span>
        </span>
        <span>
          <span className="stat-label">Hours</span>
          <span className="readout">{project.estimated_hours ?? '—'}</span>
        </span>
      </span>
    </button>
  );
}
