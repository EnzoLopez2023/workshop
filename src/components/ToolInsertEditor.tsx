import { useRef, useState } from 'react';
import { RotateCw, Trash2, Upload } from 'lucide-react';
import { Button, IconButton } from './ui';
import { importToolFile } from '../lib/toolOutline';
import type { ToolBoardLayout, ToolPocket } from '../lib/drawerInserts';
import { formatLength, type LengthUnit } from '../lib/shelving';

interface Props {
  tools: ToolPocket[];
  onChange: (tools: ToolPocket[]) => void;
  board?: ToolBoardLayout;
  /** Clearance (inches) added around each outline when it's imported. */
  clearance: number;
  units: LengthUnit;
  label: string;
}

/** Import tool outlines (SVG/DXF) for one drawer's shadow board, and see how they lay out. */
export default function ToolInsertEditor({ tools, onChange, board, clearance, units, label }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const f = (inches: number) => formatLength(inches, units);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const added: ToolPocket[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const tool = await importToolFile(file, clearance);
        added.push({ name: tool.name, rings: tool.rings, width: tool.width, height: tool.height });
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'couldn’t be read'}`);
      }
    }
    setProblems(errors);
    if (added.length) onChange([...tools, ...added]);
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const scale = board ? 300 / Math.max(board.width, board.depth) : 1;
  return (
    <div className="gf-planner tool-editor">
      {board && (
        <svg
          viewBox={`-0.2 -0.2 ${board.width + 0.4} ${board.depth + 0.4}`}
          width={Math.round(board.width * scale)}
          role="img"
          aria-label={`${label}: shadow board ${f(board.width)} by ${f(board.depth)} with ${board.placed.length} tool pockets, front at the bottom`}
        >
          <rect x={0} y={0} width={board.width} height={board.depth} className="tool-board" />
          {board.placed.map((p, i) => (
            <g key={i}>
              <path
                d={p.rings.map(r => `M ${r.map(([x, y]) => `${x} ${board.depth - y}`).join(' L ')} Z`).join(' ')}
                fillRule="evenodd"
                className="tool-pocket"
              />
              <text x={p.x + p.width / 2} y={board.depth - p.y - p.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(0.6, p.height / 3)} className="tool-name">{p.name}</text>
            </g>
          ))}
          {board.fingerHoles.map((h, i) => <circle key={i} cx={h.x} cy={board.depth - h.y} r={h.r} className="tool-pocket" />)}
        </svg>
      )}
      <ul className="gf-bins">
        {tools.map((t, i) => (
          <li key={i}>
            <strong>{t.name}</strong>
            <span className="is-muted">{f(t.rotated ? t.height : t.width)} × {f(t.rotated ? t.width : t.height)}</span>
            <IconButton label={`Turn ${t.name} 90°`} onClick={() => onChange(tools.map((x, k) => (k === i ? { ...x, rotated: !x.rotated } : x)))}>
              <RotateCw size={14} aria-hidden="true" />
            </IconButton>
            <IconButton label={`Remove ${t.name}`} onClick={() => onChange(tools.filter((_, k) => k !== i))}>
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      <span className="shelf-source-actions">
        <input ref={input} type="file" accept=".svg,.dxf" multiple hidden onChange={e => void importFiles(e.target.files)} />
        <Button variant="ghost" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={16} aria-hidden="true" /> {busy ? 'Reading…' : 'Import tool outlines (SVG or DXF)'}
        </Button>
      </span>
      <small className="is-muted">
        One tool per file, drawn at real size (Shaper Origin, Inkscape or CAD exports work). The largest closed outline in each file is used,
        grown by {f(clearance)} so the tool drops in. Files are read in your browser — nothing is uploaded.
      </small>
      {problems.map(p => <small key={p} className="shelf-field-error">{p}</small>)}
    </div>
  );
}
