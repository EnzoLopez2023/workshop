// Cutting order: turns a cut list into saw setups so the fence moves as little as
// possible. For each plywood thickness, rip every strip at one fence setting before
// moving the fence, widest first (so offcuts can become narrower strips), then
// crosscut each strip with a stop block, longest lengths first.

import type { ShelfPart } from './shelving.ts';

export interface CrosscutSetting {
  length: number;
  qty: number;
  parts: string[];
}

export interface RipSetting {
  width: number;
  /** Strips to rip at this fence setting (strips run the sheet's length). */
  strips: number;
  crosscuts: CrosscutSetting[];
  /** Pieces cut from these strips. */
  pieces: number;
}

export interface ThicknessOrder {
  thickness: number;
  rips: RipSetting[];
  /** Fence moves for the rips, and stop moves for the crosscuts. */
  fenceSettings: number;
  stopSettings: number;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Strips needed to cut these lengths (longest first, first fit) from strips `stripLength` long. */
export function stripsNeeded(lengths: number[], stripLength: number, kerf: number): number {
  const strips: number[] = [];
  for (const length of [...lengths].sort((a, b) => b - a)) {
    const room = strips.findIndex(used => used + kerf + length <= stripLength + 1e-9);
    if (room >= 0) strips[room] += kerf + length;
    else strips.push(length);
  }
  return strips.length;
}

export function cuttingOrder(parts: ShelfPart[], stripLength = 96, kerf = 1 / 8): ThicknessOrder[] {
  const thicknesses: number[] = [];
  for (const p of parts) if (!thicknesses.some(t => same(t, p.thickness))) thicknesses.push(p.thickness);
  return thicknesses.sort((a, b) => b - a).map(thickness => {
    const ofThickness = parts.filter(p => same(p.thickness, thickness));
    const widths: number[] = [];
    for (const p of ofThickness) if (!widths.some(w => same(w, p.width))) widths.push(p.width);
    const rips = widths.sort((a, b) => b - a).map(width => {
      const atWidth = ofThickness.filter(p => same(p.width, width));
      const crosscuts: CrosscutSetting[] = [];
      for (const p of atWidth) {
        const c = crosscuts.find(x => same(x.length, p.length));
        if (c) { c.qty += p.qty; c.parts.push(p.name); } else crosscuts.push({ length: p.length, qty: p.qty, parts: [p.name] });
      }
      crosscuts.sort((a, b) => b.length - a.length);
      const lengths = atWidth.flatMap(p => Array.from({ length: p.qty }, () => p.length));
      return { width, strips: stripsNeeded(lengths, stripLength, kerf), crosscuts, pieces: lengths.length };
    });
    const stops: number[] = [];
    for (const r of rips) for (const c of r.crosscuts) if (!stops.some(x => same(x, c.length))) stops.push(c.length);
    return { thickness, rips, fenceSettings: rips.length, stopSettings: stops.length };
  });
}
