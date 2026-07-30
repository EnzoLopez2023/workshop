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
      className="card card-hover depart-card"
      onClick={onClick}
    >
      {/* Photo */}
      {showImage ? (
        <div className="depart-photo">
          <img src={heroSrc!} alt="" onError={() => setImgBroken(true)} />
        </div>
      ) : null}

      <span className="depart-head">
        <span className="board-caps depart-title">{project.title || 'Untitled'}</span>
        <span className="pill flag-steel">
          <Cpu size={11} strokeWidth={2.4} /> Shaper
        </span>
      </span>

      {project.description && <span className="depart-desc">{project.description}</span>}

      <span className="depart-foot">
        <span>
          <span className="stat-label">Material</span>
          <span className="readout">{project.materials[0]?.name ?? '—'}</span>
        </span>
        <span>
          <span className="stat-label">Parts</span>
          <span className="readout">{String(project.cut_list.length).padStart(2, '0')}</span>
        </span>
      </span>
    </button>
  );
}
