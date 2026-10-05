// Drawer inserts for the Drawer Builder: an egg-crate divider grid, or a marker
// tray of notched ribs that cradle markers lying front to back. Geometry only —
// the plan (drawerUnit.ts) places it in each drawer box.
//
// Inside a box: x runs from the inside face of the left box side, z from the
// inside face of the box front, y up from the top of the box bottom.

import { layoutGridfinity, packBins, type BinPacking, type GridfinityBin, type GridfinityLayout } from './gridfinity.ts';

export type DrawerInsert =
  | { kind: 'grid'; columns: number; rows: number }
  | { kind: 'markers'; diameter: number; length: number; spacing: number }
  /** A printed Gridfinity baseplate sized to the drawer, and the bins planned for it. */
  | { kind: 'gridfinity'; bins?: GridfinityBin[] };

/** A cut into a piece's edge, in the piece's (u along its length, v up its height) frame. */
export type EdgeCut =
  | { kind: 'slot'; center: number; width: number; depth: number; from: 'top' | 'bottom' }
  | { kind: 'round'; center: number; radius: number };

export interface InsertPiece {
  role: 'lengthwise' | 'crosswise' | 'rib';
  qty: number;
  length: number;
  height: number;
  cuts: EdgeCut[];
}

/** Where each piece sits in the box, for the 3D view. */
export interface InsertPlacement {
  role: InsertPiece['role'];
  /** Runs along x (crosswise, ribs) or z (lengthwise), starting at (x, z). */
  along: 'x' | 'z';
  x: number;
  z: number;
  length: number;
  height: number;
}

export interface InsertLayout {
  pieces: InsertPiece[];
  placements: InsertPlacement[];
  /** Markers held, for a marker tray. */
  capacity: number;
  /** Cells, for a grid (or Gridfinity units). */
  cells: number;
  /** The baseplate, for a Gridfinity drawer. */
  gridfinity?: GridfinityLayout;
  /** Where the planned bins go on it. */
  binPacking?: BinPacking;
  error: string | null;
}

/** Pieces stop this short of the box walls (half each end) so they drop in. */
export const INSERT_PLAY = 1 / 32;
/** Slots are this much wider than the stock so the grid slides together. */
export const SLOT_PLAY = 1 / 64;
/** Dividers stop this far below the top of the box sides. */
export const INSERT_TOP_CLEARANCE = 1 / 4;
const RIB_BASE = 1 / 2;
const MARKER_END_ROOM = 3 / 4;
const MIN_CELL = 1.5;

/** Typical sizes to start from — measure yours, brands vary. */
export const MARKER_PRESETS = [
  { id: 'alcohol', label: 'Alcohol marker (about 16 × 150 mm)', diameter: 16 / 25.4, length: 150 / 25.4 },
  { id: 'paint', label: 'Paint marker (about 18 × 140 mm)', diameter: 18 / 25.4, length: 140 / 25.4 },
  { id: 'fineliner', label: 'Fine-liner pen (about 10 × 150 mm)', diameter: 10 / 25.4, length: 150 / 25.4 },
  { id: 'pencil', label: 'Pencil (7.5 × 190 mm)', diameter: 7.5 / 25.4, length: 190 / 25.4 },
] as const;

export function layoutInsert(
  insert: DrawerInsert,
  inside: { width: number; depth: number; height: number },
  thickness: number,
  f: (inches: number) => string,
  /** Printer bed (mm) for splitting Gridfinity baseplates. */
  bedMm = 256,
): InsertLayout {
  const t = thickness;
  const empty: InsertLayout = { pieces: [], placements: [], capacity: 0, cells: 0, error: null };

  if (insert.kind === 'gridfinity') {
    const mm = 25.4;
    const gf = layoutGridfinity(inside.width * mm, inside.depth * mm, (inside.height - INSERT_TOP_CLEARANCE) * mm, bedMm);
    if (gf.error) return { ...empty, gridfinity: gf, error: gf.error };
    const bins = insert.bins ?? [];
    const tooTall = bins.filter(b => b.qty > 0 && b.u > gf.maxUnits);
    const binPacking = bins.length ? packBins(gf.columns, gf.rows, bins) : undefined;
    const error = tooTall.length
      ? `${tooTall.map(b => `${b.u}u`).join(', ')} bins are taller than the ${gf.maxUnits}u that fits under the drawer above`
      : null;
    return { ...empty, cells: gf.columns * gf.rows, gridfinity: gf, binPacking, error };
  }

  if (insert.kind === 'grid') {
    const cols = Math.max(1, Math.floor(insert.columns));
    const rows = Math.max(1, Math.floor(insert.rows));
    const h = inside.height - INSERT_TOP_CLEARANCE;
    if (cols === 1 && rows === 1) return { ...empty, cells: 1 };
    if (h < 1) return { ...empty, error: `the box is only ${f(inside.height)} deep inside — too shallow for dividers` };
    const cellW = (inside.width - (cols - 1) * t) / cols;
    const cellD = (inside.depth - (rows - 1) * t) / rows;
    if (cellW < MIN_CELL || cellD < MIN_CELL) {
      return { ...empty, error: `a ${cols} × ${rows} grid leaves ${f(Math.min(cellW, cellD))} cells — at least ${f(MIN_CELL)} is practical` };
    }
    const xs = Array.from({ length: cols - 1 }, (_, k) => (k + 1) * cellW + k * t);
    const zs = Array.from({ length: rows - 1 }, (_, k) => (k + 1) * cellD + k * t);
    const pieces: InsertPiece[] = [];
    const placements: InsertPlacement[] = [];
    // Lengthwise dividers run front to back, slotted from the top; crosswise ones
    // run side to side, slotted from the bottom, so the two halves lap.
    if (xs.length) {
      const length = inside.depth - INSERT_PLAY;
      pieces.push({
        role: 'lengthwise', qty: xs.length, length, height: h,
        cuts: zs.map(z => ({ kind: 'slot', center: z + t / 2 - INSERT_PLAY / 2, width: t + SLOT_PLAY, depth: h / 2, from: 'top' })),
      });
      xs.forEach(x => placements.push({ role: 'lengthwise', along: 'z', x, z: INSERT_PLAY / 2, length, height: h }));
    }
    if (zs.length) {
      const length = inside.width - INSERT_PLAY;
      pieces.push({
        role: 'crosswise', qty: zs.length, length, height: h,
        cuts: xs.map(x => ({ kind: 'slot', center: x + t / 2 - INSERT_PLAY / 2, width: t + SLOT_PLAY, depth: h / 2, from: 'bottom' })),
      });
      zs.forEach(z => placements.push({ role: 'crosswise', along: 'x', x: INSERT_PLAY / 2, z, length, height: h }));
    }
    return { pieces, placements, capacity: 0, cells: cols * rows, error: null };
  }

  // Marker tray: ribs across the drawer with a half-round notch per marker; two
  // ribs per row of markers, near each end of the marker.
  const d = insert.diameter;
  const L = insert.length;
  if (!(d > 0) || !(L > 0)) return { ...empty, error: 'give the markers a diameter and a length' };
  const radius = d / 2 + SLOT_PLAY;
  // Rounded up to 1/32" so the rib is an easy size to rip.
  const height = Math.ceil((RIB_BASE + radius) * 32 - 1e-9) / 32;
  if (RIB_BASE + d > inside.height - INSERT_TOP_CLEARANCE) {
    return { ...empty, error: `${f(d)} markers on ${f(RIB_BASE)} ribs stand ${f(RIB_BASE + d)} tall, but the box is only ${f(inside.height)} deep inside` };
  }
  const length = inside.width - INSERT_PLAY;
  const pitch = d + Math.max(insert.spacing, 0);
  const perRow = Math.floor((length - 0.5 + insert.spacing) / pitch);
  const rowDepth = L + MARKER_END_ROOM;
  const rows = Math.floor(inside.depth / rowDepth);
  if (perRow < 1) return { ...empty, error: `the drawer is too narrow for a ${f(d)} marker` };
  if (rows < 1) return { ...empty, error: `${f(L)} markers need ${f(rowDepth)} front to back, but the box is ${f(inside.depth)} inside — point them side to side in a wider drawer, or choose shorter markers` };
  const first = (length - (perRow - 1) * pitch) / 2;
  const cuts: EdgeCut[] = Array.from({ length: perRow }, (_, i) => ({ kind: 'round', center: first + i * pitch, radius }));
  const placements: InsertPlacement[] = [];
  const spare = (inside.depth - rows * rowDepth) / 2;
  for (let r = 0; r < rows; r++) {
    const start = spare + r * rowDepth + MARKER_END_ROOM / 2;
    for (const z of [start + 0.2 * L - t / 2, start + 0.8 * L - t / 2]) {
      placements.push({ role: 'rib', along: 'x', x: INSERT_PLAY / 2, z, length, height });
    }
  }
  return {
    pieces: [{ role: 'rib', qty: rows * 2, length, height, cuts }],
    placements,
    capacity: perRow * rows,
    cells: 0,
    error: null,
  };
}

/**
 * A piece's outline with its edge cuts, counter-clockwise from the bottom-left
 * corner in (u, v): bottom edge left to right, then the top edge right to left.
 */
export function pieceOutline(length: number, height: number, cuts: EdgeCut[]): [number, number][] {
  const pts: [number, number][] = [[0, 0]];
  const bottom = cuts.filter((c): c is Extract<EdgeCut, { kind: 'slot' }> => c.kind === 'slot' && c.from === 'bottom').sort((a, b) => a.center - b.center);
  for (const s of bottom) {
    const u0 = s.center - s.width / 2;
    const u1 = s.center + s.width / 2;
    pts.push([u0, 0], [u0, s.depth], [u1, s.depth], [u1, 0]);
  }
  pts.push([length, 0], [length, height]);
  const top = cuts.filter(c => c.kind === 'round' || c.from === 'top').sort((a, b) => b.center - a.center);
  for (const c of top) {
    if (c.kind === 'slot') {
      const u0 = c.center - c.width / 2;
      const u1 = c.center + c.width / 2;
      pts.push([u1, height], [u1, height - c.depth], [u0, height - c.depth], [u0, height]);
    } else {
      // Half-round notch, right to left.
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI;
        pts.push([c.center + c.radius * Math.cos(a), height - c.radius * Math.sin(a)]);
      }
    }
  }
  pts.push([0, height]);
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
}

export const INSERT_NAMES: Record<InsertPiece['role'], string> = {
  lengthwise: 'Lengthwise divider',
  crosswise: 'Crosswise divider',
  rib: 'Marker rib',
};
