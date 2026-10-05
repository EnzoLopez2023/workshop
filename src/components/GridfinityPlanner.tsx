import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from './ui';
import type { BinPacking, GridfinityBin, GridfinityLayout } from '../lib/gridfinity';

interface Props {
  layout: GridfinityLayout;
  packing?: BinPacking;
  bins: GridfinityBin[];
  onChange: (bins: GridfinityBin[]) => void;
  label: string;
}

const COLORS = ['#7fa3b5', '#d9a441', '#9cbf7a', '#c9837a', '#a58bc4', '#6fb0a5', '#d1b07c', '#8e9fbf'];

/** Plan the bins for one Gridfinity drawer: a list of sizes and a top-down view of where they go. */
export default function GridfinityPlanner({ layout, packing, bins, onChange, label }: Props) {
  const { columns, rows } = layout;
  const set = (i: number, patch: Partial<GridfinityBin>) => onChange(bins.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(Math.floor(v) || min, min), max);
  const fillRest = () => {
    const free = packing ? packing.freeCells : columns * rows;
    if (free <= 0) return;
    const one = bins.findIndex(b => b.w === 1 && b.d === 1 && b.u === Math.min(6, layout.maxUnits));
    if (one >= 0) set(one, { qty: bins[one].qty + free });
    else onChange([...bins, { w: 1, d: 1, u: Math.min(6, layout.maxUnits), qty: free }]);
  };
  const cell = 14;
  return (
    <div className="gf-planner">
      <svg
        viewBox={`-1 -1 ${columns * cell + 2} ${rows * cell + 2}`}
        width={Math.min(columns * cell + 2, 320)}
        role="img"
        aria-label={`${label}: ${columns} by ${rows} grid with ${packing?.placements.length ?? 0} bins, front at the bottom`}
      >
        {Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => (
          <rect key={`${x}-${y}`} x={x * cell} y={(rows - 1 - y) * cell} width={cell} height={cell} className="gf-cell" />
        )))}
        {packing?.placements.map((p, i) => (
          <g key={i}>
            <rect x={p.x * cell + 1} y={(rows - p.y - p.d) * cell + 1} width={p.w * cell - 2} height={p.d * cell - 2} rx={2}
              fill={COLORS[p.bin % COLORS.length]} stroke="#15332e" strokeWidth={0.6} />
            {p.w * p.d >= 2 && (
              <text x={(p.x + p.w / 2) * cell} y={(rows - p.y - p.d / 2) * cell + 3} textAnchor="middle" fontSize={7} fill="#15332e">{p.u}u</text>
            )}
          </g>
        ))}
      </svg>
      <ul className="gf-bins">
        {bins.map((b, i) => (
          <li key={i}>
            <span className="gf-swatch" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" />
            <label>W <input type="number" min={1} max={columns} value={b.w} onChange={e => set(i, { w: clamp(Number(e.target.value), 1, Math.max(columns, rows)) })} aria-label="Bin width in units" /></label>
            <label>D <input type="number" min={1} max={rows} value={b.d} onChange={e => set(i, { d: clamp(Number(e.target.value), 1, Math.max(columns, rows)) })} aria-label="Bin depth in units" /></label>
            <label>H <input type="number" min={2} max={layout.maxUnits} value={b.u} onChange={e => set(i, { u: clamp(Number(e.target.value), 2, 40) })} aria-label="Bin height in 7 mm units" />u</label>
            <span className="gf-qty">
              <IconButton label="One fewer" onClick={() => set(i, { qty: Math.max(0, b.qty - 1) })}><Minus size={14} aria-hidden="true" /></IconButton>
              <output>{b.qty}</output>
              <IconButton label="One more" onClick={() => set(i, { qty: b.qty + 1 })}><Plus size={14} aria-hidden="true" /></IconButton>
            </span>
            <IconButton label="Remove this bin size" onClick={() => onChange(bins.filter((_, k) => k !== i))}><Trash2 size={14} aria-hidden="true" /></IconButton>
          </li>
        ))}
      </ul>
      <span className="shelf-source-actions">
        <Button variant="ghost" onClick={() => onChange([...bins, { w: 2, d: 1, u: Math.min(6, layout.maxUnits), qty: 1 }])}>
          <Plus size={16} aria-hidden="true" /> Add a bin size
        </Button>
        <Button variant="ghost" onClick={fillRest} disabled={(packing?.freeCells ?? columns * rows) === 0}>Fill the rest with 1 × 1</Button>
      </span>
      {packing && (
        <small className={packing.unplaced ? 'shelf-field-error' : 'is-muted'}>
          {packing.unplaced ? `${packing.unplaced} bin${packing.unplaced === 1 ? '' : 's'} don’t fit — remove some or make them smaller. ` : ''}
          {packing.freeCells} of {columns * rows} cells free. Front of the drawer at the bottom.
        </small>
      )}
    </div>
  );
}
