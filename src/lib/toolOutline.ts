// Tool outlines for shadow-board drawer inserts, ported from ShapePilot's tool
// tray: read the closed outlines in an SVG or DXF, keep the largest, simplify it,
// and grow it by a clearance so the tool actually drops into its pocket.
//
// Importers work in millimetres, y-up (SVG is y-down, so it's flipped); the
// result is converted to inches with its lower-left corner at the origin.

import * as pcNamespace from 'polygon-clipping';

// polygon-clipping ships CJS (Node) and ESM (Vite) builds with different shapes.
const pc = ((pcNamespace as unknown as { default?: typeof pcNamespace }).default ?? pcNamespace) as typeof pcNamespace;

export type Pt = [number, number];
export type Ring = Pt[];
/** An outer ring and its holes. */
export type Region = Ring[];

export class OutlineImportError extends Error {}

const MM_PER_INCH = 25.4;
/** Snapping grid (mm): the clipper needs near-coincident points to be exactly coincident. */
const QUANTUM = 1e-4;
const quantize = (r: Ring): Ring => r.map(([x, y]) => [Math.round(x / QUANTUM) * QUANTUM, Math.round(y / QUANTUM) * QUANTUM]);

export function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function pointInRing([x, y]: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Groups loose rings into regions by containment. A ring inside an even number
 * of others is an outline; inside an odd number, it's a hole in the smallest of them.
 */
export function nestRings(rings: Ring[]): Region[] {
  const usable = rings.filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1e-9);
  const area = (r: Ring) => Math.abs(signedArea(r));
  const containing = (ring: Ring) => usable.filter(o => o !== ring && area(o) > area(ring) && pointInRing(ring[0], o));
  const outers = usable.filter(r => containing(r).length % 2 === 0);
  const regions = new Map<Ring, Ring[]>(outers.map(o => [o, []]));
  for (const ring of usable) {
    const around = containing(ring);
    if (around.length % 2 === 0) continue;
    const owner = around.filter(o => regions.has(o)).sort((x, y) => area(x) - area(y))[0];
    if (owner) regions.get(owner)!.push(ring);
  }
  return outers.sort((x, y) => area(y) - area(x)).map(o => [o, ...regions.get(o)!]);
}

// ── SVG ──────────────────────────────────────────────────────────────────────

const UNIT_MM: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, in: MM_PER_INCH, pt: MM_PER_INCH / 72, pc: MM_PER_INCH / 6, px: MM_PER_INCH / 96, '': MM_PER_INCH / 96,
};

/**
 * Millimetres per SVG user unit, from the declared width against the viewBox width.
 * A document with neither is treated as 96 dpi pixels (the CSS default).
 */
export function svgUnitScaleMm(svg: string): number {
  const fallback = MM_PER_INCH / 96;
  const width = /<svg[^>]*\bwidth\s*=\s*"([^"]+)"/.exec(svg)?.[1]?.trim();
  const viewBox = /<svg[^>]*\bviewBox\s*=\s*"([^"]+)"/.exec(svg)?.[1]?.trim();
  if (!width) return fallback;
  const match = /^([0-9.+-eE]+)\s*([a-z%]*)$/.exec(width);
  if (!match) return fallback;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || unit === '%') return fallback;
  const widthMm = value * (UNIT_MM[unit] ?? fallback);
  if (!viewBox) return UNIT_MM[unit] ?? fallback;
  const viewWidth = viewBox.split(/[\s,]+/).map(Number)[2];
  return Number.isFinite(viewWidth) && viewWidth > 0 ? widthMm / viewWidth : fallback;
}

/** Closed outlines from an SVG (browser only: it uses three.js's SVG parser). */
export async function svgOutlines(text: string): Promise<Region[]> {
  const { SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js');
  const scale = svgUnitScaleMm(text);
  const parsed = new SVGLoader().parse(text);
  const rings: Ring[] = [];
  const toRing = (points: { x: number; y: number }[]): Ring => {
    const ring: Ring = points.map(p => [p.x * scale, -p.y * scale]);
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (ring.length > 1 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) ring.pop();
    return ring;
  };
  for (const path of parsed.paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      rings.push(toRing(shape.getPoints(24)));
      for (const hole of shape.holes) rings.push(toRing(hole.getPoints(24)));
    }
  }
  const regions = nestRings(rings);
  if (!regions.length) throw new OutlineImportError('no closed shapes found — strokes and text must be converted to filled paths');
  return regions;
}

// ── DXF ──────────────────────────────────────────────────────────────────────

/** $INSUNITS codes we honour; anything else is taken as millimetres. */
const INSUNITS_MM: Record<number, number> = { 1: MM_PER_INCH, 2: MM_PER_INCH * 12, 4: 1, 5: 10, 6: 1000 };
const ARC_STEPS_PER_TURN = 64;

function arcPoints(cx: number, cy: number, r: number, from: number, to: number): Ring {
  let sweep = to - from;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * ARC_STEPS_PER_TURN));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + (sweep * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
}

/** Points along a polyline segment with a bulge (tan of a quarter of the arc's angle; 0 is straight). */
function bulgeSegment(a: Pt, b: Pt, bulge: number): Ring {
  if (Math.abs(bulge) < 1e-9) return [a];
  const theta = 4 * Math.atan(bulge);
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [a];
  const r = chord / (2 * Math.sin(theta / 2));
  // Centre: from the chord midpoint, perpendicular, by the sagitta's complement.
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const h = r * Math.cos(theta / 2);
  const cx = mx - (dy / chord) * h;
  const cy = my + (dx / chord) * h;
  const start = Math.atan2(a[1] - cy, a[0] - cx);
  const steps = Math.max(2, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * ARC_STEPS_PER_TURN));
  const radius = Math.abs(r);
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (theta * i) / steps;
    return [cx + radius * Math.cos(t), cy + radius * Math.sin(t)] as Pt;
  });
}

/** Group-code/value pairs of a DXF file. */
function dxfPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

/** Closed outlines from a DXF: polylines (with arcs), circles, and LINE/ARC runs chained end to end. */
export function dxfOutlines(text: string): Region[] {
  const pairs = dxfPairs(text);
  if (!pairs.length) throw new OutlineImportError('that doesn’t look like a DXF file');
  let scale = 1;
  const units = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (units >= 0) scale = INSUNITS_MM[Number(pairs[units + 1]?.[1])] ?? 1;

  // Split the ENTITIES section into entities: each starts at group code 0.
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  const entities: [number, string][][] = [];
  for (let i = start + 1; start >= 0 && i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      if (value === 'ENDSEC') break;
      entities.push([[code, value]]);
    } else entities[entities.length - 1]?.push([code, value]);
  }

  const closed: Ring[] = [];
  const open: Ring[] = [];
  const num = (e: [number, string][], code: number, fallback = 0) => {
    const found = e.find(([c]) => c === code);
    return found ? Number(found[1]) : fallback;
  };
  const s = (x: number, y: number): Pt => [x * scale, y * scale];
  /** A polyline from vertex x/y/bulge triples, closed or not. */
  const polyline = (verts: { x: number; y: number; bulge: number }[], isClosed: boolean) => {
    const pts: Ring = [];
    const count = isClosed ? verts.length : verts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      pts.push(...bulgeSegment(s(a.x, a.y), s(b.x, b.y), a.bulge));
    }
    if (!isClosed && verts.length) pts.push(s(verts[verts.length - 1].x, verts[verts.length - 1].y));
    (isClosed ? closed : open).push(pts);
  };

  for (let k = 0; k < entities.length; k++) {
    const e = entities[k];
    const type = e[0][1];
    if (type === 'LINE') {
      open.push([s(num(e, 10), num(e, 20)), s(num(e, 11), num(e, 21))]);
    } else if (type === 'CIRCLE') {
      closed.push(arcPoints(num(e, 10) * scale, num(e, 20) * scale, num(e, 40) * scale, 0, 2 * Math.PI).slice(0, -1));
    } else if (type === 'ARC') {
      open.push(arcPoints(num(e, 10) * scale, num(e, 20) * scale, num(e, 40) * scale, num(e, 50) * Math.PI / 180, num(e, 51) * Math.PI / 180));
    } else if (type === 'LWPOLYLINE') {
      const verts: { x: number; y: number; bulge: number }[] = [];
      for (const [c, v] of e) {
        if (c === 10) verts.push({ x: Number(v), y: 0, bulge: 0 });
        else if (c === 20 && verts.length) verts[verts.length - 1].y = Number(v);
        else if (c === 42 && verts.length) verts[verts.length - 1].bulge = Number(v);
      }
      if (verts.length >= 2) polyline(verts, (num(e, 70) & 1) === 1);
    } else if (type === 'POLYLINE') {
      // Followed by VERTEX entities up to SEQEND.
      const isClosed = (num(e, 70) & 1) === 1;
      const verts: { x: number; y: number; bulge: number }[] = [];
      while (entities[k + 1]?.[0][1] === 'VERTEX') {
        const v = entities[++k];
        verts.push({ x: num(v, 10), y: num(v, 20), bulge: num(v, 42) });
      }
      if (entities[k + 1]?.[0][1] === 'SEQEND') k++;
      if (verts.length >= 2) polyline(verts, isClosed);
    } else if (type === 'SPLINE') {
      // Fit points when given, else the control polygon — close enough for a pocket outline.
      const fit: Pt[] = [];
      const control: Pt[] = [];
      for (let i = 0; i < e.length; i++) {
        const [c, v] = e[i];
        if (c === 11) fit.push(s(Number(v), Number(e[i + 1]?.[1] ?? 0)));
        if (c === 10) control.push(s(Number(v), Number(e[i + 1]?.[1] ?? 0)));
      }
      const pts = fit.length >= 2 ? fit : control;
      if (pts.length >= 2) ((num(e, 70) & 1) === 1 ? closed : open).push(pts);
    }
  }

  const rings = [...closed, ...chain(open)].map(quantize).filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  if (!rings.length) throw new OutlineImportError('no closed outlines found in the DXF file');
  return nestRings(rings);
}

/** Joins open fragments end to end into closed rings; runs the file never closed are dropped, not invented. */
function chain(fragments: Ring[]): Ring[] {
  const key = ([x, y]: Pt) => `${Math.round(x / 1e-3)}|${Math.round(y / 1e-3)}`;
  const remaining = fragments.map(f => [...f]);
  const rings: Ring[] = [];
  while (remaining.length) {
    const current = remaining.pop()!;
    let extended = true;
    while (extended) {
      extended = false;
      const tail = current[current.length - 1];
      const head = current[0];
      if (key(tail) === key(head) && current.length > 2) break;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i];
        const [oHead, oTail] = [other[0], other[other.length - 1]];
        if (key(tail) === key(oHead)) current.push(...other.slice(1));
        else if (key(tail) === key(oTail)) current.push(...[...other].reverse().slice(1));
        else if (key(head) === key(oTail)) current.unshift(...other.slice(0, -1));
        else if (key(head) === key(oHead)) current.unshift(...[...other].reverse().slice(0, -1));
        else continue;
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (current.length > 3 && key(current[0]) === key(current[current.length - 1])) rings.push(current.slice(0, -1));
  }
  return rings;
}

// ── Simplify and grow ────────────────────────────────────────────────────────

function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function decimate(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return [...points];
  let worst = 0;
  let index = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const d = pointToSegment(points[i], points[0], points[points.length - 1]);
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [...decimate(points.slice(0, index + 1), tolerance).slice(0, -1), ...decimate(points.slice(index), tolerance)];
}

/** Ramer–Douglas–Peucker on a closed ring, started at its leftmost point so the result doesn't depend on where the file started it. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length < 4) return [...ring];
  let start = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i][0] < ring[start][0] || (ring[i][0] === ring[start][0] && ring[i][1] < ring[start][1])) start = i;
  const rotated = [...ring.slice(start), ...ring.slice(0, start)];
  const result = decimate([...rotated, rotated[0]], tolerance);
  result.pop();
  return result.length >= 3 ? result : [...ring];
}

/** Every ring simplified, raising the tolerance until none has more than `maxPoints`. */
export function simplifyRegions(regions: Region[], tolerance: number, maxPoints: number): Region[] {
  let t = tolerance;
  for (let attempt = 0; attempt < 14; attempt++) {
    const out = regions.map(region => region.map(ring => simplifyRing(ring, t)));
    if (Math.max(0, ...out.flat().map(r => r.length)) <= maxPoints) return out;
    t *= 1.6;
  }
  return regions.map(region => region.map(ring => simplifyRing(ring, t)));
}

type Geo = [number, number][][][];
const toGeo = (regions: Region[]): Geo => regions.map(region => region.map(ring => {
  const q = quantize(ring);
  return [...q, q[0]];
}));
const fromGeo = (geo: Geo): Region[] => geo.map(poly => poly.map(ring => ring.slice(0, -1) as Ring));

/**
 * Grows regions outward by `d` (a Minkowski sum with a disc): a disc at every
 * vertex and a rectangle along every edge, unioned back in — round corners, no
 * spikes, and holes shrink by the same amount.
 */
export function growRegions(regions: Region[], d: number): Region[] {
  if (!(d > 0) || !regions.length) return regions;
  const discSteps = 16;
  const pieces: Region[][] = [regions];
  for (const region of regions) {
    for (const ring of region) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        pieces.push([[Array.from({ length: discSteps }, (_, k) => {
          const a = (k / discSteps) * Math.PI * 2;
          return [ax + d * Math.cos(a), ay + d * Math.sin(a)] as Pt;
        })]]);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-9) continue;
        const [nx, ny] = [-(by - ay) / len * d, (bx - ax) / len * d];
        pieces.push([[[[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]]]);
      }
    }
  }
  // Union in balanced pairs so each step stays small.
  let level = pieces;
  while (level.length > 1) {
    const next: Region[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      const b = level[i + 1];
      next.push(b ? fromGeo(pc.union(toGeo(level[i]), toGeo(b)) as Geo) : level[i]);
    }
    level = next;
  }
  return level[0];
}

// ── The tool, ready to pocket ────────────────────────────────────────────────

export interface ToolOutline {
  name: string;
  /** Outer ring and holes, in inches, lower-left at the origin, clearance included. */
  rings: Ring[];
  width: number;
  height: number;
}

/** Keeps the saved outline light: a few thousandths of an inch is far finer than a pocket needs. */
const SIMPLIFY_MM = 0.15;
const MAX_POINTS = 180;

/**
 * The largest region of an import, simplified, grown by `clearance` (inches),
 * and moved so its lower-left corner sits at the origin. Largest because a
 * drawing often carries a border or construction lines; a pocket is one tool.
 */
export function toolFromRegions(regions: Region[], clearance: number, name: string): ToolOutline | null {
  const usable = regions.filter(r => r.length && r[0].length >= 3);
  if (!usable.length) return null;
  const biggest = usable.reduce((best, r) => (Math.abs(signedArea(r[0])) > Math.abs(signedArea(best[0])) ? r : best));
  const simplified = simplifyRegions([biggest], SIMPLIFY_MM / 2, MAX_POINTS);
  const grown = growRegions(simplified, clearance * MM_PER_INCH);
  // Union can return pieces; the pocket is the biggest.
  const main = grown.reduce((best, r) => (Math.abs(signedArea(r[0])) > Math.abs(signedArea(best[0])) ? r : best), grown[0]);
  const [trimmed] = simplifyRegions([main], SIMPLIFY_MM, MAX_POINTS);
  const xs = trimmed.flat().map(p => p[0]);
  const ys = trimmed.flat().map(p => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  const rings = trimmed.map(ring => ring.map(([x, y]) => [r4((x - minX) / MM_PER_INCH), r4((y - minY) / MM_PER_INCH)] as Pt));
  return {
    name,
    rings,
    width: (Math.max(...xs) - minX) / MM_PER_INCH,
    height: (Math.max(...ys) - minY) / MM_PER_INCH,
  };
}

/** Reads one file (by its extension) into a tool outline. */
export async function importToolFile(file: File, clearance: number): Promise<ToolOutline> {
  const name = file.name.replace(/\.(svg|dxf)$/i, '');
  if (file.size > 8 * 1024 * 1024) throw new OutlineImportError(`${file.name} is larger than 8 MB`);
  const text = await file.text();
  const regions = /\.dxf$/i.test(file.name) ? dxfOutlines(text)
    : /\.svg$/i.test(file.name) ? await svgOutlines(text)
      : (() => { throw new OutlineImportError(`${file.name} isn’t an SVG or DXF file`); })();
  const tool = toolFromRegions(regions, clearance, name);
  if (!tool) throw new OutlineImportError(`${file.name} has no closed outline`);
  return tool;
}
