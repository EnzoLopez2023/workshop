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
import { INSERT_NAMES, layoutInsert, pieceOutline, type DrawerInsert, type InsertLayout } from './drawerInserts.ts';

export type DrawerBase = 'none' | 'feet' | 'casters';
/** Notches cut into the top edge (arc, slot, wide), or a hand hole cut through below it. */
export type PullShape = 'arc' | 'slot' | 'wide' | 'handhole';
export type NotchShape = 'arc' | 'slot';
/** Expected contents, for the slide-capacity and bottom-sag checks. */
export type DrawerLoad = 'light' | 'medium' | 'heavy';
/** Whether the overall height is typed (fronts share it equally) or built up from each front's height. */
export type DrawerHeightMode = 'overall' | 'fronts';

export interface FingerPull {
  enabled: boolean;
  shape: PullShape;
  /** Across the front (ignored for 'wide', which runs nearly the full width). */
  width: number;
  /** Down from the top edge; for a hand hole, the hole's height. */
  depth: number;
}

/** A front-face notch: the shape and size actually cut. */
export interface NotchSpec {
  shape: NotchShape;
  width: number;
  depth: number;
}

/** A wide pull stops this far from each end of the front. */
export const WIDE_PULL_MARGIN = 2;
/** A hand hole's top sits this far below the front's top edge. */
export const HANDHOLE_TOP = 3 / 4;

/** The notch in a front's top edge, or null for a hand hole or no pull. */
export function frontNotch(pull: FingerPull | null | undefined, frontWidth: number): NotchSpec | null {
  if (!pull?.enabled || pull.shape === 'handhole') return null;
  if (pull.shape === 'wide') return { shape: 'slot', width: Math.max(frontWidth - 2 * WIDE_PULL_MARGIN, 0), depth: pull.depth };
  return { shape: pull.shape, width: pull.width, depth: pull.depth };
}

/** A hand hole through the front, measured from its top edge, or null. */
export function handHole(pull: FingerPull | null | undefined): { width: number; height: number; top: number } | null {
  return pull?.enabled && pull.shape === 'handhole' ? { width: pull.width, height: pull.depth, top: HANDHOLE_TOP } : null;
}

/** How far below the front's top edge the pull reaches (where fingers hook). */
export function pullReach(pull: FingerPull | null | undefined, frontWidth: number): number {
  const notch = frontNotch(pull, frontWidth);
  if (notch) return notch.depth;
  const hole = handHole(pull);
  return hole ? hole.top + hole.height : 0;
}

/** Width of the pull across the front. */
export function pullWidth(pull: FingerPull | null | undefined, frontWidth: number): number {
  return frontNotch(pull, frontWidth)?.width ?? handHole(pull)?.width ?? 0;
}

/** A rounded-end (stadium) hole, counter-clockwise, centred at cx with its top at topY. */
export function stadiumOutline(cx: number, topY: number, width: number, height: number, segments = 12): [number, number][] {
  const r = Math.min(height, width) / 2;
  const cy = topY - height / 2;
  const left = cx - width / 2 + r;
  const right = cx + width / 2 - r;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -Math.PI / 2 + Math.PI * i / segments;
    pts.push([right + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI / 2 + Math.PI * i / segments;
    pts.push([left + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return dedupe(pts);
}

export const DRAWER_LOADS: Record<DrawerLoad, { psf: number; label: string }> = {
  light: { psf: 10, label: 'Light — clothes, art supplies, linens' },
  medium: { psf: 25, label: 'Medium — paper, tools, books' },
  heavy: { psf: 50, label: 'Heavy — hardware, files, cans' },
};

/** Plywood bending stiffness, as in the shelf sag check. */
const PLY_MODULUS = 1_000_000;
/** Simply supported plate, max deflection coefficient by long/short side ratio (Timoshenko). */
const PLATE_ALPHA: [number, number][] = [[1, 0.00406], [1.2, 0.00564], [1.4, 0.00705], [1.6, 0.0083], [1.8, 0.00931], [2, 0.01013], [3, 0.01223], [4, 0.01282], [5, 0.01297], [100, 0.01302]];

/** Sag at the middle of a drawer bottom held in grooves on all four sides. */
export function bottomSag(width: number, depth: number, thickness: number, psf: number): number {
  const a = Math.min(width, depth);
  const ratio = Math.max(width, depth) / a;
  let alpha = PLATE_ALPHA[PLATE_ALPHA.length - 1][1];
  for (let i = 1; i < PLATE_ALPHA.length; i++) {
    const [r0, a0] = PLATE_ALPHA[i - 1];
    const [r1, a1] = PLATE_ALPHA[i];
    if (ratio <= r1) { alpha = a0 + (a1 - a0) * (ratio - r0) / (r1 - r0); break; }
  }
  const D = PLY_MODULUS * thickness ** 3 / (12 * (1 - 0.3 ** 2));
  return alpha * (psf / 144) * a ** 4 / D;
}

/** A bottom may sag this fraction of its short span before it looks — and drags — wrong. */
export const BOTTOM_SAG_LIMIT = 1 / 200;

export interface DrawerLoadCheck {
  /** Contents at the chosen load, in pounds. */
  pounds: number;
  sag: number;
  sagLimit: number;
  overSlides: boolean;
  sags: boolean;
}

/** Finish colours as #rrggbb. */
export interface DrawerFinish {
  front: string;
  case: string;
}

export const FINISH_COLORS = [
  { id: 'white', label: 'White (ALEX)', hex: '#f4f1ea' },
  { id: 'birch', label: 'Natural birch', hex: '#e3c79d' },
  { id: 'oak', label: 'Oak stain', hex: '#b98a55' },
  { id: 'black', label: 'Black', hex: '#2e2e2e' },
  { id: 'sage', label: 'Sage', hex: '#a9b8a0' },
  { id: 'navy', label: 'Navy', hex: '#2f3e5c' },
] as const;

export const DEFAULT_FINISH: DrawerFinish = { front: '#f4f1ea', case: '#d8b98c' };

/** The finish as 3D colour overrides: fronts, and the case, back and desk top. */
export function finishColors(finish: DrawerFinish | undefined): Partial<Record<SolidKind, number>> {
  if (!finish) return {};
  const hex = (c: string) => parseInt(c.slice(1), 16);
  return { 'drawer-front': hex(finish.front), case: hex(finish.case), back: hex(finish.case) };
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
  /** What goes inside each drawer, top to bottom (missing or null: nothing). */
  inserts?: (DrawerInsert | null)[];
  /** Divider and marker-rib stock. */
  insertThickness?: number;
  /** Printer bed (mm) that Gridfinity baseplate tiles must fit. */
  gridfinityBed?: number;
  /** One or two units under a plywood desk top. */
  desk?: DeskConfig;
  /** Per-drawer slide length overrides (null: the unit's slide length), e.g. a short pencil drawer. */
  slideLengths?: (number | null)[];
  /** Expected contents, for the load check. */
  load?: DrawerLoad;
  /** Finish colours for the 3D view. */
  finish?: DrawerFinish;
}

export type DeskLayout = 'left' | 'right' | 'both';

export interface DeskConfig {
  enabled: boolean;
  /** Where the drawer units go: one at the left or right end, or one at each end. */
  layout: DeskLayout;
  width: number;
  /** Floor to the top of the desk. */
  height: number;
  /** Front to back; the back lines up with the backs of the units. */
  depth: number;
  /** Layers of case plywood laminated for the top. */
  topLayers: 1 | 2;
}

export const MIN_KNEE_SPACE = 20;
export const COMFORT_KNEE_SPACE = 24;

export interface DeskLayoutPlan {
  /** Left edge of each drawer unit under the top. */
  unitXs: number[];
  width: number;
  depth: number;
  height: number;
  topThickness: number;
  /** Clear width between the units (or beside the one unit). */
  knee: number;
}

/** LONTAN side-mount slides: 1/2" thick, about 45 mm tall, 10–24" long, 100 lb a pair. */
export const SLIDE_LENGTHS = [10, 12, 14, 16, 18, 20, 22, 24];
export const SLIDE_CLEARANCE = 1 / 2;
export const SLIDE_HEIGHT = 45 / 25.4;
export const SLIDE_CAPACITY_LB = 100;
/** An opened drawer in the 3D view comes out this share of its slide's travel. */
export const DRAWER_OPEN_FRACTION = 0.85;
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
  /** Shaped outlines (u, v) for parts that aren't plain rectangles — slotted dividers, notched ribs. */
  partOutlines: Record<string, [number, number][]>;
  /** Each drawer's insert, laid out (null when it has none). */
  inserts: (InsertLayout | null)[];
  /** Units built: 2 for a desk with a unit at each end. Part quantities already include it. */
  unitCount: number;
  desk: DeskLayoutPlan | null;
  /** Per drawer: contents weight and bottom sag at the chosen load. */
  loads: DrawerLoadCheck[];
  banding: { thickness: number; totalLength: number } | null;
}

// ── Finger pull ────────────────────────────────────────────────────────────────

/**
 * The notch outline, left to right, as (dx from the notch centre, dy below the
 * top edge — negative). It starts and ends on the top edge.
 */
export function pullProfile(pull: NotchSpec, segments = 24): [number, number][] {
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
  pull: NotchSpec | null,
): [number, number][] {
  const x1 = x0 + width;
  const y1 = y0 + height;
  if (!pull || pull.depth <= 0 || pull.width <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cx = x0 + width / 2;
  const notch = pullProfile(pull).map(([dx, dy]) => [cx + dx, y1 + dy] as [number, number]).reverse();
  return [[x0, y0], [x1, y0], [x1, y1], ...notch, [x0, y1]];
}

/** The notch in a box front behind the pull, or null when the box sits low enough. */
export function boxNotchSpec(pull: FingerPull | null | undefined, frontWidth: number, depth: number): NotchSpec | null {
  if (!pull?.enabled || depth <= 0) return null;
  const notch = frontNotch(pull, frontWidth);
  return { shape: notch?.shape ?? 'slot', width: pullWidth(pull, frontWidth) + BOX_NOTCH_EXTRA, depth };
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
  const reach = pullReach(pull, frontWidth);
  const pullName = pull?.shape === 'handhole' ? 'hand hole' : 'finger pull';
  // Per-drawer slide lengths: a shorter one for a shallow drawer, for example.
  const slideFor = (i: number) => {
    const own = config.slideLengths?.[i];
    if (own == null) return slideLength;
    if (!SLIDE_LENGTHS.includes(own)) errors.push(`Drawer ${i + 1}: ${f(own)} isn’t a slide length LONTAN sells.`);
    else if (auto !== null && own > auto + EPS) errors.push(`Drawer ${i + 1}: ${f(own)} slides don’t fit — the longest is ${f(auto)}.`);
    return own;
  };
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
    const fingerFloor = y + h - (reach > 0 ? reach + FINGER_ROOM : 0);
    const boxNotchDepth = reach > 0 && boxTop > fingerFloor ? boxTop - fingerFloor : 0;
    drawers.push({
      index: i,
      front: { x: gap / 2, y, width: frontWidth, height: h },
      box: { x: T + SLIDE_CLEARANCE, y: boxY, width: boxWidth, height: boxHeight, depth: slideFor(i) },
      slideY,
      slideMark: slideY - B,
      boxNotchDepth,
    });
    if (h > 0 && boxHeight < MIN_BOX_HEIGHT) {
      const need = h + (MIN_BOX_HEIGHT - boxHeight);
      errors.push(`Drawer ${i + 1}’s front is ${f(h)} tall, which leaves a ${f(Math.max(boxHeight, 0))} box — the slides need at least ${f(MIN_BOX_HEIGHT)}. Make that front about ${f(Math.ceil(need * 16) / 16)} tall, or use fewer drawers.`);
    }
    if (pull) {
      if (reach >= h - 1) {
        errors.push(`The ${pullName} reaches ${f(reach)} down, too far for drawer ${i + 1}’s ${f(h)} front — keep at least ${f(1)} of front below it.`);
      } else if (boxNotchDepth > boxHeight - (BOTTOM_GROOVE_OFFSET + bt + 1 / 4)) {
        errors.push(`Drawer ${i + 1}’s box is only ${f(boxHeight)} tall, so the ${pullName} would have to notch its box front down to the bottom. Make the pull shallower or that front taller.`);
      }
    }
  });
  if (pull) {
    const across = pullWidth(pull, frontWidth);
    if (pull.depth <= 0 || (pull.shape !== 'wide' && pull.width <= 0)) errors.push(`Give the ${pullName} a width and a ${pull.shape === 'handhole' ? 'height' : 'depth'}, or turn it off.`);
    else if (pull.shape === 'wide' && across < 2) errors.push(`The front is too narrow for a wide pull — use an arc or slot.`);
    else if (across > frontWidth - 2) errors.push(`The ${f(across)} ${pullName} is wider than the ${f(frontWidth)} front allows — leave at least ${f(1)} each side.`);
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
  const groups: { indexes: number[]; front: number; box: number; notch: number; depth: number }[] = [];
  for (const d of drawers) {
    const g = groups.find(g => Math.abs(g.front - d.front.height) < EPS && Math.abs(g.box - d.box.height) < EPS
      && Math.abs(g.notch - d.boxNotchDepth) < 1e-3 && g.depth === d.box.depth);
    if (g) g.indexes.push(d.index);
    else groups.push({ indexes: [d.index], front: d.front.height, box: d.box.height, notch: d.boxNotchDepth, depth: d.box.depth });
  }
  const partDrawers: Record<string, number[]> = {};
  const boxInsideWidth = boxWidth - 2 * b;
  for (const g of groups) {
    const boxInsideDepth = g.depth - 2 * b;
    const which = groups.length === 1 ? '' : ` · ${drawerRange(g.indexes)}`;
    const qty = g.indexes.length;
    for (const kind of ['Drawer front', 'Box side', 'Box front', 'Box back', 'Box bottom']) partDrawers[`${kind}${which}`] = g.indexes;
    const across = pullWidth(pull, frontWidth);
    const pullNote = !pull ? undefined
      : pull.shape === 'handhole' ? `Hand hole ${f(across)} × ${f(pull.depth)}, its top ${f(HANDHOLE_TOP)} below the top edge`
        : `${pull.shape === 'arc' ? 'Arc' : pull.shape === 'wide' ? 'Wide' : 'Slot'} finger pull ${f(across)} wide × ${f(pull.depth)} deep, centred on the top edge`;
    parts.push({ name: `Drawer front${which}`, qty, length: frontWidth - 2 * banding, width: g.front - 2 * banding, thickness: T,
      note: pullNote, material: 'plywood' });
    parts.push({ name: `Box side${which}`, qty: qty * 2, length: g.depth, width: g.box, thickness: b,
      note: `${f(b)} × ${f(b / 2)} rabbet at each end; bottom groove ${f(BOTTOM_GROOVE_OFFSET)} up`, material: 'plywood' });
    parts.push({ name: `Box front${which}`, qty, length: boxWidth - b, width: g.box, thickness: b,
      note: g.notch > 0 ? `Notch ${f(across + BOX_NOTCH_EXTRA)} wide × ${f(g.notch)} deep for fingers` : 'Bottom groove',
      material: 'plywood' });
    parts.push({ name: `Box back${which}`, qty, length: boxWidth - b, width: g.box, thickness: b, note: 'Bottom groove', material: 'plywood' });
    parts.push({ name: `Box bottom${which}`, qty, length: boxInsideWidth + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY, width: boxInsideDepth + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY,
      thickness: bt, material: 'plywood' });
  }
  // Inserts: laid out in each box, then grouped so identical ones share a line.
  const it = config.insertThickness ?? 1 / 4;
  const partOutlines: Record<string, [number, number][]> = {};
  const inserts: (InsertLayout | null)[] = drawers.map((d, i) => {
    const insert = config.inserts?.[i];
    if (!insert) return null;
    const layout = layoutInsert(insert, {
      width: boxInsideWidth, depth: d.box.depth - 2 * b, height: d.box.height - BOTTOM_GROOVE_OFFSET - bt,
    }, it, f, config.gridfinityBed ?? 256);
    if (layout.error) errors.push(`Drawer ${i + 1}: ${layout.error}.`);
    return layout;
  });
  if (inserts.some(Boolean) && !(it > 0 && it <= 1)) errors.push(`Divider stock ${f(it)} isn’t usable — ${f(1 / 4)} is typical.`);
  const insertGroups: { key: string; indexes: number[]; layout: InsertLayout }[] = [];
  inserts.forEach((layout, i) => {
    if (!layout || layout.error || layout.pieces.length === 0) return;
    const key = JSON.stringify(layout.pieces);
    const g = insertGroups.find(g => g.key === key);
    if (g) g.indexes.push(i); else insertGroups.push({ key, indexes: [i], layout });
  });
  for (const g of insertGroups) {
    for (const piece of g.layout.pieces) {
      const name = `${INSERT_NAMES[piece.role]} · ${drawerRange(g.indexes)}`;
      partDrawers[name] = g.indexes;
      partOutlines[name] = pieceOutline(piece.length, piece.height, piece.cuts);
      const slots = piece.cuts.length;
      parts.push({
        name, qty: piece.qty * g.indexes.length, length: piece.length, width: piece.height, thickness: it,
        note: piece.role === 'rib'
          ? `${slots} half-round notch${slots === 1 ? '' : 'es'}; glue to the drawer bottom`
          : slots ? `${slots} slot${slots === 1 ? '' : 's'} from the ${piece.role === 'lengthwise' ? 'top' : 'bottom'}, half its height` : undefined,
        material: 'plywood',
      });
    }
  }

  // Load: contents weight against the slides, and how far the bottom sags.
  const load = DRAWER_LOADS[config.load ?? 'medium'];
  const loads: DrawerLoadCheck[] = drawers.map(d => {
    const w = boxInsideWidth;
    const dd = d.box.depth - 2 * b;
    const pounds = load.psf * (w * dd) / 144;
    const sag = bt > 0 && w > 0 && dd > 0 ? bottomSag(w + 2 * BOTTOM_GROOVE_DEPTH, dd + 2 * BOTTOM_GROOVE_DEPTH, bt, load.psf) : 0;
    const sagLimit = Math.min(w, dd) * BOTTOM_SAG_LIMIT;
    return { pounds, sag, sagLimit, overSlides: pounds > SLIDE_CAPACITY_LB, sags: sag > sagLimit };
  });
  const loadWord = load.label.split(' —')[0].toLowerCase();
  const heavy = loads.map((l, i) => (l.overSlides ? i + 1 : 0)).filter(Boolean);
  if (heavy.length && errors.length === 0) {
    const most = Math.max(...loads.map(l => l.pounds));
    warnings.push(`Full of ${loadWord} things, drawer${heavy.length === 1 ? '' : 's'} ${heavy.join(', ')} could hold about ${Math.round(most)} lb — more than the ${SLIDE_CAPACITY_LB} lb the slides are rated for. Use heavier-duty slides, or keep them lighter.`);
  }
  const sagging = loads.map((l, i) => (l.sags ? i + 1 : 0)).filter(Boolean);
  if (sagging.length && errors.length === 0) {
    const worst = loads.reduce((w, l) => (l.sag / l.sagLimit > w.sag / w.sagLimit ? l : w));
    const needed = bt * Math.cbrt(worst.sag / worst.sagLimit);
    const thicker = [3 / 8, 1 / 2, 3 / 4].find(x => x >= needed - 1e-6) ?? 3 / 4;
    warnings.push(`Under ${loadWord} loads the ${f(bt)} bottom${sagging.length === 1 ? '' : 's'} of drawer${sagging.length === 1 ? '' : 's'} ${sagging.join(', ')} would sag about ${worst.sag.toFixed(2)}″ — more than the ${worst.sagLimit.toFixed(2)}″ that stays flat. Use ${f(thicker)} bottoms, or glue a ${f(3 / 4)} × ${f(1.5)} stiffener across the middle underneath.`);
  }

  // Desk: units under a laminated top. Everything above is per unit, so multiply it out.
  let desk: DeskLayoutPlan | null = null;
  let unitCount = 1;
  if (config.desk?.enabled) {
    const dk = config.desk;
    unitCount = dk.layout === 'both' ? 2 : 1;
    const topThickness = dk.topLayers * T;
    const knee = dk.width - unitCount * W;
    const unitXs = dk.layout === 'both' ? [0, dk.width - W] : dk.layout === 'right' ? [dk.width - W] : [0];
    desk = { unitXs, width: dk.width, depth: dk.depth, height: dk.height, topThickness, knee };
    if (knee < MIN_KNEE_SPACE) {
      errors.push(`A ${f(dk.width)} desk leaves only ${f(Math.max(knee, 0))} of knee space beside ${unitCount === 2 ? 'two' : 'a'} ${f(W)} unit${unitCount === 2 ? 's' : ''} — make it at least ${f(unitCount * W + MIN_KNEE_SPACE)} wide.`);
    } else if (knee < COMFORT_KNEE_SPACE) {
      warnings.push(`${f(knee)} of knee space is tight; ${f(COMFORT_KNEE_SPACE)} or more is comfortable.`);
    }
    if (dk.depth < D) errors.push(`The ${f(dk.depth)} desk top is shallower than the ${f(D)} units under it — make it at least ${f(D)} deep.`);
    const needed = dk.height - topThickness;
    if (Math.abs(H - needed) > 1 / 32) {
      errors.push(`Under a ${f(dk.height)} desk with a ${f(topThickness)} top, the units must be ${f(needed)} tall, but they’re ${f(H)}. ${config.frontHeights ? 'Use “Make equal” or change the fronts to fit.' : 'Change the desk height.'}`);
    }
    if (unitCount > 1) for (const p of parts) p.qty *= unitCount;
    parts.push({
      name: 'Desk top', qty: dk.topLayers, length: dk.width, width: dk.depth, thickness: T,
      note: dk.topLayers === 2 ? 'Two layers glued and screwed together' : undefined, material: 'plywood',
    });
  }

  if (errors.length === 0) {
    for (const p of parts) {
      if (!fitsSheet(p.length, p.width)) {
        errors.push(p.name === 'Desk top'
          ? `The ${f(p.length)} × ${f(p.width)} desk top is bigger than a 4 × 8 sheet — use a solid-wood or butcher-block top, or make it smaller.`
          : `${p.name} (${f(p.length)} × ${f(p.width)}) is bigger than a 4 × 8 sheet.`);
      }
    }
  }

  const bandingTotal = banding > 0
    ? (2 * caseHeight + 2 * interiorWidth + n * 2 * frontWidth + fronts.reduce((a, h) => a + 2 * h, 0)) * unitCount
      // The desk top's front and ends (each layer's edge shows).
      + (desk ? (desk.width + 2 * desk.depth) * (config.desk?.topLayers ?? 1) : 0)
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
    partOutlines,
    inserts,
    unitCount,
    desk,
    loads,
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
    const first = solids.length;
    const fr = d.front;
    const hole = handHole(pull);
    solids.push({ name: `${name} front`, kind: 'drawer-front', shape: 'plate', z0: -T, z1: 0,
      outline: notchedOutline(fr.x, fr.y, fr.width, fr.height, frontNotch(pull, fr.width)),
      holes: hole ? [stadiumOutline(fr.x + fr.width / 2, fr.y + fr.height - hole.top, hole.width, hole.height)] : undefined });
    const bx = d.box;
    const x0 = bx.x;
    const x1 = bx.x + bx.width;
    const y0 = bx.y;
    const y1 = bx.y + bx.height;
    const boxNotch = boxNotchSpec(pull, fr.width, d.boxNotchDepth);
    solids.push({ name: `${name} box front`, kind: 'drawer-box', shape: 'plate', z0: 0, z1: b,
      outline: notchedOutline(x0, y0, bx.width, bx.height, boxNotch) });
    solids.push(box(`${name} box back`, 'drawer-box', [x0, y0, bx.depth - b], [x1, y1, bx.depth]));
    solids.push(box(`${name} box left side`, 'drawer-box', [x0, y0, b], [x0 + b, y1, bx.depth - b]));
    solids.push(box(`${name} box right side`, 'drawer-box', [x1 - b, y0, b], [x1, y1, bx.depth - b]));
    const by = y0 + BOTTOM_GROOVE_OFFSET;
    solids.push(box(`${name} box bottom`, 'drawer-box', [x0 + b, by, b], [x1 - b, by + config.bottomThickness, bx.depth - b]));
    const insert = plan.inserts[d.index];
    if (insert && !insert.error) {
      const ix = x0 + b;
      const iy = by + config.bottomThickness;
      const iz = b;
      const it = config.insertThickness ?? 1 / 4;
      const ribPiece = insert.pieces.find(p => p.role === 'rib');
      if (insert.gridfinity) {
        // The baseplate, centred on the floor, as a slab (its pockets are too fine to see at this scale).
        const gf = insert.gridfinity;
        const w = gf.columns * 42 / 25.4;
        const dd = gf.rows * 42 / 25.4;
        const x = ix + gf.marginX / 25.4;
        const z = iz + gf.marginY / 25.4;
        solids.push(box(`${name} Gridfinity baseplate`, 'insert', [x, iy, z], [x + w, iy + 4.65 / 25.4, z + dd]));
      }
      insert.placements.forEach((pl, k) => {
        const label = `${name} ${pl.role === 'rib' ? 'marker rib' : 'divider'} ${k + 1}`;
        if (pl.role === 'rib' && ribPiece) {
          solids.push({ name: label, kind: 'insert', shape: 'plate', z0: iz + pl.z, z1: iz + pl.z + it,
            outline: pieceOutline(ribPiece.length, ribPiece.height, ribPiece.cuts).map(([u, v]) => [ix + pl.x + u, iy + v] as [number, number]) });
        } else if (pl.along === 'z') {
          solids.push(box(label, 'insert', [ix + pl.x, iy, iz + pl.z], [ix + pl.x + it, iy + pl.height, iz + pl.z + pl.length]));
        } else {
          solids.push(box(label, 'insert', [ix + pl.x, iy, iz + pl.z], [ix + pl.x + pl.length, iy + pl.height, iz + pl.z + it]));
        }
      });
    }
    // Everything so far for this drawer slides out together; the slides stay put.
    for (const s of solids.slice(first)) { s.group = name; s.travel = d.box.depth * DRAWER_OPEN_FRACTION; }
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

/**
 * The whole desk: each drawer unit under the top. With `prefix`, every unit's
 * parts are renamed ("Left unit · Drawer 1 front"), so they never clash with a
 * single unit's names in the build guide.
 */
export function deskSolids(plan: DrawerPlan, config: DrawerConfig, prefix = false): Solid[] {
  const unit = drawerSolids(plan, config);
  if (!plan.desk) return unit;
  const dk = plan.desk;
  const out: Solid[] = [];
  dk.unitXs.forEach((dx, i) => {
    const side = dk.unitXs.length === 2 ? (i === 0 ? 'Left unit' : 'Right unit') : 'Unit';
    const rename = (name: string) => (prefix || i > 0 ? `${side} · ${name}` : name);
    for (const unitSolid of unit) {
      const s = unitSolid.group ? { ...unitSolid, group: rename(unitSolid.group) } : unitSolid;
      if (s.shape === 'box') out.push({ ...s, name: rename(s.name), min: [s.min[0] + dx, s.min[1], s.min[2]], max: [s.max[0] + dx, s.max[1], s.max[2]] });
      else if (s.shape === 'prism') out.push({ ...s, name: rename(s.name), x0: s.x0 + dx, x1: s.x1 + dx });
      else out.push({ ...s, name: rename(s.name), outline: s.outline.map(([x, y]) => [x + dx, y] as [number, number]) });
    }
  });
  const H = plan.overallHeight;
  out.push({ name: 'Desk top', kind: 'case', shape: 'box', min: [0, H, plan.caseDepth - dk.depth], max: [dk.width, H + dk.topThickness, plan.caseDepth] });
  return out;
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
        shape: p.shape === 'slot' || p.shape === 'wide' || p.shape === 'handhole' ? p.shape : 'arc',
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
      inserts: Array.isArray(c.inserts)
        ? Array.from({ length: drawers }, (_, i) => readInsert((c.inserts as unknown[])[i]))
        : undefined,
      insertThickness: num(c.insertThickness, 0.05, 1) ?? 1 / 4,
      gridfinityBed: num(c.gridfinityBed, 100, 1000) ?? 256,
      desk: readDesk(c.desk),
      slideLengths: Array.isArray(c.slideLengths)
        ? Array.from({ length: drawers }, (_, i) => {
          const v = (c.slideLengths as unknown[])[i];
          return typeof v === 'number' && SLIDE_LENGTHS.includes(v) ? v : null;
        })
        : undefined,
      load: c.load === 'light' || c.load === 'heavy' ? c.load : 'medium',
      finish: readFinish(c.finish),
    },
  };
}

function readFinish(raw: unknown): DrawerFinish | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const hex = (x: unknown) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : null);
  const front = hex(v.front);
  const body = hex(v.case);
  return front && body ? { front, case: body } : undefined;
}

function readInsert(raw: unknown): DrawerInsert | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const n = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);
  if (v.kind === 'grid') {
    const columns = n(v.columns, 1, 20);
    const rows = n(v.rows, 1, 20);
    return columns && rows ? { kind: 'grid', columns: Math.floor(columns), rows: Math.floor(rows) } : null;
  }
  if (v.kind === 'gridfinity') return { kind: 'gridfinity' };
  if (v.kind === 'markers') {
    const diameter = n(v.diameter, 0.05, 4);
    const length = n(v.length, 0.5, 30);
    return diameter && length ? { kind: 'markers', diameter, length, spacing: n(v.spacing, 0, 2) ?? 1 / 8 } : null;
  }
  return null;
}

function readDesk(raw: unknown): DeskConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const n = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);
  const width = n(v.width, 1, 240);
  const height = n(v.height, 1, 60);
  const depth = n(v.depth, 1, 60);
  if (v.enabled !== true || width === null || height === null || depth === null) return undefined;
  return {
    enabled: true,
    layout: v.layout === 'left' || v.layout === 'right' ? v.layout : 'both',
    width, height, depth,
    topLayers: v.topLayers === 1 ? 1 : 2,
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
  /** Per drawer, top to bottom. */
  insertKinds: InsertKind[];
  gridColumns: number[];
  gridRows: number[];
  insertThickness: string;
  /** One kind of marker per design. */
  markerDiameter: string;
  markerLength: string;
  markerSpacing: string;
  desk: boolean;
  deskLayout: DeskLayout;
  deskWidth: string;
  deskHeight: string;
  deskDepth: string;
  deskTopLayers: 1 | 2;
  /** Per drawer: '' for the unit's slide length, or a length in inches. */
  drawerSlides: string[];
  load: DrawerLoad;
  finishFront: string;
  finishCase: string;
  /** Printer bed in mm, as typed. */
  gridfinityBed: string;
}

export type InsertKind = 'none' | 'grid' | 'markers' | 'gridfinity';

/** Form defaults for the inside-the-drawer and desk fields (inch strings). */
export const EXTRA_FIELD_DEFAULTS = {
  insertThickness: '1/4',
  markerDiameter: '0.63',
  markerLength: '5.91',
  markerSpacing: '1/8',
  deskLayout: 'both' as DeskLayout,
  deskWidth: '60',
  deskHeight: '29',
  deskDepth: '24',
  deskTopLayers: 2 as 1 | 2,
};

export function drawerDesignToFields(saved: SavedDrawerDesign): DrawerDesignFields {
  const { config: c, units } = saved;
  const L = (inches: number) => lengthToField(inches, units);
  const fronts = frontHeightsOf(c);
  const marker = c.inserts?.find((x): x is Extract<DrawerInsert, { kind: 'markers' }> => x?.kind === 'markers');
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
    insertKinds: Array.from({ length: c.drawers }, (_, i) => c.inserts?.[i]?.kind ?? 'none'),
    gridColumns: Array.from({ length: c.drawers }, (_, i) => { const x = c.inserts?.[i]; return x?.kind === 'grid' ? x.columns : 2; }),
    gridRows: Array.from({ length: c.drawers }, (_, i) => { const x = c.inserts?.[i]; return x?.kind === 'grid' ? x.rows : 2; }),
    insertThickness: L(c.insertThickness ?? 1 / 4),
    markerDiameter: marker ? L(marker.diameter) : lengthToField(parseFloat(EXTRA_FIELD_DEFAULTS.markerDiameter), units),
    markerLength: marker ? L(marker.length) : lengthToField(parseFloat(EXTRA_FIELD_DEFAULTS.markerLength), units),
    markerSpacing: marker ? L(marker.spacing) : L(1 / 8),
    desk: c.desk?.enabled === true,
    deskLayout: c.desk?.layout ?? EXTRA_FIELD_DEFAULTS.deskLayout,
    deskWidth: L(c.desk?.width ?? 60),
    deskHeight: L(c.desk?.height ?? 29),
    deskDepth: L(c.desk?.depth ?? 24),
    deskTopLayers: c.desk?.topLayers ?? 2,
    drawerSlides: Array.from({ length: c.drawers }, (_, i) => (c.slideLengths?.[i] != null ? String(c.slideLengths[i]) : '')),
    load: c.load ?? 'medium',
    finishFront: c.finish?.front ?? DEFAULT_FINISH.front,
    finishCase: c.finish?.case ?? DEFAULT_FINISH.case,
    gridfinityBed: String(c.gridfinityBed ?? 256),
  };
}
