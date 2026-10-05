// Gridfinity for drawers: how many 42 mm grid units fit a drawer, how tall the
// bins can be, how to split the baseplate into tiles that fit a printer's bed,
// and the baseplate tiles themselves as STL. All values here are millimetres.
//
// The baseplate is the open-bottomed "skeleton" style: each cell is a ring whose
// inside follows the bin-foot profile (0.7 mm 45° chamfer, 1.8 mm straight, 2.15
// mm 45° chamfer up to the top), so standard Gridfinity bins drop in and lock.

export const GF_PITCH = 42;
export const GF_UNIT = 7;
export const GF_PLATE_HEIGHT = 4.65;
/** The stacking lip on top of most bins. */
export const GF_LIP = 4.4;
/** Left between the plate and the drawer sides so it drops in. */
export const GF_SIDE_PLAY = 0.5;

/** Common printer beds. */
export const PRINTER_BEDS = [
  { mm: 256, label: 'Bambu X1 / P1 / A1 (256 mm bed)' },
  { mm: 180, label: 'Bambu A1 mini (180 mm bed)' },
  { mm: 220, label: '220 mm bed (Ender 3 class)' },
  { mm: 350, label: '350 mm bed' },
] as const;

export interface GridfinityTile {
  columns: number;
  rows: number;
  count: number;
}

export interface GridfinityLayout {
  columns: number;
  rows: number;
  /** Space left on each side (x) and front and back (y) once the plate is centred. */
  marginX: number;
  marginY: number;
  /** Tallest bin that fits under the drawer above, with and without a stacking lip, in 7 mm units. */
  maxUnits: number;
  maxUnitsWithLip: number;
  /** Baseplate pieces that each fit the printer bed. */
  tiles: GridfinityTile[];
  error: string | null;
}

/** Splits n units into the fewest near-equal chunks no bigger than max: 7 by 6 → 4 + 3. */
export function splitUnits(n: number, max: number): number[] {
  const parts = Math.ceil(n / max);
  const base = Math.floor(n / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < n % parts ? 1 : 0));
}

/**
 * Lays out a baseplate for a drawer's inside (millimetres): the floor's width and
 * depth, and the clear height from the floor to where things must stop.
 */
export function layoutGridfinity(width: number, depth: number, clearHeight: number, bed: number): GridfinityLayout {
  const usableW = width - GF_SIDE_PLAY;
  const usableD = depth - GF_SIDE_PLAY;
  const columns = Math.floor(usableW / GF_PITCH);
  const rows = Math.floor(usableD / GF_PITCH);
  const maxUnits = Math.floor(clearHeight / GF_UNIT);
  const maxUnitsWithLip = Math.floor((clearHeight - GF_LIP) / GF_UNIT);
  const empty = { columns, rows, marginX: 0, marginY: 0, maxUnits, maxUnitsWithLip, tiles: [] };
  if (columns < 1 || rows < 1) return { ...empty, error: `the inside is ${Math.round(width)} × ${Math.round(depth)} mm — too small for a ${GF_PITCH} mm Gridfinity unit` };
  if (maxUnits < 2) return { ...empty, error: `only ${Math.round(clearHeight)} mm of headroom — Gridfinity bins need at least ${2 * GF_UNIT} mm (2 units)` };
  const perTile = Math.max(1, Math.floor((bed - 2) / GF_PITCH));
  const tiles: GridfinityTile[] = [];
  for (const c of splitUnits(columns, perTile)) {
    for (const r of splitUnits(rows, perTile)) {
      const t = tiles.find(x => x.columns === c && x.rows === r);
      if (t) t.count += 1; else tiles.push({ columns: c, rows: r, count: 1 });
    }
  }
  return {
    columns, rows,
    marginX: (width - columns * GF_PITCH) / 2,
    marginY: (depth - rows * GF_PITCH) / 2,
    maxUnits, maxUnitsWithLip, tiles, error: null,
  };
}

// ── Baseplate STL ────────────────────────────────────────────────────────────

type V = [number, number, number];

/** The pocket's inside half-width at each height, bottom to top. */
const PROFILE: [number, number][] = [
  [0, 17.9],
  [0.7, 18.6],
  [2.5, 18.6],
  [GF_PLATE_HEIGHT, 20.75],
];
const HALF = GF_PITCH / 2;

/** A baseplate tile `columns` × `rows` units, as an ASCII STL in millimetres. */
export function baseplateStl(columns: number, rows: number, name = 'gridfinity-baseplate'): string {
  const facets: string[] = [];
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fmt = (n: number) => Number(n.toFixed(4)).toString();
  /** A triangle wound so its normal points along `out`. */
  const tri = (a: V, b: V, c: V, out: V) => {
    let n = cross(sub(b, a), sub(c, a));
    if (dot(n, out) < 0) { [b, c] = [c, b]; n = n.map(x => -x) as V; }
    const len = Math.hypot(...n) || 1;
    facets.push(`facet normal ${n.map(x => fmt(x / len)).join(' ')}\n outer loop\n${[a, b, c].map(v => `  vertex ${v.map(fmt).join(' ')}`).join('\n')}\n endloop\nendfacet`);
  };
  const quad = (a: V, b: V, c: V, d: V, out: V) => { tri(a, b, c, out); tri(a, c, d, out); };
  /** The four corners of a square of half-width h around (cx, cy), at height z, counter-clockwise. */
  const square = (cx: number, cy: number, h: number, z: number): V[] => [
    [cx - h, cy - h, z], [cx + h, cy - h, z], [cx + h, cy + h, z], [cx - h, cy + h, z],
  ];
  /** The band between two squares (corner lists), one trapezoid per side. */
  const band = (outer: V[], inner: V[], out: (side: number) => V) => {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(outer[i], outer[j], inner[j], inner[i], out(i));
    }
  };
  // Side normals for the square's edges in order: −y, +x, +y, −x.
  const sideNormal = (i: number): V => [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]][i] as V;

  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = c * GF_PITCH + HALF;
      const cy = r * GF_PITCH + HALF;
      const top = GF_PLATE_HEIGHT;
      // Top and bottom faces: the ring between the cell's outline and the pocket.
      band(square(cx, cy, HALF, top), square(cx, cy, PROFILE[3][1], top), () => [0, 0, 1]);
      band(square(cx, cy, HALF, 0), square(cx, cy, PROFILE[0][1], 0), () => [0, 0, -1]);
      // Pocket walls, facing into the pocket (toward its centre).
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const [z0, h0] = PROFILE[k];
        const [z1, h1] = PROFILE[k + 1];
        band(square(cx, cy, h0, z0), square(cx, cy, h1, z1), i => sideNormal(i).map(x => -x) as V);
      }
      // Outside walls only where the cell is on the tile's edge.
      const outer0 = square(cx, cy, HALF, 0);
      const outer1 = square(cx, cy, HALF, top);
      const onEdge = [r === 0, c === columns - 1, r === rows - 1, c === 0];
      for (let i = 0; i < 4; i++) {
        if (!onEdge[i]) continue;
        const j = (i + 1) % 4;
        quad(outer0[i], outer0[j], outer1[j], outer1[i], sideNormal(i));
      }
    }
  }
  return `solid ${name}\n${facets.join('\n')}\nendsolid ${name}\n`;
}

// ── Bins ─────────────────────────────────────────────────────────────────────

/** A bin size and how many: w × d grid units, u × 7 mm tall. */
export interface GridfinityBin {
  w: number;
  d: number;
  u: number;
  qty: number;
}

export interface BinPlacement {
  /** Grid cell of the bin's corner (column, row from the front left). */
  x: number;
  y: number;
  w: number;
  d: number;
  u: number;
  /** Which entry in the bin list it came from. */
  bin: number;
}

export interface BinPacking {
  placements: BinPlacement[];
  /** Bins that didn't fit. */
  unplaced: number;
  /** Grid cells left empty. */
  freeCells: number;
}

/** Packs bins into a grid, biggest first, first free spot scanning from the front left; turns them if that fits. */
export function packBins(columns: number, rows: number, bins: GridfinityBin[]): BinPacking {
  const used = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false));
  const fits = (x: number, y: number, w: number, d: number) => {
    if (x + w > columns || y + d > rows) return false;
    for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) if (used[j][i]) return false;
    return true;
  };
  const instances = bins.flatMap((b, bin) => Array.from({ length: Math.max(0, Math.floor(b.qty)) }, () => ({ ...b, bin })))
    .sort((a, b) => b.w * b.d - a.w * a.d);
  const placements: BinPlacement[] = [];
  let unplaced = 0;
  for (const b of instances) {
    let placed = false;
    for (let y = 0; y < rows && !placed; y++) {
      for (let x = 0; x < columns && !placed; x++) {
        for (const [w, d] of b.w === b.d ? [[b.w, b.d]] : [[b.w, b.d], [b.d, b.w]]) {
          if (fits(x, y, w, d)) {
            for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) used[j][i] = true;
            placements.push({ x, y, w, d, u: b.u, bin: b.bin });
            placed = true;
            break;
          }
        }
      }
    }
    if (!placed) unplaced += 1;
  }
  const freeCells = used.flat().filter(c => !c).length;
  return { placements, unplaced, freeCells };
}

/** Bin outside is this much smaller than its grid footprint, so neighbours don't bind. */
const BIN_PLAY = 0.5;
const BIN_WALL = 1.2;
const BIN_FLOOR = 1.2;
/** The bin foot's profile (half-width at each height), the reverse of the baseplate pocket. */
const FOOT: [number, number][] = [[0, 17.8], [0.8, 18.6], [2.6, 18.6], [GF_PLATE_HEIGHT + 0.1, 20.75]];

/**
 * A plain Gridfinity bin w × d units, u × 7 mm tall (no stacking lip, square corners),
 * as an ASCII STL in millimetres: a foot under every cell and an open-topped box.
 */
export function binStl(w: number, d: number, u: number, name = 'gridfinity-bin'): string {
  const facets: string[] = [];
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fmt = (n: number) => Number(n.toFixed(4)).toString();
  const tri = (a: V, b: V, c: V, out: V) => {
    let n = cross(sub(b, a), sub(c, a));
    if (dot(n, out) < 0) { [b, c] = [c, b]; n = n.map(x => -x) as V; }
    const len = Math.hypot(...n) || 1;
    facets.push(`facet normal ${n.map(x => fmt(x / len)).join(' ')}\n outer loop\n${[a, b, c].map(v => `  vertex ${v.map(fmt).join(' ')}`).join('\n')}\n endloop\nendfacet`);
  };
  const quad = (a: V, b: V, c: V, e: V, out: V) => { tri(a, b, c, out); tri(a, c, e, out); };
  const rectAt = (x0: number, y0: number, x1: number, y1: number, z: number): V[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const sides: V[] = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
  /** Side walls between two rectangles (corner lists in the same order), facing `inward ? in : out`. */
  const walls = (lower: V[], upper: V[], inward = false) => {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const n = sides[i];
      quad(lower[i], lower[j], upper[j], upper[i], inward ? n.map(x => -x) as V : n);
    }
  };

  // Feet: one closed frustum stack per cell.
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const cx = i * GF_PITCH + GF_PITCH / 2;
      const cy = j * GF_PITCH + GF_PITCH / 2;
      const ring = (h: number, z: number) => rectAt(cx - h, cy - h, cx + h, cy + h, z);
      const [first, last] = [FOOT[0], FOOT[FOOT.length - 1]];
      const bottom = ring(first[1], first[0]);
      quad(bottom[0], bottom[1], bottom[2], bottom[3], [0, 0, -1]);
      for (let k = 0; k < FOOT.length - 1; k++) walls(ring(FOOT[k][1], FOOT[k][0]), ring(FOOT[k + 1][1], FOOT[k + 1][0]));
      const top = ring(last[1], last[0]);
      quad(top[0], top[1], top[2], top[3], [0, 0, 1]);
    }
  }

  // Body: an open-topped box from the feet up to u × 7 mm.
  const z0 = GF_PLATE_HEIGHT;
  const zTop = Math.max(u * GF_UNIT, z0 + BIN_FLOOR + 2);
  const x0 = BIN_PLAY / 2;
  const y0 = BIN_PLAY / 2;
  const x1 = w * GF_PITCH - BIN_PLAY / 2;
  const y1 = d * GF_PITCH - BIN_PLAY / 2;
  const outerBottom = rectAt(x0, y0, x1, y1, z0);
  const outerTop = rectAt(x0, y0, x1, y1, zTop);
  const innerTop = rectAt(x0 + BIN_WALL, y0 + BIN_WALL, x1 - BIN_WALL, y1 - BIN_WALL, zTop);
  const innerFloor = rectAt(x0 + BIN_WALL, y0 + BIN_WALL, x1 - BIN_WALL, y1 - BIN_WALL, z0 + BIN_FLOOR);
  quad(outerBottom[0], outerBottom[1], outerBottom[2], outerBottom[3], [0, 0, -1]);
  walls(outerBottom, outerTop);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(outerTop[i], outerTop[j], innerTop[j], innerTop[i], [0, 0, 1]);
  }
  walls(innerFloor, innerTop, true);
  quad(innerFloor[0], innerFloor[1], innerFloor[2], innerFloor[3], [0, 0, 1]);
  return `solid ${name}\n${facets.join('\n')}\nendsolid ${name}\n`;
}
