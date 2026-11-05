// Shaper Origin + BenchPilot pass-through: a part longer than the BenchPilot
// reach, cut in segments. Ported from ShapePilot's tray-cabinet export
// (src/export/passThrough.ts there), working on Workshop's PartFace in inches.
//
// ShaperTape runs the whole board and Origin scans it all, so it knows the
// whole workspace however the board is moved. The file stays one drawing of the
// whole part; only a cut longer than the reach is split, into pieces that
// overlap across each seam. Cut what is in reach, slide the board along its
// length, cut the rest.
//
// A split outline can no longer be a closed shape, and Origin only offsets
// closed shapes, so each piece becomes an open on-line cut already offset by
// the bit radius — with the rounded corners an outside cut would have left.
// That is why the bit has to be known, and why it must be the one used.
//
// Only rectangular parts are split, and inside them only rectangular pockets
// (back rabbets, grooves). Short cuts — dados, holes — stay whole and the seams
// are nudged off them.

import { MM_PER_INCH } from './shelving.ts';
import type { Feature, PartFace } from './shelfExport.ts';

export type BenchPilotMount = 'workstation' | 'bench';
/** Which way a part too long for the reach slides through it. */
export type BenchPilotFeed = 'sideways' | 'front-to-back';

export interface BenchPilotReach {
  /** Left to right, in inches. */
  width: number;
  /** Front to back, in inches. */
  depth: number;
  label: string;
}

// From support.shapertools.com/benchpilot-faq; approximate, as in ShapePilot.
export const BENCHPILOT_REACH: Record<BenchPilotMount, BenchPilotReach> = {
  workstation: { width: 460 / MM_PER_INCH, depth: 280 / MM_PER_INCH, label: 'On the Workstation' },
  bench: { width: 460 / MM_PER_INCH, depth: 445 / MM_PER_INCH, label: 'On the bench' },
};

/** Each segment runs this far past a seam, so the halves overlap twice this. */
export const PASS_THROUGH_OVERLAP = 3 / MM_PER_INCH;
/** 1/4", the usual Origin bit for cutting a panel out. */
export const DEFAULT_PASS_THROUGH_BIT = 0.25;

export const PASS_THROUGH_BITS: { value: number; label: string }[] = [
  { value: 0.125, label: '1/8"' },
  { value: 3 / MM_PER_INCH, label: '3 mm' },
  { value: 0.25, label: '1/4"' },
  { value: 6 / MM_PER_INCH, label: '6 mm' },
  { value: 8 / MM_PER_INCH, label: '8 mm' },
];

/** Whether a part fits the reach, either way round — the stock can be turned. */
export const fitsReach = (reach: BenchPilotReach, a: number, b: number): boolean =>
  (a <= reach.width && b <= reach.depth) || (b <= reach.width && a <= reach.depth);

type Axis = 'u' | 'v';

export interface PassThroughPlan {
  /** The face axis the part is split along: its long side. */
  axis: Axis;
  /** The part's extent along that axis. */
  length: number;
  /** Seam positions along the axis. */
  seams: number[];
  /** Each segment's extent along the axis, overlaps included. */
  windows: [number, number][];
  /** True when the length runs left to right through the reach. */
  alongReachWidth: boolean;
  bit: number;
  overlap: number;
}

/**
 * How a part this size splits, or null when it fits whole or is too wide to
 * pass through. Without a feed, it slides sideways when its width allows and
 * front to back when it does not.
 */
export function passThroughSegments(
  reach: BenchPilotReach, a: number, b: number, bit: number,
  feed?: BenchPilotFeed, overlap = PASS_THROUGH_OVERLAP,
): { count: number; limit: number; alongReachWidth: boolean } | null {
  if (fitsReach(reach, a, b)) return null;
  const length = Math.max(a, b);
  const across = Math.min(a, b) + bit;
  const alongReachWidth = feed ? feed === 'sideways' : across <= reach.depth;
  if (across > (alongReachWidth ? reach.depth : reach.width)) return null;
  const limit = alongReachWidth ? reach.width : reach.depth;
  // The longest window is an end segment, which carries the bit radius at its end.
  if (limit - overlap - bit / 2 <= 0) return null;
  // Middle windows carry an overlap at both seams, so they are the tighter ones past two.
  for (let count = 2; count < 50; count++) {
    const span = length / count;
    if (span + overlap + bit / 2 <= limit && (count < 3 || span + 2 * overlap <= limit)) {
      return { count, limit, alongReachWidth };
    }
  }
  return null;
}

/** A feature's extent along an axis. */
function extent(f: Feature, axis: Axis): [number, number] {
  const pick = (p: [number, number]) => (axis === 'u' ? p[0] : p[1]);
  const range = (pts: [number, number][]): [number, number] => {
    const vs = pts.map(pick);
    return [Math.min(...vs), Math.max(...vs)];
  };
  switch (f.kind) {
    case 'pocket': return axis === 'u' ? [f.u, f.u + f.length] : [f.v, f.v + f.width];
    case 'hole': { const c = axis === 'u' ? f.u : f.v; return [c - f.radius, c + f.radius]; }
    case 'guide':
    case 'cutout': return range(f.points);
    case 'pocketPath': return range(f.rings.flat());
  }
}

/** The seam closest to `ideal` whose overlap misses every short cut, if there is one in range. */
function placeSeam(ideal: number, lo: number, hi: number, overlap: number, blocked: [number, number][]): number {
  const clear = (s: number) => s >= lo && s <= hi && blocked.every(([a, b]) => s + overlap <= a || s - overlap >= b);
  const candidates = [ideal, ...blocked.flatMap(([a, b]) => [a - overlap, b + overlap])]
    .filter(clear)
    .sort((p, q) => Math.abs(p - ideal) - Math.abs(q - ideal));
  return candidates[0] ?? ideal;
}

export function planPassThrough(
  face: PartFace, reach: BenchPilotReach, bit = DEFAULT_PASS_THROUGH_BIT,
  feed?: BenchPilotFeed, overlap = PASS_THROUGH_OVERLAP,
): PassThroughPlan | null {
  if (face.outline) return null; // shaped outlines aren't split
  const split = passThroughSegments(reach, face.length, face.width, bit, feed, overlap);
  if (!split) return null;
  const axis: Axis = face.length >= face.width ? 'u' : 'v';
  const length = axis === 'u' ? face.length : face.width;
  const r = bit / 2;

  // A seam's overlap should miss the short cuts: dados, holes, anything shorter than a segment.
  const blocked = face.features
    .filter(f => f.kind !== 'guide')
    .map(f => extent(f, axis))
    .filter(([a, b]) => b - a < length / split.count);

  const seams: number[] = [];
  let prev = -r;
  for (let i = 1; i < split.count; i++) {
    const ideal = (length * i) / split.count;
    // Stay inside this window's limit, and leave the rest enough room.
    const hi = prev + split.limit - overlap;
    const lo = length + r - (split.count - i) * (split.limit - 2 * overlap) + overlap;
    const seam = placeSeam(ideal, lo, hi, overlap, blocked);
    seams.push(seam);
    prev = seam - overlap;
  }
  const windows = [0, ...seams].map((s, i): [number, number] => [
    i === 0 ? 0 : s - overlap,
    i === seams.length ? length : seams[i] + overlap,
  ]);
  return { axis, length, seams, windows, alongReachWidth: split.alongReachWidth, bit, overlap };
}

const ARC_STEPS = 8;

/** A quarter arc around (ca, cc), from angle a0 to a1 in degrees, first point excluded. */
const arc = (ca: number, cc: number, r: number, a0: number, a1: number): [number, number][] =>
  Array.from({ length: ARC_STEPS }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * (i + 1)) / ARC_STEPS) * Math.PI) / 180;
    return [ca + r * Math.cos(a), cc + r * Math.sin(a)];
  });

/** The outline pieces of one window, offset outward by the bit radius, in (u, v). */
function outlinePieces(face: PartFace, plan: PassThroughPlan, i: number): [number, number][][] {
  const r = plan.bit / 2;
  const L = plan.length;
  const W = plan.axis === 'u' ? face.width : face.length;
  const [a, b] = plan.windows[i];
  const first = i === 0;
  const last = i === plan.windows.length - 1;
  // Built along/across the split axis, then mapped to (u, v).
  const toUV = (pts: [number, number][]): [number, number][] =>
    pts.map(([s, c]) => (plan.axis === 'u' ? [s, c] : [c, s]));
  if (first) {
    return [toUV([
      [b, -r], [0, -r], ...arc(0, 0, r, 270, 180),
      [-r, W], ...arc(0, W, r, 180, 90), [b, W + r],
    ])];
  }
  if (last) {
    return [toUV([
      [a, -r], [L, -r], ...arc(L, 0, r, 270, 360),
      [L + r, W], ...arc(L, W, r, 0, 90), [a, W + r],
    ])];
  }
  return [toUV([[a, -r], [b, -r]]), toUV([[a, W + r], [b, W + r]])];
}

/** The face as it should be cut in segments: on-line outline pieces, long pockets split. */
export function splitForPassThrough(face: PartFace, plan: PassThroughPlan): PartFace {
  const { axis, windows } = plan;
  const fitsAWindow = (f: Feature) => {
    const [a, b] = extent(f, axis);
    return windows.some(([wa, wb]) => a >= wa - 1e-9 && b <= wb + 1e-9);
  };
  const features: Feature[] = [];
  for (const f of face.features) {
    if (f.kind !== 'pocket' || fitsAWindow(f)) { features.push(f); continue; }
    windows.forEach(([wa, wb], i) => {
      const [a, b] = extent(f, axis);
      const lo = Math.max(a, wa);
      const hi = Math.min(b, wb);
      if (hi <= lo) return;
      const label = `${f.label}, segment ${i + 1}`;
      features.push(axis === 'u' ? { ...f, label, u: lo, length: hi - lo } : { ...f, label, v: lo, width: hi - lo });
    });
  }
  features.push({
    kind: 'guide', label: 'Finished edge (reference)', closed: true,
    points: [[0, 0], [face.length, 0], [face.length, face.width], [0, face.width]],
  });
  const fmt = (inches: number) => `${+inches.toFixed(3)}" (${+(inches * MM_PER_INCH).toFixed(1)} mm)`;
  return {
    ...face,
    features,
    outlinePaths: windows.flatMap((_w, i) => outlinePieces(face, plan, i)),
    margin: plan.bit / 2,
    note:
      `PASS-THROUGH in ${windows.length} segments along the length, seams at ${plan.seams.map(fmt).join(', ')}, `
      + `${fmt(plan.overlap * 2)} overlap. Tape and scan the whole board, cut what is in reach, slide it along its length, `
      + `cut the rest. The outline is open on-line cuts already offset for a ${fmt(plan.bit)} bit: cut ON the line with that bit. `
      + 'The blue rectangle is the finished edge, reference only.',
  };
}

export type PassThroughStatus =
  | { kind: 'fits'; turned: boolean }
  | { kind: 'split'; plan: PassThroughPlan; face: PartFace }
  /** Too long, and too wide to feed this way, though the other feed works. */
  | { kind: 'too-wide'; otherFeed: true }
  | { kind: 'shaped' }
  | { kind: 'too-big' };

export const OTHER_FEED: Record<BenchPilotFeed, BenchPilotFeed> = { sideways: 'front-to-back', 'front-to-back': 'sideways' };

/** What happens to a face on BenchPilot with these settings. */
export function passThroughStatus(face: PartFace, reach: BenchPilotReach, bit: number, feed: BenchPilotFeed): PassThroughStatus {
  if (fitsReach(reach, face.length, face.width)) {
    return { kind: 'fits', turned: !(face.length <= reach.width && face.width <= reach.depth) };
  }
  if (face.outline) return { kind: 'shaped' };
  const plan = planPassThrough(face, reach, bit, feed);
  if (plan) return { kind: 'split', plan, face: splitForPassThrough(face, plan) };
  return planPassThrough(face, reach, bit, OTHER_FEED[feed]) ? { kind: 'too-wide', otherFeed: true } : { kind: 'too-big' };
}
