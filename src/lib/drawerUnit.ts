// Drawer unit generator, after the IKEA ALEX: a plywood case full of side-mount
// slide drawers, each full-overlay front with a finger-pull notch cut into its
// top edge instead of a handle. All values are inches.
//
// Coordinate model matches the Shelf Builder: x runs left → right from the
// outside of the left side, y runs up from the floor, depth (z) runs from the
// case's front edge to the back. Drawer fronts sit in front of the case, at
// negative depth.
//
// Case: full-height sides; top and bottom fitted between them; a thin back let
// into a rabbet in each side. Drawer boxes: four sides of thinner plywood with
// the front and back in rabbets in the box sides, and a bottom in a groove.

import {
  fitsSheet,
  formatLength,
  lengthToField,
  type LengthUnit,
  type ProjectCutItemInput,
  type ShelfPart,
  type Solid,
  type SolidKind,
} from './shelving.ts';

export type DrawerBase = 'none' | 'feet' | 'casters';
export type PullShape = 'arc' | 'slot';
/** Whether the overall height is typed (fronts share it equally) or built up from each front's height. */
export type DrawerHeightMode = 'overall' | 'fronts';

export interface FingerPull {
  enabled: boolean;
  shape: PullShape;
  /** Across the top edge of the front. */
  width: number;
  /** Down from the top edge. */
  depth: number;
}

export interface DrawerConfig {
  /** Case and drawer-front plywood. */
  thickness: number;
  /** Overall width of the case. */
  width: number;
  /** Overall height including feet or casters. Ignored when `frontHeights` is set. */
  height: number;
  /** Overall depth, drawer fronts included. */
  depth: number;
  drawers: number;
  /** Each front's height, top to bottom. When set, the case height is built from them. */
  frontHeights?: number[];
  /** Gap between neighbouring fronts (half of it shows at the top, bottom and sides). */
  gap: number;
  pull: FingerPull;
  /** Drawer-box sides, front and back. */
  boxThickness: number;
  /** Drawer-box bottom, in a groove. */
  bottomThickness: number;
  /** Case back, in a rabbet in each side. */
  backThickness: number;
  base: DrawerBase;
  /** Gap under the case on leveling feet. */
  footHeight: number;
  /** Mounted height of the casters, floor to plate. */
  casterHeight: number;
  /** A specific slide length; leave unset to use the longest that fits. */
  slideLength?: number;
  /** Band the case's front edges and the drawer fronts' straight edges. */
  edgeBanding?: boolean;
  bandingThickness?: number;
  /** Display unit for notes and messages. Geometry is always inches. */
  units?: LengthUnit;
}

/** LONTAN side-mount slides: 1/2" thick, about 45 mm tall, 10–24" long, 100 lb a pair. */
export const SLIDE_LENGTHS = [10, 12, 14, 16, 18, 20, 22, 24];
export const SLIDE_CLEARANCE = 1 / 2;
export const SLIDE_HEIGHT = 45 / 25.4;
export const SLIDE_CAPACITY_LB = 100;
/** Room left behind a closed drawer box for the slide's back end and an out-of-square back. */
export const SLIDE_BACK_CLEARANCE = 1 / 2;
/** Space above and below each drawer box inside its front's share of the case. */
export const BOX_CLEARANCE = 3 / 8;
/** Shortest drawer box the slides mount to with a screw above and below. */
export const MIN_BOX_HEIGHT = 2 + 1 / 4;
/** Narrowest drawer box worth building. */
export const MIN_BOX_WIDTH = 4;
/** Fingers need this much more room behind the front than the notch is deep. */
export const FINGER_ROOM = 3 / 8;
/** The box front's notch is this much wider than the front's, so it never shows. */
export const BOX_NOTCH_EXTRA = 1 / 2;
/** Bottom groove: how far up from the bottom edge of the box parts, and how deep. */
export const BOTTOM_GROOVE_OFFSET = 1 / 2;
export const BOTTOM_GROOVE_DEPTH = 1 / 4;
/** The bottom floats 1/32" short of the groove bottoms each way. */
const BOTTOM_PLAY = 1 / 16;
/** MROCO feet thread into T-nuts, which want about this much wood. */
export const TNUT_MIN_THICKNESS = 5 / 8;
export const FOOT_SIZE = 1.25;
export const FOOT_INSET = 1.5;
/** Units wider than this get a pair of feet or casters in the middle. */
export const MIDDLE_SUPPORT_WIDTH = 30;
/** Drawers wider than this rack: they twist and bind when pulled from one side. */
export const WIDE_DRAWER = 36;
const EPS = 1e-6;

const floor16 = (inches: number) => Math.floor(inches * 16 + EPS) / 16;

export interface DrawerLayout {
  index: number;
  /** Front extent in the front elevation. */
  front: { x: number; y: number; width: number; height: number };
  /** Box extent: bottom, height, and outside width. */
  box: { x: number; y: number; width: number; height: number; depth: number };
  /** Bottom edge of the slide, from the floor. */
  slideY: number;
  /** Slide bottom edge from the bottom edge of the case side, for marking the sides. */
  slideMark: number;
  /** Box-front notch depth below the box's top edge (0 when the box already sits low enough). */
  boxNotchDepth: number;
}

export interface DrawerPlan {
  overallWidth: number;
  overallHeight: number;
  overallDepth: number;
  /** Case without the fronts. */
  caseDepth: number;
  caseHeight: number;
  /** Feet or caster height under the case. */
  baseHeight: number;
  interiorWidth: number;
  interiorDepth: number;
  slideLength: number;
  drawers: DrawerLayout[];
  parts: ShelfPart[];
  warnings: string[];
  errors: string[];
  /** Feet or casters, counted. */
  supports: number;
  /** Which drawers (0-based) each drawer part is cut for, by part name. */
  partDrawers: Record<string, number[]>;
  banding: { thickness: number; totalLength: number } | null;
}

// ── Finger pull ────────────────────────────────────────────────────────────────

/**
 * The notch outline, left to right, as (dx from the notch centre, dy below the
 * top edge — negative). It starts and ends on the top edge.
 */
export function pullProfile(pull: Pick<FingerPull, 'shape' | 'width' | 'depth'>, segments = 24): [number, number][] {
  const w = pull.width;
  const d = pull.depth;
  if (pull.shape === 'slot') {
    // A rounded-bottom slot: straight sides, corners rounded by up to 1/2".
    const r = Math.min(d, w / 2, 0.5);
    const pts: [number, number][] = [[-w / 2, 0]];
    const corner = (cx: number, cy: number, from: number, to: number) => {
      const n = Math.max(4, Math.round(segments / 4));
      for (let i = 0; i <= n; i++) {
        const a = from + (to - from) * i / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(-w / 2 + r, -d + r, Math.PI, Math.PI * 1.5);
    corner(w / 2 - r, -d + r, Math.PI * 1.5, Math.PI * 2);
    pts.push([w / 2, 0]);
    return dedupe(pts);
  }
  // A shallow circular arc — the ALEX "smile". Radius from the chord and its depth.
  const R = (w * w / 4 + d * d) / (2 * d);
  const cy = R - d;
  const half = Math.asin(Math.min(1, w / (2 * R)));
  // A notch deeper than half its width is more than a semicircle: sweep past the sides.
  const sweep = d > w / 2 ? Math.PI - half : half;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -sweep + 2 * sweep * i / segments;
    pts.push([R * Math.sin(a), cy - R * Math.cos(a)]);
  }
  pts[0] = [-w / 2, 0];
  pts[pts.length - 1] = [w / 2, 0];
  return pts;
}

function dedupe(pts: [number, number][]): [number, number][] {
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
}

/**
 * A rectangle with the notch cut into its top edge, counter-clockwise from the
 * bottom-left corner, in the same frame as the rectangle.
 */
export function notchedOutline(
  x0: number, y0: number, width: number, height: number,
  pull: Pick<FingerPull, 'shape' | 'width' | 'depth'> | null,
): [number, number][] {
  const x1 = x0 + width;
  const y1 = y0 + height;
  if (!pull || pull.depth <= 0 || pull.width <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cx = x0 + width / 2;
  const notch = pullProfile(pull).map(([dx, dy]) => [cx + dx, y1 + dy] as [number, number]).reverse();
  return [[x0, y0], [x1, y0], [x1, y1], ...notch, [x0, y1]];
}

// ── Front heights ─────────────────────────────────────────────────────────────

/** Equal fronts that fill the space. */
export function equalFronts(count: number, available: number): number[] {
  return Array.from({ length: count }, () => available / count);
}

/** Fronts that grow toward the floor, each `step` times the one above, filling the space. */
export function graduatedFronts(count: number, available: number, step = 1.2): number[] {
  const weights = Array.from({ length: count }, (_, i) => step ** i);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => available * w / total);
}

/** Height under the case. */
export function baseHeightOf(c: Pick<DrawerConfig, 'base' | 'footHeight' | 'casterHeight'>): number {
  return c.base === 'feet' ? c.footHeight : c.base === 'casters' ? c.casterHeight : 0;
}

/** Overall height built from front heights: the fronts, a gap per front, and the base. */
export function overallFromFronts(frontHeights: number[], c: Pick<DrawerConfig, 'gap' | 'base' | 'footHeight' | 'casterHeight'>): number {
  return frontHeights.reduce((a, b) => a + b, 0) + frontHeights.length * c.gap + baseHeightOf(c);
}

/** Front heights for the current config, top to bottom. */
export function frontHeightsOf(c: DrawerConfig): number[] {
  if (c.frontHeights && c.frontHeights.length === c.drawers) return c.frontHeights;
  const caseHeight = c.height - baseHeightOf(c);
  return equalFronts(c.drawers, caseHeight - c.drawers * c.gap);
}

/** The longest LONTAN slide that fits the inside depth, or null if even 10" doesn't. */
export function autoSlideLength(interiorDepth: number): number | null {
  const fits = SLIDE_LENGTHS.filter(l => l <= interiorDepth - SLIDE_BACK_CLEARANCE + EPS);
  return fits.length ? fits[fits.length - 1] : null;
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export function buildDrawerPlan(config: DrawerConfig): DrawerPlan {
  const units = config.units ?? 'in';
  const f = (inches: number) => formatLength(inches, units);
  const errors: string[] = [];
  const warnings: string[] = [];

  const T = config.thickness;
  const b = config.boxThickness;
  const bt = config.bottomThickness;
  const backT = config.backThickness;
  const W = config.width;
  const D = config.depth;
  const n = config.drawers;
  const gap = config.gap;
  const B = baseHeightOf(config);
  const fronts = frontHeightsOf(config);
  const caseHeight = config.frontHeights && config.frontHeights.length === n
    ? fronts.reduce((a, s) => a + s, 0) + n * gap
    : config.height - B;
  const H = caseHeight + B;
  const caseDepth = D - T;
  const interiorWidth = W - 2 * T;
  const interiorDepth = caseDepth - backT;
  const boxWidth = interiorWidth - 2 * SLIDE_CLEARANCE;
  const banding = config.edgeBanding ? (config.bandingThickness ?? 0.02) : 0;

  // Material.
  if (!(T > 0) || T > 1.5) errors.push(`Case plywood ${f(T)} isn’t usable — enter a thickness between ${f(1 / 4)} and ${f(1.5)}.`);
  if (!(b > 0) || b > 1) errors.push(`Drawer-box plywood ${f(b)} isn’t usable — ${f(1 / 2)} is typical.`);
  if (!(bt > 0)) errors.push('Enter a drawer-bottom thickness, e.g. 1/4".');
  else if (b > 0 && BOTTOM_GROOVE_DEPTH >= b - 0.125) {
    errors.push(`The ${f(BOTTOM_GROOVE_DEPTH)} bottom groove would leave less than ${f(1 / 8)} of the ${f(b)} box sides. Use box plywood at least ${f(BOTTOM_GROOVE_DEPTH + 1 / 4)} thick.`);
  }
  if (!(backT > 0) || backT >= T) errors.push(`The back (${f(backT)}) must be thinner than the case plywood (${f(T)}) — it sits in a rabbet in the sides.`);
  if (!Number.isInteger(n) || n < 1 || n > 12) errors.push('Choose between 1 and 12 drawers.');
  if (gap < 0 || gap > 0.5) errors.push(`A ${f(gap)} gap between fronts is outside ${f(0)}–${f(1 / 2)}; ${f(1 / 8)} is typical.`);

  // Width.
  if (boxWidth < MIN_BOX_WIDTH) {
    const minWidth = MIN_BOX_WIDTH + 2 * SLIDE_CLEARANCE + 2 * T;
    errors.push(`At ${f(W)} wide the drawer boxes would be only ${f(Math.max(boxWidth, 0))} wide after the two sides (${f(T)} each) and ${f(SLIDE_CLEARANCE)} per side for the slides. Make the unit at least ${f(minWidth)} wide.`);
  } else if (boxWidth > WIDE_DRAWER) {
    warnings.push(`The drawers are ${f(boxWidth)} wide. Past about ${f(WIDE_DRAWER)} a drawer pulled from one side twists and binds — consider two units side by side.`);
  }

  // Depth and slides.
  const auto = autoSlideLength(interiorDepth);
  let slideLength = config.slideLength ?? auto ?? 0;
  if (auto === null) {
    errors.push(`The inside depth is ${f(Math.max(interiorDepth, 0))} (overall ${f(D)} less the ${f(T)} fronts and the ${f(backT)} back). The shortest slide is ${f(SLIDE_LENGTHS[0])} and needs ${f(SLIDE_LENGTHS[0] + SLIDE_BACK_CLEARANCE)} — make the unit at least ${f(SLIDE_LENGTHS[0] + SLIDE_BACK_CLEARANCE + T + backT)} deep.`);
    slideLength = 0;
  } else if (config.slideLength !== undefined) {
    if (!SLIDE_LENGTHS.includes(config.slideLength)) {
      errors.push(`${f(config.slideLength)} isn’t a slide length LONTAN sells; pick one of ${SLIDE_LENGTHS.map(l => f(l)).join(', ')}.`);
    } else if (config.slideLength > auto + EPS) {
      errors.push(`${f(config.slideLength)} slides need ${f(config.slideLength + SLIDE_BACK_CLEARANCE)} inside, but there’s only ${f(interiorDepth)}. The longest that fits is ${f(auto)}.`);
    }
  }

  // Heights.
  if (config.frontHeights && config.frontHeights.length !== n) {
    errors.push(`There are ${n} drawers but ${config.frontHeights.length} front heights.`);
  }
  if (caseHeight <= 2 * T) errors.push(`At ${f(H)} overall there’s no room for drawers once the base (${f(B)}) and the top and bottom are taken out.`);
  fronts.forEach((h, i) => {
    if (!(h > 0)) errors.push(`Drawer ${i + 1}’s front would be ${f(h)} tall — make the unit taller or use fewer drawers.`);
  });
  if (B < 0) errors.push('The foot or caster height can’t be negative.');

  const drawers: DrawerLayout[] = [];
  const interiorBottom = B + T;
  const interiorTop = H - T;
  const pull = config.pull.enabled ? config.pull : null;
  const frontWidth = W - gap;
  let top = H - gap / 2;
  fronts.forEach((h, i) => {
    const y = top - h;
    top = y - gap;
    const zoneBottom = Math.max(y - gap / 2, interiorBottom);
    const zoneTop = Math.min(y + h + gap / 2, interiorTop);
    const boxHeight = floor16(zoneTop - zoneBottom - 2 * BOX_CLEARANCE);
    const boxY = zoneBottom + BOX_CLEARANCE;
    // Slide centred on the box side (no higher than 2" up), set on a clean 1/16" so it's easy to mark on every box.
    const slideOffset = Math.max(Math.round((Math.min(boxHeight / 2, 2) - SLIDE_HEIGHT / 2) * 16) / 16, 1 / 8);
    const slideY = boxY + slideOffset;
    const boxTop = boxY + boxHeight;
    const fingerFloor = y + h - (pull ? pull.depth + FINGER_ROOM : 0);
    const boxNotchDepth = pull && boxTop > fingerFloor ? boxTop - fingerFloor : 0;
    drawers.push({
      index: i,
      front: { x: gap / 2, y, width: frontWidth, height: h },
      box: { x: T + SLIDE_CLEARANCE, y: boxY, width: boxWidth, height: boxHeight, depth: slideLength },
      slideY,
      slideMark: slideY - B,
      boxNotchDepth,
    });
    if (h > 0 && boxHeight < MIN_BOX_HEIGHT) {
      const need = h + (MIN_BOX_HEIGHT - boxHeight);
      errors.push(`Drawer ${i + 1}’s front is ${f(h)} tall, which leaves a ${f(Math.max(boxHeight, 0))} box — the slides need at least ${f(MIN_BOX_HEIGHT)}. Make that front about ${f(Math.ceil(need * 16) / 16)} tall, or use fewer drawers.`);
    }
    if (pull) {
      if (pull.depth >= h - 1) {
        errors.push(`The ${f(pull.depth)} finger pull is too deep for drawer ${i + 1}’s ${f(h)} front — keep at least ${f(1)} of front below it.`);
      } else if (boxNotchDepth > boxHeight - (BOTTOM_GROOVE_OFFSET + bt + 1 / 4)) {
        errors.push(`Drawer ${i + 1}’s box is only ${f(boxHeight)} tall, so the ${f(pull.depth)} finger pull would have to notch its front down to the bottom. Make the pull shallower or that front taller.`);
      }
    }
  });
  if (pull) {
    if (pull.width <= 0 || pull.depth <= 0) errors.push('Give the finger pull a width and a depth, or turn it off.');
    else if (pull.width > frontWidth - 2) errors.push(`The ${f(pull.width)} finger pull is wider than the ${f(frontWidth)} front allows — leave at least ${f(1)} each side.`);
    else if (pull.shape === 'arc' && pull.depth > pull.width / 2) {
      warnings.push(`An arc pull deeper than half its width (${f(pull.width / 2)}) curls back under the top edge, which a router can’t cut cleanly. Use the slot shape or a shallower pull.`);
    }
  }

  // Base.
  const supports = config.base === 'none' ? 0 : W > MIDDLE_SUPPORT_WIDTH ? 6 : 4;
  if (config.base === 'feet' && T < TNUT_MIN_THICKNESS) {
    warnings.push(`The leveling feet’s T-nuts want about ${f(TNUT_MIN_THICKNESS)} of wood and the bottom is ${f(T)}. Glue a ${f(3 / 4)} block under the bottom at each foot.`);
  }
  if (config.base === 'casters' && T < 1 / 2) {
    warnings.push(`Caster screws need more than the ${f(T)} bottom. Glue a ${f(3 / 4)} block under each caster plate.`);
  }
  if (config.base === 'casters' && H > 2.5 * D) {
    warnings.push(`At ${f(H)} tall and ${f(D)} deep on casters, the unit tips easily with a drawer open. Use locking casters, keep heavy things low, or go lower.`);
  } else if (H > 3 * D) {
    warnings.push(`At ${f(H)} tall and only ${f(D)} deep, open drawers can tip the unit. Anchor it to the wall.`);
  }

  // Parts.
  const parts: ShelfPart[] = [];
  const caseBanding = banding;
  const sideHeight = caseHeight;
  const panelLength = interiorWidth;
  parts.push({ name: 'Side', qty: 2, length: sideHeight, width: caseDepth - caseBanding, thickness: T,
    note: `${f(backT)} × ${f(T / 2)} rabbet on the back inside edge for the back`, material: 'plywood' });
  parts.push({ name: 'Top', qty: 1, length: panelLength, width: interiorDepth - caseBanding, thickness: T, material: 'plywood' });
  parts.push({ name: 'Bottom', qty: 1, length: panelLength, width: interiorDepth - caseBanding, thickness: T,
    note: config.base === 'feet' ? `${supports} T-nuts for the leveling feet` : config.base === 'casters' ? `${supports} casters screw on` : undefined,
    material: 'plywood' });
  parts.push({ name: 'Back', qty: 1, length: sideHeight, width: W - T, thickness: backT, note: `Sits in ${f(T / 2)} rabbets in the sides`, material: 'plywood' });

  // Drawer parts, grouped by size so identical drawers share a line.
  const groups: { indexes: number[]; front: number; box: number; notch: number }[] = [];
  for (const d of drawers) {
    const g = groups.find(g => Math.abs(g.front - d.front.height) < EPS && Math.abs(g.box - d.box.height) < EPS && Math.abs(g.notch - d.boxNotchDepth) < 1e-3);
    if (g) g.indexes.push(d.index);
    else groups.push({ indexes: [d.index], front: d.front.height, box: d.box.height, notch: d.boxNotchDepth });
  }
  const partDrawers: Record<string, number[]> = {};
  const boxInsideWidth = boxWidth - 2 * b;
  const boxInsideDepth = slideLength - 2 * b;
  for (const g of groups) {
    const which = groups.length === 1 ? '' : ` · ${drawerRange(g.indexes)}`;
    const qty = g.indexes.length;
    for (const kind of ['Drawer front', 'Box side', 'Box front', 'Box back', 'Box bottom']) partDrawers[`${kind}${which}`] = g.indexes;
    const pullNote = pull ? `${pull.shape === 'arc' ? 'Arc' : 'Slot'} finger pull ${f(pull.width)} wide × ${f(pull.depth)} deep, centred on the top edge` : undefined;
    parts.push({ name: `Drawer front${which}`, qty, length: frontWidth - 2 * banding, width: g.front - 2 * banding, thickness: T,
      note: pullNote, material: 'plywood' });
    parts.push({ name: `Box side${which}`, qty: qty * 2, length: slideLength, width: g.box, thickness: b,
      note: `${f(b)} × ${f(b / 2)} rabbet at each end; bottom groove ${f(BOTTOM_GROOVE_OFFSET)} up`, material: 'plywood' });
    parts.push({ name: `Box front${which}`, qty, length: boxWidth - b, width: g.box, thickness: b,
      note: g.notch > 0 ? `Notch ${f((pull?.width ?? 0) + BOX_NOTCH_EXTRA)} wide × ${f(g.notch)} deep for fingers` : 'Bottom groove',
      material: 'plywood' });
    parts.push({ name: `Box back${which}`, qty, length: boxWidth - b, width: g.box, thickness: b, note: 'Bottom groove', material: 'plywood' });
    parts.push({ name: `Box bottom${which}`, qty, length: boxInsideWidth + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY, width: boxInsideDepth + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY,
      thickness: bt, material: 'plywood' });
  }
  if (errors.length === 0) {
    for (const p of parts) {
      if (!fitsSheet(p.length, p.width)) errors.push(`${p.name} (${f(p.length)} × ${f(p.width)}) is bigger than a 4 × 8 sheet.`);
    }
  }

  const bandingTotal = banding > 0
    ? 2 * caseHeight + 2 * interiorWidth + n * 2 * frontWidth + fronts.reduce((a, h) => a + 2 * h, 0)
    : 0;

  return {
    overallWidth: W,
    overallHeight: H,
    overallDepth: D,
    caseDepth,
    caseHeight,
    baseHeight: B,
    interiorWidth,
    interiorDepth,
    slideLength,
    drawers,
    parts,
    warnings,
    errors,
    supports,
    partDrawers,
    banding: banding > 0 ? { thickness: banding, totalLength: bandingTotal } : null,
  };
}

function drawerRange(indexes: number[]): string {
  const nums = indexes.map(i => i + 1);
  if (nums.length === 1) return `drawer ${nums[0]}`;
  const contiguous = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1);
  return contiguous ? `drawers ${nums[0]}–${nums[nums.length - 1]}` : `drawers ${nums.join(', ')}`;
}

// ── 3D solids ─────────────────────────────────────────────────────────────────

/** Support positions (x, z of the near corner) under the bottom panel. */
export function supportPositions(plan: DrawerPlan, config: DrawerConfig): [number, number][] {
  if (plan.supports === 0) return [];
  const T = config.thickness;
  const W = plan.overallWidth;
  const s = config.base === 'casters' ? 2.5 : FOOT_SIZE;
  const xs = [T + FOOT_INSET, W - T - FOOT_INSET - s];
  if (plan.supports === 6) xs.splice(1, 0, W / 2 - s / 2);
  const zs = [FOOT_INSET, plan.interiorDepth - FOOT_INSET - s];
  return xs.flatMap(x => zs.map(z => [x, z] as [number, number]));
}

export function drawerSolids(plan: DrawerPlan, config: DrawerConfig): Solid[] {
  const T = config.thickness;
  const b = config.boxThickness;
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const B = plan.baseHeight;
  const cd = plan.caseDepth;
  const id = plan.interiorDepth;
  const box = (name: string, kind: SolidKind, min: [number, number, number], max: [number, number, number]): Solid =>
    ({ name, kind, shape: 'box', min, max });
  const pull = config.pull.enabled ? config.pull : null;

  const solids: Solid[] = [
    box('Left side', 'case', [0, B, 0], [T, H, cd]),
    box('Right side', 'case', [W - T, B, 0], [W, H, cd]),
    box('Top', 'case', [T, H - T, 0], [W - T, H, id]),
    box('Bottom', 'case', [T, B, 0], [W - T, B + T, id]),
    box('Back', 'back', [T / 2, B, id], [W - T / 2, H, cd]),
  ];
  for (const d of plan.drawers) {
    const name = `Drawer ${d.index + 1}`;
    const fr = d.front;
    solids.push({ name: `${name} front`, kind: 'drawer-front', shape: 'plate', z0: -T, z1: 0,
      outline: notchedOutline(fr.x, fr.y, fr.width, fr.height, pull) });
    const bx = d.box;
    const x0 = bx.x;
    const x1 = bx.x + bx.width;
    const y0 = bx.y;
    const y1 = bx.y + bx.height;
    const boxNotch = d.boxNotchDepth > 0 && pull
      ? { shape: pull.shape, width: pull.width + BOX_NOTCH_EXTRA, depth: d.boxNotchDepth }
      : null;
    solids.push({ name: `${name} box front`, kind: 'drawer-box', shape: 'plate', z0: 0, z1: b,
      outline: notchedOutline(x0, y0, bx.width, bx.height, boxNotch) });
    solids.push(box(`${name} box back`, 'drawer-box', [x0, y0, bx.depth - b], [x1, y1, bx.depth]));
    solids.push(box(`${name} box left side`, 'drawer-box', [x0, y0, b], [x0 + b, y1, bx.depth - b]));
    solids.push(box(`${name} box right side`, 'drawer-box', [x1 - b, y0, b], [x1, y1, bx.depth - b]));
    const by = y0 + BOTTOM_GROOVE_OFFSET;
    solids.push(box(`${name} box bottom`, 'drawer-box', [x0 + b, by, b], [x1 - b, by + config.bottomThickness, bx.depth - b]));
    solids.push(box(`${name} left slide`, 'slide', [T, d.slideY, 0], [T + SLIDE_CLEARANCE, d.slideY + SLIDE_HEIGHT, bx.depth]));
    solids.push(box(`${name} right slide`, 'slide', [W - T - SLIDE_CLEARANCE, d.slideY, 0], [W - T, d.slideY + SLIDE_HEIGHT, bx.depth]));
  }
  supportPositions(plan, config).forEach(([x, z], i) => {
    if (config.base === 'feet') {
      solids.push(box(`Foot ${i + 1}`, 'foot', [x, 0, z], [x + FOOT_SIZE, B, z + FOOT_SIZE]));
    } else {
      // A plate under the bottom, a fork, and a wheel on an axle running left–right.
      const plate = 0.2;
      const r = Math.max((B - plate) / 2 - 0.05, 0.2);
      const cz = z + 1.25;
      solids.push(box(`Caster ${i + 1} plate`, 'caster', [x, B - plate, z], [x + 2.5, B, z + 2.5]));
      solids.push(box(`Caster ${i + 1} fork`, 'caster', [x + 0.75, r, cz - 0.3], [x + 1.75, B - plate, cz + 0.3]));
      const wheel: [number, number][] = Array.from({ length: 20 }, (_, k) => {
        const a = (k / 20) * Math.PI * 2;
        return [cz + r * Math.cos(a), r + r * Math.sin(a)];
      });
      solids.push({ name: `Caster ${i + 1} wheel`, kind: 'caster', shape: 'prism', x0: x + 0.85, x1: x + 1.65, profile: wheel });
    }
  });
  return solids;
}

// ── Project cut list and titles ──────────────────────────────────────────────

export function drawerProjectCutItems(plan: DrawerPlan, material = 'Plywood'): ProjectCutItemInput[] {
  return plan.parts.map(part => ({
    part_name: part.name,
    qty: part.qty,
    length: lengthToField(part.length, 'in'),
    width: lengthToField(part.width, 'in'),
    thickness: lengthToField(part.thickness, 'in'),
    material,
  }));
}

/** A default title, e.g. "Drawer unit 14 1/8\" × 27 1/2\", 5 drawers". */
export function drawerProjectTitle(plan: DrawerPlan, units: LengthUnit): string {
  const n = plan.drawers.length;
  return `Drawer unit ${formatLength(plan.overallWidth, units)} × ${formatLength(plan.overallHeight, units)}, ${n} drawer${n === 1 ? '' : 's'}`;
}

// ── Saved designs ─────────────────────────────────────────────────────────────

export const DRAWER_DESIGN_VERSION = 1;

export interface SavedDrawerDesign {
  version: 1;
  kind: 'drawer-unit';
  units: LengthUnit;
  heightMode: DrawerHeightMode;
  config: DrawerConfig;
}

export function toSavedDrawerDesign(config: DrawerConfig, units: LengthUnit, heightMode: DrawerHeightMode = 'overall'): SavedDrawerDesign {
  const c: DrawerConfig = { ...config, units, pull: { ...config.pull } };
  if (heightMode === 'overall') delete c.frontHeights;
  return { version: DRAWER_DESIGN_VERSION, kind: 'drawer-unit', units, heightMode, config: c };
}

/** Reads a design back from storage, rejecting anything unusable rather than guessing. */
export function readSavedDrawerDesign(raw: unknown): SavedDrawerDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== DRAWER_DESIGN_VERSION || value.kind !== 'drawer-unit' || !value.config || typeof value.config !== 'object') return null;
  const c = value.config as Record<string, unknown>;
  const units: LengthUnit = value.units === 'mm' ? 'mm' : 'in';
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
  const thickness = num(c.thickness, 0.05, 2);
  const width = num(c.width, 1, 120);
  const height = num(c.height, 1, 120);
  const depth = num(c.depth, 1, 60);
  const drawers = num(c.drawers, 1, 12);
  if (thickness === null || width === null || height === null || depth === null || drawers === null || !Number.isInteger(drawers)) return null;
  const heightMode: DrawerHeightMode = value.heightMode === 'fronts' ? 'fronts' : 'overall';
  let frontHeights: number[] | undefined;
  if (heightMode === 'fronts') {
    if (!Array.isArray(c.frontHeights) || c.frontHeights.length !== drawers) return null;
    const list = c.frontHeights.map(h => num(h, 0.25, 60));
    if (list.some(h => h === null)) return null;
    frontHeights = list as number[];
  }
  const p = (c.pull && typeof c.pull === 'object' ? c.pull : {}) as Record<string, unknown>;
  const slideLength = num(c.slideLength, 1, 60);
  return {
    version: DRAWER_DESIGN_VERSION,
    kind: 'drawer-unit',
    units,
    heightMode,
    config: {
      thickness, width, height, depth, drawers,
      frontHeights,
      gap: num(c.gap, 0, 1) ?? 1 / 8,
      pull: {
        enabled: p.enabled !== false,
        shape: p.shape === 'slot' ? 'slot' : 'arc',
        width: num(p.width, 0, 60) ?? DEFAULT_PULL.width,
        depth: num(p.depth, 0, 20) ?? DEFAULT_PULL.depth,
      },
      boxThickness: num(c.boxThickness, 0.05, 2) ?? 1 / 2,
      bottomThickness: num(c.bottomThickness, 0.05, 2) ?? 1 / 4,
      backThickness: num(c.backThickness, 0.05, 2) ?? 1 / 4,
      base: c.base === 'feet' || c.base === 'casters' ? c.base : 'none',
      footHeight: num(c.footHeight, 0, 12) ?? DEFAULT_FOOT_HEIGHT,
      casterHeight: num(c.casterHeight, 0, 12) ?? DEFAULT_CASTER_HEIGHT,
      slideLength: slideLength ?? undefined,
      edgeBanding: c.edgeBanding === true,
      bandingThickness: num(c.bandingThickness, 0, 0.15) ?? 0.02,
      units,
    },
  };
}

export const DEFAULT_PULL: FingerPull = { enabled: true, shape: 'arc', width: 4.75, depth: 1 };
/** Gap under the case on MROCO leveling feet, before adjusting. */
export const DEFAULT_FOOT_HEIGHT = 1 / 2;
export const DEFAULT_CASTER_HEIGHT = 2;

/** Form fields: every length as typed, in the design's unit. */
export interface DrawerDesignFields {
  units: LengthUnit;
  thickness: string;
  width: string;
  height: string;
  depth: string;
  heightMode: DrawerHeightMode;
  drawers: number;
  frontHeights: string[];
  gap: string;
  pullEnabled: boolean;
  pullShape: PullShape;
  pullWidth: string;
  pullDepth: string;
  boxThickness: string;
  bottomThickness: string;
  backThickness: string;
  base: DrawerBase;
  footHeight: string;
  casterHeight: string;
  /** 'auto' or a length in inches. */
  slideLength: string;
  edgeBanding: boolean;
  bandingThickness: string;
}

export function drawerDesignToFields(saved: SavedDrawerDesign): DrawerDesignFields {
  const { config: c, units } = saved;
  const L = (inches: number) => lengthToField(inches, units);
  const fronts = frontHeightsOf(c);
  return {
    units,
    thickness: L(c.thickness),
    width: L(c.width),
    height: L(c.frontHeights ? overallFromFronts(c.frontHeights, c) : c.height),
    depth: L(c.depth),
    heightMode: saved.heightMode,
    drawers: c.drawers,
    frontHeights: fronts.map(L),
    gap: L(c.gap),
    pullEnabled: c.pull.enabled,
    pullShape: c.pull.shape,
    pullWidth: L(c.pull.width),
    pullDepth: L(c.pull.depth),
    boxThickness: L(c.boxThickness),
    bottomThickness: L(c.bottomThickness),
    backThickness: L(c.backThickness),
    base: c.base,
    footHeight: L(c.footHeight),
    casterHeight: L(c.casterHeight),
    slideLength: c.slideLength ? String(c.slideLength) : 'auto',
    edgeBanding: c.edgeBanding === true,
    bandingThickness: c.bandingThickness ? `${Math.round(c.bandingThickness * 25.4 * 10) / 10} mm` : '0.5 mm',
  };
}
