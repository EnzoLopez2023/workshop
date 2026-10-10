// Rooms and cabinet layouts for Built-in Studio projects. Pure geometry so it can
// be tested without a browser; the top view and the 3D room both read from here.
//
// Plan coordinates are inches with the origin at the room's north-west inside
// corner: x runs east along the north wall, y runs south along the west wall.
// Openings on the north and south walls measure their offset from the west
// corner; openings on the east and west walls measure from the north corner.
//
// A cabinet's placement is the centre of its footprint plus a clockwise
// rotation. At 0° its back is toward the north wall and its front faces south;
// 90° puts its back on the east wall, 180° on the south, 270° on the west.

import type { LengthUnit, Solid } from './shelving.ts';

export type Wall = 'north' | 'east' | 'south' | 'west';
export const WALLS: readonly Wall[] = ['north', 'east', 'south', 'west'];
export const WALL_LABELS: Record<Wall, string> = { north: 'Top wall', east: 'Right wall', south: 'Bottom wall', west: 'Left wall' };

export type OpeningKind = 'window' | 'door' | 'closet' | 'opening';
export const OPENING_LABELS: Record<OpeningKind, string> = { window: 'Window', door: 'Door', closet: 'Closet', opening: 'Open doorway' };

export interface RoomOpening {
  id: string;
  kind: OpeningKind;
  wall: Wall;
  /** From the west corner (north/south walls) or the north corner (east/west walls) to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Floor to the bottom of the opening; 0 for doors, closets and doorways. */
  sill: number;
  /** Doors: which way the leaf swings, and which end its hinges are on (start = the corner offsets measure from). */
  swing?: 'in' | 'out';
  hinge?: 'start' | 'end';
  /** Closets: how far the closet runs back behind the wall. */
  depth?: number;
}

export interface Room {
  version: 1;
  units: LengthUnit;
  width: number;
  depth: number;
  height: number;
  walls: Record<Wall, boolean>;
  openings: RoomOpening[];
}

export type Rotation = 0 | 90 | 180 | 270;
export interface Placement { x: number; y: number; rotation: Rotation }

/** Drawn wall thickness: a 2×4 stud wall with drywall both sides. */
export const WALL_THICKNESS = 4.5;
export const DEFAULT_CLOSET_DEPTH = 24;
/** How close a cabinet's back has to come to a wall before it snaps flush (and turns to face away from it). */
export const WALL_SNAP = 10;
/** How close an edge has to come to another cabinet's edge, or a corner, to line up with it. */
export const EDGE_SNAP = 2;
/** Clear floor kept in front of a door or doorway. */
export const DOOR_CLEARANCE = 30;

const EPS = 1e-6;
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const BACK_WALL: Record<Rotation, Wall> = { 0: 'north', 90: 'east', 180: 'south', 270: 'west' };
const WALL_ROTATION: Record<Wall, Rotation> = { north: 0, east: 90, south: 180, west: 270 };

export const backWall = (rotation: Rotation): Wall => BACK_WALL[rotation];
export const rotationFacingAway = (wall: Wall): Rotation => WALL_ROTATION[wall];
export const nextRotation = (r: Rotation, step: 1 | -1 = 1): Rotation => ROTATIONS[(ROTATIONS.indexOf(r) + step + 4) % 4];

export function defaultRoom(units: LengthUnit = 'in'): Room {
  return { version: 1, units, width: 144, depth: 120, height: 96, walls: { north: true, east: true, south: true, west: true }, openings: [] };
}

export function wallLength(room: Pick<Room, 'width' | 'depth'>, wall: Wall): number {
  return wall === 'north' || wall === 'south' ? room.width : room.depth;
}

export function newOpening(kind: OpeningKind, wall: Wall, room: Room, id: string): RoomOpening {
  const length = wallLength(room, wall);
  const width = Math.min(kind === 'window' ? 36 : kind === 'closet' ? 48 : kind === 'opening' ? 36 : 32, length);
  const height = Math.min(kind === 'window' ? 48 : 80, room.height);
  const sill = kind === 'window' ? Math.min(36, Math.max(0, room.height - height)) : 0;
  return {
    id, kind, wall,
    offset: Math.max(0, Math.round((length - width) / 2)),
    width, height, sill,
    ...(kind === 'door' ? { swing: 'in' as const, hinge: 'start' as const } : {}),
    ...(kind === 'closet' ? { depth: DEFAULT_CLOSET_DEPTH } : {}),
  };
}

/** Everything wrong with a room, as sentences; empty when it's ready to lay out. */
export function roomProblems(room: Room, f: (inches: number) => string = String): string[] {
  const problems: string[] = [];
  if (!(room.width >= 12 && room.width <= 1200)) problems.push('Room width must be between 1 and 100 feet.');
  if (!(room.depth >= 12 && room.depth <= 1200)) problems.push('Room depth must be between 1 and 100 feet.');
  if (!(room.height >= 24 && room.height <= 360)) problems.push('Wall height must be between 2 and 30 feet.');
  if (!WALLS.some(w => room.walls[w])) problems.push('Turn on at least one wall — cabinets need something to stand against.');
  for (const wall of WALLS) {
    const list = room.openings.filter(o => o.wall === wall).sort((a, b) => a.offset - b.offset);
    const length = wallLength(room, wall);
    for (const o of list) {
      const name = `The ${OPENING_LABELS[o.kind].toLowerCase()} on the ${WALL_LABELS[wall].toLowerCase()}`;
      if (!room.walls[wall]) problems.push(`${name} is on a wall that's turned off.`);
      if (!(o.width > 0) || !(o.height > 0) || !(o.offset >= 0) || !(o.sill >= 0)) { problems.push(`${name} needs a width, height and position.`); continue; }
      if (o.offset + o.width > length + EPS) problems.push(`${name} runs past the end of the wall (${f(length)} long).`);
      if (o.sill + o.height > room.height + EPS) problems.push(`${name} is taller than the wall (${f(room.height)}).`);
      if (o.kind === 'closet' && !((o.depth ?? 0) >= 6 && (o.depth ?? 0) <= 120)) problems.push(`${name} needs a depth between ${f(6)} and ${f(120)}.`);
    }
    for (let i = 1; i < list.length; i++) {
      if (list[i].offset < list[i - 1].offset + list[i - 1].width - EPS) {
        problems.push(`Two openings overlap on the ${WALL_LABELS[wall].toLowerCase()}.`);
        break;
      }
    }
  }
  return problems;
}

/** Reads a stored room back, or null when it isn't one. */
export function readRoom(raw: unknown): Room | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const width = num(r.width), depth = num(r.depth), height = num(r.height);
  if (width === null || depth === null || height === null) return null;
  const w = (r.walls && typeof r.walls === 'object' ? r.walls : {}) as Record<string, unknown>;
  const walls = Object.fromEntries(WALLS.map(k => [k, w[k] === true])) as Record<Wall, boolean>;
  const openings: RoomOpening[] = [];
  for (const [i, value] of (Array.isArray(r.openings) ? r.openings : []).entries()) {
    if (!value || typeof value !== 'object') continue;
    const o = value as Record<string, unknown>;
    const kind = o.kind as OpeningKind;
    const wall = o.wall as Wall;
    if (!(kind in OPENING_LABELS) || !WALLS.includes(wall)) continue;
    const offset = num(o.offset), ow = num(o.width), oh = num(o.height);
    if (offset === null || ow === null || oh === null) continue;
    openings.push({
      id: typeof o.id === 'string' && o.id ? o.id : `o${i + 1}`,
      kind, wall, offset, width: ow, height: oh,
      sill: kind === 'window' ? num(o.sill) ?? 0 : 0,
      ...(kind === 'door' ? { swing: o.swing === 'out' ? 'out' as const : 'in' as const, hinge: o.hinge === 'end' ? 'end' as const : 'start' as const } : {}),
      ...(kind === 'closet' ? { depth: num(o.depth) ?? DEFAULT_CLOSET_DEPTH } : {}),
    });
  }
  return { version: 1, units: r.units === 'mm' ? 'mm' : 'in', width, depth, height, walls, openings };
}

// ── Cabinets ────────────────────────────────────────────────────────────────

/** A cabinet's extent in its own model space: x right, y up from the floor, z back from the front. */
export interface CabinetBox { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/** The box around a cabinet's parts (posed parts only by their offset — they never apply to placed cabinets). */
export function cabinetBox(solids: Solid[]): CabinetBox | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const add = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  };
  for (const s of solids) {
    const [dx, dy, dz] = s.pose?.offset ?? [0, 0, 0];
    if (s.shape === 'box') {
      add(s.min[0] + dx, s.min[1] + dy, s.min[2] + dz);
      add(s.max[0] + dx, s.max[1] + dy, s.max[2] + dz);
    } else if (s.shape === 'plate') {
      for (const [x, y] of s.outline) { add(x + dx, y + dy, s.z0 + dz); add(x + dx, y + dy, s.z1 + dz); }
    } else {
      for (const [z, y] of s.profile) { add(s.x0 + dx, y + dy, z + dz); add(s.x1 + dx, y + dy, z + dz); }
    }
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
}

/** Plan width (along x) and depth (along y) of a cabinet turned to `rotation`. */
export function footprint(box: CabinetBox, rotation: Rotation): { w: number; d: number } {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  return rotation === 90 || rotation === 270 ? { w: depth, d: width } : { w: width, d: depth };
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export function placedRect(p: Placement, box: CabinetBox): Rect {
  const { w, d } = footprint(box, p.rotation);
  return { x0: p.x - w / 2, y0: p.y - d / 2, x1: p.x + w / 2, y1: p.y + d / 2 };
}

/**
 * Maps a point in the cabinet's model space (x right, z back from the front) to plan
 * coordinates. Used to draw fronts and to place the 3D model.
 */
export function modelToPlan(p: Placement, box: CabinetBox, x: number, z: number): [number, number] {
  // Relative to the footprint centre, with depth pointing north at 0°.
  const dx = x - (box.minX + box.maxX) / 2;
  const dy = -(z - (box.minZ + box.maxZ) / 2);
  switch (p.rotation) {
    case 90: return [p.x - dy, p.y + dx];
    case 180: return [p.x - dx, p.y - dy];
    case 270: return [p.x + dy, p.y - dx];
    default: return [p.x + dx, p.y + dy];
  }
}

/** The plan line along a cabinet's front face, left end first as you face it. */
export function frontLine(p: Placement, box: CabinetBox): [[number, number], [number, number]] {
  return [modelToPlan(p, box, box.minX, box.minZ), modelToPlan(p, box, box.maxX, box.minZ)];
}

const round16 = (v: number) => Math.round(v * 16) / 16;

export interface SnapNeighbor {
  rect: Rect;
  /** Floor to the cabinet's bottom and top. Left out, it's taken to share the dragged cabinet's height. */
  bottom?: number;
  top?: number;
}

export interface SnapInput {
  room: Room;
  box: CabinetBox;
  /** Where the pointer wants the cabinet's centre. */
  x: number;
  y: number;
  rotation: Rotation;
  /** Turn the cabinet to back onto whichever wall it's dragged near. */
  autoRotate?: boolean;
  others?: SnapNeighbor[];
  /** How close (inches) the cabinet has to come to a wall to snap to it; at least WALL_SNAP. */
  wallSnap?: number;
  /** How close an edge has to come to a neighbour's edge to line up with it; at least EDGE_SNAP. */
  edgeSnap?: number;
}

export interface SnapResult extends Placement {
  /** The wall the cabinet's back is flush against, if any. */
  wall: Wall | null;
}

/** Wall snapping, edge alignment with neighbours and corners, then clamped inside the room. */
export function snapPlacement({ room, box, x, y, rotation, autoRotate = true, others = [], wallSnap = WALL_SNAP, edgeSnap = EDGE_SNAP }: SnapInput): SnapResult {
  const reach = Math.max(wallSnap, WALL_SNAP);
  const EDGE = Math.max(edgeSnap, EDGE_SNAP);
  let r = rotation;
  if (autoRotate) {
    const distances: [Wall, number][] = WALLS.filter(w => room.walls[w]).map(w => [w, distanceToWall(room, w, x, y)]);
    distances.sort((a, b) => a[1] - b[1]);
    for (const [wall, dist] of distances) {
      const { d } = footprint(box, rotationFacingAway(wall));
      if (dist <= d / 2 + reach) { r = rotationFacingAway(wall); break; }
    }
  }
  const { w, d } = footprint(box, r);
  let cx = x;
  let cy = y;
  let flush: Wall | null = null;
  const back = backWall(r);
  if (room.walls[back]) {
    const gap = distanceToWall(room, back, cx, cy) - d / 2;
    if (gap <= reach) {
      flush = back;
      if (back === 'north') cy = d / 2;
      else if (back === 'south') cy = room.depth - d / 2;
      else if (back === 'west') cx = w / 2;
      else cx = room.width - w / 2;
    }
  }

  // Sides snap into the walls beside it (a cabinet in a corner) as readily as the back does.
  // Neighbours: side by side, it butts up against them and lines up its front; one in front
  // of another, or an upper over a base, lines up its sides. Open room sides line up close in.
  const alongX = flush !== 'west' && flush !== 'east';
  const alongY = flush !== 'north' && flush !== 'south';
  const side = (wall: Wall, at: number): SnapCandidate => [at, room.walls[wall] ? reach : EDGE, 'any'];
  const sameHeight = (o: SnapNeighbor) => o.bottom === undefined || o.top === undefined || spansOverlap(box.minY, box.maxY, o.bottom, o.top, -EPS);
  const neighbourCandidates = (lo: number, hi: number, alongLo: (o: SnapNeighbor) => number, alongHi: (o: SnapNeighbor) => number, acrossLo: (o: SnapNeighbor) => number, acrossHi: (o: SnapNeighbor) => number) =>
    others.flatMap((o): SnapCandidate[] => {
      const shared = Math.min(hi, acrossHi(o)) - Math.max(lo, acrossLo(o));
      const align: SnapCandidate[] = [[alongLo(o), reach, 'lo'], [alongHi(o), reach, 'hi']];
      if (shared > EPS) return sameHeight(o) ? [[alongHi(o), reach, 'lo'], [alongLo(o), reach, 'hi']] : align;
      return shared >= -EDGE ? align : [];
    });
  if (alongX) {
    cx = snapAxis(cx, w, [side('west', 0), side('east', room.width),
      ...neighbourCandidates(cy - d / 2, cy + d / 2, o => o.rect.x0, o => o.rect.x1, o => o.rect.y0, o => o.rect.y1)]);
  }
  if (alongY) {
    cy = snapAxis(cy, d, [side('north', 0), side('south', room.depth),
      ...neighbourCandidates(cx - w / 2, cx + w / 2, o => o.rect.y0, o => o.rect.y1, o => o.rect.x0, o => o.rect.x1)]);
  }

  const clampX = (v: number) => (w >= room.width ? room.width / 2 : Math.min(Math.max(v, w / 2), room.width - w / 2));
  const clampY = (v: number) => (d >= room.depth ? room.depth / 2 : Math.min(Math.max(v, d / 2), room.depth - d / 2));
  cx = clampX(cx);
  cy = clampY(cy);

  // Dragged into a neighbour of the same height, it stops beside it rather than overlapping:
  // the shortest way out, along its wall first, that stays in the room and clear of the rest.
  const blockers = others.filter(sameHeight);
  const rectAt = (x: number, y: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, y0: y - d / 2, y1: y + d / 2 });
  const clear = (x: number, y: number) => blockers.every(o => !rectsOverlap(rectAt(x, y), o.rect));
  for (let pass = 0; pass < 4 && !clear(cx, cy); pass++) {
    const hit = blockers.find(o => rectsOverlap(rectAt(cx, cy), o.rect))!;
    const moves: [number, number, boolean][] = [
      [hit.rect.x0 - w / 2, cy, alongX], [hit.rect.x1 + w / 2, cy, alongX],
      [cx, hit.rect.y0 - d / 2, alongY], [cx, hit.rect.y1 + d / 2, alongY],
    ];
    const options = moves
      .filter(([x, y]) => Math.abs(clampX(x) - x) < EPS && Math.abs(clampY(y) - y) < EPS)
      .map(([x, y, along]) => ({ x, y, cost: Math.hypot(x - cx, y - cy) + (along ? 0 : 1000), free: clear(x, y) }))
      .sort((a, b) => Number(b.free) - Number(a.free) || a.cost - b.cost);
    if (!options.length) break;
    cx = options[0].x;
    cy = options[0].y;
  }
  return { x: round16(cx), y: round16(cy), rotation: r, wall: flush };
}

/** A snap target: the position, how far it reaches, and which edge it takes (the low or high one, or either). */
type SnapCandidate = [number, number, 'lo' | 'hi' | 'any'];

function distanceToWall(room: Room, wall: Wall, x: number, y: number): number {
  if (wall === 'north') return y;
  if (wall === 'south') return room.depth - y;
  if (wall === 'west') return x;
  return room.width - x;
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number, slack = 0): boolean {
  return a0 < b1 + slack && b0 < a1 + slack;
}

/** Moves a span's centre so an edge lands on the closest candidate within its reach. */
function snapAxis(center: number, size: number, candidates: SnapCandidate[]): number {
  let best = center;
  let bestGap = Infinity;
  for (const [c, reach, which] of candidates) {
    const edges = which === 'lo' ? [center - size / 2] : which === 'hi' ? [center + size / 2] : [center - size / 2, center + size / 2];
    for (const edge of edges) {
      const gap = Math.abs(edge - c);
      if (gap <= reach + EPS && gap < bestGap) { bestGap = gap; best = center + (c - edge); }
    }
  }
  return best;
}

/** Whether two footprints touch edge to edge along a shared stretch. */
export function rectsTouch(a: Rect, b: Rect): boolean {
  const near = (p: number, q: number) => Math.abs(p - q) < 0.01;
  return ((near(a.x1, b.x0) || near(a.x0, b.x1)) && spansOverlap(a.y0, a.y1, b.y0, b.y1, -EPS))
    || ((near(a.y1, b.y0) || near(a.y0, b.y1)) && spansOverlap(a.x0, a.x1, b.x0, b.x1, -EPS));
}

/** The walls a footprint is flush against (back or sides). */
export function wallsTouching(room: Room, rect: Rect): Wall[] {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return WALLS.filter(w => room.walls[w] && (
    w === 'north' ? near(rect.y0, 0) : w === 'south' ? near(rect.y1, room.depth) : w === 'west' ? near(rect.x0, 0) : near(rect.x1, room.width)));
}

/** Keeps a placement's footprint inside the room without any snapping (keyboard nudges, turns). */
export function clampPlacement(room: Room, box: CabinetBox, p: Placement): Placement {
  const { w, d } = footprint(box, p.rotation);
  const x = w >= room.width ? room.width / 2 : Math.min(Math.max(p.x, w / 2), room.width - w / 2);
  const y = d >= room.depth ? room.depth / 2 : Math.min(Math.max(p.y, d / 2), room.depth - d / 2);
  return { x: round16(x), y: round16(y), rotation: p.rotation };
}

/** First free spot along the walls (north, east, south, west), or the room's centre. */
export function autoPlace(room: Room, box: CabinetBox, others: { rect: Rect; bottom: number; top: number }[]): Placement {
  const step = 1;
  for (const wall of WALLS) {
    if (!room.walls[wall]) continue;
    const r = rotationFacingAway(wall);
    const { w, d } = footprint(box, r);
    const along = wallLength(room, wall);
    const size = wall === 'north' || wall === 'south' ? w : d;
    for (let a = 0; a + size <= along + EPS; a += step) {
      const p: Placement = wall === 'north' ? { x: a + w / 2, y: d / 2, rotation: r }
        : wall === 'south' ? { x: a + w / 2, y: room.depth - d / 2, rotation: r }
          : wall === 'west' ? { x: w / 2, y: a + d / 2, rotation: r }
            : { x: room.width - w / 2, y: a + d / 2, rotation: r };
      const rect = placedRect(p, box);
      if (rect.x1 > room.width + EPS || rect.y1 > room.depth + EPS) continue;
      const clash = others.some(o => rectsOverlap(rect, o.rect) && spansOverlap(box.minY, box.maxY, o.bottom, o.top));
      if (!clash) return { ...p, x: round16(p.x), y: round16(p.y) };
    }
  }
  const { w, d } = footprint(box, 0);
  return { x: round16(Math.max(room.width / 2, w / 2)), y: round16(Math.max(room.depth / 2, d / 2)), rotation: 0 };
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.05): boolean {
  return a.x0 < b.x1 - tolerance && b.x0 < a.x1 - tolerance && a.y0 < b.y1 - tolerance && b.y0 < a.y1 - tolerance;
}

// ── Layout checks ───────────────────────────────────────────────────────────

export interface LayoutItem {
  id: number;
  label: string;
  placement: Placement;
  box: CabinetBox;
  /** Hangs on a French cleat, so it needs a wall behind it. */
  wallHung: boolean;
}

export interface LayoutIssue { ids: number[]; message: string }

/** The span an opening covers along its wall, as a plan rectangle reaching `reach` into the room. */
export function openingZone(room: Room, o: RoomOpening, reach: number): Rect {
  const a0 = o.offset;
  const a1 = o.offset + o.width;
  switch (o.wall) {
    case 'north': return { x0: a0, x1: a1, y0: 0, y1: reach };
    case 'south': return { x0: a0, x1: a1, y0: room.depth - reach, y1: room.depth };
    case 'west': return { x0: 0, x1: reach, y0: a0, y1: a1 };
    default: return { x0: room.width - reach, x1: room.width, y0: a0, y1: a1 };
  }
}

/** Clashes and blocked doors or windows, in plain words. */
export function layoutIssues(room: Room, items: LayoutItem[], f: (inches: number) => string = String): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const placed = items.map(item => ({ ...item, rect: placedRect(item.placement, item.box) }));
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    if (a.rect.x0 < -EPS || a.rect.y0 < -EPS || a.rect.x1 > room.width + EPS || a.rect.y1 > room.depth + EPS) {
      issues.push({ ids: [a.id], message: `${a.label} sticks out past the room.` });
    }
    if (a.box.maxY > room.height + EPS) {
      issues.push({ ids: [a.id], message: `${a.label} is ${f(a.box.maxY)} tall — taller than the ${f(room.height)} ceiling.` });
    }
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      if (rectsOverlap(a.rect, b.rect) && spansOverlap(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY, -0.05)) {
        issues.push({ ids: [a.id, b.id], message: `${a.label} and ${b.label} overlap.` });
      }
    }
    if (a.wallHung) {
      const wall = backWall(a.placement.rotation);
      const zone = openingZone(room, { id: '', kind: 'opening', wall, offset: 0, width: wallLength(room, wall), height: 0, sill: 0 }, 0.5);
      const touching = room.walls[wall] && rectsOverlap(a.rect, zone, 0);
      if (!touching) issues.push({ ids: [a.id], message: `${a.label} hangs on a cleat but its back isn't against a wall.` });
    }
  }
  for (const o of room.openings) {
    if (!room.walls[o.wall]) continue;
    const where = `the ${WALL_LABELS[o.wall].toLowerCase()}`;
    if (o.kind === 'window') {
      const zone = openingZone(room, o, 1);
      for (const a of placed) {
        if (rectsOverlap(a.rect, zone) && a.box.maxY > o.sill + 0.5 && a.box.minY < o.sill + o.height) {
          issues.push({ ids: [a.id], message: `${a.label} covers part of the window on ${where}.` });
        }
      }
    } else {
      const reach = o.kind === 'door' ? Math.max(DOOR_CLEARANCE, o.swing === 'in' ? o.width : 0) : DOOR_CLEARANCE;
      const zone = openingZone(room, o, reach);
      const noun = o.kind === 'door' ? 'door' : o.kind === 'closet' ? 'closet' : 'doorway';
      for (const a of placed) {
        if (rectsOverlap(a.rect, zone) && a.box.minY < o.height) {
          issues.push({ ids: [a.id], message: `${a.label} blocks the ${noun} on ${where}.` });
        }
      }
    }
  }
  return issues;
}

// ── Walls for the 3D view ───────────────────────────────────────────────────

/** A solid piece of wall: `a0..a1` along the wall (same measure as opening offsets), `y0..y1` up from the floor. */
export interface WallPiece { wall: Wall; a0: number; a1: number; y0: number; y1: number }

/**
 * Splits each wall around its openings. North and south walls run past the corners by
 * the wall thickness so the corners close up.
 */
export function wallPieces(room: Room): WallPiece[] {
  const pieces: WallPiece[] = [];
  for (const wall of WALLS) {
    if (!room.walls[wall]) continue;
    const ns = wall === 'north' || wall === 'south';
    const start = ns && room.walls.west ? -WALL_THICKNESS : 0;
    const end = wallLength(room, wall) + (ns && room.walls.east ? WALL_THICKNESS : 0);
    const openings = room.openings.filter(o => o.wall === wall).sort((a, b) => a.offset - b.offset);
    let cursor = start;
    const push = (a0: number, a1: number, y0: number, y1: number) => {
      if (a1 - a0 > EPS && y1 - y0 > EPS) pieces.push({ wall, a0, a1, y0, y1 });
    };
    for (const o of openings) {
      const a0 = Math.max(o.offset, cursor);
      const a1 = Math.min(o.offset + o.width, end);
      if (a1 <= a0) continue;
      push(cursor, a0, 0, room.height);
      push(a0, a1, 0, Math.min(o.sill, room.height));
      push(a0, a1, Math.min(o.sill + o.height, room.height), room.height);
      cursor = a1;
    }
    push(cursor, end, 0, room.height);
  }
  return pieces;
}

/**
 * The plan rectangle a stretch of wall occupies (outside the room, `thickness` deep),
 * for `a0..a1` along it. Closets use it with their depth to draw the recess.
 */
export function wallBand(room: Room, wall: Wall, a0: number, a1: number, thickness = WALL_THICKNESS): Rect {
  switch (wall) {
    case 'north': return { x0: a0, x1: a1, y0: -thickness, y1: 0 };
    case 'south': return { x0: a0, x1: a1, y0: room.depth, y1: room.depth + thickness };
    case 'west': return { x0: -thickness, x1: 0, y0: a0, y1: a1 };
    default: return { x0: room.width, x1: room.width + thickness, y0: a0, y1: a1 };
  }
}
