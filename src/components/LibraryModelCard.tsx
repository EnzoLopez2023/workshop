import { useState } from 'react';
import { Box, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { libraryThumbUrl } from '../services/api';
import type { LibraryModel } from '../types/project';
import { LIBRARY_STATUS_LABELS } from '../types/project';
import {
  LIBRARY_STATUS_TONE,
  categoryLabel,
  formatDimensions,
  formatDuration,
  formatGrams,
  formatLabel,
  isNewModel,
} from '../lib/library';

interface Props {
  model: LibraryModel;
  to: string;
}

export default function LibraryModelCard({ model, to }: Props) {
  const [imageBroken, setImageBroken] = useState(false);
  const fresh = isNewModel(model);
  const meta = [categoryLabel(model.category), model.designer].filter(Boolean).join(' · ');

  return (
    <Link to={to} className="card card-hover depart-card library-card">
      <div className="library-card-media">
        {model.thumb_hash && !imageBroken ? (
          <img src={libraryThumbUrl(model.thumb_hash)} alt="" loading="lazy" onError={() => setImageBroken(true)} />
        ) : (
          <span className="bambu-card-placeholder" aria-hidden="true">
            <Box size={44} strokeWidth={1.35} />
          </span>
        )}
        {fresh && <span className="library-ribbon">New</span>}
        <span className="library-formats">
          {model.formats.map(format => (
            <span key={format} className={`library-format library-format-${format}`}>{formatLabel(format)}</span>
          ))}
        </span>
      </div>

      <span className="depart-head">
        <span className="board-caps depart-title library-card-title">{model.title}</span>
        {model.favorite && <Heart size={16} className="library-favorite" aria-label="Favorite" />}
      </span>
      <span className="library-card-meta">
        <span className={`pill ${LIBRARY_STATUS_TONE[model.status]}`}>{LIBRARY_STATUS_LABELS[model.status]}</span>
        <span className="library-card-where">{meta}</span>
      </span>
      {model.tags.length > 0 && (
        <span className="library-card-tags">
          {model.tags.slice(0, 3).map(tag => <span key={tag} className="chip">{tag}</span>)}
          {model.tags.length > 3 && <span className="chip">+{model.tags.length - 3}</span>}
        </span>
      )}

      <span className="depart-foot library-card-foot">
        <span>
          <span className="stat-label">{model.est_seconds || model.est_grams != null ? 'Print' : 'Size'}</span>
          <span className="readout">
            {model.est_seconds || model.est_grams != null
              ? `${formatDuration(model.est_seconds)} · ${formatGrams(model.est_grams)}`
              : model.bbox ? formatDimensions(model.bbox) : '—'}
          </span>
        </span>
        <span>
          <span className="stat-label">Plates</span>
          <span className="readout">{model.plate_count || '—'}</span>
        </span>
        <span>
          <span className="stat-label">Printed</span>
          <span className="readout">{model.printed_count ? `×${model.printed_count}` : '—'}</span>
        </span>
      </span>
    </Link>
  );
}
