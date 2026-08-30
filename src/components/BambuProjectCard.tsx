import { useState } from 'react';
import { Box } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bambuAssetUrl } from '../services/api';
import type { BambuProject } from '../types/project';

interface Props {
  project: BambuProject;
  to: string;
  onOpen?: () => void;
}

const SOURCE_LABELS: Record<BambuProject['source_site'], string> = {
  makerworld: 'MakerWorld',
  thingiverse: 'Thingiverse',
  printables: 'Printables',
};

export default function BambuProjectCard({ project, to, onOpen }: Props) {
  const [imageBroken, setImageBroken] = useState(false);
  const hero = project.hero_asset_id ? bambuAssetUrl(project.hero_asset_id) : null;

  return (
    <Link to={to} className="card card-hover depart-card" onClick={onOpen}>
      <div className="depart-photo bambu-card-media">
        {hero && !imageBroken ? (
          <img src={hero} alt="" onError={() => setImageBroken(true)} />
        ) : (
          <span className="bambu-card-placeholder" aria-hidden="true">
            <Box size={44} strokeWidth={1.35} />
          </span>
        )}
      </div>

      <span className="depart-head">
        <span className="board-caps depart-title">{project.title || 'Untitled 3D project'}</span>
        <span className="pill flag-steel">
          <Box size={11} strokeWidth={2.4} /> 3D
        </span>
      </span>

      {project.description && <span className="depart-desc">{project.description}</span>}

      <span className="depart-foot">
        <span>
          <span className="stat-label">Source</span>
          <span className="readout">{SOURCE_LABELS[project.source_site]}</span>
        </span>
        <span>
          <span className="stat-label">Images</span>
          <span className="readout">{String(project.image_count).padStart(2, '0')}</span>
        </span>
        <span>
          <span className="stat-label">Files</span>
          <span className="readout">{String(project.file_count).padStart(2, '0')}</span>
        </span>
      </span>
    </Link>
  );
}
