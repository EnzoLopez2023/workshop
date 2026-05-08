import { Clock } from 'lucide-react';
import type { ProjectListItem } from '../types/project';
import { imageUrl } from '../services/api';
import StatusBadge from './StatusBadge';

interface Props {
  project: ProjectListItem;
  onClick: () => void;
}

export default function ProjectCard({ project, onClick }: Props) {
  const img = project.hero_image_id ? imageUrl(project.hero_image_id) : null;

  return (
    <button
      onClick={onClick}
      className="card card-hover"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        padding: 0, overflow: 'hidden', textAlign: 'left',
      }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 11', overflow: 'hidden', backgroundColor: 'var(--color-cream-2)' }}>
        {img ? (
          <img src={img} alt={project.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-muted)', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '1.4rem',
          }}>
            {project.title.slice(0, 1)}
          </div>
        )}
        <div style={{ position: 'absolute', top: 12, left: 12 }}>
          <StatusBadge status={project.status} withBackdrop />
        </div>
      </div>

      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            {project.title}
          </h3>
          {project.description && (
            <p className="muted" style={{
              margin: '6px 0 0', fontSize: '0.86rem',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', lineHeight: 1.45,
            }}>
              {project.description}
            </p>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--color-line)',
          fontSize: '0.82rem', color: 'var(--color-rust)',
        }}>
          <span style={{ fontWeight: 500 }}>
            {project.wood_types.length ? project.wood_types.join(' · ') : '—'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-muted)' }}>
            <Clock size={13} />
            {project.estimated_hours}h
          </span>
        </div>
      </div>
    </button>
  );
}
