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
