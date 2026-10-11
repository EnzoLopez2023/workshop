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
  /**
   * Open space above the counter: the sides run down to it, but the bottom panel and
   * the shelves start this high (0 for none).
   */
  openBelow: number;
  /** A valance under the bookcase bottom hides an LED strip lighting the counter. */
  taskLight: boolean;
  valanceHeight: number;
  /** For the fit checks; unset to skip them. */
  ceilingHeight?: number;
  /** Display touches: a lip on every shelf so boards and prints lean back without sliding off. */
  lips?: boolean;
  /** A pegboard (Skadis or similar) on spacer cleats across the open space, for hooks and small shelves. */
  pegboard?: boolean;
  /** An LED strip hidden under the front of every shelf and the top. */
  shelfLights?: boolean;
  /** An outlet cutout in the backsplash (the back where it runs down through the open space). */
  outlet?: boolean;
  /**
   * Over open space, hang the bookcase on the wall instead of standing its sides on the
   * counter: the sides stop at the bottom shelf (or the light valance), so nothing stands
   * in the open space, and a rail under the top screws into the studs.
   */
  floating?: boolean;
}

/** How far a floating bookcase's sides and dividers stop above the counter (0 when they run down). */
export function bookcaseSideCut(bk: Pick<BookcaseConfig, 'openBelow' | 'floating' | 'taskLight' | 'valanceHeight'>): number {
  if (!bk.floating || !(bk.openBelow > 0)) return 0;
  return Math.max(bk.openBelow - (bk.taskLight ? bk.valanceHeight : 0), 0);
}

/** The hanging rail under a floating bookcase's top. */
export const HANGING_RAIL = 3;

/** A shelf lip: 3/4″ stock 1 1/2″ wide, standing 3/4″ proud of the shelf. */
export const LIP_HEIGHT = 1.5;
export const LIP_PROUD = 0.75;
/** The rail under a shelf's front that hides its LED strip. */
export const LIGHT_RAIL = 1;
/** Pegboard spacers: hooks need about 3/4″ behind the board. */
export const PEGBOARD_SPACER = 0.75;

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
  openBelow: 0,
  taskLight: false,
  valanceHeight: 2,
};

/**
 * What the shelves are for: each preset sets the depth and how many shelves fit so every
 * opening clears the item. Spools stand on edge (a 1 kg spool is about 8″ across and 2 1/2–3″
 * wide); a single-spool dry box is about 10″ tall.
 */
export const SHELF_PRESETS = [
  { id: 'spools', label: '1 kg filament spools', opening: 9, depth: 10, note: 'spools on edge, about 8″ across' },
  { id: 'spool-boxes', label: 'Filament boxes', opening: 9, depth: 10, note: 'boxed spools on edge, about 8 1/2″ tall' },
  { id: 'dry-boxes', label: 'Filament dry boxes', opening: 11, depth: 12, note: 'single-spool dry boxes, about 10″ tall' },
  { id: 'books', label: 'Books', opening: 11, depth: 12, note: 'most hardbacks under 10″' },
  { id: 'display', label: 'Display', opening: 14, depth: 10, note: 'prints, models and boards shown off' },
] as const;
export type ShelfPresetId = typeof SHELF_PRESETS[number]['id'];

/**
 * How many shelves fit a bookcase so every opening is at least `opening` tall: one fixed
 * shelf in a dado once there are three or more (it stiffens the case), the rest on pins.
 */
export function shelvesForOpening(height: number, openBelow: number, thickness: number, opening: number): { fixed: number; adjustable: number; each: number } {
  const usable = height - openBelow - 2 * thickness;
  const n = Math.max(0, Math.floor((usable - opening) / (opening + thickness) + 1e-9));
  const fixed = n >= 3 ? 1 : 0;
  return { fixed, adjustable: n - fixed, each: (usable - n * thickness) / (n + 1) };
}

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
  /** An outlet cutout in the backsplash (model x and y), null without one. */
  outlet: { x0: number; x1: number; y0: number; y1: number } | null;
  parts: ShelfPart[];
  errors: string[];
  warnings: string[];
}

/** "Side" → "Bookcase side"; the shelf model's toe kick becomes the light valance. */
export function bookcaseName(name: string): string {
  if (name === 'Toe kick') return 'Bookcase light valance';
  return `Bookcase ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** Where the light valance sits, bookcase floor up (null when there's none). */
export function valanceSpan(bk: Pick<BookcaseConfig, 'openBelow' | 'taskLight' | 'valanceHeight'>): [number, number] | null {
  if (!bk.taskLight) return null;
  return bk.openBelow > 0 ? [bk.openBelow - bk.valanceHeight, bk.openBelow] : [0, bk.valanceHeight];
}

/**
 * Shelf-model solids fixed up for open space below: the shelf model draws its toe-kick
 * board full height, but only a valance at the top of the space is wanted, and the back
 * runs down to the counter as a backsplash.
 */
export function withValance(bk: Pick<BookcaseConfig, 'openBelow' | 'taskLight' | 'valanceHeight' | 'floating'>, solids: Solid[]): Solid[] {
  if (!(bk.openBelow > 0)) return solids;
  const span = valanceSpan(bk);
  const cut = bookcaseSideCut(bk);
  return solids.flatMap((s): Solid[] => {
    // Standing on the counter the back runs down as a backsplash; hung on the wall it doesn't,
    // and the sides and dividers stop at the bottom shelf or the valance.
    if (s.kind === 'back' && s.shape === 'box') return cut > 0 ? [s] : [{ ...s, min: [s.min[0], 0, s.min[2]] }];
    if (cut > 0 && s.shape === 'box' && /^(Left side|Right side|Divider \d+)$/.test(s.name)) return [{ ...s, min: [s.min[0], Math.max(s.min[1], cut), s.min[2]] }];
    if (cut > 0 && s.shape === 'prism' && /^(Left side|Right side|Divider \d+)$/.test(s.name)) return [{ ...s, profile: s.profile.map(([z, y]) => [z, Math.max(y, cut)] as [number, number]) }];
    if (s.name !== 'Toe kick') return [s];
    if (!span || s.shape !== 'box') return [];
    return [{ ...s, min: [s.min[0], span[0], s.min[2]], max: [s.max[0], span[1], s.max[2]] }];
  });
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
    // The shelf model's toe kick lifts the bottom panel with the sides running down past it:
    // that's the open space. Its front board is the light valance (cut down to size below).
    mounting: 'floor',
    toeKick: bk.openBelow > 0 ? bk.openBelow : bk.taskLight ? bk.valanceHeight : 0,
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
  if (bk.openBelow > 0) {
    if (bk.openBelow > bk.height - 12) errors.push(`${f(bk.openBelow)} of open space leaves less than ${f(12)} for shelves in a ${f(bk.height)} bookcase — make the bookcase taller or the space lower.`);
    else if (bk.openBelow < 6) warnings.push(`${f(bk.openBelow)} of open space above the counter is very low; 15–18″ clears most things you’d set there.`);
    if (bk.taskLight && bk.openBelow < bk.valanceHeight + 2) errors.push(`The ${f(bk.valanceHeight)} light valance doesn’t fit in ${f(bk.openBelow)} of open space.`);
  }
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
    if (p.name === 'Toe kick') {
      // With open space below it's only the valance (if there's a light), not a board down to the counter.
      if (!bk.taskLight) continue;
      parts.push({ ...p, name: bookcaseName(p.name), width: bk.valanceHeight, note: 'Flush with the front under the bottom; an LED strip goes behind it' });
      continue;
    }
    const cut = bookcaseSideCut(bk);
    if (cut > 0 && (p.name === 'Side' || p.name.startsWith('Divider'))) {
      parts.push({ ...p, name: bookcaseName(p.name), length: p.length - cut, note: `${p.note ? `${p.note}; ` : ''}stops ${f(cut)} above the counter — the bookcase hangs on the wall` });
      continue;
    }
    if (bk.openBelow > 0 && p.name.startsWith('Back') && cut === 0) {
      // The back runs down through the open space to the counter as a backsplash.
      parts.push({ ...p, name: bookcaseName(p.name), length: bk.height, note: `${p.note ? `${p.note}; ` : ''}runs down to the counter as a backsplash` });
      continue;
    }
    parts.push({ ...p, name: bookcaseName(p.name), note: p.name === 'Side' && bk.openBelow > 0 ? `${p.note ? `${p.note}; ` : ''}runs down past the bottom to the counter` : p.note });
  }

  // Display touches: lips on the shelves, lights under them, a pegboard in the open space.
  const shelvesInBays = bk.bays * (bk.shelvesPerBay + bk.adjustablePerBay);
  const bayLength = shelfConfig.bayWidth;
  if (bk.lips && bk.bays > 0) {
    if (shelvesInBays) parts.push({ name: 'Shelf lip', qty: shelvesInBays, length: bayLength - 1 / 16, width: LIP_HEIGHT, thickness: 0.75,
      note: `Glued and pinned to the front edge of every shelf, ${f(LIP_PROUD)} proud, so boards and prints lean back without sliding off`, material: 'solid' });
    parts.push({ name: 'Bottom lip', qty: 1, length: W - 2 * T, width: LIP_HEIGHT, thickness: 0.75, note: `Along the bookcase bottom’s front edge, ${f(LIP_PROUD)} proud`, material: 'solid' });
  }
  if (bk.shelfLights && bk.bays > 0) {
    if (shelvesInBays) parts.push({ name: 'Light rail', qty: shelvesInBays, length: bayLength - 1 / 16, width: LIGHT_RAIL, thickness: 0.75,
      note: 'Under the front edge of every shelf, hiding an LED strip that lights the shelf below; drill a 3/8″ cord hole at the back corner', material: 'solid' });
    parts.push({ name: 'Top light rail', qty: 1, length: W - 2 * T, width: LIGHT_RAIL, thickness: 0.75, note: 'Under the bookcase top’s front edge, hiding the strip that lights the top shelf', material: 'solid' });
    if (bk.adjustablePerBay > 0) warnings.push('Lights under adjustable shelves need their cords to move with them — use plug-in strips with slack, or make the lit shelves fixed.');
  }
  // Hung on the wall: a rail under the top, screwed into the studs, carries it.
  if (bookcaseSideCut(bk) > 0) {
    parts.push({ name: 'Bookcase hanging rail', qty: 1, length: W - 2 * T, width: HANGING_RAIL, thickness: T,
      note: 'Under the top, against the back, between the sides; screw through it into every stud. The bookcase hangs over the open space with nothing down to the counter', material: 'plywood' });
  }
  // An outlet in the backsplash, centred, low in the open space.
  let outlet: BookcasePlan['outlet'] = null;
  if (bk.outlet && bookcaseSideCut(bk) > 0) warnings.push('Hung on the wall the bookcase has no backsplash, so the outlet goes in the wall itself — no cutout needed.');
  else if (bk.outlet) {
    if (bk.openBelow < 7) errors.push('An outlet in the backsplash needs at least 7″ of open space above the counter.');
    else {
      const cy = y0 + Math.min(8, bk.openBelow / 2);
      outlet = { x0: W / 2 - 1.5, x1: W / 2 + 1.5, y0: cy - 2.25, y1: cy + 2.25 };
      const back = parts.find(p => /^Bookcase back/.test(p.name));
      if (back) back.note = `${back.note ? `${back.note}; ` : ''}${f(3)} × ${f(4.5)} outlet cutout, centred across it, ${f(outlet.y0 - y0)} up from the counter`;
    }
  }
  if (bk.pegboard) {
    if (bk.openBelow <= 0) errors.push('The pegboard goes in the open space above the counter — turn on “Open space above the counter”.');
    else parts.push({ name: 'Pegboard spacer', qty: 2 * bk.bays, length: bayLength - 1 / 16, width: 1.5, thickness: PEGBOARD_SPACER,
      note: `Screwed to the back at the top and bottom of the open space; the pegboard screws to them so hooks clear the back (the board itself is bought, about ${f(W - 2 * T)} × ${f(bk.openBelow - 1)})`, material: 'plywood' });
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

  return { config: bk, shelfConfig, shelfPlan, y0, z0, topY, totalHeight, countertop, cap, crown, grommet, outlet, parts, errors, warnings };
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
  const out = placeBookcaseSolids(bp, withValance(bp.config, shelfSolids(bp.shelfPlan, bp.shelfConfig))).map(s => ({ ...s, explode: [0, spread * 2, 0] as [number, number, number] }));
  // Display touches, from each shelf's own box: a lip on its front, a light rail under it.
  const bk = bp.config;
  const shelves = out.filter(s => s.shape === 'box' && (s.kind === 'shelf' || s.kind === 'adjustable') && /^Bookcase bay \d+ /i.test(s.name));
  const bottom = out.find(s => s.name === 'Bookcase bottom');
  const top = out.find(s => s.name === 'Bookcase top');
  if (bk.lips) {
    for (const s of [...shelves, ...(bottom ? [bottom] : [])]) {
      if (s.shape !== 'box') continue;
      out.push({ name: `${s.name} lip`, kind: 'frame', shape: 'box', min: [s.min[0], s.max[1] - (LIP_HEIGHT - LIP_PROUD), s.min[2] - 0.75], max: [s.max[0], s.max[1] + LIP_PROUD, s.min[2]], explode: s.explode });
    }
  }
  if (bk.shelfLights) {
    for (const s of [...shelves, ...(top ? [top] : [])]) {
      if (s.shape !== 'box') continue;
      out.push({ name: `${s.name} light rail`, kind: 'frame', shape: 'box', min: [s.min[0], s.min[1] - LIGHT_RAIL, s.min[2]], max: [s.max[0], s.min[1], s.min[2] + 0.75], explode: s.explode });
    }
  }
  if (bookcaseSideCut(bk) > 0) {
    const T2 = bp.shelfConfig.thickness;
    out.push({ ...box('Bookcase hanging rail', { x0: T2, x1: width - T2, y0: bp.topY - T2 - HANGING_RAIL, y1: bp.topY - T2, z0: caseDepth - 0.25 - T2, z1: caseDepth - 0.25 }), explode: [0, spread * 2, spread] });
  }
  if (bp.outlet) {
    const o = bp.outlet;
    out.push({ name: 'Backsplash outlet', kind: 'pinhole', shape: 'box', min: [o.x0, o.y0, caseDepth - 0.35], max: [o.x1, o.y1, caseDepth + 0.05], explode: [0, spread * 2, 0] });
  }
  if (bk.pegboard && bk.openBelow > 0) {
    const back = caseDepth - 0.25;
    const y0 = bp.y0 + (bk.taskLight ? bk.valanceHeight : 0) + 0.5;
    const y1 = bp.y0 + bk.openBelow - 0.5;
    out.push({ ...box('Pegboard spacer, bottom', { x0: T, x1: width - T, y0, y1: y0 + 1.5, z0: back - PEGBOARD_SPACER, z1: back }), explode: [0, 0, spread] });
    out.push({ ...box('Pegboard spacer, top', { x0: T, x1: width - T, y0: y1 - 1.5, y1, z0: back - PEGBOARD_SPACER, z1: back }), explode: [0, 0, spread] });
    out.push({ ...box('Pegboard', { x0: T + 0.25, x1: width - T - 0.25, y0, y1, z0: back - PEGBOARD_SPACER - 0.2, z1: back - PEGBOARD_SPACER }, 'back'), explode: [0, 0, -spread] });
  }
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
    openBelow: n(v.openBelow, 0, 96, 0),
    taskLight: v.taskLight === true,
    valanceHeight: n(v.valanceHeight, 0, 12, d.valanceHeight),
    ceilingHeight: typeof v.ceilingHeight === 'number' && v.ceilingHeight > 0 && v.ceilingHeight < 240 ? v.ceilingHeight : undefined,
    ...(v.lips === true ? { lips: true } : {}),
    ...(v.pegboard === true ? { pegboard: true } : {}),
    ...(v.shelfLights === true ? { shelfLights: true } : {}),
    ...(v.outlet === true ? { outlet: true } : {}),
    ...(v.floating === true ? { floating: true } : {}),
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
  openSpace: boolean;
  openHeight: string;
  taskLight: boolean;
  valanceHeight: string;
  /** '' to skip the ceiling checks. */
  ceilingHeight: string;
  lips?: boolean;
  pegboard?: boolean;
  shelfLights?: boolean;
  outlet?: boolean;
  floating?: boolean;
}

export const BOOKCASE_LENGTH_KEYS = [
  'height', 'depth', 'counterThickness', 'overhangFront', 'overhangSides', 'capProjection', 'crownHeight', 'crownProjection', 'openHeight', 'valanceHeight', 'ceilingHeight',
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
    openSpace: b.openBelow > 0,
    openHeight: L(b.openBelow > 0 ? b.openBelow : 18),
    taskLight: b.taskLight,
    valanceHeight: L(b.valanceHeight),
    ceilingHeight: b.ceilingHeight ? L(b.ceilingHeight) : '',
    lips: b.lips === true,
    pegboard: b.pegboard === true,
    shelfLights: b.shelfLights === true,
    outlet: b.outlet === true,
    floating: b.floating === true,
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
    openBelow: fields.openSpace ? num('openHeight') : 0,
    taskLight: fields.taskLight,
    valanceHeight: fields.taskLight ? num('valanceHeight') : DEFAULT_BOOKCASE.valanceHeight,
    ceilingHeight: fields.ceilingHeight.trim() ? num('ceilingHeight') : undefined,
    ...(fields.lips ? { lips: true } : {}),
    ...(fields.pegboard ? { pegboard: true } : {}),
    ...(fields.shelfLights ? { shelfLights: true } : {}),
    ...(fields.outlet ? { outlet: true } : {}),
    ...(fields.floating && fields.openSpace ? { floating: true } : {}),
  };
}
