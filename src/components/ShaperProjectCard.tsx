import { useState } from 'react';
import { Cpu } from 'lucide-react';
import type { ShaperProject } from '../types/project';
import { imageUrl } from '../services/api';

interface Props {
  project: ShaperProject;
  onClick: () => void;
}

export default function ShaperProjectCard({ project, onClick }: Props) {
  const [imgBroken, setImgBroken] = useState(false);
  const heroSrc = project.hero_image_id
    ? imageUrl(project.hero_image_id)
    : project.photo_url;
  const showImage = heroSrc && !imgBroken;
  return (
    <button
      className="card card-hover"
      onClick={onClick}
      style={{
        padding: 0, textAlign: 'left', width: '100%',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Photo */}
      <div style={{
        width: '100%', aspectRatio: '16/10', overflow: 'hidden',
        position: 'relative', flexShrink: 0,
        backgroundColor: 'var(--color-cream-2)',
      }}>
        {showImage ? (
          <img
            src={heroSrc!}
            alt={project.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgBroken(true)}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Cpu size={36} style={{ color: 'var(--color-line)' }} />
          </div>
        )}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          backgroundColor: 'rgba(28,15,7,0.72)',
          color: '#fff', fontSize: '0.62rem', fontWeight: 700,
          letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 999,
          backdropFilter: 'blur(4px)',
        }}>
          SHAPER HUB
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <h3 style={{
          margin: 0, fontSize: '1rem', fontWeight: 700,
          color: 'var(--color-ink)', lineHeight: 1.3,
        }}>
          {project.title || 'Untitled'}
        </h3>
        {project.description && (
          <p style={{
            margin: 0, fontSize: '0.83rem', color: 'var(--color-muted)', lineHeight: 1.45,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {project.description}
          </p>
        )}
        {project.materials.length > 0 && (
          <div style={{
            marginTop: 'auto', paddingTop: 8,
            fontSize: '0.75rem', color: 'var(--color-muted)',
          }}>
            {project.materials.length} material{project.materials.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </button>
  );
}
