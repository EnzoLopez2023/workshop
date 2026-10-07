// Drawer unit generator, after the IKEA ALEX: a plywood case full of side-mount
// slide drawers, each inset (or full-overlay) front with a finger-pull notch cut into its
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
import { hingePositions } from './shelfExport.ts';
import { INSERT_NAMES, INSERT_PLAY, layoutInsert, pieceOutline, type DrawerInsert, type InsertLayout } from './drawerInserts.ts';
import type { GridfinityBin } from './gridfinity.ts';
import { buildRun, readRun, runToFields, RUN_REPLACED, type RunConfig, type RunFields, type RunPlan } from './drawerRun.ts';
import { bookcaseSolids, bookcaseToFields, buildBookcase, readBookcase, type BookcaseConfig, type BookcaseFields, type BookcasePlan } from './drawerBookcase.ts';
import type { ToolPocket } from './drawerInserts.ts';

/**
 * What the case stands on. Plinth: a separate toe-kick box, set back at the front.
 * Kick: the sides run to the floor, notched at the front, with a kick board between them.
 * Flush: a plinth flush with the case, wrapped in baseboard.
 */
export type DrawerBase = 'none' | 'feet' | 'casters' | 'plinth' | 'kick' | 'flush';
/** On the floor (on its base), hung on a French cleat, or hung under an existing desk. */
export type DrawerMount = 'floor' | 'wall' | 'under-desk';
/** Notches cut into the top edge (arc, slot, wide), or a hand hole cut through below it. */
export type PullShape = 'alex' | 'arc' | 'slot' | 'wide' | 'handhole';
export type NotchShape = 'alex' | 'arc' | 'slot';
/** Inset fronts sit inside the case, flush with its front edge (the ALEX look); overlay fronts cover the case edges. */
export type FrontStyle = 'inset' | 'overlay';
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

/** Share of each half of an ALEX notch that curves up to the top edge (the rest is the flat bottom). */
export const ALEX_TAPER = 0.55;
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
  return { 'drawer-front': hex(finish.front), door: hex(finish.front), case: hex(finish.case), back: hex(finish.case) };
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
  /** Total drawers (across every column). */
  drawers: number;
  /** Each front's height, top to bottom (single column). When set, the case height is built from them. */
  frontHeights?: number[];
  /** Gap between neighbouring fronts (half of it shows at the top, bottom and sides). */
  gap: number;
  /** Inset (default, flush with the case like the ALEX) or full overlay. */
  frontStyle?: FrontStyle;
  pull: FingerPull;
  /** Store-bought pulls instead of (or as well as) the cut-out: knobs, bar pulls or cup pulls. */
  hardware?: PullHardware;
  /** Slab fronts, or Shaker: a frame and a recessed panel, pocketed on a CNC or with strips glued on. */
  frontProfile?: FrontProfile;
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
  /** Toe-kick, integrated kick and flush bases: height under the case. */
  kickHeight?: number;
  /** How far the kick board sits back from the case front. */
  kickSetback?: number;
  /** Flush base: baseboard height (unset: just over the plinth joint) and thickness. */
  baseboardHeight?: number;
  baseboardThickness?: number;
  /** Ends that show (not against a wall or another cabinet): the plinth sets back and the baseboard wraps there. */
  exposedSides?: ExposedSides;
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
  /**
   * Two or more stacks of drawers side by side, with partitions between them. Drawers
   * are numbered column by column (left to right, top to bottom) in every per-drawer list.
   */
  columns?: DrawerColumn[];
  /** One or two units under a plywood desk top. */
  desk?: DeskConfig;
  mount?: DrawerMount;
  /** Wall: the unit's bottom above the floor. Under a desk: the desk's underside above the floor. */
  mountHeight?: number;
  /** Height of each French cleat (wall-hung). */
  cleatHeight?: number;
  /** Per drawer: true for an open cubby (no drawer); its floor is a fixed shelf unless it's at the bottom. */
  openSlots?: boolean[];
  /** Per drawer position: a door over that opening instead of a drawer (null: not a door). */
  doors?: (DoorSlot | null)[];
  /** Per-drawer slide length overrides (null: the unit's slide length), e.g. a short pencil drawer. */
  slideLengths?: (number | null)[];
  /** Expected contents, for the load check. */
  load?: DrawerLoad;
  /** Finish colours for the 3D view. */
  finish?: DrawerFinish;
  /** A bookcase on top (a single floor-standing unit only). */
  bookcase?: BookcaseConfig;
  /** A wall of built-ins: copies of this cabinet, desk gaps and fillers under one countertop. */
  run?: RunConfig;
}

export type HardwareKind = 'none' | 'knob' | 'bar' | 'cup';
export interface PullHardware {
  kind: HardwareKind;
  /** Hole centres for bar and cup pulls (e.g. 3", 3 3/4" = 96 mm, 128 mm). */
  spacing: number;
}
export interface FrontProfile {
  style: 'slab' | 'shaker';
  method: 'pocket' | 'applied';
  /** Frame width (stiles and rails); narrow fronts get narrower ones. */
  rail: number;
  /** Pocket depth, or the applied strips' thickness. */
  depth: number;
}
export const DEFAULT_PROFILE: FrontProfile = { style: 'slab', method: 'pocket', rail: 2.25, depth: 1 / 4 };
/** Pull screws go through a 3/16" hole (8-32 machine screws). */
export const PULL_HOLE = 3 / 16;

/** The Shaker frame width for a front this size: the asked width, but always leaving a panel at least 1 1/2" across. */
export function shakerRail(profile: FrontProfile | undefined, width: number, height: number): number {
  if (!profile || profile.style !== 'shaker') return 0;
  const r = Math.min(profile.rail, (Math.min(width, height) - 1.5) / 2);
  return r >= 3 / 4 ? Math.floor(r * 16) / 16 : 0;
}

/**
 * Where a front's pull holes go, in front coordinates (x from the left edge, y up from
 * the bottom). Drawers: centred across (two pulls on fronts over 30"), in the middle of
 * short fronts and 3" from the top of tall ones (the top rail's centre on Shaker fronts).
 * Doors: a vertical pull near the opening edge, its top 3" from the door's top.
 */
export function pullHoles(hw: PullHardware | undefined, w: number, h: number, door: { hinge: 'left' | 'right' } | null, rail = 0): { holes: [number, number][]; pulls: { x: number; y: number; vertical: boolean }[] } {
  if (!hw || hw.kind === 'none') return { holes: [], pulls: [] };
  const two = hw.kind !== 'knob';
  const half = hw.spacing / 2;
  if (door) {
    const x = door.hinge === 'left' ? w - (rail ? rail / 2 : 2) : (rail ? rail / 2 : 2);
    const yc = h - 3 - (two ? half : 0);
    return { holes: two ? [[x, yc + half], [x, yc - half]] : [[x, yc]], pulls: [{ x, y: yc, vertical: two }] };
  }
  const y = rail && h > 9 ? h - rail / 2 : h <= 9 ? h / 2 : h - 3;
  const xs = w > 30 ? [w / 4, (3 * w) / 4] : [w / 2];
  return {
    holes: xs.flatMap(x => (two ? [[x - half, y], [x + half, y]] as [number, number][] : [[x, y]] as [number, number][])),
    pulls: xs.map(x => ({ x, y, vertical: false })),
  };
}

/** Which side a door hinges on; 'auto' hinges on the outside, and pairs doors over wide openings. */
export type DoorHinge = 'auto' | 'left' | 'right' | 'pair';
export type DoorInside = 'empty' | 'shelves' | 'trays';

export interface DoorSlot {
  hinge: DoorHinge;
  /** Behind the door: nothing, adjustable shelves on pins, or pull-out trays on slides. */
  inside: DoorInside;
  /** How many shelves or trays. */
  count: number;
}

/** Doors wider than this are split into a pair. */
export const PAIR_DOOR_WIDTH = 24;
/** Pull-out trays: box height, and the spacer panels that carry them clear of the hinges. */
export const TRAY_HEIGHT = 3;
/** Shelf-pin holes: diameter, depth, spacing, and their columns' inset from the front and back of the opening. */
export const PIN_HOLE = 1 / 4;
export const PIN_DEPTH = 3 / 8;
export const PIN_SPACING = 1;
export const PIN_INSET = 1.5;
/** Concealed-hinge mounting plates sit this far back from the front edge of the cabinet side (37 mm system). */
export const HINGE_PLATE_SETBACK = 37 / 25.4;

export interface DoorLeaf {
  x: number;
  width: number;
  /** Which edge the hinges are on. */
  hinge: 'left' | 'right';
  /** Overlay hinge on a partition (half overlay), on a case side (full overlay), or inset. */
  hingeType: 'inset' | 'full overlay' | 'half overlay';
}

export interface TrayLayout {
  /** Box bottom, height, left edge and width (outside), depth (slide length). */
  y: number;
  height: number;
  x: number;
  width: number;
  depth: number;
  slideY: number;
}

export interface DoorPlan {
  leaves: DoorLeaf[];
  /** Hinge-cup centres up from each leaf's bottom edge. */
  hinges: number[];
  inside: DoorInside;
  /** The clear space behind the door, floor to ceiling. */
  zoneBottom: number;
  zoneTop: number;
  /** Adjustable shelves: bottom faces, from the floor. */
  shelfYs: number[];
  /** Shelf-pin hole centres, from the floor (both sides of the opening). */
  pinYs: number[];
  trays: TrayLayout[];
}

export interface ExposedSides {
  left: boolean;
  right: boolean;
}

export const KICK_HEIGHT = 4;
export const KICK_SETBACK = 3;
export const BASEBOARD_THICKNESS = 1 / 2;
/** Plinth stretchers go in so no gap between them is wider than this. */
export const PLINTH_STRETCHER_SPACING = 24;

/** Bases built of plywood under the case (no hardware). */
export const isKickBase = (base: DrawerBase) => base === 'plinth' || base === 'kick' || base === 'flush';

export const BASE_LABELS: Record<DrawerBase, string> = {
  none: 'On the floor',
  feet: 'Leveling feet',
  casters: 'Casters',
  plinth: 'Toe kick (separate plinth)',
  kick: 'Toe kick (integrated)',
  flush: 'Flush base with baseboard',
};

/** "on 4 leveling feet", "on a toe-kick plinth"… for summaries. */
export function baseDescription(config: Pick<DrawerConfig, 'base'>, plan: Pick<DrawerPlan, 'supports' | 'mount'>): string {
  if (plan.mount === 'wall') return 'hung on a French cleat';
  if (plan.mount === 'under-desk') return 'hung under a desk';
  switch (config.base) {
    case 'feet': return `on ${plan.supports} leveling feet`;
    case 'casters': return `on ${plan.supports} casters`;
    case 'plinth': return 'on a toe-kick plinth';
    case 'kick': return 'with an integrated toe kick';
    case 'flush': return 'on a flush base with baseboard';
    default: return 'standing on the floor';
  }
}

export interface BasePlan {
  kind: 'plinth' | 'kick' | 'flush';
  height: number;
  /** Kick board set back from the case front (0 for a flush base). */
  setback: number;
  /** Plinth: its ends' setback from each case side. */
  sideSetbacks: [number, number];
  /** Plinth: left x of each end and stretcher, left to right. */
  plinthXs: number[];
  baseboard: { height: number; thickness: number; faces: ('front' | 'left' | 'right')[] } | null;
  /** Floor footprint including baseboard. */
  footprint: { width: number; depth: number };
}

export interface DrawerColumn {
  drawers: number;
  /** Each front's height, top to bottom. Column 1's sets the case height; the others must match it. */
  frontHeights?: number[];
  /** Clear opening between the sides/partitions; columns without one share what's left equally. */
  width?: number;
}

export interface ColumnLayout {
  index: number;
  /** Left edge of the opening (inside face of the side or partition). */
  x: number;
  width: number;
  /** Global indexes of its drawers, top to bottom. */
  drawers: number[];
}

export const MAX_COLUMNS = 4;

/** The columns, or the single column a plain config describes. */
export function columnsOf(c: Pick<DrawerConfig, 'columns' | 'drawers' | 'frontHeights'>): DrawerColumn[] {
  return c.columns && c.columns.length > 1 ? c.columns : [{ drawers: c.drawers, frontHeights: c.frontHeights }];
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
export const BOTTOM_PLAY = 1 / 16;
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
  /** Position in every per-drawer list (column by column). */
  index: number;
  column: number;
  /** "Drawer 3", or "Column 2 drawer 3" when there are columns — used in names and messages. */
  label: string;
  /** An open cubby instead of a drawer: no front, box or slides. */
  open: boolean;
  /** For a cubby above another drawer or cubby: the fixed shelf's underside, from the floor (null at the bottom). */
  shelfY: number | null;
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
  /** A door over the opening (the slot is then `open`: no drawer box or slides). */
  door: DoorPlan | null;
}

export interface DrawerPlan {
  /** How far the boxes and slides start behind the case front (the fronts' thickness when inset). */
  frontInset: number;
  mount: DrawerMount;
  /** How far the unit's bottom sits above the floor in the 3D view (hung units). */
  lift: number;
  /** Space behind the back for a French cleat (0 unless wall-hung). */
  cleatGap: number;
  columns: ColumnLayout[];
  /** Left face of each partition between columns. */
  partitionXs: number[];
  overallWidth: number;
  overallHeight: number;
  overallDepth: number;
  /** Case without the fronts. */
  caseDepth: number;
  caseHeight: number;
  /** Feet, caster or toe-kick height under the case. */
  baseHeight: number;
  /** Where the case sides' bottom edges are (the floor for an integrated toe kick). Slide marks measure from here. */
  sideBottom: number;
  /** Toe-kick, integrated kick and flush bases. */
  base: BasePlan | null;
  /** The bookcase on top, with its countertop and trim. */
  bookcase: BookcasePlan | null;
  /** Floor to the highest point: the cabinet, desk top, or bookcase. */
  totalHeight: number;
  /** A wall run of copies of this cabinet. */
  run: RunPlan | null;
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
  if (pull.shape === 'alex') {
    // The ALEX scoop: a flat bottom across the middle and smooth S-curves at each end,
    // tangent to the top edge — a raised-cosine fall over the outer ALEX_TAPER of each half.
    const flat = 1 - ALEX_TAPER;
    const steps = Math.max(segments * 2, 48);
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const x = -w / 2 + (w * i) / steps;
      const t = Math.abs(x) / (w / 2);
      const fall = t <= flat ? 1 : 0.5 * (1 + Math.cos(Math.PI * (t - flat) / ALEX_TAPER));
      pts.push([x, -d * fall]);
    }
    return pts;
  }
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
  /** Where along the top edge the notch is centred (default: the middle). */
  centerX?: number,
): [number, number][] {
  const x1 = x0 + width;
  const y1 = y0 + height;
  if (!pull || pull.depth <= 0 || pull.width <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cx = centerX ?? x0 + width / 2;
  const notch = pullProfile(pull).map(([dx, dy]) => [cx + dx, y1 + dy] as [number, number]).reverse();
  return [[x0, y0], [x1, y0], [x1, y1], ...notch, [x0, y1]];
}

/** A solid moved up by `dy` (a hung unit sits above the floor). */
function liftSolid(s: Solid, dy: number): Solid {
  if (s.shape === 'box') return { ...s, min: [s.min[0], s.min[1] + dy, s.min[2]], max: [s.max[0], s.max[1] + dy, s.max[2]] };
  if (s.shape === 'prism') return { ...s, profile: s.profile.map(([z, y]) => [z, y + dy] as [number, number]) };
  return {
    ...s,
    outline: s.outline.map(([x, y]) => [x, y + dy] as [number, number]),
    holes: s.holes?.map(h => h.map(([x, y]) => [x, y + dy] as [number, number])),
  };
}

/** The positions that hold a drawer (not an open cubby). */
export function boxedDrawers(plan: Pick<DrawerPlan, 'drawers'>): DrawerLayout[] {
  return plan.drawers.filter(d => !d.open);
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

/** A door over one opening: its leaves and hinges, and the shelves or trays behind it. */
function layoutDoor(slot: DoorSlot, c: {
  front: { x: number; y: number; width: number; height: number };
  column: number; columns: number; inset: boolean; gap: number; T: number; slideLength: number;
  opening: { x: number; width: number };
  zoneBottom: number; zoneTop: number;
  name: string; f: (inches: number) => string; errors: string[]; warnings: string[];
}): DoorPlan {
  const { front, f } = c;
  const pair = slot.hinge === 'pair' || (slot.hinge === 'auto' && front.width > PAIR_DOOR_WIDTH);
  // A single door hinges on the outside: the left in the left column, otherwise the right.
  const single: 'left' | 'right' = slot.hinge === 'left' || slot.hinge === 'right' ? slot.hinge : c.column === 0 && c.columns > 1 ? 'left' : c.column === c.columns - 1 && c.columns > 1 ? 'right' : 'left';
  const type = (side: 'left' | 'right'): DoorLeaf['hingeType'] => {
    if (c.inset) return 'inset';
    const outside = side === 'left' ? c.column === 0 : c.column === c.columns - 1;
    return outside ? 'full overlay' : 'half overlay';
  };
  const half = (front.width - c.gap) / 2;
  const leaves: DoorLeaf[] = pair
    ? [{ x: front.x, width: half, hinge: 'left', hingeType: type('left') }, { x: front.x + half + c.gap, width: half, hinge: 'right', hingeType: type('right') }]
    : [{ x: front.x, width: front.width, hinge: single, hingeType: type(single) }];
  if (leaves.some(l => l.width > 30)) c.warnings.push(`${c.name}’s door${pair ? 's are' : ' is'} ${f(Math.max(...leaves.map(l => l.width)))} wide — wide doors sag on concealed hinges. Make it a pair or narrow the column.`);
  if (front.height > 60) c.warnings.push(`${c.name} is ${f(front.height)} tall; doors that tall can warp — consider two doors stacked.`);

  // Shelves on pins, spread evenly through the space behind the door.
  const zoneH = c.zoneTop - c.zoneBottom;
  const count = Math.max(0, Math.floor(slot.count));
  const shelfYs = slot.inside === 'shelves'
    ? Array.from({ length: count }, (_, k) => Math.round((c.zoneBottom + zoneH * (k + 1) / (count + 1) - c.T / 2) * 16) / 16)
    : [];
  const pinYs: number[] = [];
  if (shelfYs.length) for (let y = c.zoneBottom + 2; y <= c.zoneTop - 2 + EPS; y += PIN_SPACING) pinYs.push(Math.round(y * 32) / 32);
  if (slot.inside === 'shelves' && count > 0 && zoneH / (count + 1) < 3) c.errors.push(`${c.name}: ${count} shelves leave less than ${f(3)} between them — use fewer.`);

  // Pull-out trays: shallow boxes on slides, screwed to spacer panels that carry them past the hinges.
  const trays: TrayLayout[] = [];
  if (slot.inside === 'trays' && count > 0) {
    const pitch = zoneH / count;
    const height = Math.min(TRAY_HEIGHT, floor16(pitch - 1));
    const width = c.opening.width - 2 * c.T - 2 * SLIDE_CLEARANCE;
    if (height < MIN_BOX_HEIGHT) c.errors.push(`${c.name}: ${count} pull-out trays need at least ${f((MIN_BOX_HEIGHT + 1) * count)} behind the door; there’s ${f(zoneH)}. Use fewer trays.`);
    if (width < MIN_BOX_WIDTH) c.errors.push(`${c.name}: the opening is too narrow for pull-out trays once the spacer panels (${f(c.T)} each side) and slides go in.`);
    for (let k = 0; k < count; k++) {
      const y = c.zoneBottom + k * pitch + 1 / 2;
      const slideOffset = Math.max(Math.round((Math.min(height / 2, 2) - SLIDE_HEIGHT / 2) * 16) / 16, 1 / 8);
      trays.push({ y, height, x: c.opening.x + c.T + SLIDE_CLEARANCE, width, depth: c.slideLength, slideY: y + slideOffset });
    }
  }
  return { leaves, hinges: hingePositions(front.height), inside: slot.inside, zoneBottom: c.zoneBottom, zoneTop: c.zoneTop, shelfYs, pinYs, trays };
}

/** Height under the case. */
export function baseHeightOf(c: Pick<DrawerConfig, 'base' | 'footHeight' | 'casterHeight' | 'kickHeight'> & { mount?: DrawerMount }): number {
  if (c.mount && c.mount !== 'floor') return 0;
  if (isKickBase(c.base)) return c.kickHeight ?? KICK_HEIGHT;
  return c.base === 'feet' ? c.footHeight : c.base === 'casters' ? c.casterHeight : 0;
}

/** The parts cut from plywood sheets (solid-wood trim like baseboard is bought by length). */
export function sheetParts(parts: ShelfPart[]): ShelfPart[] {
  return parts.filter(p => p.material !== 'solid');
}

/** Overall height built from front heights: the fronts, a gap per front, and the base. */
/** Height the fronts don't cover: inset fronts sit between the top and bottom panels. */
export function frontAllowance(c: Pick<DrawerConfig, 'frontStyle' | 'thickness'>): number {
  return c.frontStyle === 'overlay' ? 0 : 2 * c.thickness;
}

export function overallFromFronts(frontHeights: number[], c: Pick<DrawerConfig, 'gap' | 'base' | 'footHeight' | 'casterHeight' | 'kickHeight' | 'frontStyle' | 'thickness'> & { mount?: DrawerMount }): number {
  return frontHeights.reduce((a, b) => a + b, 0) + frontHeights.length * c.gap + frontAllowance(c) + baseHeightOf(c);
}

/** Front heights for the current config, top to bottom. */
export function frontHeightsOf(c: DrawerConfig): number[] {
  if (c.frontHeights && c.frontHeights.length === c.drawers) return c.frontHeights;
  const caseHeight = c.height - baseHeightOf(c);
  return equalFronts(c.drawers, caseHeight - frontAllowance(c) - c.drawers * c.gap);
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
  const gap = config.gap;
  const B = baseHeightOf(config);
  const cols = columnsOf(config);
  const k = cols.length;
  const n = cols.reduce((a, c) => a + c.drawers, 0);
  const own = (c: DrawerColumn) => (c.frontHeights && c.frontHeights.length === c.drawers ? c.frontHeights : null);
  const firstFronts = own(cols[0]);
  const inset = config.frontStyle !== 'overlay';
  const edge = frontAllowance(config);
  const caseHeight = firstFronts ? firstFronts.reduce((a, s) => a + s, 0) + cols[0].drawers * gap + edge : config.height - B;
  const columnFronts = cols.map(c => own(c) ?? equalFronts(c.drawers, caseHeight - edge - c.drawers * gap));
  const H = caseHeight + B;
  // Inset fronts sit inside the case, so it runs the full depth and the boxes start behind the fronts.
  const caseDepth = inset ? D : D - T;
  const frontInset = inset ? T : 0;
  const interiorWidth = W - 2 * T;
  const mount: DrawerMount = config.mount ?? 'floor';
  // An integrated toe kick runs the sides down to the floor; everything else stands the case on its base.
  const baseKind = mount === 'floor' && isKickBase(config.base) ? config.base as BasePlan['kind'] : null;
  const sideBottom = baseKind === 'kick' ? 0 : B;
  // A wall-hung unit's back moves forward by the cleat's thickness; the sides hide the cleat.
  const cleatGap = mount === 'wall' ? T : 0;
  const interiorDepth = caseDepth - cleatGap - backT;
  const banding = config.edgeBanding ? (config.bandingThickness ?? 0.02) : 0;

  // Column openings: given widths first, the rest share what's left; partitions are case stock.
  const openingTotal = interiorWidth - (k - 1) * T;
  const given = cols.map(c => (k > 1 && c.width && c.width > 0 ? c.width : null));
  const free = given.filter(w => w === null).length;
  const fixed = given.reduce<number>((a, w) => a + (w ?? 0), 0);
  const share = free ? (openingTotal - fixed) / free : 0;
  const openings = given.map(w => w ?? share);
  if (k > 1 && free === 0 && Math.abs(fixed - openingTotal) > 1 / 32) {
    errors.push(`The column widths add up to ${f(fixed)}, but there’s ${f(openingTotal)} between the sides once the ${k - 1} partition${k > 2 ? 's' : ''} (${f(T)} each) are in. Leave one column to take up the rest.`);
  }
  const columns: ColumnLayout[] = [];
  const partitionXs: number[] = [];
  {
    let x = T;
    let index = 0;
    cols.forEach((c, ci) => {
      columns.push({ index: ci, x, width: openings[ci], drawers: Array.from({ length: c.drawers }, () => index++) });
      x += openings[ci];
      if (ci < k - 1) { partitionXs.push(x); x += T; }
    });
  }
  // Fronts meet on each partition's centre line; the outer ones reach the case sides.
  const bounds = [0, ...partitionXs.map(x => x + T / 2), W];
  const label = (ci: number, i: number) => (k > 1 ? `Column ${ci + 1} drawer ${i + 1}` : `Drawer ${i + 1}`);
  const boxWidths = openings.map(w => w - 2 * SLIDE_CLEARANCE);
  const boxWidth = Math.min(...boxWidths);

  // Material.
  if (!(T > 0) || T > 1.5) errors.push(`Case plywood ${f(T)} isn’t usable — enter a thickness between ${f(1 / 4)} and ${f(1.5)}.`);
  if (!(b > 0) || b > 1) errors.push(`Drawer-box plywood ${f(b)} isn’t usable — ${f(1 / 2)} is typical.`);
  if (!(bt > 0)) errors.push('Enter a drawer-bottom thickness, e.g. 1/4".');
  else if (b > 0 && BOTTOM_GROOVE_DEPTH >= b - 0.125) {
    errors.push(`The ${f(BOTTOM_GROOVE_DEPTH)} bottom groove would leave less than ${f(1 / 8)} of the ${f(b)} box sides. Use box plywood at least ${f(BOTTOM_GROOVE_DEPTH + 1 / 4)} thick.`);
  }
  if (!(backT > 0) || backT >= T) errors.push(`The back (${f(backT)}) must be thinner than the case plywood (${f(T)}) — it sits in a rabbet in the sides.`);
  if (k > MAX_COLUMNS) errors.push(`Choose up to ${MAX_COLUMNS} columns.`);
  cols.forEach((c, ci) => {
    if (!Number.isInteger(c.drawers) || c.drawers < 1 || c.drawers > 12) errors.push(`${k > 1 ? `Column ${ci + 1}: c` : 'C'}hoose between 1 and 12 drawers.`);
  });
  if (gap < 0 || gap > 0.5) errors.push(`A ${f(gap)} gap between fronts is outside ${f(0)}–${f(1 / 2)}; ${f(1 / 8)} is typical.`);

  // Width.
  if (k === 1 && boxWidth < MIN_BOX_WIDTH) {
    const minWidth = MIN_BOX_WIDTH + 2 * SLIDE_CLEARANCE + 2 * T;
    errors.push(`At ${f(W)} wide the drawer boxes would be only ${f(Math.max(boxWidth, 0))} wide after the two sides (${f(T)} each) and ${f(SLIDE_CLEARANCE)} per side for the slides. Make the unit at least ${f(minWidth)} wide.`);
  } else if (k > 1) {
    boxWidths.forEach((w, ci) => {
      if (w < MIN_BOX_WIDTH) {
        errors.push(`Column ${ci + 1}’s opening is ${f(Math.max(openings[ci], 0))}, so its drawers would be only ${f(Math.max(w, 0))} wide after ${f(SLIDE_CLEARANCE)} per side for the slides — at least ${f(MIN_BOX_WIDTH + 2 * SLIDE_CLEARANCE)} is needed. Make the unit wider, use fewer columns, or narrow the other columns.`);
      }
    });
  }
  const tooWide = boxWidths.map((w, ci) => (w > WIDE_DRAWER ? ci : -1)).filter(ci => ci >= 0);
  if (tooWide.length) {
    warnings.push(`${k > 1 ? `Column ${tooWide.map(c => c + 1).join(' and ')}’s drawers are` : 'The drawers are'} ${f(Math.max(...boxWidths))} wide. Past about ${f(WIDE_DRAWER)} a drawer pulled from one side twists and binds — ${k > 1 ? 'add a column' : 'consider two columns'}.`);
  }

  // Depth and slides.
  const auto = autoSlideLength(interiorDepth - frontInset);
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
  if (k === 1 && config.frontHeights && config.frontHeights.length !== n) {
    errors.push(`There are ${n} drawers but ${config.frontHeights.length} front heights.`);
  }
  if (caseHeight <= 2 * T) errors.push(`At ${f(H)} overall there’s no room for drawers once the base (${f(B)}) and the top and bottom are taken out.`);
  cols.forEach((c, ci) => {
    const fixedFronts = own(c);
    if (ci > 0 && fixedFronts) {
      const total = fixedFronts.reduce((a, s) => a + s, 0) + c.drawers * gap + edge;
      if (Math.abs(total - caseHeight) > 1 / 32) {
        errors.push(`Column ${ci + 1}’s fronts and gaps add up to ${f(total)}, but column 1 makes the case ${f(caseHeight)} tall. Use “Make equal” on column ${ci + 1}, or change its fronts by ${f(Math.abs(caseHeight - total))}.`);
      }
    }
    columnFronts[ci].forEach((h, i) => {
      if (!(h > 0)) errors.push(`${label(ci, i)}’s front would be ${f(h)} tall — make the unit taller or use fewer drawers.`);
    });
  });
  if (B < 0) errors.push('The foot or caster height can’t be negative.');

  const drawers: DrawerLayout[] = [];
  const interiorBottom = B + T;
  const interiorTop = H - T;
  const pull = config.pull.enabled ? config.pull : null;
  const frontWidths = cols.map((_, ci) => (inset ? openings[ci] : bounds[ci + 1] - bounds[ci]) - gap);
  const frontWidth = Math.min(...frontWidths);
  const reach = pullReach(pull, frontWidth);
  const pullName = pull?.shape === 'handhole' ? 'hand hole' : 'finger pull';
  // Per-drawer slide lengths: a shorter one for a shallow drawer, for example.
  const slideFor = (i: number) => {
    const own = config.slideLengths?.[i];
    if (own == null) return slideLength;
    if (!SLIDE_LENGTHS.includes(own)) errors.push(`${labelOf(i)}: ${f(own)} isn’t a slide length LONTAN sells.`);
    else if (auto !== null && own > auto + EPS) errors.push(`${labelOf(i)}: ${f(own)} slides don’t fit — the longest is ${f(auto)}.`);
    return own;
  };
  const labelOf = (index: number) => {
    const ci = columns.findIndex(c => c.drawers.includes(index));
    return label(Math.max(ci, 0), Math.max(columns[Math.max(ci, 0)].drawers.indexOf(index), 0));
  };
  cols.forEach((_, ci) => {
  let top = (inset ? H - T : H) - gap / 2;
  columnFronts[ci].forEach((h, row) => {
    const i = columns[ci].drawers[row];
    const doorSlot = config.doors?.[i] ?? null;
    const open = config.openSlots?.[i] === true || doorSlot !== null;
    const name = doorSlot ? (k > 1 ? `Column ${ci + 1} door ${row + 1}` : `Door ${row + 1}`)
      : open ? (k > 1 ? `Column ${ci + 1} cubby ${row + 1}` : `Cubby ${row + 1}`) : label(ci, row);
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
      column: ci,
      label: name,
      front: { x: (inset ? columns[ci].x : bounds[ci]) + gap / 2, y, width: frontWidths[ci], height: h },
      box: { x: columns[ci].x + SLIDE_CLEARANCE, y: boxY, width: boxWidths[ci], height: boxHeight, depth: slideFor(i) },
      slideY,
      slideMark: slideY - sideBottom,
      boxNotchDepth: open ? 0 : boxNotchDepth,
      open,
      // A cubby needs a floor unless the case bottom is right under it.
      shelfY: open && zoneBottom > interiorBottom + EPS ? zoneBottom : null,
      door: doorSlot ? layoutDoor(doorSlot, {
        front: { x: (inset ? columns[ci].x : bounds[ci]) + gap / 2, y, width: frontWidths[ci], height: h },
        column: ci, columns: k, inset, gap, T, slideLength,
        opening: { x: columns[ci].x, width: openings[ci] },
        zoneBottom: zoneBottom > interiorBottom + EPS ? zoneBottom + T : zoneBottom, zoneTop,
        name, f, errors, warnings,
      }) : null,
    });
    if (open) {
      if (zoneTop - zoneBottom - (zoneBottom > interiorBottom + EPS ? T : 0) < 1) errors.push(`${name} is only ${f(Math.max(zoneTop - zoneBottom, 0))} tall — too small to be useful.`);
      return;
    }
    if (h > 0 && boxHeight < MIN_BOX_HEIGHT) {
      const need = h + (MIN_BOX_HEIGHT - boxHeight);
      errors.push(`${name}’s front is ${f(h)} tall, which leaves a ${f(Math.max(boxHeight, 0))} box — the slides need at least ${f(MIN_BOX_HEIGHT)}. Make that front about ${f(Math.ceil(need * 16) / 16)} tall, or use fewer drawers.`);
    }
    if (pull) {
      if (reach >= h - 1) {
        errors.push(`The ${pullName} reaches ${f(reach)} down, too far for ${name.toLowerCase()}’s ${f(h)} front — keep at least ${f(1)} of front below it.`);
      } else if (boxNotchDepth > boxHeight - (BOTTOM_GROOVE_OFFSET + bt + 1 / 4)) {
        errors.push(`${name}’s box is only ${f(boxHeight)} tall, so the ${pullName} would have to notch its box front down to the bottom. Make the pull shallower or that front taller.`);
      }
    }
  });
  });
  // Column by column is how every per-drawer list is ordered.
  drawers.sort((a, b2) => a.index - b2.index);
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
  const supports = mount !== 'floor' || (config.base !== 'feet' && config.base !== 'casters') ? 0 : W > MIDDLE_SUPPORT_WIDTH ? 6 : 4;
  // Hung units: where they sit above the floor (for the 3D view), and their own checks.
  let lift = 0;
  const cleatHeight = config.cleatHeight ?? 3;
  if (mount === 'wall') {
    lift = config.mountHeight ?? 30;
    if (cleatHeight < 1.5 || cleatHeight > caseHeight / 3) errors.push(`A ${f(cleatHeight)} cleat doesn’t suit a ${f(caseHeight)} tall case — use ${f(2)}–${f(Math.max(2, Math.floor(caseHeight / 3)))}.`);
    if (config.desk?.enabled) errors.push('A desk top needs floor-standing units — turn off the desk or stand the unit on the floor.');
  } else if (mount === 'under-desk') {
    const underside = config.mountHeight ?? 27.5;
    lift = underside - H;
    if (lift < 4) errors.push(`Hung under a desk whose underside is ${f(underside)} up, a ${f(H)} tall unit would leave ${f(Math.max(lift, 0))} above the floor. Keep it at least ${f(4)} clear — make it shorter.`);
    else if (lift < 18 && W > 20) warnings.push(`It hangs only ${f(lift)} above the floor — check it clears your knees.`);
    if (config.desk?.enabled) errors.push('Use either the desk top or hang the unit under an existing desk, not both.');
  }
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

  // Toe-kick bases: a plinth under the case, or the sides run down with a kick board.
  let basePlan: BasePlan | null = null;
  const partOutlines: Record<string, [number, number][]> = {};
  if (baseKind) {
    const exposed = config.exposedSides ?? { left: true, right: true };
    const setback = baseKind === 'flush' ? 0 : config.kickSetback ?? KICK_SETBACK;
    const sideSetbacks: [number, number] = baseKind === 'plinth' ? [exposed.left ? setback : 0, exposed.right ? setback : 0] : [0, 0];
    if (B < 1 || B > 12) errors.push(`A ${f(B)} toe kick is outside ${f(1)}–${f(12)}; ${f(4)} is typical.`);
    else if (B < 2.5 || B > 6) warnings.push(`Toe kicks are usually ${f(3)}–${f(4.5)} tall; ${f(B)} works, but check it suits the room.`);
    if (setback < 0 || setback > caseDepth / 3) errors.push(`A ${f(setback)} setback is outside ${f(0)}–${f(caseDepth / 3)} for a ${f(caseDepth)} deep case.`);
    // Plinth ends and stretchers, evenly spread so no gap between them is wider than the spacing.
    const plinthXs: number[] = [];
    if (baseKind !== 'kick') {
      const x0 = sideSetbacks[0];
      const x1 = W - sideSetbacks[1] - T;
      const between = Math.max(0, Math.ceil((x1 - x0 - T) / PLINTH_STRETCHER_SPACING) - 1);
      for (let i = 0; i <= between + 1; i++) plinthXs.push(x0 + (x1 - x0) * i / (between + 1));
    }
    let baseboard: BasePlan['baseboard'] = null;
    if (baseKind === 'flush') {
      const thickness = config.baseboardThickness ?? BASEBOARD_THICKNESS;
      // It may lap up over the case, but never over a front, or the drawer couldn't open past it.
      const fronted = drawers.filter(d => !d.open);
      const cover = fronted.length ? Math.min(...fronted.map(d => d.front.y)) : B + T;
      const height = config.baseboardHeight ?? B + Math.max(0, Math.min(1 / 2, cover - B - 1 / 16));
      if (height < B - EPS) errors.push(`The ${f(height)} baseboard is shorter than the ${f(B)} base it covers — make it at least ${f(B)}.`);
      else if (height > cover + EPS) errors.push(`A ${f(height)} baseboard would cover the bottom of the lowest drawer front (${f(cover)} up), and the drawer couldn’t open past it. Make it ${f(cover)} or less.`);
      else if (height < B + 1 / 4 && cover > B + 1 / 4) warnings.push(`Lap the baseboard at least ${f(1 / 4)} over the case (make it ${f(Math.min(B + 1 / 2, cover))}) so the joint above the plinth is hidden.`);
      if (thickness < 1 / 4 || thickness > 1.5) errors.push(`A ${f(thickness)} baseboard is outside ${f(1 / 4)}–${f(1.5)}; ${f(1 / 2)} is typical.`);
      baseboard = { height, thickness, faces: ['front', ...(exposed.left ? ['left' as const] : []), ...(exposed.right ? ['right' as const] : [])] };
    }
    const wrap = baseboard ? baseboard.thickness : 0;
    basePlan = {
      kind: baseKind, height: B, setback, sideSetbacks, plinthXs, baseboard,
      footprint: {
        width: W + (baseboard?.faces.includes('left') ? wrap : 0) + (baseboard?.faces.includes('right') ? wrap : 0),
        depth: Math.max(D, caseDepth + wrap),
      },
    };
  }

  // Parts.
  const parts: ShelfPart[] = [];
  const caseBanding = banding;
  const sideHeight = caseHeight;
  const panelLength = interiorWidth;
  const sideLength = sideHeight + B - sideBottom;
  parts.push({ name: 'Side', qty: 2, length: sideLength, width: caseDepth - caseBanding, thickness: T,
    note: [cleatGap > 0
      ? `${f(backT)} × ${f(T / 2)} groove for the back, ${f(cleatGap)} in from the back edge (room for the cleat)`
      : `${f(backT)} × ${f(T / 2)} rabbet on the back inside edge for the back`,
    ...(baseKind === 'kick' ? [`${f(basePlan!.setback)} × ${f(B)} toe-kick notch at the front of the bottom end`] : [])].join('; '), material: 'plywood' });
  if (baseKind === 'kick') {
    // u = up from the bottom end, v = back from the front edge.
    const sv = basePlan!.setback - caseBanding;
    const Wd = caseDepth - caseBanding;
    partOutlines.Side = [[0, sv], [0, Wd], [sideLength, Wd], [sideLength, 0], [B, 0], [B, sv]];
  }
  parts.push({ name: 'Top', qty: 1, length: panelLength, width: interiorDepth - caseBanding, thickness: T, material: 'plywood' });
  parts.push({ name: 'Bottom', qty: 1, length: panelLength, width: interiorDepth - caseBanding, thickness: T,
    note: supports > 0 && config.base === 'feet' ? `${supports} T-nuts for the leveling feet`
      : supports > 0 && config.base === 'casters' ? `${supports} casters screw on`
        : baseKind === 'kick' ? `Between the sides, ${f(B)} up; the kick board and nailer go under it`
          : baseKind ? 'Sits on the plinth; screw down through it into the plinth' : undefined,
    material: 'plywood' });
  parts.push({ name: 'Back', qty: 1, length: sideHeight, width: W - T, thickness: backT, note: `Sits in ${f(T / 2)} rabbets in the sides`, material: 'plywood' });
  if (cleatGap > 0) {
    parts.push({ name: 'Cabinet cleat', qty: 1, length: interiorWidth, width: cleatHeight, thickness: T, note: '45° bevel along one edge; screwed to the back and the top', material: 'plywood' });
    parts.push({ name: 'Wall cleat', qty: 1, length: interiorWidth, width: cleatHeight, thickness: T, note: '45° bevel along one edge; screwed into the studs', material: 'plywood' });
    parts.push({ name: 'Bottom spacer', qty: 1, length: interiorWidth, width: 2, thickness: T, note: 'Behind the back at the bottom, so the unit hangs plumb', material: 'plywood' });
  }
  partitionXs.forEach((x, pi) => {
    parts.push({
      name: partitionXs.length === 1 ? 'Partition' : `Partition ${pi + 1}`, qty: 1, length: caseHeight - 2 * T, width: interiorDepth - caseBanding, thickness: T,
      note: `Between the top and bottom, ${f(x - T)} in from the left side; slides screw to both faces`, material: 'plywood',
    });
  });
  if (basePlan) {
    const bp = basePlan;
    if (bp.kind === 'kick') {
      parts.push({ name: 'Toe kick', qty: 1, length: interiorWidth, width: B, thickness: T, note: `Between the sides, ${f(bp.setback)} back from the front edge`, material: 'plywood' });
      parts.push({ name: 'Kick nailer', qty: 1, length: interiorWidth, width: B, thickness: T, note: 'Between the sides at the back, under the bottom', material: 'plywood' });
    } else {
      const railLength = W - bp.sideSetbacks[0] - bp.sideSetbacks[1];
      parts.push({ name: 'Plinth front and back', qty: 2, length: railLength, width: B, thickness: T,
        note: bp.setback > 0 ? `The front sits ${f(bp.setback)} back from the case front` : 'Flush with the case front, back and sides', material: 'plywood' });
      parts.push({ name: 'Plinth ends and stretchers', qty: bp.plinthXs.length, length: caseDepth - bp.setback - 2 * T, width: B, thickness: T,
        note: `Between the front and back rails, no more than ${f(PLINTH_STRETCHER_SPACING)} apart`, material: 'plywood' });
    }
    if (bp.baseboard) {
      const bb = bp.baseboard;
      const wraps = bb.faces.filter(x => x !== 'front').length;
      parts.push({ name: 'Baseboard, front', qty: 1, length: W + wraps * bb.thickness, width: bb.height, thickness: bb.thickness,
        note: wraps === 2 ? '45° mitre at both ends (long point to long point)' : wraps === 1 ? `45° mitre at the ${bb.faces.includes('left') ? 'left' : 'right'} end, square at the wall` : 'Square ends, tight to the walls',
        material: 'solid' });
      if (wraps) {
        parts.push({ name: 'Baseboard, side', qty: wraps, length: caseDepth + bb.thickness, width: bb.height, thickness: bb.thickness,
          note: '45° mitre at the front end, square at the wall; cut long and trim to fit', material: 'solid' });
      }
    }
  }

  // Drawer parts, grouped by size so identical drawers share a line.
  const groups: { indexes: number[]; front: number; box: number; notch: number; depth: number; frontWidth: number; boxWidth: number }[] = [];
  for (const d of drawers) {
    if (d.open) continue;
    const g = groups.find(g => Math.abs(g.front - d.front.height) < EPS && Math.abs(g.box - d.box.height) < EPS
      && Math.abs(g.notch - d.boxNotchDepth) < 1e-3 && g.depth === d.box.depth
      && Math.abs(g.frontWidth - d.front.width) < EPS && Math.abs(g.boxWidth - d.box.width) < EPS);
    if (g) g.indexes.push(d.index);
    else groups.push({ indexes: [d.index], front: d.front.height, box: d.box.height, notch: d.boxNotchDepth, depth: d.box.depth, frontWidth: d.front.width, boxWidth: d.box.width });
  }
  const partDrawers: Record<string, number[]> = {};
  const range = (indexes: number[]) => drawerRange(indexes, drawers, k);
  for (const g of groups) {
    const boxWidth = g.boxWidth;
    const frontWidth = g.frontWidth;
    const boxInsideWidth = boxWidth - 2 * b;
    const boxInsideDepth = g.depth - 2 * b;
    const which = groups.length === 1 ? '' : ` · ${range(g.indexes)}`;
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
  // Cubby shelves: a fixed panel under each cubby that isn't at the bottom, one line per opening width.
  const shelves: { width: number; indexes: number[]; door: boolean }[] = [];
  for (const d of drawers) {
    if (!d.open || d.shelfY === null) continue;
    const w = columns[d.column].width;
    const g = shelves.find(x => Math.abs(x.width - w) < EPS && x.door === !!d.door);
    if (g) g.indexes.push(d.index); else shelves.push({ width: w, indexes: [d.index], door: !!d.door });
  }
  for (const g of shelves) {
    const kind = g.door ? 'Fixed shelf under door' : 'Cubby shelf';
    const name = shelves.filter(x => x.door === g.door).length === 1 ? kind : `${kind} · ${range(g.indexes)}`;
    partDrawers[name] = g.indexes;
    parts.push({ name, qty: g.indexes.length, length: g.width, width: interiorDepth - caseBanding, thickness: T,
      note: 'Fixed: glue and screw through the sides (or partition) into its ends', material: 'plywood' });
  }

  // Doors: one line per leaf size and hinge side (their cup holes differ), then shelves and trays behind them.
  const doorGroups: { width: number; height: number; hinge: 'left' | 'right'; indexes: number[]; count: number }[] = [];
  const doorShelves: { length: number; count: number; indexes: number[] }[] = [];
  const trayGroups: { width: number; height: number; depth: number; count: number; indexes: number[] }[] = [];
  let spacerPanels: { height: number; count: number }[] = [];
  const depthBehind = interiorDepth - frontInset;
  for (const d of drawers) {
    if (!d.door) continue;
    for (const leaf of d.door.leaves) {
      const g = doorGroups.find(x => Math.abs(x.width - leaf.width) < EPS && Math.abs(x.height - d.front.height) < EPS && x.hinge === leaf.hinge);
      if (g) { g.count++; if (!g.indexes.includes(d.index)) g.indexes.push(d.index); }
      else doorGroups.push({ width: leaf.width, height: d.front.height, hinge: leaf.hinge, indexes: [d.index], count: 1 });
    }
    if (d.door.shelfYs.length) {
      const length = columns[d.column].width - 1 / 16;
      const g = doorShelves.find(x => Math.abs(x.length - length) < EPS);
      if (g) { g.count += d.door.shelfYs.length; g.indexes.push(d.index); } else doorShelves.push({ length, count: d.door.shelfYs.length, indexes: [d.index] });
    }
    for (const t of d.door.trays) {
      const g = trayGroups.find(x => Math.abs(x.width - t.width) < EPS && Math.abs(x.height - t.height) < EPS && x.depth === t.depth);
      if (g) { g.count++; if (!g.indexes.includes(d.index)) g.indexes.push(d.index); } else trayGroups.push({ width: t.width, height: t.height, depth: t.depth, count: 1, indexes: [d.index] });
    }
    if (d.door.trays.length) {
      const height = d.door.zoneTop - d.door.zoneBottom;
      const g = spacerPanels.find(x => Math.abs(x.height - height) < EPS);
      if (g) g.count += 2; else spacerPanels = [...spacerPanels, { height, count: 2 }];
    }
  }
  for (const g of doorGroups) {
    const name = `Door, hinged ${g.hinge}${doorGroups.length === 1 ? '' : ` · ${range(g.indexes).replace(/drawer/g, 'position')}`}`;
    partDrawers[name] = g.indexes;
    parts.push({ name, qty: g.count, length: g.width - 2 * banding, width: g.height - 2 * banding, thickness: T,
      note: `${hingePositions(g.height).length} concealed-hinge cups (35 mm) on the back, along the ${g.hinge} edge`, material: 'plywood' });
  }
  for (const g of doorShelves) {
    const name = doorShelves.length === 1 ? 'Door shelf' : `Door shelf · ${f(g.length)}`;
    parts.push({ name, qty: g.count, length: g.length, width: depthBehind - 1 / 8 - caseBanding, thickness: T,
      note: `Loose, on shelf pins; ${f(1 / 16)} short of the opening so it lifts out`, material: 'plywood' });
  }
  for (const g of trayGroups) {
    const which = trayGroups.length === 1 ? '' : ` · ${f(g.width)} × ${f(g.height)}`;
    const inside = g.width - 2 * b;
    parts.push({ name: `Tray side${which}`, qty: g.count * 2, length: g.depth, width: g.height, thickness: b,
      note: `${f(b)} × ${f(b / 2)} rabbet at each end; bottom groove ${f(BOTTOM_GROOVE_OFFSET)} up`, material: 'plywood' });
    parts.push({ name: `Tray front and back${which}`, qty: g.count * 2, length: g.width - b, width: g.height, thickness: b, note: 'Bottom groove', material: 'plywood' });
    parts.push({ name: `Tray bottom${which}`, qty: g.count, length: inside + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY, width: g.depth - 2 * b + 2 * BOTTOM_GROOVE_DEPTH - BOTTOM_PLAY, thickness: bt, material: 'plywood' });
  }
  for (const g of spacerPanels) {
    parts.push({ name: spacerPanels.length === 1 ? 'Tray spacer panel' : `Tray spacer panel · ${f(g.height)}`, qty: g.count, length: depthBehind, width: g.height, thickness: T,
      note: 'Screwed to the side or partition behind the door; the tray slides mount on it, clear of the hinges', material: 'plywood' });
  }

  // Shaker fronts and pull hardware.
  const profile = config.frontProfile;
  if (profile?.style === 'shaker') {
    if (profile.rail < 1 || profile.rail > 4) errors.push(`A ${f(profile.rail)} Shaker frame is outside ${f(1)}–${f(4)}; ${f(2.25)} is typical.`);
    if (profile.method === 'pocket' && (profile.depth <= 0 || profile.depth > T / 2)) errors.push(`The ${f(profile.depth)} panel pocket must be less than half the ${f(T)} front — ${f(1 / 4)} is typical.`);
    if (profile.method === 'applied' && (profile.depth < 1 / 8 || profile.depth > 1 / 2)) errors.push(`${f(profile.depth)} frame strips are outside ${f(1 / 8)}–${f(1 / 2)}; ${f(1 / 4)} is typical.`);
    if (pull && pull.shape !== 'handhole') warnings.push('The cut-out pull cuts through the top rail of the Shaker frame. Use knobs or pulls instead, or slab fronts.');
    // Every front and door leaf, by size, for the applied strips.
    const sizes: { w: number; h: number; qty: number }[] = [];
    for (const d of drawers) {
      const list = d.door ? d.door.leaves.map(l => l.width) : d.open ? [] : [d.front.width];
      for (const w of list) {
        const g = sizes.find(x => Math.abs(x.w - w) < EPS && Math.abs(x.h - d.front.height) < EPS);
        if (g) g.qty++; else sizes.push({ w, h: d.front.height, qty: 1 });
      }
    }
    const plain = sizes.filter(x => shakerRail(profile, x.w, x.h) === 0);
    if (plain.length) warnings.push(`${plain.length === sizes.length ? 'Every front is' : 'Some fronts are'} too small for a Shaker frame (they need about ${f(2 * 0.75 + 1.5)} each way) and stay slab.`);
    if (profile.method === 'applied') {
      const stiles: { length: number; width: number; qty: number }[] = [];
      const rails: { length: number; width: number; qty: number }[] = [];
      const add = (list: typeof stiles, length: number, width: number, qty: number) => {
        const g = list.find(x => Math.abs(x.length - length) < EPS && Math.abs(x.width - width) < EPS);
        if (g) g.qty += qty; else list.push({ length, width, qty });
      };
      for (const x of sizes) {
        const r = shakerRail(profile, x.w, x.h);
        if (!r) continue;
        add(stiles, x.h, r, 2 * x.qty);
        add(rails, x.w - 2 * r, r, 2 * x.qty);
      }
      stiles.forEach((g, k) => parts.push({ name: `Shaker stile${stiles.length > 1 ? ` ${k + 1}` : ''}`, qty: g.qty, length: g.length, width: g.width, thickness: profile.depth,
        note: 'Glued and pinned to the front, flush with its edges', material: 'plywood' }));
      rails.forEach((g, k) => parts.push({ name: `Shaker rail${rails.length > 1 ? ` ${k + 1}` : ''}`, qty: g.qty, length: g.length, width: g.width, thickness: profile.depth,
        note: 'Between the stiles, top and bottom', material: 'plywood' }));
      if (inset) warnings.push(`Applied Shaker strips stand ${f(profile.depth)} proud of the case on inset fronts — that’s the look, but the fronts no longer sit flush.`);
    }
  }
  const hw = config.hardware;
  if (hw && hw.kind !== 'none' && hw.kind !== 'knob' && (hw.spacing < 1 || hw.spacing > 24)) errors.push(`Pull holes ${f(hw.spacing)} apart are outside ${f(1)}–${f(24)}; 3″, 3 3/4″ (96 mm) and 5″ (128 mm) are common.`);

  // Inserts: laid out in each box, then grouped so identical ones share a line.
  const it = config.insertThickness ?? 1 / 4;
  const inserts: (InsertLayout | null)[] = drawers.map((d, i) => {
    const insert = config.inserts?.[i];
    if (!insert || d.open) return null;
    const layout = layoutInsert(insert, {
      width: d.box.width - 2 * b, depth: d.box.depth - 2 * b, height: d.box.height - BOTTOM_GROOVE_OFFSET - bt,
    }, it, f, config.gridfinityBed ?? 256);
    if (layout.error) errors.push(`${d.label}: ${layout.error}.`);
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
      const name = `${INSERT_NAMES[piece.role]} · ${range(g.indexes)}`;
      partDrawers[name] = g.indexes;
      partOutlines[name] = pieceOutline(piece.length, piece.height, piece.cuts);
      const slots = piece.cuts.length;
      parts.push({
        name, qty: piece.qty * g.indexes.length, length: piece.length, width: piece.height, thickness: piece.thickness ?? it,
        note: piece.role === 'board'
          ? `${g.layout.toolBoard?.placed.length ?? 0} tool pocket${g.layout.toolBoard?.placed.length === 1 ? '' : 's'}, ${f(g.layout.toolBoard?.pocketDepth ?? 0)} deep`
          : piece.role === 'rib'
          ? `${slots} half-round notch${slots === 1 ? '' : 'es'}; glue to the drawer bottom`
          : slots ? `${slots} slot${slots === 1 ? '' : 's'} from the ${piece.role === 'lengthwise' ? 'top' : 'bottom'}, half its height` : undefined,
        material: 'plywood',
      });
    }
  }

  // Load: contents weight against the slides, and how far the bottom sags.
  const load = DRAWER_LOADS[config.load ?? 'medium'];
  const loads: DrawerLoadCheck[] = drawers.map(d => {
    if (d.open) return { pounds: 0, sag: 0, sagLimit: 1, overSlides: false, sags: false };
    const w = d.box.width - 2 * b;
    const dd = d.box.depth - 2 * b;
    const pounds = load.psf * (w * dd) / 144;
    const sag = bt > 0 && w > 0 && dd > 0 ? bottomSag(w + 2 * BOTTOM_GROOVE_DEPTH, dd + 2 * BOTTOM_GROOVE_DEPTH, bt, load.psf) : 0;
    const sagLimit = Math.min(w, dd) * BOTTOM_SAG_LIMIT;
    return { pounds, sag, sagLimit, overSlides: pounds > SLIDE_CAPACITY_LB, sags: sag > sagLimit };
  });
  const loadWord = load.label.split(' —')[0].toLowerCase();
  const heavy = drawers.filter((_, i) => loads[i].overSlides).map(d => d.index);
  if (heavy.length && errors.length === 0) {
    const most = Math.max(...loads.map(l => l.pounds));
    warnings.push(`Full of ${loadWord} things, ${range(heavy)} could hold about ${Math.round(most)} lb — more than the ${SLIDE_CAPACITY_LB} lb the slides are rated for. Use heavier-duty slides, or keep them lighter.`);
  }
  const sagging = drawers.filter((_, i) => loads[i].sags).map(d => d.index);
  if (sagging.length && errors.length === 0) {
    const worst = loads.reduce((w, l) => (l.sag / l.sagLimit > w.sag / w.sagLimit ? l : w));
    const needed = bt * Math.cbrt(worst.sag / worst.sagLimit);
    const thicker = [3 / 8, 1 / 2, 3 / 4].find(x => x >= needed - 1e-6) ?? 3 / 4;
    warnings.push(`Under ${loadWord} loads the ${f(bt)} bottom${sagging.length === 1 ? '' : 's'} of ${range(sagging)} would sag about ${worst.sag.toFixed(2)}″ — more than the ${worst.sagLimit.toFixed(2)}″ that stays flat. Use ${f(thicker)} bottoms, or glue a ${f(3 / 4)} × ${f(1.5)} stiffener across the middle underneath.`);
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
    for (const p of sheetParts(parts)) {
      if (!fitsSheet(p.length, p.width)) {
        errors.push(p.name === 'Desk top'
          ? `The ${f(p.length)} × ${f(p.width)} desk top is bigger than a 4 × 8 sheet — use a solid-wood or butcher-block top, or make it smaller.`
          : `${p.name} (${f(p.length)} × ${f(p.width)}) is bigger than a 4 × 8 sheet.`);
      }
    }
  }

  // Bookcase: built from the Shelf Builder's model and set on the cabinet.
  let bookcase: BookcasePlan | null = null;
  if (config.bookcase?.enabled) {
    const blockers: string[] = [];
    if (mount !== 'floor') blockers.push('A bookcase on top needs a floor-standing unit — stand it on the floor or turn the bookcase off.');
    if (config.base === 'casters') blockers.push('Don’t put a bookcase on a unit on casters — it would tip. Use feet, a toe kick or a plinth.');
    if (config.desk?.enabled) blockers.push('The bookcase goes on a single unit — turn off the desk or the bookcase.');
    bookcase = buildBookcase(config.bookcase, {
      width: W, cabinetHeight: H, caseDepth, frontProjection: inset ? 0 : T, thickness: T,
      exposed: config.exposedSides ?? { left: true, right: true },
      edgeBanding: config.edgeBanding, bandingThickness: config.bandingThickness, units, blockers,
    });
    errors.push(...bookcase.errors);
    warnings.push(...bookcase.warnings);
    parts.push(...bookcase.parts);
  }

  // Wall run: copies of this cabinet (and its bookcase) under one countertop, with desk gaps and fillers.
  let run: RunPlan | null = null;
  if (config.run?.enabled) {
    if (mount !== 'floor') errors.push('A wall run is built of floor-standing cabinets — set the unit on the floor.');
    if (config.base === 'casters') errors.push('Built-ins don’t go on casters — use a toe kick, a plinth or leveling feet.');
    if (config.desk?.enabled) errors.push('Use the wall run’s desk gaps instead of the desk option — turn the desk off.');
    else {
      const built = buildRun(config.run, {
        W, H, cd: caseDepth, T, frontProjection: inset ? 0 : T, units, bookcase, bookcaseConfig: config.bookcase?.enabled ? config.bookcase : undefined,
        edgeBanding: config.edgeBanding, bandingThickness: config.bandingThickness,
      });
      run = built.plan;
      errors.push(...built.errors);
      warnings.push(...built.warnings);
      unitCount = run.cabinetCount;
      const mirrored = run.sections.filter(x => x.kind === 'cabinet' && x.mirror).length;
      // Every cabinet (with its bookcase) is the same, except mirrored ones hinge their doors the other way.
      const perUnit = parts.filter(p => !RUN_REPLACED.test(p.name));
      const swap = (name: string) => name.replace(/hinged (left|right)/, (_, side) => `hinged ${side === 'left' ? 'right' : 'left'}`);
      const doorQty = new Map(perUnit.filter(p => p.name.startsWith('Door, hinged')).map(p => [p.name, p.qty]));
      parts.length = 0;
      for (const p of perUnit) {
        if (p.name.startsWith('Door, hinged')) {
          const qty = p.qty * (unitCount - mirrored) + (doorQty.get(swap(p.name)) ?? 0) * mirrored;
          if (qty > 0) parts.push({ ...p, qty });
        } else parts.push({ ...p, qty: p.qty * unitCount });
      }
      // Doors that only exist mirrored (a unit with only left-hinged doors, some copies mirrored).
      for (const [name, qty] of doorQty) {
        const other = swap(name);
        if (!doorQty.has(other) && mirrored > 0) {
          const src = perUnit.find(p => p.name === name)!;
          parts.push({ ...src, name: other, qty: qty * mirrored });
          partDrawers[other] = partDrawers[name];
        }
      }
      // Uppers over the desk gaps, then the run's countertop, ledgers, fillers and top trim.
      for (const sec of run.sections) {
        if (!sec.upper) continue;
        for (const p of sec.upper.parts) {
          if (RUN_REPLACED.test(p.name)) continue;
          parts.push({ ...p, name: p.name.replace(/^Bookcase /, `Desk ${sec.number} upper `) });
        }
      }
      parts.push(...built.parts);
    }
  }

  const bandingTotal = banding > 0
    ? (2 * caseHeight + 2 * interiorWidth + (k - 1) * (caseHeight - 2 * T)
      + drawers.reduce((a, d) => a + (d.door ? d.door.leaves.reduce((x, l) => x + 2 * l.width + 2 * d.front.height, 0) : 0)
        + (d.open ? (d.shelfY !== null ? columns[d.column].width : 0) : 2 * d.front.width + 2 * d.front.height), 0)) * unitCount
      // The desk top's front and ends (each layer's edge shows).
      + (desk ? (desk.width + 2 * desk.depth) * (config.desk?.topLayers ?? 1) : 0)
      + (bookcase?.shelfPlan.banding?.totalLength ?? 0)
    : 0;

  return {
    frontInset,
    mount,
    lift,
    cleatGap,
    columns,
    partitionXs,
    overallWidth: W,
    overallHeight: H,
    overallDepth: D,
    caseDepth,
    caseHeight,
    baseHeight: B,
    sideBottom,
    base: basePlan,
    bookcase,
    totalHeight: Math.max(H, desk ? desk.height : 0, bookcase ? bookcase.totalHeight : 0, run ? run.totalHeight : 0),
    run,
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

/** "drawers 2–4", or with columns "column 1 drawers 1–3, column 2 drawer 1". */
function drawerRange(indexes: number[], drawers: DrawerLayout[] = [], columnCount = 1): string {
  const numbers = (nums: number[]) => {
    if (nums.length === 1) return `drawer ${nums[0]}`;
    const contiguous = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1);
    return contiguous ? `drawers ${nums[0]}–${nums[nums.length - 1]}` : `drawers ${nums.join(', ')}`;
  };
  if (columnCount <= 1) return numbers(indexes.map(i => i + 1));
  const byColumn = new Map<number, number[]>();
  for (const i of indexes) {
    const d = drawers.find(x => x.index === i);
    if (!d) continue;
    const list = byColumn.get(d.column) ?? [];
    list.push(drawers.filter(x => x.column === d.column).findIndex(x => x.index === i) + 1);
    byColumn.set(d.column, list);
  }
  return [...byColumn].map(([c, nums]) => `column ${c + 1} ${numbers(nums)}`).join(', ');
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

  const bp = plan.base;
  // An integrated toe kick: the sides run to the floor with a notch at the front.
  const side = (name: string, x0: number, x1: number): Solid => (bp?.kind === 'kick'
    ? { name, kind: 'case', shape: 'prism', x0, x1, profile: [[bp.setback, 0], [cd, 0], [cd, H], [0, H], [0, B], [bp.setback, B]] }
    : box(name, 'case', [x0, B, 0], [x1, H, cd]));
  const solids: Solid[] = [
    side('Left side', 0, T),
    side('Right side', W - T, W),
    box('Top', 'case', [T, H - T, 0], [W - T, H, id]),
    box('Bottom', 'case', [T, B, 0], [W - T, B + T, id]),
    box('Back', 'back', [T / 2, B, id], [W - T / 2, H, id + config.backThickness]),
    ...plan.partitionXs.map((x, i) => box(plan.partitionXs.length === 1 ? 'Partition' : `Partition ${i + 1}`, 'case', [x, B + T, 0], [x + T, H - T, id])),
  ];
  for (const d of plan.drawers) {
    const name = d.label;
    if (d.open) {
      const c = plan.columns[d.column];
      if (d.shelfY !== null) solids.push(box(`${name} shelf`, 'shelf', [c.x, d.shelfY, 0], [c.x + c.width, d.shelfY + T, id]));
      if (d.door) solids.push(...doorSolids(d, d.door, plan, config));
      continue;
    }
    const first = solids.length;
    const fr = d.front;
    const hole = handHole(pull);
    const zf = plan.frontInset;
    solids.push(...frontSolids(`${name} front`, 'drawer-front', notchedOutline(fr.x, fr.y, fr.width, fr.height, frontNotch(pull, fr.width)), fr, zf - T, T, config, null,
      hole ? [stadiumOutline(fr.x + fr.width / 2, fr.y + fr.height - hole.top, hole.width, hole.height)] : undefined));
    const bx = d.box;
    const x0 = bx.x;
    const x1 = bx.x + bx.width;
    const y0 = bx.y;
    const y1 = bx.y + bx.height;
    const boxNotch = boxNotchSpec(pull, fr.width, d.boxNotchDepth);
    solids.push({ name: `${name} box front`, kind: 'drawer-box', shape: 'plate', z0: zf, z1: zf + b,
      outline: notchedOutline(x0, y0, bx.width, bx.height, boxNotch) });
    solids.push(box(`${name} box back`, 'drawer-box', [x0, y0, zf + bx.depth - b], [x1, y1, zf + bx.depth]));
    solids.push(box(`${name} box left side`, 'drawer-box', [x0, y0, zf + b], [x0 + b, y1, zf + bx.depth - b]));
    solids.push(box(`${name} box right side`, 'drawer-box', [x1 - b, y0, zf + b], [x1, y1, zf + bx.depth - b]));
    const by = y0 + BOTTOM_GROOVE_OFFSET;
    solids.push(box(`${name} box bottom`, 'drawer-box', [x0 + b, by, zf + b], [x1 - b, by + config.bottomThickness, zf + bx.depth - b]));
    const insert = plan.inserts[d.index];
    if (insert && !insert.error) {
      const ix = x0 + b;
      const iy = by + config.bottomThickness;
      const iz = zf + b;
      const it = config.insertThickness ?? 1 / 4;
      const ribPiece = insert.pieces.find(p => p.role === 'rib');
      if (insert.toolBoard) {
        const tb = insert.toolBoard;
        solids.push(box(`${name} tool board`, 'insert', [ix + INSERT_PLAY / 2, iy, iz + INSERT_PLAY / 2], [ix + INSERT_PLAY / 2 + tb.width, iy + tb.thickness, iz + INSERT_PLAY / 2 + tb.depth]));
      }
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
    // Slides fill the gap between the box and the side or partition on each side.
    solids.push(box(`${name} left slide`, 'slide', [bx.x - SLIDE_CLEARANCE, d.slideY, zf], [bx.x, d.slideY + SLIDE_HEIGHT, zf + bx.depth]));
    solids.push(box(`${name} right slide`, 'slide', [bx.x + bx.width, d.slideY, zf], [bx.x + bx.width + SLIDE_CLEARANCE, d.slideY + SLIDE_HEIGHT, zf + bx.depth]));
  }
  if (bp?.kind === 'kick') {
    solids.push(box('Toe kick', 'case', [T, 0, bp.setback], [W - T, B, bp.setback + T]));
    solids.push(box('Kick nailer', 'case', [T, 0, cd - T], [W - T, B, cd]));
  } else if (bp) {
    const [l, r] = bp.sideSetbacks;
    solids.push(box('Plinth front', 'case', [l, 0, bp.setback], [W - r, B, bp.setback + T]));
    solids.push(box('Plinth back', 'case', [l, 0, cd - T], [W - r, B, cd]));
    bp.plinthXs.forEach((x, i) => {
      const name = i === 0 ? 'Plinth left end' : i === bp.plinthXs.length - 1 ? 'Plinth right end' : `Plinth stretcher ${i}`;
      solids.push(box(name, 'case', [x, 0, bp.setback + T], [x + T, B, cd - T]));
    });
    if (bp.baseboard) {
      const { height: h, thickness: t, faces } = bp.baseboard;
      const l2 = faces.includes('left') ? t : 0;
      const r2 = faces.includes('right') ? t : 0;
      solids.push(box('Baseboard front', 'case', [-l2, 0, -t], [W + r2, h, 0]));
      if (l2) solids.push(box('Baseboard left', 'case', [-t, 0, 0], [0, h, cd]));
      if (r2) solids.push(box('Baseboard right', 'case', [W, 0, 0], [W + t, h, cd]));
    }
  }
  // Exploded view: case panels move outward, each drawer's parts spread from the box.
  const spread = Math.max(W, H) / 12;
  const explodeOf = (s: Solid): [number, number, number] | undefined => {
    const n = s.name;
    if (n === 'Left side') return [-spread, 0, 0];
    if (n === 'Right side') return [spread, 0, 0];
    if (n === 'Top') return [0, spread, 0];
    if (n === 'Bottom') return [0, -spread / 3, 0];
    if (n === 'Back') return [0, 0, spread * 1.5];
    // Panels, strips and pulls travel with their front.
    if (s.kind === 'drawer-front' || (s.kind === 'pin' && / front (knob|pull)/.test(n))) return [0, 0, -spread * 1.2];
    if (s.kind === 'pin' && / (knob|pull)( \d+)?$/.test(n)) return [0, 0, -spread * 1.2];
    if (s.kind === 'door') return [0, 0, -spread * 1.2];
    if (/ tray \d+ /.test(n)) return [0, 0, -spread * 0.6];
    if (n === 'Toe kick' || n === 'Plinth front' || n === 'Baseboard front') return [0, -spread / 2, -spread * (n === 'Baseboard front' ? 1.4 : 0.7)];
    if (n === 'Kick nailer' || n === 'Plinth back') return [0, -spread / 2, spread * 0.7];
    if (n.startsWith('Plinth')) return [0, -spread / 2, 0];
    if (n === 'Baseboard left') return [-spread * 1.4, -spread / 2, 0];
    if (n === 'Baseboard right') return [spread * 1.4, -spread / 2, 0];
    if (/ box front$/.test(n)) return [0, 0, -spread * 0.5];
    if (/ box back$/.test(n)) return [0, 0, spread * 0.5];
    if (/ box left side$/.test(n)) return [-spread * 0.5, 0, 0];
    if (/ box right side$/.test(n)) return [spread * 0.5, 0, 0];
    if (/ box bottom$/.test(n)) return [0, -spread * 0.4, 0];
    if (s.kind === 'insert') return [0, spread * 0.8, 0];
    if (/ left slide$/.test(n)) return [-spread * 0.25, 0, 0];
    if (/ right slide$/.test(n)) return [spread * 0.25, 0, 0];
    return undefined;
  };
  for (const s of solids) s.explode = explodeOf(s);

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
  if (plan.cleatGap > 0) {
    // French cleat behind the back: the cabinet cleat under the top, bevel down; the wall cleat below it, bevel up.
    const z0 = id + config.backThickness;
    const z1 = cd;
    const h = config.cleatHeight ?? 3;
    const top = H - T;
    const bevel = Math.min(z1 - z0, h / 2);
    solids.push({ name: 'Cabinet cleat', kind: 'cleat', shape: 'prism', x0: T, x1: W - T,
      profile: [[z0, top], [z1, top], [z1, top - h + bevel], [z0, top - h]] });
    solids.push({ name: 'Wall cleat', kind: 'wall-cleat', shape: 'prism', x0: T, x1: W - T,
      profile: [[z0, top - h], [z1, top - h + bevel], [z1, top - 2 * h + bevel], [z0, top - 2 * h]] });
    solids.push(box('Bottom spacer', 'cleat', [T, B + T, z0], [W - T, B + T + 2, z1]));
  }
  if (plan.bookcase) solids.push(...bookcaseSolids(plan.bookcase, W, cd, T));
  if (plan.mount === 'under-desk') {
    // The desk it hangs from, for context.
    solids.push(box('Desk (existing)', 'back', [-6, H, -T - 2], [W + 6, H + 1.5, cd + 2]));
  }
  return plan.lift ? solids.map(s => liftSolid(s, plan.lift)) : solids;
}

/**
 * A front (drawer or door leaf) as solids: the slab, or a Shaker frame with its recessed
 * panel (pocketed) or strips glued on (applied), plus the pull hardware in front of it.
 */
export function frontSolids(name: string, kind: SolidKind, outline: [number, number][], rect: { x: number; y: number; width: number; height: number },
  zFace: number, T: number, config: Pick<DrawerConfig, 'frontProfile' | 'hardware'>, door: { hinge: 'left' | 'right' } | null, holes?: [number, number][][]): Solid[] {
  const p = config.frontProfile;
  const rail = shakerRail(p, rect.width, rect.height);
  const out: Solid[] = [];
  const inner: [number, number][] = [[rect.x + rail, rect.y + rail], [rect.x + rect.width - rail, rect.y + rail], [rect.x + rect.width - rail, rect.y + rect.height - rail], [rect.x + rail, rect.y + rect.height - rail]];
  const z1 = zFace + T;
  if (rail && p!.method === 'pocket') {
    // The frame at full thickness around a panel set back by the pocket depth.
    out.push({ name, kind, shape: 'plate', z0: zFace, z1, outline, holes: [inner, ...(holes ?? [])] });
    out.push({ name: `${name} panel`, kind, shape: 'plate', z0: zFace + p!.depth, z1, outline: inner });
  } else {
    out.push({ name, kind, shape: 'plate', z0: zFace, z1, outline, holes });
    if (rail) {
      const t = p!.depth;
      const { x, y, width: w, height: h } = rect;
      const strip = (n: string, x0: number, y0: number, x1: number, y1: number): Solid => ({ name: `${name} ${n}`, kind, shape: 'box', min: [x0, y0, zFace - t], max: [x1, y1, zFace] });
      out.push(strip('left stile', x, y, x + rail, y + h), strip('right stile', x + w - rail, y, x + w, y + h),
        strip('top rail', x + rail, y + h - rail, x + w - rail, y + h), strip('bottom rail', x + rail, y, x + w - rail, y + rail));
    }
  }
  const { pulls } = pullHoles(config.hardware, rect.width, rect.height, door, rail);
  const hw = config.hardware;
  const front = zFace - (rail && p!.method === 'applied' ? p!.depth : 0);
  pulls.forEach((pl, k) => {
    const cx = rect.x + pl.x;
    const cy = rect.y + pl.y;
    const label = `${name} ${hw!.kind === 'knob' ? 'knob' : 'pull'}${pulls.length > 1 ? ` ${k + 1}` : ''}`;
    if (hw!.kind === 'knob') out.push({ name: label, kind: 'pin', shape: 'box', min: [cx - 0.55, cy - 0.55, front - 1.1], max: [cx + 0.55, cy + 0.55, front] });
    else {
      const len = hw!.spacing + (hw!.kind === 'cup' ? 0.6 : 1);
      const across = hw!.kind === 'cup' ? 1.2 : 0.45;
      const [dx, dy] = pl.vertical ? [across / 2, len / 2] : [len / 2, across / 2];
      out.push({ name: label, kind: 'pin', shape: 'box', min: [cx - dx, cy - dy, front - (hw!.kind === 'cup' ? 0.6 : 1.1)], max: [cx + dx, cy + dy, front] });
    }
  });
  return out;
}

/** A door's leaves, and the shelves or pull-out trays behind it. */
function doorSolids(d: DrawerLayout, door: DoorPlan, plan: DrawerPlan, config: DrawerConfig): Solid[] {
  const T = config.thickness;
  const b = config.boxThickness;
  const zf = plan.frontInset;
  const id = plan.interiorDepth;
  const c = plan.columns[d.column];
  const out: Solid[] = [];
  const box = (name: string, kind: SolidKind, min: [number, number, number], max: [number, number, number]): Solid => ({ name, kind, shape: 'box', min, max });
  const notch = doorNotch(config.pull);
  door.leaves.forEach(leaf => {
    const name = door.leaves.length === 1 ? `${d.label}` : `${d.label} ${leaf.hinge === 'left' ? 'left' : 'right'} leaf`;
    const usable = notch && leaf.width > notch.width + 3 ? notch : null;
    out.push(...frontSolids(name, 'door', notchedOutline(leaf.x, d.front.y, leaf.width, d.front.height, usable, doorNotchCenter(leaf, usable)),
      { x: leaf.x, y: d.front.y, width: leaf.width, height: d.front.height }, zf - T, T, config, { hinge: leaf.hinge }));
  });
  door.shelfYs.forEach((y, k) => out.push(box(`${d.label} shelf ${k + 1}`, 'adjustable', [c.x + 1 / 32, y, zf], [c.x + c.width - 1 / 32, y + T, id - 1 / 8])));
  if (door.trays.length) {
    out.push(box(`${d.label} left spacer`, 'case', [c.x, door.zoneBottom, zf], [c.x + T, door.zoneTop, id]));
    out.push(box(`${d.label} right spacer`, 'case', [c.x + c.width - T, door.zoneBottom, zf], [c.x + c.width, door.zoneTop, id]));
  }
  door.trays.forEach((t, k) => {
    const n = `${d.label} tray ${k + 1}`;
    const z0 = zf;
    const z1 = zf + t.depth;
    const x1 = t.x + t.width;
    const parts: Solid[] = [
      box(`${n} front`, 'drawer-box', [t.x, t.y, z0], [x1, t.y + t.height, z0 + b]),
      box(`${n} back`, 'drawer-box', [t.x, t.y, z1 - b], [x1, t.y + t.height, z1]),
      box(`${n} left side`, 'drawer-box', [t.x, t.y, z0 + b], [t.x + b, t.y + t.height, z1 - b]),
      box(`${n} right side`, 'drawer-box', [x1 - b, t.y, z0 + b], [x1, t.y + t.height, z1 - b]),
      box(`${n} bottom`, 'drawer-box', [t.x + b, t.y + BOTTOM_GROOVE_OFFSET, z0 + b], [x1 - b, t.y + BOTTOM_GROOVE_OFFSET + config.bottomThickness, z1 - b]),
    ];
    out.push(...parts, box(`${n} left slide`, 'slide', [t.x - SLIDE_CLEARANCE, t.slideY, zf], [t.x, t.slideY + SLIDE_HEIGHT, zf + t.depth]),
      box(`${n} right slide`, 'slide', [x1, t.slideY, zf], [x1 + SLIDE_CLEARANCE, t.slideY + SLIDE_HEIGHT, zf + t.depth]));
  });
  return out;
}

/** Doors with a cut-out pull get it near the opening edge, sized for a door. */
export function doorNotch(pull: FingerPull): NotchSpec | null {
  if (!pull.enabled || pull.shape === 'handhole' || pull.depth <= 0) return null;
  return { shape: pull.shape === 'wide' ? 'slot' : pull.shape, width: Math.min(pull.width, 4), depth: Math.min(pull.depth, 1) };
}

/** The notch's centre on a leaf's top edge: 1 1/2" in from the opening (non-hinge) edge. */
export function doorNotchCenter(leaf: DoorLeaf, notch: NotchSpec | null): number | undefined {
  if (!notch) return undefined;
  const offset = notch.width / 2 + 1.5;
  return leaf.hinge === 'left' ? leaf.x + leaf.width - offset : leaf.x + offset;
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
  out.push({ name: 'Desk top', kind: 'case', shape: 'box', min: [0, H, plan.caseDepth - dk.depth], max: [dk.width, H + dk.topThickness, plan.caseDepth], explode: [0, Math.max(dk.width, H) / 8, 0] });
  return out;
}

/** A solid moved right by dx, mirrored about the unit's centre first when asked. */
function placeSolid(s: Solid, dx: number, mirrorWidth: number | null): Solid {
  const fx = (x: number) => (mirrorWidth === null ? x : mirrorWidth - x) + dx;
  if (s.shape === 'box') {
    const [a, b2] = [fx(s.min[0]), fx(s.max[0])];
    return { ...s, min: [Math.min(a, b2), s.min[1], s.min[2]], max: [Math.max(a, b2), s.max[1], s.max[2]] };
  }
  if (s.shape === 'prism') {
    const [a, b2] = [fx(s.x0), fx(s.x1)];
    return { ...s, x0: Math.min(a, b2), x1: Math.max(a, b2) };
  }
  // Mirroring reverses the winding; put it back so faces still point outward.
  const ring = (pts: [number, number][]) => {
    const moved = pts.map(([x, y]) => [fx(x), y] as [number, number]);
    return mirrorWidth === null ? moved : moved.reverse();
  };
  return { ...s, outline: ring(s.outline), holes: s.holes?.map(ring) };
}

/**
 * The whole wall run: each cabinet (with its bookcase) in place, mirrored where asked,
 * the uppers over the desk gaps, the fillers, ledgers, countertop and top trim. Every
 * name is prefixed ("Cabinet 2 · Drawer 1 front") so copies never clash.
 */
export function runSolids(plan: DrawerPlan, config: DrawerConfig): Solid[] {
  const run = plan.run;
  if (!run) return drawerSolids(plan, config);
  const T = config.thickness;
  const W = plan.overallWidth;
  const cd = plan.caseDepth;
  const unit = drawerSolids(plan, config).filter(s => !RUN_REPLACED.test(s.name) && !/^Crown molding, (left|right)$/.test(s.name));
  const out: Solid[] = [];
  const box = (name: string, kind: SolidKind, min: [number, number, number], max: [number, number, number], explode?: [number, number, number]): Solid =>
    ({ name, kind, shape: 'box', min, max, explode });
  const spread = Math.max(run.width, run.totalHeight) / 14;
  for (const sec of run.sections) {
    if (sec.kind === 'cabinet') {
      const prefix = `Cabinet ${sec.number} · `;
      for (const s of unit) {
        const placed = placeSolid(s, sec.x, sec.mirror ? W : null);
        out.push({ ...placed, name: prefix + s.name, ...(s.group ? { group: prefix + s.group } : {}) });
      }
    } else if (sec.upper) {
      const prefix = `Desk ${sec.number} · `;
      for (const s of bookcaseSolids(sec.upper, sec.width, cd, T)) {
        if (RUN_REPLACED.test(s.name) || /^Crown molding/.test(s.name)) continue;
        out.push({ ...placeSolid(s, sec.x, null), name: prefix + s.name });
      }
    }
    if (sec.kind === 'desk') {
      const H = plan.overallHeight;
      out.push(box(`Desk ${sec.number} · ledger`, 'cleat', [sec.x, H - 3, cd - T], [sec.x + sec.width, H, cd]));
      out.push(box(`Desk ${sec.number} · left cleat`, 'cleat', [sec.x, H - 3, 1], [sec.x + T, H, cd - T]));
      out.push(box(`Desk ${sec.number} · right cleat`, 'cleat', [sec.x + sec.width - T, H - 3, 1], [sec.x + sec.width, H, cd - T]));
    }
  }
  const ct = run.countertop;
  out.push(box('Run countertop', 'shelf', [ct.x0, ct.y0, ct.z0], [ct.x1, ct.y1, ct.z1], [0, spread, 0]));
  for (const fl of run.fillers) {
    const z0 = plan.frontInset > 0 ? 0 : -T;
    out.push(box(`Filler ${fl.side}`, 'case', [fl.x, 0, z0], [fl.x + fl.width, plan.overallHeight, z0 + T], [fl.side === 'left' ? -spread : spread, 0, 0]));
    if (run.uppers) {
      out.push(box(`Upper filler ${fl.side}`, 'case', [fl.x, run.uppers.y0, cd - (config.bookcase?.depth ?? 12)], [fl.x + fl.width, run.uppers.topY, cd - (config.bookcase?.depth ?? 12) + T], [fl.side === 'left' ? -spread : spread, spread * 2, 0]));
    }
  }
  if (run.cap) {
    const c = run.cap;
    out.push(box('Run top cap', 'case', [c.x0, c.y0, c.z0], [c.x1, c.y1, c.z1], [0, spread * 3, 0]));
  }
  if (run.crown) {
    const cr = run.crown;
    const up: [number, number, number] = [0, spread * 3, 0];
    out.push(box('Run crown nailer', 'case', [0, cr.y0, cr.front], [run.width, cr.y0 + cr.height, cr.front + T], up));
    out.push(box('Run crown molding', 'frame', [cr.x0, cr.y0, cr.front - cr.projection], [cr.x1, cr.y0 + cr.height, cr.front], up));
    for (const side of cr.returns) {
      const [x0, x1] = side === 'left' ? [-cr.projection, 0] : [run.width, run.width + cr.projection];
      out.push(box(`Run crown return ${side}`, 'frame', [x0, cr.y0, cr.front], [x1, cr.y0 + cr.height, cd], up));
    }
  }
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
  // Written out explicitly: designs saved before inset fronts existed read back as overlay.
  const c: DrawerConfig = { ...config, units, pull: { ...config.pull }, frontStyle: config.frontStyle ?? 'inset' };
  if (heightMode === 'overall') {
    delete c.frontHeights;
    if (c.columns) c.columns = c.columns.map(col => ({ drawers: col.drawers, ...(col.width ? { width: col.width } : {}) }));
  }
  if (c.columns && c.columns.length > 1) delete c.frontHeights;
  else delete c.columns;
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
  const drawers = num(c.drawers, 1, 12 * MAX_COLUMNS);
  if (thickness === null || width === null || height === null || depth === null || drawers === null || !Number.isInteger(drawers)) return null;
  const heightMode: DrawerHeightMode = value.heightMode === 'fronts' ? 'fronts' : 'overall';
  let frontHeights: number[] | undefined;
  const columns = readColumns(c.columns, drawers, heightMode === 'fronts');
  if (Array.isArray(c.columns) && c.columns.length > 1 && !columns) return null;
  if (heightMode === 'fronts' && !columns) {
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
      // Designs saved before inset fronts existed were overlay.
      frontStyle: c.frontStyle === 'inset' ? 'inset' : 'overlay',
      pull: {
        enabled: p.enabled !== false,
        shape: p.shape === 'alex' || p.shape === 'slot' || p.shape === 'wide' || p.shape === 'handhole' ? p.shape : 'arc',
        width: num(p.width, 0, 60) ?? DEFAULT_PULL.width,
        depth: num(p.depth, 0, 20) ?? DEFAULT_PULL.depth,
      },
      hardware: readHardware(c.hardware),
      frontProfile: readProfile(c.frontProfile),
      boxThickness: num(c.boxThickness, 0.05, 2) ?? 1 / 2,
      bottomThickness: num(c.bottomThickness, 0.05, 2) ?? 1 / 4,
      backThickness: num(c.backThickness, 0.05, 2) ?? 1 / 4,
      base: typeof c.base === 'string' && c.base in BASE_LABELS ? c.base as DrawerBase : 'none',
      footHeight: num(c.footHeight, 0, 12) ?? DEFAULT_FOOT_HEIGHT,
      casterHeight: num(c.casterHeight, 0, 12) ?? DEFAULT_CASTER_HEIGHT,
      kickHeight: num(c.kickHeight, 0, 24) ?? undefined,
      kickSetback: num(c.kickSetback, 0, 24) ?? undefined,
      baseboardHeight: num(c.baseboardHeight, 0, 24) ?? undefined,
      baseboardThickness: num(c.baseboardThickness, 0, 4) ?? undefined,
      exposedSides: readExposed(c.exposedSides),
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
      columns,
      mount: c.mount === 'wall' || c.mount === 'under-desk' ? c.mount : 'floor',
      mountHeight: num(c.mountHeight, 0, 120) ?? undefined,
      cleatHeight: num(c.cleatHeight, 0.5, 12) ?? 3,
      openSlots: Array.isArray(c.openSlots) ? Array.from({ length: drawers }, (_, i) => (c.openSlots as unknown[])[i] === true) : undefined,
      doors: Array.isArray(c.doors) ? Array.from({ length: drawers }, (_, i) => readDoor((c.doors as unknown[])[i])) : undefined,
      slideLengths: Array.isArray(c.slideLengths)
        ? Array.from({ length: drawers }, (_, i) => {
          const v = (c.slideLengths as unknown[])[i];
          return typeof v === 'number' && SLIDE_LENGTHS.includes(v) ? v : null;
        })
        : undefined,
      load: c.load === 'light' || c.load === 'heavy' ? c.load : 'medium',
      finish: readFinish(c.finish),
      bookcase: readBookcase(c.bookcase),
      run: readRun(c.run),
    },
  };
}

/** Columns must account for every drawer; anything inconsistent is dropped rather than guessed. */
function readColumns(raw: unknown, drawers: number, fronts: boolean): DrawerColumn[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_COLUMNS) return undefined;
  const cols: DrawerColumn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined;
    const v = item as Record<string, unknown>;
    const n = typeof v.drawers === 'number' && Number.isInteger(v.drawers) && v.drawers >= 1 && v.drawers <= 12 ? v.drawers : null;
    if (n === null) return undefined;
    const heights = Array.isArray(v.frontHeights) && v.frontHeights.length === n && v.frontHeights.every(h => typeof h === 'number' && h > 0 && h < 60)
      ? v.frontHeights as number[] : undefined;
    if (fronts && !heights) return undefined;
    const width = typeof v.width === 'number' && v.width > 0 && v.width < 120 ? v.width : undefined;
    cols.push({ drawers: n, ...(fronts ? { frontHeights: heights } : {}), ...(width ? { width } : {}) });
  }
  return cols.reduce((a, c) => a + c.drawers, 0) === drawers ? cols : undefined;
}

function readHardware(raw: unknown): PullHardware | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  if (v.kind !== 'knob' && v.kind !== 'bar' && v.kind !== 'cup') return undefined;
  return { kind: v.kind, spacing: typeof v.spacing === 'number' && v.spacing > 0 && v.spacing < 48 ? v.spacing : 3.75 };
}

function readProfile(raw: unknown): FrontProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  if (v.style !== 'shaker') return undefined;
  const n = (x: unknown, fallback: number) => (typeof x === 'number' && x > 0 && x < 12 ? x : fallback);
  return { style: 'shaker', method: v.method === 'applied' ? 'applied' : 'pocket', rail: n(v.rail, DEFAULT_PROFILE.rail), depth: n(v.depth, DEFAULT_PROFILE.depth) };
}

function readDoor(raw: unknown): DoorSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  return {
    hinge: v.hinge === 'left' || v.hinge === 'right' || v.hinge === 'pair' ? v.hinge : 'auto',
    inside: v.inside === 'shelves' || v.inside === 'trays' ? v.inside : 'empty',
    count: typeof v.count === 'number' && Number.isInteger(v.count) && v.count >= 0 && v.count <= 8 ? v.count : 0,
  };
}

function readExposed(raw: unknown): ExposedSides | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  return { left: v.left !== false, right: v.right !== false };
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
  if (v.kind === 'gridfinity') {
    const bins = Array.isArray(v.bins)
      ? (v.bins as unknown[]).flatMap(b => {
        if (!b || typeof b !== 'object') return [];
        const x = b as Record<string, unknown>;
        const w = n(x.w, 1, 20); const dd = n(x.d, 1, 20); const u = n(x.u, 2, 40); const qty = n(x.qty, 0, 400);
        return w && dd && u && qty !== null ? [{ w: Math.floor(w), d: Math.floor(dd), u: Math.floor(u), qty: Math.floor(qty) }] : [];
      })
      : undefined;
    return bins?.length ? { kind: 'gridfinity', bins } : { kind: 'gridfinity' };
  }
  if (v.kind === 'tools') {
    const tools = Array.isArray(v.tools) ? (v.tools as unknown[]).flatMap(t => {
      if (!t || typeof t !== 'object') return [];
      const x = t as Record<string, unknown>;
      const okPt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(c => typeof c === 'number' && Number.isFinite(c));
      const rings = Array.isArray(x.rings) && x.rings.length && x.rings.length <= 20
        && (x.rings as unknown[]).every(r => Array.isArray(r) && r.length >= 3 && r.length <= 400 && r.every(okPt))
        ? x.rings as [number, number][][] : null;
      const width = n(x.width, 0.05, 60);
      const height = n(x.height, 0.05, 60);
      if (!rings || width === null || height === null) return [];
      return [{ name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'Tool', rings, width, height, rotated: x.rotated === true }];
    }) : [];
    return {
      kind: 'tools', tools,
      boardThickness: n(v.boardThickness, 0.1, 3) ?? 0.75,
      pocketDepth: n(v.pocketDepth, 0.05, 3) ?? 0.5,
      fingerHoles: v.fingerHoles !== false,
    };
  }
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

/** About the size of the IKEA ALEX scoop: roughly 165 × 28 mm. */
export const DEFAULT_PULL: FingerPull = { enabled: true, shape: 'alex', width: 6.5, depth: 1.125 };
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
  frontStyle: FrontStyle;
  pullEnabled: boolean;
  pullShape: PullShape;
  pullWidth: string;
  pullDepth: string;
  hardwareKind: HardwareKind;
  hardwareSpacing: string;
  profileStyle: FrontProfile['style'];
  profileMethod: FrontProfile['method'];
  profileRail: string;
  profileDepth: string;
  boxThickness: string;
  bottomThickness: string;
  backThickness: string;
  base: DrawerBase;
  footHeight: string;
  casterHeight: string;
  kickHeight: string;
  kickSetback: string;
  /** '' for automatic (just over the plinth joint). */
  baseboardHeight: string;
  baseboardThickness: string;
  exposedLeft: boolean;
  exposedRight: boolean;
  /** 'auto' or a length in inches. */
  slideLength: string;
  edgeBanding: boolean;
  bandingThickness: string;
  /** Per drawer, top to bottom. */
  insertKinds: InsertKind[];
  /** Per drawer: the Gridfinity bins planned for it. */
  gridfinityBins: GridfinityBin[][];
  /** Per drawer: the tools in its shadow board. */
  toolPockets: ToolPocket[][];
  /** Shadow boards (one spec per design), as typed. */
  toolBoardThickness: string;
  toolPocketDepth: string;
  toolClearance: string;
  toolFingerHoles: boolean;
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
  /** Per position, for doors: hinge side, what's behind it, and how many shelves or trays. */
  doorHinges: DoorHinge[];
  doorInside: DoorInside[];
  doorCounts: number[];
  load: DrawerLoad;
  finishFront: string;
  finishCase: string;
  /** Printer bed in mm, as typed. */
  gridfinityBed: string;
  /** 1 for a single stack; 2–4 for columns side by side. */
  columns: number;
  columnWidthMode: 'equal' | 'custom';
  /** Each column's clear opening (the last takes whatever's left). */
  columnWidths: string[];
  /** With columns: each column's drawer count and front heights. */
  columnDrawers: number[];
  columnFronts: string[][];
  mount: DrawerMount;
  /** Wall: bottom above the floor; under a desk: the desk's underside. As typed. */
  mountHeight: string;
  cleatHeight: string;
  bookcase: BookcaseFields;
  run: RunFields;
}

/** What's in each position: an empty drawer, an insert, or an open cubby (no drawer at all). */
export type InsertKind = 'none' | 'grid' | 'markers' | 'gridfinity' | 'tools' | 'cubby' | 'door';

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
  const cols = columnsOf(c);
  const fronts = cols.length > 1 ? (cols[0].frontHeights ?? frontHeightsOf({ ...c, drawers: cols[0].drawers, frontHeights: undefined })) : frontHeightsOf(c);
  const marker = c.inserts?.find((x): x is Extract<DrawerInsert, { kind: 'markers' }> => x?.kind === 'markers');
  const toolSpec = c.inserts?.find((x): x is Extract<DrawerInsert, { kind: 'tools' }> => x?.kind === 'tools');
  return {
    units,
    thickness: L(c.thickness),
    width: L(c.width),
    height: L((cols[0].frontHeights ?? c.frontHeights) ? overallFromFronts((cols[0].frontHeights ?? c.frontHeights)!, c) : c.height),
    depth: L(c.depth),
    heightMode: saved.heightMode,
    drawers: c.drawers,
    frontHeights: fronts.map(L),
    gap: L(c.gap),
    frontStyle: c.frontStyle ?? 'inset',
    pullEnabled: c.pull.enabled,
    pullShape: c.pull.shape,
    pullWidth: L(c.pull.width),
    pullDepth: L(c.pull.depth),
    hardwareKind: c.hardware?.kind ?? 'none',
    hardwareSpacing: L(c.hardware?.spacing ?? 3.75),
    profileStyle: c.frontProfile?.style ?? 'slab',
    profileMethod: c.frontProfile?.method ?? DEFAULT_PROFILE.method,
    profileRail: L(c.frontProfile?.rail ?? DEFAULT_PROFILE.rail),
    profileDepth: L(c.frontProfile?.depth ?? DEFAULT_PROFILE.depth),
    boxThickness: L(c.boxThickness),
    bottomThickness: L(c.bottomThickness),
    backThickness: L(c.backThickness),
    base: c.base,
    footHeight: L(c.footHeight),
    casterHeight: L(c.casterHeight),
    kickHeight: L(c.kickHeight ?? KICK_HEIGHT),
    kickSetback: L(c.kickSetback ?? KICK_SETBACK),
    baseboardHeight: c.baseboardHeight ? L(c.baseboardHeight) : '',
    baseboardThickness: L(c.baseboardThickness ?? BASEBOARD_THICKNESS),
    exposedLeft: c.exposedSides?.left ?? true,
    exposedRight: c.exposedSides?.right ?? true,
    slideLength: c.slideLength ? String(c.slideLength) : 'auto',
    edgeBanding: c.edgeBanding === true,
    bandingThickness: c.bandingThickness ? `${Math.round(c.bandingThickness * 25.4 * 10) / 10} mm` : '0.5 mm',
    insertKinds: Array.from({ length: c.drawers }, (_, i) => (c.doors?.[i] ? 'door' : c.openSlots?.[i] ? 'cubby' : c.inserts?.[i]?.kind ?? 'none')),
    doorHinges: Array.from({ length: c.drawers }, (_, i) => c.doors?.[i]?.hinge ?? 'auto'),
    doorInside: Array.from({ length: c.drawers }, (_, i) => c.doors?.[i]?.inside ?? 'shelves'),
    doorCounts: Array.from({ length: c.drawers }, (_, i) => c.doors?.[i]?.count ?? 1),
    gridColumns: Array.from({ length: c.drawers }, (_, i) => { const x = c.inserts?.[i]; return x?.kind === 'grid' ? x.columns : 2; }),
    gridfinityBins: Array.from({ length: c.drawers }, (_, i) => { const x = c.inserts?.[i]; return x?.kind === 'gridfinity' ? x.bins ?? [] : []; }),
    toolPockets: Array.from({ length: c.drawers }, (_, i) => { const x = c.inserts?.[i]; return x?.kind === 'tools' ? x.tools : []; }),
    toolBoardThickness: L(toolSpec?.boardThickness ?? 0.75),
    toolPocketDepth: L(toolSpec?.pocketDepth ?? 0.5),
    toolClearance: L(1 / 32),
    toolFingerHoles: toolSpec?.fingerHoles ?? true,
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
    columns: cols.length,
    columnWidthMode: cols.some(x => x.width) ? 'custom' : 'equal',
    columnWidths: cols.map(x => (x.width ? L(x.width) : '')),
    columnDrawers: cols.map(x => x.drawers),
    mount: c.mount ?? 'floor',
    mountHeight: L(c.mountHeight ?? (c.mount === 'under-desk' ? 27.5 : 30)),
    cleatHeight: L(c.cleatHeight ?? 3),
    bookcase: bookcaseToFields(c.bookcase, L),
    run: runToFields(c.run, L),
    columnFronts: cols.map(x => (x.frontHeights ?? equalFronts(x.drawers, c.height - baseHeightOf(c) - frontAllowance(c) - x.drawers * c.gap)).map(L)),
  };
}
