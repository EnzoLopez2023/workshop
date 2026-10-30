// The cut list, shared by the Shelf Builder and the Built-in Studio: each row selects its part
// in the 3D view, with optional grain/face hints and a rip-first order.

import { useState } from 'react';
import { partHint, ripOrder } from '../lib/cutListHints';

interface CutPart {
  name: string;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  note?: string;
}

export default function CutListTable({ parts, fmt, otherUnit, onPick }: {
  parts: CutPart[];
  fmt: (inches: number) => string;
  otherUnit: (inches: number) => string;
  onPick?: (name: string) => void;
}) {
  const [hints, setHints] = useState(false);
  const [rip, setRip] = useState(false);
  const rows = rip ? ripOrder(parts) : parts;
  return (
    <>
      <div className="cutlist-options">
        <label><input type="checkbox" checked={hints} onChange={e => setHints(e.target.checked)} /> Grain &amp; faces</label>
        <label title="Group by thickness, widest first: one fence setting rips every part of a width."><input type="checkbox" checked={rip} onChange={e => setRip(e.target.checked)} /> Rip order</label>
      </div>
      <div className="shelf-table-scroll" tabIndex={0} aria-label="Cut list table">
        <table className="shelf-table">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Qty</th>
              <th scope="col">Length</th>
              <th scope="col">Width</th>
              <th scope="col">Thick</th>
              {hints && <th scope="col">Grain</th>}
              {hints && <th scope="col">Face</th>}
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const hint = hints ? partHint(p.name) : null;
              return (
                <tr key={p.name} className={onPick ? 'is-clickable' : undefined} onClick={onPick ? () => onPick(p.name) : undefined} title={onPick ? 'Show this part in the 3D view' : undefined}>
                  <th scope="row">{p.name}</th>
                  <td>{p.qty}</td>
                  <td title={otherUnit(p.length)}>{fmt(p.length)}</td>
                  <td title={otherUnit(p.width)}>{fmt(p.width)}</td>
                  <td title={otherUnit(p.thickness)}>{fmt(p.thickness)}</td>
                  {hint && <td className="is-muted">{hint.grain}</td>}
                  {hint && <td className="is-muted">{hint.face}</td>}
                  <td className="is-muted">{p.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
