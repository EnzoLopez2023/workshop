// A bookcase standing on a drawer unit, like a built-in hutch: on a countertop with
// overhang, or stacked straight on the case top. The bookcase itself is the Shelf
// Builder's model (bays, fixed and adjustable shelves, doors, back), generated from
// these settings and then named and placed on the cabinet.

import { buildShelfPlan, fitsSheet, formatLength, shelfSolids, type LengthUnit, type ShelfConfig, type ShelfPart, type ShelfPlan, type Solid } from './shelving.ts';
import { sagCheck } from './shelfEstimate.ts';

export type BookcaseSeat = 'countertop' | 'stacked';
export type BookcaseTop = 'none' | 'cap' | 'crown';

export interface BookcaseConfig {
  enabled: boolean;
  seat: BookcaseSeat;
  /** The bookcase case, floor of the bookcase to its top panel (cap or crown go above). */
  height: number;
  /** Front to back, back included. Its back lines up with the cabinet's. */
  depth: number;
  bays: number;
  /** Fixed shelves in dados, and loose shelves on pins, in every bay. */
  shelvesPerBay: number;
  adjustablePerBay: number;
  /** Per bay: a door over it. */
  doors: boolean[];
  countertop: {
    material: 'plywood' | 'butcher';
    /** Butcher block thickness; a plywood top is `layers` of the case plywood. */
    thickness: number;
    layers: 1 | 2;
    overhangFront: number;
    /** Over each end that shows. */
    overhangSides: number;
  };
  top: { style: BookcaseTop; capProjection: number; crownHeight: number; crownProjection: number };
  /** A valance under the bookcase bottom hides an LED strip lighting the counter. */
  taskLight: boolean;
  valanceHeight: number;
  /** For the fit checks; unset to skip them. */
  ceilingHeight?: number;
}

export const DEFAULT_BOOKCASE: BookcaseConfig = {
  enabled: false,
  seat: 'countertop',
  height: 48,
  depth: 12,
  bays: 1,
  shelvesPerBay: 1,
  adjustablePerBay: 2,
  doors: [],
  countertop: { material: 'plywood', thickness: 1.5, layers: 1, overhangFront: 1, overhangSides: 1 },
  top: { style: 'cap', capProjection: 3 / 4, crownHeight: 3.5, crownProjection: 2.5 },
  taskLight: false,
  valanceHeight: 2,
};

/** A cord grommet: a hole this size through the countertop. */
export const GROMMET_DIAMETER = 2;

/** Everything about the cabinet the bookcase needs (so this module never imports the drawer model). */
export interface BookcaseContext {
  width: number;
  /** Top of the cabinet (case top), floor up. */
  cabinetHeight: number;
  caseDepth: number;
  /** How far overlay fronts stand in front of the case (0 for inset). */
  frontProjection: number;
  thickness: number;
  exposed: { left: boolean; right: boolean };
  edgeBanding?: boolean;
  bandingThickness?: number;
  units: LengthUnit;
  /** Problems the cabinet itself causes (hung, on casters, a desk). */
  blockers: string[];
}

interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface BookcasePlan {
  config: BookcaseConfig;
  shelfConfig: ShelfConfig;
  shelfPlan: ShelfPlan;
  /** Where the bookcase's own origin lands: its floor and the front of its case. */
  y0: number;
  z0: number;
  /** Top of the bookcase case. */
  topY: number;
  /** Floor to the very top (cap or crown included). */
  totalHeight: number;
  countertop: (Box3 & { material: 'plywood' | 'butcher'; layers: number }) | null;
  cap: Box3 | null;
  crown: { height: number; projection: number; front: number; faces: ('front' | 'left' | 'right')[] } | null;
  grommet: { x: number; z: number; diameter: number } | null;
  parts: ShelfPart[];
  errors: string[];
  warnings: string[];
}

/** "Side" → "Bookcase side"; the shelf model's toe kick becomes the light valance. */
export function bookcaseName(name: string): string {
  if (name === 'Toe kick') return 'Bookcase light valance';
  return `Bookcase ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** The Shelf Builder settings for this bookcase. */
export function bookcaseShelfConfig(bk: BookcaseConfig, ctx: Pick<BookcaseContext, 'width' | 'thickness' | 'units' | 'edgeBanding' | 'bandingThickness'>): ShelfConfig {
  const T = ctx.thickness;
  const n = Math.max(1, Math.floor(bk.bays));
  return {
    thickness: T,
    bayWidth: (ctx.width - (n + 1) * T) / n,
    shelfDepth: bk.depth - T,
    height: bk.height,
    bays: n,
    shelvesPerBay: Array.from({ length: n }, () => Math.max(0, Math.floor(bk.shelvesPerBay))),
    adjustablePerBay: Array.from({ length: n }, () => Math.max(0, Math.floor(bk.adjustablePerBay))),
    doorsPerBay: Array.from({ length: n }, (_, i) => bk.doors[i] === true),
    topPanel: true,
    bottomPanel: true,
    backPanel: true,
    joinery: 'dado',
    dadoDepth: Math.round(T / 3 * 32) / 32,
    backJoint: 'rabbet',
    // The shelf model's toe kick, set flush at the front, is exactly a light valance.
    mounting: 'floor',
    toeKick: bk.taskLight ? bk.valanceHeight : 0,
    frenchCleat: false,
    cleatHeight: 3,
    pinSystem: ctx.units === 'mm' ? 'metric' : 'imperial',
    shelfLoad: 'books',
    edgeBanding: ctx.edgeBanding,
    bandingThickness: ctx.bandingThickness,
    units: ctx.units,
  };
}

export function buildBookcase(bk: BookcaseConfig, ctx: BookcaseContext): BookcasePlan {
  const f = (inches: number) => formatLength(inches, ctx.units);
  const T = ctx.thickness;
  const W = ctx.width;
  const cd = ctx.caseDepth;
  const errors = [...ctx.blockers];
  const warnings: string[] = [];
  const parts: ShelfPart[] = [];
  const exposedCount = Number(ctx.exposed.left) + Number(ctx.exposed.right);

  // Countertop: from the cabinet's back to just past the fronts, over the ends that show.
  let countertop: BookcasePlan['countertop'] = null;
  if (bk.seat === 'countertop') {
    const c = bk.countertop;
    const thickness = c.material === 'plywood' ? T * c.layers : c.thickness;
    const box = {
      x0: ctx.exposed.left ? -c.overhangSides : 0,
      x1: W + (ctx.exposed.right ? c.overhangSides : 0),
      z0: -ctx.frontProjection - c.overhangFront,
      z1: cd,
      y0: ctx.cabinetHeight,
      y1: ctx.cabinetHeight + thickness,
    };
    countertop = { ...box, material: c.material, layers: c.material === 'plywood' ? c.layers : 1 };
    const length = box.x1 - box.x0;
    const depth = box.z1 - box.z0;
    if (c.overhangFront < 0 || c.overhangFront > 4) errors.push(`A ${f(c.overhangFront)} front overhang is outside ${f(0)}–${f(4)}; ${f(1)} is typical.`);
    if (c.overhangSides < 0 || c.overhangSides > 4) errors.push(`A ${f(c.overhangSides)} end overhang is outside ${f(0)}–${f(4)}.`);
    if (c.material === 'plywood') {
      parts.push({ name: 'Countertop', qty: c.layers, length, width: depth, thickness: T,
        note: [c.layers === 2 ? 'Two layers glued and screwed together' : '', 'Screwed up through the case top', 'band the front and the ends that show'].filter(Boolean).join('; '),
        material: 'plywood' });
      if (!fitsSheet(length, depth)) errors.push(`The ${f(length)} × ${f(depth)} countertop is bigger than a 4 × 8 sheet — use butcher block, or make it smaller.`);
    } else {
      if (c.thickness < 0.75 || c.thickness > 2) errors.push(`A ${f(c.thickness)} butcher-block top is outside ${f(3 / 4)}–${f(2)}.`);
      parts.push({ name: 'Countertop (butcher block)', qty: 1, length, width: depth, thickness: c.thickness,
        note: 'Bought to size or cut from a slab; fastened with figure-8 clips so it can move', material: 'solid' });
    }
  }

  const y0 = ctx.cabinetHeight + (countertop ? countertop.y1 - countertop.y0 : 0);
  const z0 = cd - bk.depth;
  const shelfConfig = bookcaseShelfConfig(bk, ctx);
  const shelfPlan = buildShelfPlan(shelfConfig);
  const front = z0 - shelfPlan.frontDepth;

  // Depth: the back lines up with the cabinet's; a stacked bookcase can't overhang the case top.
  if (bk.depth < 6) errors.push(`A ${f(bk.depth)} deep bookcase is too shallow for books — make it at least ${f(6)}.`);
  if (bk.seat === 'stacked' && bk.depth > cd + 1e-6) {
    errors.push(`Stacked on the case, the bookcase can be at most ${f(cd)} deep (the case top) — it’s ${f(bk.depth)}. Put it on a countertop or make it shallower.`);
  }
  if (countertop) {
    const counterDepth = countertop.z1 - countertop.z0;
    if (bk.depth > counterDepth + 1e-6) errors.push(`The ${f(bk.depth)} deep bookcase is deeper than the ${f(counterDepth)} countertop.`);
    else if (front - countertop.z0 < 6) warnings.push(`Only ${f(Math.max(front - countertop.z0, 0))} of countertop is left in front of the bookcase — not much of a work surface. Make the bookcase shallower.`);
  }
  if (bk.height < 12) errors.push(`A ${f(bk.height)} tall bookcase leaves no room for shelves — make it at least ${f(12)}.`);
  if (bk.taskLight && (bk.valanceHeight < 1 || bk.valanceHeight > 4)) errors.push(`A ${f(bk.valanceHeight)} light valance is outside ${f(1)}–${f(4)}; ${f(2)} hides an LED strip.`);
  if (bk.taskLight && !countertop) warnings.push('The light valance lights the case top; it’s meant for a countertop work surface.');
  if (bk.bays >= 1 && shelfConfig.bayWidth < 6) errors.push(`${bk.bays} bays leave each only ${f(Math.max(shelfConfig.bayWidth, 0))} wide — use fewer bays.`);
  errors.push(...shelfPlan.errors.map(e => `Bookcase: ${e}`));
  warnings.push(...shelfPlan.warnings.map(w => `Bookcase: ${w}`));
  if (shelfPlan.errors.length === 0) {
    const sagging = sagCheck(shelfPlan, shelfConfig).filter(r => !r.ok);
    if (sagging.length) {
      const worst = sagging.reduce((a, r) => (r.sag / r.limit > a.sag / a.limit ? r : a));
      warnings.push(`Loaded with books, the bookcase’s ${f(worst.span)} ${worst.kind} shelves would sag about ${worst.sag.toFixed(2)}″ — add a bay${worst.thicknessNeeded ? ` or use ${f(worst.thicknessNeeded)} plywood` : ''}.`);
    }
  }

  for (const p of shelfPlan.parts) {
    parts.push({ ...p, name: bookcaseName(p.name), note: p.name === 'Toe kick' ? 'Flush with the front under the bottom; an LED strip goes behind it' : p.note });
  }

  // Top: a plywood cap overhanging the front and ends that show, or crown molding on a nailer.
  const topY = y0 + bk.height;
  let cap: BookcasePlan['cap'] = null;
  let crown: BookcasePlan['crown'] = null;
  if (bk.top.style === 'cap') {
    const p = bk.top.capProjection;
    cap = { x0: ctx.exposed.left ? -p : 0, x1: W + (ctx.exposed.right ? p : 0), z0: front - p, z1: cd, y0: topY, y1: topY + T };
    if (p < 0 || p > 3) errors.push(`A ${f(p)} cap overhang is outside ${f(0)}–${f(3)}.`);
    parts.push({ name: 'Bookcase top cap', qty: 1, length: cap.x1 - cap.x0, width: cap.z1 - cap.z0, thickness: T,
      note: 'Screwed down through the bookcase top; band the edges that show', material: 'plywood' });
  } else if (bk.top.style === 'crown') {
    const { crownHeight: h, crownProjection: p } = bk.top;
    if (h < 1.5 || h > 8) errors.push(`${f(h)} crown is outside ${f(1.5)}–${f(8)}.`);
    if (p < 0.5 || p > 6) errors.push(`A ${f(p)} crown projection is outside ${f(1 / 2)}–${f(6)}.`);
    const faces: ('front' | 'left' | 'right')[] = ['front', ...(ctx.exposed.left ? ['left' as const] : []), ...(ctx.exposed.right ? ['right' as const] : [])];
    crown = { height: h, projection: p, front, faces };
    const depth = cd - front;
    parts.push({ name: 'Bookcase crown nailer', qty: 1, length: W, width: h, thickness: T, note: 'On the bookcase top, flush with its front; the crown nails to it', material: 'plywood' });
    if (exposedCount) parts.push({ name: 'Bookcase crown nailer, side', qty: exposedCount, length: depth - T, width: h, thickness: T, note: 'Flush with the outside of the sides that show', material: 'plywood' });
    parts.push({ name: 'Crown molding, front', qty: 1, length: W + exposedCount * p, width: h, thickness: p,
      note: exposedCount === 2 ? '45° mitres at both ends' : exposedCount === 1 ? '45° mitre at the open end, square at the wall' : 'Square ends, tight to the walls', material: 'solid' });
    if (exposedCount) parts.push({ name: 'Crown molding, side', qty: exposedCount, length: depth + p, width: h, thickness: p, note: 'Mitred at the front, square at the wall', material: 'solid' });
  }
  const totalHeight = topY + (cap ? T : crown ? crown.height : 0);

  // Cord grommet for the light (or a lamp, a charger): in the counter just in front of the bookcase.
  const grommet = bk.taskLight && countertop && front - countertop.z0 > GROMMET_DIAMETER + 1
    ? { x: W / 2, z: front - GROMMET_DIAMETER / 2 - 0.5, diameter: GROMMET_DIAMETER }
    : null;

  if (bk.ceilingHeight && bk.ceilingHeight > 0) {
    const ceiling = bk.ceilingHeight;
    if (totalHeight > ceiling - 1 / 4) {
      errors.push(`Altogether it stands ${f(totalHeight)} tall, but the ceiling is ${f(ceiling)} — make the bookcase ${f(totalHeight - ceiling + 1 / 2)} shorter.`);
    } else {
      const tilt = Math.hypot(bk.height, bk.depth);
      if (y0 + tilt > ceiling) {
        warnings.push(`Tilting the bookcase up on the ${countertop ? 'countertop' : 'cabinet'} needs ${f(y0 + tilt)} of headroom (its diagonal), and the ceiling is ${f(ceiling)}. Assemble it in place, or stand it up on the floor and lift it on with help.`);
      }
      if (ceiling - totalHeight > 1 / 4 && ceiling - totalHeight < 3 && crown) {
        warnings.push(`There’s ${f(ceiling - totalHeight)} above the crown — run it to the ceiling with a scribe strip, or leave a clear reveal.`);
      }
    }
  }

  return { config: bk, shelfConfig, shelfPlan, y0, z0, topY, totalHeight, countertop, cap, crown, grommet, parts, errors, warnings };
}

/** A solid moved by (dx, dy, dz) and renamed. */
function moved(s: Solid, dx: number, dy: number, dz: number, name: string): Solid {
  if (s.shape === 'box') {
    return { ...s, name, min: [s.min[0] + dx, s.min[1] + dy, s.min[2] + dz], max: [s.max[0] + dx, s.max[1] + dy, s.max[2] + dz],
      ...(s.on ? { on: bookcaseName(s.on) } : {}) };
  }
  if (s.shape === 'prism') return { ...s, name, x0: s.x0 + dx, x1: s.x1 + dx, profile: s.profile.map(([z, y]) => [z + dz, y + dy] as [number, number]) };
  return { ...s, name, z0: s.z0 + dz, z1: s.z1 + dz, outline: s.outline.map(([x, y]) => [x + dx, y + dy] as [number, number]),
    holes: s.holes?.map(h => h.map(([x, y]) => [x + dx, y + dy] as [number, number])) };
}

/**
 * Shelf-model solids (the bookcase itself, or its dado and pin-hole markings) renamed
 * and placed on the cabinet; `inPlace: false` leaves them at the bookcase's own origin.
 */
export function placeBookcaseSolids(bp: BookcasePlan, solids: Solid[], inPlace = true): Solid[] {
  const [dy, dz] = inPlace ? [bp.y0, bp.z0] : [0, 0];
  return solids.map(s => moved(s, 0, dy, dz, bookcaseName(s.name)));
}

/** The bookcase, countertop and top trim in place on the cabinet. */
export function bookcaseSolids(bp: BookcasePlan, width: number, caseDepth: number, thickness: number): Solid[] {
  const T = thickness;
  const spread = Math.max(width, bp.totalHeight) / 12;
  const box = (name: string, b: Box3, kind: Solid['kind'] = 'case'): Solid =>
    ({ name, kind, shape: 'box', min: [b.x0, b.y0, b.z0], max: [b.x1, b.y1, b.z1] });
  const out = placeBookcaseSolids(bp, shelfSolids(bp.shelfPlan, bp.shelfConfig)).map(s => ({ ...s, explode: [0, spread * 2, 0] as [number, number, number] }));
  if (bp.countertop) {
    const c = bp.countertop;
    out.push({ ...box('Countertop', c, 'shelf'), explode: [0, spread, 0] });
  }
  if (bp.cap) out.push({ ...box('Bookcase top cap', bp.cap), explode: [0, spread * 3, 0] });
  if (bp.crown) {
    const { height: h, projection: p, front, faces } = bp.crown;
    const y0 = bp.topY;
    const l = faces.includes('left') ? p : 0;
    const r = faces.includes('right') ? p : 0;
    const up: [number, number, number] = [0, spread * 3, 0];
    out.push({ ...box('Bookcase crown nailer', { x0: 0, x1: width, y0, y1: y0 + h, z0: front, z1: front + T }), explode: up });
    out.push({ ...box('Crown molding, front', { x0: -l, x1: width + r, y0, y1: y0 + h, z0: front - p, z1: front }, 'frame'), explode: up });
    if (l) out.push({ ...box('Crown molding, left', { x0: -p, x1: 0, y0, y1: y0 + h, z0: front, z1: caseDepth }, 'frame'), explode: up });
    if (r) out.push({ ...box('Crown molding, right', { x0: width, x1: width + p, y0, y1: y0 + h, z0: front, z1: caseDepth }, 'frame'), explode: up });
  }
  return out;
}

// ── Saved designs ─────────────────────────────────────────────────────────────

export function readBookcase(raw: unknown): BookcaseConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const n = (x: unknown, min: number, max: number, fallback: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : fallback);
  const c = (v.countertop && typeof v.countertop === 'object' ? v.countertop : {}) as Record<string, unknown>;
  const t = (v.top && typeof v.top === 'object' ? v.top : {}) as Record<string, unknown>;
  const d = DEFAULT_BOOKCASE;
  const bays = Math.floor(n(v.bays, 1, 8, d.bays));
  return {
    enabled: v.enabled === true,
    seat: v.seat === 'stacked' ? 'stacked' : 'countertop',
    height: n(v.height, 1, 144, d.height),
    depth: n(v.depth, 1, 48, d.depth),
    bays,
    shelvesPerBay: Math.floor(n(v.shelvesPerBay, 0, 12, d.shelvesPerBay)),
    adjustablePerBay: Math.floor(n(v.adjustablePerBay, 0, 12, d.adjustablePerBay)),
    doors: Array.from({ length: bays }, (_, i) => Array.isArray(v.doors) && v.doors[i] === true),
    countertop: {
      material: c.material === 'butcher' ? 'butcher' : 'plywood',
      thickness: n(c.thickness, 0.25, 4, d.countertop.thickness),
      layers: c.layers === 2 ? 2 : 1,
      overhangFront: n(c.overhangFront, 0, 12, d.countertop.overhangFront),
      overhangSides: n(c.overhangSides, 0, 12, d.countertop.overhangSides),
    },
    top: {
      style: t.style === 'none' || t.style === 'crown' ? t.style : 'cap',
      capProjection: n(t.capProjection, 0, 12, d.top.capProjection),
      crownHeight: n(t.crownHeight, 0, 24, d.top.crownHeight),
      crownProjection: n(t.crownProjection, 0, 12, d.top.crownProjection),
    },
    taskLight: v.taskLight === true,
    valanceHeight: n(v.valanceHeight, 0, 12, d.valanceHeight),
    ceilingHeight: typeof v.ceilingHeight === 'number' && v.ceilingHeight > 0 && v.ceilingHeight < 240 ? v.ceilingHeight : undefined,
  };
}

/** The bookcase settings as form fields (lengths as typed strings). */
export interface BookcaseFields {
  enabled: boolean;
  seat: BookcaseSeat;
  height: string;
  depth: string;
  bays: number;
  shelves: number;
  adjustable: number;
  doors: boolean[];
  counterMaterial: 'plywood' | 'butcher';
  counterThickness: string;
  counterLayers: 1 | 2;
  overhangFront: string;
  overhangSides: string;
  top: BookcaseTop;
  capProjection: string;
  crownHeight: string;
  crownProjection: string;
  taskLight: boolean;
  valanceHeight: string;
  /** '' to skip the ceiling checks. */
  ceilingHeight: string;
}

export const BOOKCASE_LENGTH_KEYS = [
  'height', 'depth', 'counterThickness', 'overhangFront', 'overhangSides', 'capProjection', 'crownHeight', 'crownProjection', 'valanceHeight', 'ceilingHeight',
] as const;

export function bookcaseToFields(c: BookcaseConfig | undefined, L: (inches: number) => string): BookcaseFields {
  const b = c ?? DEFAULT_BOOKCASE;
  return {
    enabled: c?.enabled === true,
    seat: b.seat,
    height: L(b.height),
    depth: L(b.depth),
    bays: b.bays,
    shelves: b.shelvesPerBay,
    adjustable: b.adjustablePerBay,
    doors: Array.from({ length: b.bays }, (_, i) => b.doors[i] === true),
    counterMaterial: b.countertop.material,
    counterThickness: L(b.countertop.thickness),
    counterLayers: b.countertop.layers,
    overhangFront: L(b.countertop.overhangFront),
    overhangSides: L(b.countertop.overhangSides),
    top: b.top.style,
    capProjection: L(b.top.capProjection),
    crownHeight: L(b.top.crownHeight),
    crownProjection: L(b.top.crownProjection),
    taskLight: b.taskLight,
    valanceHeight: L(b.valanceHeight),
    ceilingHeight: b.ceilingHeight ? L(b.ceilingHeight) : '',
  };
}

/** Fields back to settings; `num` parses (and reports) a length field by key. */
export function bookcaseFromFields(
  fields: BookcaseFields | undefined,
  num: (key: typeof BOOKCASE_LENGTH_KEYS[number], opts?: { allowZero?: boolean }) => number,
): BookcaseConfig | undefined {
  if (!fields?.enabled) return undefined;
  const butcher = fields.counterMaterial === 'butcher';
  const counter = fields.seat === 'countertop';
  return {
    enabled: true,
    seat: fields.seat,
    height: num('height'),
    depth: num('depth'),
    bays: fields.bays,
    shelvesPerBay: fields.shelves,
    adjustablePerBay: fields.adjustable,
    doors: Array.from({ length: fields.bays }, (_, i) => fields.doors[i] === true),
    countertop: {
      material: fields.counterMaterial,
      thickness: counter && butcher ? num('counterThickness') : DEFAULT_BOOKCASE.countertop.thickness,
      layers: fields.counterLayers,
      overhangFront: counter ? num('overhangFront', { allowZero: true }) : DEFAULT_BOOKCASE.countertop.overhangFront,
      overhangSides: counter ? num('overhangSides', { allowZero: true }) : DEFAULT_BOOKCASE.countertop.overhangSides,
    },
    top: {
      style: fields.top,
      capProjection: fields.top === 'cap' ? num('capProjection', { allowZero: true }) : DEFAULT_BOOKCASE.top.capProjection,
      crownHeight: fields.top === 'crown' ? num('crownHeight') : DEFAULT_BOOKCASE.top.crownHeight,
      crownProjection: fields.top === 'crown' ? num('crownProjection') : DEFAULT_BOOKCASE.top.crownProjection,
    },
    taskLight: fields.taskLight,
    valanceHeight: fields.taskLight ? num('valanceHeight') : DEFAULT_BOOKCASE.valanceHeight,
    ceilingHeight: fields.ceilingHeight.trim() ? num('ceilingHeight') : undefined,
  };
}
