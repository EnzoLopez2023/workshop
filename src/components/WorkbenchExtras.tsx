// Small workbench pieces shared by the Shelf Builder and the Built-in Studio:
// a first-run introduction, and a side-by-side comparison with a pinned design.

import { useState } from 'react';
import { Pin, X } from 'lucide-react';
import { Button } from './ui';

/** A dismissible welcome card over the viewport, shown until it's closed once on this browser. */
export function WorkbenchIntro({ storageKey, name }: { storageKey: string; name: string }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'seen'; } catch { return true; }
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try { localStorage.setItem(storageKey, 'seen'); } catch { /* convenience only */ }
  };
  return (
    <aside className="wb-intro" role="note" aria-label={`Welcome to ${name}`}>
      <button type="button" className="wb-intro-close" onClick={close} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
      <strong>Welcome to {name}</strong>
      <ul>
        <li><b>Tree</b> (left): jump to a section, or pick a part to light it up everywhere.</li>
        <li><b>Viewport</b> (middle): drag to orbit, click a part to select it, click a dimension to change it, use the crosshair to measure.</li>
        <li><b>Properties</b> (right): every setting for the section you’re in. <kbd>⌘Z</kbd> undoes.</li>
      </ul>
      <Button variant="primary" onClick={close}>Got it</Button>
    </aside>
  );
}

export interface CompareRow {
  label: string;
  pinned: string;
  current: string;
  /** A change worth marking, e.g. "+3/4″" or "−2 parts"; empty when unchanged. */
  delta: string;
}

/** The current design beside one pinned earlier: what changed in size, parts and material. */
export function ComparePanel({ rows, pinned, onPin, onClear, onRestore }: {
  rows: CompareRow[] | null;
  pinned: boolean;
  onPin: () => void;
  onClear: () => void;
  onRestore: () => void;
}) {
  return (
    <section className="wb-compare" aria-label="Compare designs">
      <header>
        <strong>Compare</strong>
        <span className="is-muted">{pinned ? 'The pinned design beside this one.' : 'Pin this design, change something, and see what it did.'}</span>
        <span className="wb-compare-actions">
          <Button variant="ghost" onClick={onPin}><Pin size={14} aria-hidden="true" /> {pinned ? 'Re-pin current' : 'Pin current'}</Button>
          {pinned && <Button variant="ghost" onClick={onRestore}>Restore pinned</Button>}
          {pinned && <Button variant="ghost" onClick={onClear}>Clear</Button>}
        </span>
      </header>
      {rows && (
        <table className="shelf-table">
          <thead><tr><th scope="col">&nbsp;</th><th scope="col">Pinned</th><th scope="col">Now</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className={r.delta ? 'is-changed' : undefined}>
                <th scope="row">{r.label}</th><td>{r.pinned}</td><td>{r.current}</td><td>{r.delta || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export interface PlanStats { width: number; height: number; depth: number; parts: number; area: number; sheets: string }

/** What a plan measures, for comparing one version of a design with another. */
export function planStats(plan: { overallWidth: number; overallHeight: number; overallDepth: number; parts: { qty: number; length: number; width: number }[] }, sheets: string): PlanStats {
  return {
    width: plan.overallWidth, height: plan.overallHeight, depth: plan.overallDepth,
    parts: plan.parts.reduce((sum, p) => sum + p.qty, 0),
    area: plan.parts.reduce((sum, p) => sum + p.qty * p.length * p.width, 0) / 144,
    sheets,
  };
}

export function compareRows(a: PlanStats, b: PlanStats, fmt: (inches: number) => string): CompareRow[] {
  const size = (label: string, x: number, y: number): CompareRow => {
    const d = y - x;
    return { label, pinned: fmt(x), current: fmt(y), delta: Math.abs(d) < 1e-4 ? '' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}` };
  };
  const count = (label: string, x: number, y: number, suffix: string): CompareRow => ({
    label, pinned: `${Math.round(x * 10) / 10}${suffix}`, current: `${Math.round(y * 10) / 10}${suffix}`,
    delta: Math.abs(y - x) < 0.05 ? '' : `${y > x ? '+' : '−'}${Math.round(Math.abs(y - x) * 10) / 10}${suffix}`,
  });
  return [
    size('Overall width', a.width, b.width), size('Overall height', a.height, b.height), size('Overall depth', a.depth, b.depth),
    count('Parts', a.parts, b.parts, ''), count('Plywood area', a.area, b.area, ' sq ft'),
    { label: 'Sheets', pinned: a.sheets, current: b.sheets, delta: a.sheets === b.sheets ? '' : 'changed' },
  ];
}

