// Shelving unit generator: turns a bay-based design into exact part sizes,
// shelf positions, and dado layouts. All values are inches.
//
// Coordinate model (front elevation): x runs left → right from the outside of
// the left side, y runs up from the floor (or the bottom of a wall unit).
// Depth runs front → back.
//
// Depth stack, front to back:   shelf depth │ back panel │ cleat gap
// Shelves, dividers, top and bottom stop at the back panel; only the outer
// sides run the full depth so they hide the back and the French cleat.

import { parseInches } from './cutPlan.ts';

export type Joinery = 'butt' | 'dado';
export type LengthUnit = 'in' | 'mm';
export type Mounting = 'floor' | 'wall';
/** How the back attaches: inset between the sides, or let into a rabbet (a groove when there's a cleat). */
export type BackJoint = 'inset' | 'rabbet';
/** Shelf-pin hole spacing: 1" (imperial) or the 32 mm system. */
export type PinSystem = 'imperial' | 'metric';
/** Expected shelf load, for the sag check. */
export type ShelfLoad = 'light' | 'books' | 'heavy';

export interface FaceFrameConfig {
  enabled: boolean;
  stileWidth: number;
  railWidth: number;
  /** Solid-wood thickness. */
  thickness: number;
}

export interface ShelfConfig {
  thickness: number;
  bayWidth: number;
  shelfDepth: number;
  height: number;
  bays: number;
  shelvesPerBay: number[];
  topPanel: boolean;
  bottomPanel: boolean;
  backPanel: boolean;
  joinery: Joinery;
  dadoDepth: number;
  mounting: Mounting;
  toeKick: number;
  frenchCleat: boolean;
  cleatHeight: number;
  /** Display unit for notes and warnings. Geometry is always inches. */
  units?: LengthUnit;
  /** Per-bay clear widths; any missing bay uses `bayWidth`. */
  bayWidths?: number[];
  /** Adjustable (loose, on shelf pins) shelves per bay, in addition to the fixed ones. */
  adjustablePerBay?: number[];
  pinSystem?: PinSystem;
  backJoint?: BackJoint;
  faceFrame?: FaceFrameConfig;
  /** Which bays get doors. */
  doorsPerBay?: boolean[];
  shelfLoad?: ShelfLoad;
  /** Band the front edges of the case parts (unless a face frame covers them) and every door edge. */
  edgeBanding?: boolean;
  /** Banding thickness; banded parts are cut this much smaller so the finished size is right. */
  bandingThickness?: number;
}

export interface BandingRun {
  part: string;
  /** Pieces of this part. */
  qty: number;
  /** Banding per piece. */
  length: number;
  edges: string;
}

export interface ShelfPart {
  name: string;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  note?: string;
  /** Plywood parts come from sheets; solid-wood parts (face frame) are bought as boards. */
  material?: 'plywood' | 'solid';
}

export interface BayLayout {
  index: number;
  x: number;
  width: number;
  shelfYs: number[];
  openingHeight: number;
  /** Bottom faces of the adjustable shelves, spread across the bay's openings. */
  adjustableYs: number[];
}

/** A run of shelf-pin holes on one face of a side or divider, inside one opening. */
export interface PinHoleRun {
  panel: string;
  face: 'left' | 'right';
  bay: number;
  /** Heights of the hole centres, from the floor. */
  ys: number[];
  /** Hole columns, measured from the front edge of the panel. */
  frontInset: number;
  backInset: number;
  /** Shifted half a step so holes drilled from both faces of a divider don't meet. */
  staggered: boolean;
}

export interface DoorLayout {
  bay: number;
  /** Left edge and size, in the front elevation. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceFrameLayout {
  thickness: number;
  stileWidth: number;
  topRail: number;
  bottomRail: number;
  /** Centre x of each mullion (over each divider). */
  mullionXs: number[];
  /** Clear opening inside the frame for each bay. */
  openings: { x0: number; x1: number; y0: number; y1: number }[];
}

export interface PanelMarks {
  part: string;
  reference: string;
  positions: number[];
}

export interface ShelfPlan {
  overallWidth: number;
  overallHeight: number;
  overallDepth: number;
  innerSpan: number;
  sideDepth: number;
  backThickness: number;
  cleatGap: number;
  interiorBottom: number;
  interiorTop: number;
  kick: number;
  dadoDepth: number;
  dividerXs: number[];
  bays: BayLayout[];
  parts: ShelfPart[];
  marks: PanelMarks[];
  warnings: string[];
  errors: string[];
  /** Rabbet/groove width cut into each side for the back (0 when the back is inset). */
  backRabbet: number;
  pinHoles: PinHoleRun[];
  pinSpacing: number;
  pinDiameter: number;
  pinDepth: number;
  frame: FaceFrameLayout | null;
  doors: DoorLayout[];
  /** How far the face frame and doors stand in front of the case. */
  frontDepth: number;
  /** Edge banding, when turned on. `caseFronts` is false when a face frame covers them. */
  banding: { thickness: number; caseFronts: boolean; runs: BandingRun[]; totalLength: number } | null;
}

export const SHEET_LENGTH = 96;
/** Side-to-side clearance for an adjustable shelf, and how far short of the back it stops. */
export const ADJUSTABLE_CLEARANCE = 1 / 16;
export const ADJUSTABLE_BACK_CLEARANCE = 1 / 8;
/** Shelf-pin holes stay this far clear of each fixed shelf (and the bottom/top of each opening). */
export const PIN_MARGIN = 2;
/** Bays wider than this get a pair of doors. */
export const PAIR_DOOR_WIDTH = 24;
const DOOR_GAP = 1 / 8;
const DOOR_REVEAL = 1 / 16;
const FRAME_DOOR_OVERLAY = 1 / 2;
export const SHEET_WIDTH = 48;
const EPS = 1e-6;

export function fitsSheet(length: number, width: number): boolean {
  return (length <= SHEET_LENGTH + EPS && width <= SHEET_WIDTH + EPS)
    || (length <= SHEET_WIDTH + EPS && width <= SHEET_LENGTH + EPS);
}

/** Side depth = shelf depth + back panel + cleat gap (cleat is the build thickness). */
export function sidePanelDepth(config: Pick<ShelfConfig, 'shelfDepth' | 'thickness' | 'backPanel' | 'frenchCleat' | 'mounting'>): number {
  const cleat = config.mounting === 'wall' && config.frenchCleat;
  const back = config.backPanel || cleat ? config.thickness : 0;
  return config.shelfDepth + back + (cleat ? config.thickness : 0);
}

/** Each bay's clear width: its own value when given, otherwise the shared bay width. */
export function bayWidthsOf(config: Pick<ShelfConfig, 'bays' | 'bayWidth' | 'bayWidths'>): number[] {
  const n = Math.max(1, Math.floor(config.bays));
  return Array.from({ length: n }, (_, i) => {
    const w = config.bayWidths?.[i];
    return typeof w === 'number' && w > 0 ? w : config.bayWidth;
  });
}

/** Groups bays that share a size, for part names like "Shelf (bays 1, 3)". */
function groupBySize<T>(items: { bay: number; key: number; value: T }[]): { bays: number[]; key: number; values: T[] }[] {
  const groups: { bays: number[]; key: number; values: T[] }[] = [];
  for (const item of items) {
    const group = groups.find(g => Math.abs(g.key - item.key) < 1e-6);
    if (group) { group.bays.push(item.bay); group.values.push(item.value); }
    else groups.push({ bays: [item.bay], key: item.key, values: [item.value] });
  }
  return groups;
}

function bayLabel(bays: number[]): string {
  return bays.length === 1 ? `bay ${bays[0] + 1}` : `bays ${bays.map(b => b + 1).join(', ')}`;
}

/** Bottom edges of `count` evenly spaced fixed shelves inside [bottom, top]. */
export function shelfPositions(bottom: number, top: number, count: number, thickness: number): { ys: number[]; opening: number } {
  const opening = (top - bottom - count * thickness) / (count + 1);
  const ys = Array.from({ length: count }, (_, i) => bottom + (i + 1) * opening + i * thickness);
  return { ys, opening };
}

export function buildShelfPlan(config: ShelfConfig): ShelfPlan {
  const t = config.thickness;
  const D = config.shelfDepth;
  const H = config.height;
  const n = Math.max(1, Math.floor(config.bays));
  const widths = bayWidthsOf(config);
  const errors: string[] = [];
  const warnings: string[] = [];
  const fmt = (inches: number) => formatLength(inches, config.units ?? 'in');

  const cleat = config.mounting === 'wall' && config.frenchCleat;
  const hasBack = config.backPanel || cleat;
  const dado = config.joinery === 'dado';
  const d = dado ? config.dadoDepth : 0;
  const kick = config.mounting === 'floor' && config.bottomPanel ? Math.max(0, config.toeKick) : 0;
  const rabbet = hasBack && config.backJoint === 'rabbet' ? t / 2 : 0;

  if (dado && d >= t) errors.push('Dado depth must be less than the plywood thickness.');
  else if (dado && d > t / 2 + EPS) warnings.push(`A ${fmt(d)} dado is more than half of ${fmt(t)} plywood; 1/3 of the thickness is typical.`);
  widths.forEach((w, i) => { if (!(w > 0)) errors.push(`Bay ${i + 1} needs a width.`); });

  const backThickness = hasBack ? t : 0;
  const cleatGap = cleat ? t : 0;
  const sideDepth = D + backThickness + cleatGap;
  const widthSum = widths.reduce((sum, w) => sum + w, 0);
  const overallWidth = widthSum + (n + 1) * t;
  const innerSpan = widthSum + (n - 1) * t;

  const interiorBottom = config.bottomPanel ? kick + t : 0;
  const interiorTop = config.topPanel ? H - t : H;
  const clearHeight = interiorTop - interiorBottom;
  if (clearHeight <= 0) errors.push('The height leaves no room between the top and bottom panels.');

  const counts = Array.from({ length: n }, (_, i) => Math.max(0, Math.floor(config.shelvesPerBay[i] ?? 0)));
  const adjustableCounts = Array.from({ length: n }, (_, i) => Math.max(0, Math.floor(config.adjustablePerBay?.[i] ?? 0)));
  const xs: number[] = [];
  widths.reduce((x, w) => { xs.push(x); return x + w + t; }, t);

  const bays: BayLayout[] = counts.map((count, index) => {
    const { ys, opening } = shelfPositions(interiorBottom, interiorTop, count, t);
    if (count > 0 && opening <= 0) errors.push(`Bay ${index + 1} has more shelves than its height can hold.`);
    // Spread the adjustable shelves over the openings, tallest first, evenly inside each.
    const bounds = [interiorBottom, ...ys.map(y => y + t)].map((bottom, i) => ({ bottom, top: i < ys.length ? ys[i] : interiorTop }));
    const perOpening = bounds.map(() => 0);
    for (let k = 0; k < adjustableCounts[index]; k++) {
      let best = 0;
      bounds.forEach((b, i) => {
        const clear = (b.top - b.bottom - perOpening[i] * t) / (perOpening[i] + 1);
        const bestClear = (bounds[best].top - bounds[best].bottom - perOpening[best] * t) / (perOpening[best] + 1);
        if (clear > bestClear + EPS) best = i;
      });
      perOpening[best] += 1;
    }
    const adjustableYs = bounds.flatMap((b, i) => {
      const q = perOpening[i];
      if (q === 0) return [];
      const gap = (b.top - b.bottom - q * t) / (q + 1);
      if (gap <= 0) errors.push(`Bay ${index + 1} has more adjustable shelves than its openings can hold.`);
      return Array.from({ length: q }, (_, r) => b.bottom + (r + 1) * gap + r * t);
    });
    return { index, x: xs[index], width: widths[index], shelfYs: ys, openingHeight: opening, adjustableYs };
  });
  const dividerXs = Array.from({ length: n - 1 }, (_, i) => xs[i] + widths[i]);

  // ── Parts ───────────────────────────────────────────────────────────────────
  const parts: ShelfPart[] = [];
  const housed = dado ? ' Housed in dados.' : '';
  const rabbetNote = rabbet > 0
    ? `Cut a ${fmt(rabbet)} × ${fmt(t)} ${cleat ? 'groove' : 'rabbet'} for the back, ${fmt(D)} from the front edge.`
    : '';

  parts.push({
    name: 'Side',
    qty: 2,
    length: H,
    width: sideDepth,
    thickness: t,
    note: [
      hasBack && !rabbet ? `Back sits ${fmt(D)} from the front edge.` : '',
      rabbetNote,
      cleat ? `Extends ${fmt(cleatGap)} past the back for the cleat.` : '',
    ].filter(Boolean).join(' ') || undefined,
  });

  if (n > 1) {
    const dividerBottom = config.bottomPanel ? interiorBottom - d : 0;
    const dividerTop = config.topPanel ? interiorTop + d : H;
    parts.push({
      name: 'Divider',
      qty: n - 1,
      length: dividerTop - dividerBottom,
      width: D,
      thickness: t,
      note: dado && (config.topPanel || config.bottomPanel) ? 'Ends housed in top/bottom dados.' : undefined,
    });
  }

  const panelLength = innerSpan + 2 * d;
  if (config.topPanel) parts.push({ name: 'Top', qty: 1, length: panelLength, width: D, thickness: t, note: housed.trim() || undefined });
  if (config.bottomPanel) parts.push({ name: 'Bottom', qty: 1, length: panelLength, width: D, thickness: t, note: housed.trim() || undefined });

  // Fixed shelves, one part per distinct bay width.
  const fixedGroups = groupBySize(bays.filter(b => counts[b.index] > 0).map(b => ({ bay: b.index, key: b.width, value: counts[b.index] })));
  for (const g of fixedGroups) {
    parts.push({
      name: fixedGroups.length === 1 ? 'Shelf' : `Shelf (${bayLabel(g.bays)})`,
      qty: g.values.reduce((a, c) => a + c, 0),
      length: g.key + 2 * d,
      width: D,
      thickness: t,
      note: housed.trim() || undefined,
    });
  }
  const adjustableGroups = groupBySize(bays.filter(b => adjustableCounts[b.index] > 0).map(b => ({ bay: b.index, key: b.width, value: adjustableCounts[b.index] })));
  for (const g of adjustableGroups) {
    parts.push({
      name: adjustableGroups.length === 1 ? 'Adjustable shelf' : `Adjustable shelf (${bayLabel(g.bays)})`,
      qty: g.values.reduce((a, c) => a + c, 0),
      length: g.key - ADJUSTABLE_CLEARANCE,
      width: D - ADJUSTABLE_BACK_CLEARANCE,
      thickness: t,
      note: `Sits on shelf pins; ${fmt(ADJUSTABLE_CLEARANCE)} narrower than the bay so it lifts out.`,
    });
  }

  if (hasBack) {
    const backHeight = H - kick;
    for (const piece of splitBack(backHeight, dividerXs, t, overallWidth, rabbet)) {
      parts.push({
        name: piece.name,
        qty: 1,
        length: backHeight,
        width: piece.width,
        thickness: t,
        note: piece.note,
      });
    }
  }

  if (kick > 0) {
    parts.push({ name: 'Toe kick', qty: 1, length: innerSpan, width: kick, thickness: t, note: 'Fits between the sides under the bottom.' });
  }

  if (cleat) {
    const h = config.cleatHeight;
    parts.push({ name: 'Cabinet cleat', qty: 1, length: innerSpan, width: h, thickness: t, note: '45° bevel on the lower edge, pointing down toward the back.' });
    parts.push({ name: 'Wall cleat', qty: 1, length: innerSpan, width: h, thickness: t, note: '45° bevel on the upper edge; screw into studs.' });
    parts.push({ name: 'Bottom spacer', qty: 1, length: innerSpan, width: h, thickness: t, note: 'Behind the back at the bottom so the unit hangs plumb.' });
    if (h > clearHeight / 3) warnings.push('The cleat is tall relative to the cabinet; check it clears the top shelf opening.');
  }

  // ── Face frame ──────────────────────────────────────────────────────────────
  let frame: FaceFrameLayout | null = null;
  const ff = config.faceFrame;
  if (ff?.enabled) {
    const sw = ff.stileWidth;
    const bottomRail = Math.max(ff.railWidth, interiorBottom);
    const topRail = Math.max(ff.railWidth, H - interiorTop);
    const mullionXs = dividerXs.map(x => x + t / 2);
    const openings = bays.map((_, i) => ({
      x0: i === 0 ? sw : mullionXs[i - 1] + sw / 2,
      x1: i === n - 1 ? overallWidth - sw : mullionXs[i] - sw / 2,
      y0: bottomRail,
      y1: H - topRail,
    }));
    openings.forEach((o, i) => {
      if (o.x1 - o.x0 <= 0 || o.y1 - o.y0 <= 0) errors.push(`The face frame closes off bay ${i + 1}; use narrower stiles and rails.`);
    });
    frame = { thickness: ff.thickness, stileWidth: sw, topRail, bottomRail, mullionXs, openings };
    const solid = { thickness: ff.thickness, material: 'solid' as const };
    parts.push({ name: 'Face frame stile', qty: 2, length: H, width: sw, ...solid, note: 'Flush with the outside of each side.' });
    const railLength = overallWidth - 2 * sw;
    if (Math.abs(topRail - bottomRail) < EPS) {
      parts.push({ name: 'Face frame rail', qty: 2, length: railLength, width: topRail, ...solid, note: 'Top and bottom, between the stiles.' });
    } else {
      parts.push({ name: 'Face frame top rail', qty: 1, length: railLength, width: topRail, ...solid, note: 'Between the stiles.' });
      parts.push({ name: 'Face frame bottom rail', qty: 1, length: railLength, width: bottomRail, ...solid, note: 'Between the stiles; covers the bottom edge.' });
    }
    if (n > 1) {
      parts.push({ name: 'Face frame mullion', qty: n - 1, length: H - topRail - bottomRail, width: sw, ...solid, note: 'Between the rails, centred on each divider.' });
    }
  }

  // ── Doors ───────────────────────────────────────────────────────────────────
  const doors: DoorLayout[] = [];
  const doorBays = (config.doorsPerBay ?? []).slice(0, n);
  bays.forEach((bay, i) => {
    if (!doorBays[i]) return;
    let x0: number; let x1: number; let y0: number; let y1: number;
    if (frame) {
      const o = frame.openings[i];
      x0 = o.x0 - FRAME_DOOR_OVERLAY; x1 = o.x1 + FRAME_DOOR_OVERLAY;
      y0 = o.y0 - FRAME_DOOR_OVERLAY; y1 = o.y1 + FRAME_DOOR_OVERLAY;
    } else {
      // Full overlay: cover the outer sides, and half of each divider.
      x0 = i === 0 ? DOOR_REVEAL : dividerXs[i - 1] + t / 2 + DOOR_GAP / 2;
      x1 = i === n - 1 ? overallWidth - DOOR_REVEAL : dividerXs[i] + t / 2 - DOOR_GAP / 2;
      y0 = kick + DOOR_REVEAL;
      y1 = H - DOOR_REVEAL;
    }
    const span = x1 - x0;
    if (bay.width > PAIR_DOOR_WIDTH) {
      const w = (span - DOOR_GAP) / 2;
      doors.push({ bay: i, x: x0, y: y0, width: w, height: y1 - y0 });
      doors.push({ bay: i, x: x0 + w + DOOR_GAP, y: y0, width: w, height: y1 - y0 });
    } else {
      doors.push({ bay: i, x: x0, y: y0, width: span, height: y1 - y0 });
    }
  });
  const doorGroups = groupBySize(doors.map(dr => ({ bay: dr.bay, key: Math.round(dr.width * 1e4) * 1e5 + Math.round(dr.height * 1e4), value: dr })));
  for (const g of doorGroups) {
    const first = g.values[0];
    parts.push({
      name: doorGroups.length === 1 ? 'Door' : `Door (${bayLabel([...new Set(g.bays)])})`,
      qty: g.values.length,
      length: first.height,
      width: first.width,
      thickness: t,
      note: frame ? `${fmt(FRAME_DOOR_OVERLAY)} overlay on the face frame.` : 'Full overlay on the case.',
    });
  }

  // ── Edge banding: cut banded parts smaller so they finish at size ────────────
  let banding: ShelfPlan['banding'] = null;
  if (config.edgeBanding) {
    const b = Math.max(0, config.bandingThickness ?? 0.02);
    const caseFronts = !frame;
    const runs: BandingRun[] = [];
    const fronted = (name: string) => ['Side', 'Divider', 'Top', 'Bottom'].includes(name) || name.startsWith('Shelf') || name.startsWith('Adjustable shelf');
    for (const part of parts) {
      if (caseFronts && fronted(part.name)) {
        part.width -= b;
        runs.push({ part: part.name, qty: part.qty, length: part.length, edges: 'front edge' });
        part.note = [part.note, b > 0 ? `Cut ${fmt(b)} narrower; band the front edge.` : 'Band the front edge.'].filter(Boolean).join(' ');
      } else if (part.name.startsWith('Door')) {
        part.length -= 2 * b;
        part.width -= 2 * b;
        runs.push({ part: part.name, qty: part.qty, length: 2 * (part.length + part.width) + 8 * b, edges: 'all four edges' });
        part.note = [part.note, b > 0 ? `Cut ${fmt(2 * b)} smaller each way; band all four edges.` : 'Band all four edges.'].filter(Boolean).join(' ');
      }
    }
    banding = { thickness: b, caseFronts, runs, totalLength: runs.reduce((sum, run) => sum + run.qty * run.length, 0) };
  }

  for (const part of parts) {
    if (part.material !== 'solid' && !fitsSheet(part.length, part.width)) {
      warnings.push(`${part.name} (${fmt(part.length)} × ${fmt(part.width)}) does not fit a ${config.units === 'mm' ? '1220 × 2440 mm' : '4×8'} sheet.`);
    }
  }

  // ── Opposing dados in dividers ──────────────────────────────────────────────
  if (dado) {
    const web = t - 2 * d;
    for (let i = 0; i < n - 1; i++) {
      const left = bays[i].shelfYs;
      const right = bays[i + 1].shelfYs;
      const opposing = left.some(a => right.some(b => Math.abs(a - b) < t - EPS));
      if (opposing && web < t / 3 - EPS) {
        warnings.push(`Divider ${i + 1} has dados on both faces at the same height, leaving only ${fmt(Math.max(0, web))} of material. Use shallower dados or offset the shelf counts.`);
      }
    }
  }

  // ── Shelf-pin holes ─────────────────────────────────────────────────────────
  const metricPins = config.pinSystem === 'metric';
  const pinSpacing = metricPins ? 32 / MM_PER_INCH : 1;
  const pinDiameter = metricPins ? 5 / MM_PER_INCH : 0.25;
  const pinDepth = Math.min(metricPins ? 10 / MM_PER_INCH : 0.375, t * 0.6);
  const pinInset = metricPins ? 37 / MM_PER_INCH : 1.5;
  const pinMargin = PIN_MARGIN;
  const pinHoles: PinHoleRun[] = [];
  bays.forEach((bay, i) => {
    if (adjustableCounts[i] === 0) return;
    const bounds = [interiorBottom, ...bay.shelfYs.map(y => y + t)].map((bottom, k) => ({ bottom, top: k < bay.shelfYs.length ? bay.shelfYs[k] : interiorTop }));
    const ysFor = (offset: number) => bounds.flatMap(b => {
      const from = b.bottom + pinMargin + offset;
      const to = b.top - pinMargin;
      const out: number[] = [];
      for (let y = from; y <= to + EPS; y += pinSpacing) out.push(y);
      return out;
    });
    const leftPanel = i === 0 ? 'Left side' : `Divider ${i}`;
    const rightPanel = i === n - 1 ? 'Right side' : `Divider ${i + 1}`;
    // A divider drilled from both faces gets the second face shifted half a step.
    const leftStagger = i > 0 && adjustableCounts[i - 1] > 0 && 2 * pinDepth >= t - EPS;
    pinHoles.push({ panel: leftPanel, face: 'right', bay: i, ys: ysFor(leftStagger ? pinSpacing / 2 : 0), frontInset: pinInset, backInset: D - pinInset, staggered: leftStagger });
    pinHoles.push({ panel: rightPanel, face: 'left', bay: i, ys: ysFor(0), frontInset: pinInset, backInset: D - pinInset, staggered: false });
  });

  // ── Layout marks (bottom edge of each shelf/dado, from the part's end) ─────
  const marks: PanelMarks[] = [];
  const sideMarks = (ys: number[]) => {
    const list = [...ys];
    if (config.bottomPanel) list.push(kick);
    if (config.topPanel) list.push(H - t);
    return list.sort((a, b) => a - b);
  };
  marks.push({ part: 'Left side', reference: 'from the bottom end, inside face', positions: sideMarks(bays[0].shelfYs) });
  const dividerOrigin = config.bottomPanel ? interiorBottom - d : 0;
  for (let i = 0; i < n - 1; i++) {
    marks.push({ part: `Divider ${i + 1}`, reference: 'from the bottom end, left face', positions: bays[i].shelfYs.map(y => y - dividerOrigin) });
    marks.push({ part: `Divider ${i + 1}`, reference: 'from the bottom end, right face', positions: bays[i + 1].shelfYs.map(y => y - dividerOrigin) });
  }
  marks.push({ part: 'Right side', reference: 'from the bottom end, inside face', positions: sideMarks(bays[n - 1].shelfYs) });
  if (n > 1 && (config.topPanel || config.bottomPanel)) {
    // Divider left faces measured from the panel's left end (panel starts d inside the left side).
    const fromEnd = dividerXs.map(x => x - (t - d));
    if (config.topPanel) marks.push({ part: 'Top', reference: 'divider left edge, from the left end, underside', positions: fromEnd });
    if (config.bottomPanel) marks.push({ part: 'Bottom', reference: 'divider left edge, from the left end, top face', positions: fromEnd });
  }

  const frontDepth = (frame ? frame.thickness : 0) + (doors.length > 0 ? t : 0);

  return {
    overallWidth,
    overallHeight: H,
    overallDepth: sideDepth + frontDepth,
    innerSpan,
    sideDepth,
    backThickness,
    cleatGap,
    interiorBottom,
    interiorTop,
    kick,
    dadoDepth: d,
    dividerXs,
    bays,
    parts,
    marks: marks.filter(m => m.positions.length > 0),
    warnings,
    errors,
    backRabbet: rabbet,
    pinHoles,
    pinSpacing,
    pinDiameter,
    pinDepth,
    frame,
    doors,
    frontDepth,
    banding,
  };
}

/**
 * One back panel when it fits a sheet; otherwise split it into the fewest
 * runs of whole bays, with seams centered on dividers. A rabbeted back
 * reaches `rabbet` into each side.
 */
function splitBack(height: number, dividerXs: number[], t: number, overallWidth: number, rabbet: number) {
  const left = t - rabbet;
  const right = overallWidth - t + rabbet;
  const where = rabbet > 0 ? 'Let into the rabbets in the sides, behind the shelves.' : 'Inset between the sides, behind the shelves.';
  if (fitsSheet(height, right - left) || dividerXs.length === 0) {
    return [{ name: 'Back', width: right - left, note: where }];
  }
  const seams = dividerXs.map(x => x + t / 2);
  const edges = [left, ...seams, right];
  const pieces: { start: number; end: number }[] = [];
  let start = edges[0];
  for (let i = 1; i < edges.length; i++) {
    const next = edges[i + 1];
    const canExtend = next !== undefined && fitsSheet(height, next - start);
    if (!canExtend) {
      pieces.push({ start, end: edges[i] });
      start = edges[i];
    }
  }
  return pieces.map((p, i) => ({
    name: `Back ${i + 1} of ${pieces.length}`,
    width: p.end - p.start,
    note: 'Seams land on divider centers.',
  }));
}

// ── 3D solids ─────────────────────────────────────────────────────────────────
// Visible extents of each part (dado tongues are hidden inside their housings,
// so they are not modeled). x → right, y → up, z → back from the front edge.

export type SolidKind = 'case' | 'shelf' | 'adjustable' | 'pin' | 'back' | 'cleat' | 'wall-cleat' | 'groove' | 'pinhole' | 'frame' | 'door'
  | 'drawer-front' | 'drawer-box' | 'slide' | 'foot' | 'caster' | 'insert';

export type Solid =
  | {
    name: string; kind: SolidKind; shape: 'box'; min: [number, number, number]; max: [number, number, number];
    /** For grooves: the part they are cut into, and which way its grooved face points along x. */
    on?: string; face?: 1 | -1;
  }
  /** A profile in the (z, y) plane extruded from x0 to x1 — used for beveled cleats. */
  | { name: string; kind: SolidKind; shape: 'prism'; x0: number; x1: number; profile: [number, number][] }
  /** An outline in the front (x, y) plane extruded from depth z0 to z1 — used for notched drawer fronts. */
  | { name: string; kind: SolidKind; shape: 'plate'; z0: number; z1: number; outline: [number, number][]; holes?: [number, number][][] };

export function shelfSolids(plan: ShelfPlan, config: ShelfConfig): Solid[] {
  const t = config.thickness;
  const D = config.shelfDepth;
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const hasTop = plan.interiorTop < H;
  const hasBottom = config.bottomPanel;
  const box = (name: string, kind: SolidKind, min: [number, number, number], max: [number, number, number]): Solid =>
    ({ name, kind, shape: 'box', min, max });

  const solids: Solid[] = [
    box('Left side', 'case', [0, 0, 0], [t, H, plan.sideDepth]),
    box('Right side', 'case', [W - t, 0, 0], [W, H, plan.sideDepth]),
  ];
  plan.dividerXs.forEach((x, i) => {
    solids.push(box(`Divider ${i + 1}`, 'case', [x, hasBottom ? plan.interiorBottom : 0, 0], [x + t, plan.interiorTop, D]));
  });
  if (hasTop) solids.push(box('Top', 'case', [t, H - t, 0], [W - t, H, D]));
  if (hasBottom) solids.push(box('Bottom', 'case', [t, plan.kick, 0], [W - t, plan.kick + t, D]));
  if (plan.kick > 0) solids.push(box('Toe kick', 'case', [t, 0, 0], [W - t, plan.kick, t]));
  for (const bay of plan.bays) {
    bay.shelfYs.forEach((y, i) => {
      solids.push(box(`Bay ${bay.index + 1} shelf ${i + 1}`, 'shelf', [bay.x, y, 0], [bay.x + bay.width, y + t, D]));
    });
  }
  // Adjustable shelves rest on four shelf pins. They're drawn larger than life —
  // a real 1/4" pin is a speck at full-unit scale — so the shelves read as loose.
  const pin = Math.max(plan.pinDiameter, 0.5);
  const pinReach = 0.75;
  const pinColumns = plan.pinHoles[0] ? [plan.pinHoles[0].frontInset, plan.pinHoles[0].backInset] : [1.5, D - 1.5];
  for (const bay of plan.bays) {
    bay.adjustableYs.forEach((y, i) => {
      const x0 = bay.x + ADJUSTABLE_CLEARANCE / 2;
      const name = `Bay ${bay.index + 1} adjustable shelf ${i + 1}`;
      solids.push(box(name, 'adjustable', [x0, y, 0], [x0 + bay.width - ADJUSTABLE_CLEARANCE, y + t, D - ADJUSTABLE_BACK_CLEARANCE]));
      for (const [side, xa, xb] of [['left', bay.x, bay.x + pinReach], ['right', bay.x + bay.width - pinReach, bay.x + bay.width]] as const) {
        pinColumns.forEach((z, k) => {
          solids.push(box(`${name} pin ${side} ${k === 0 ? 'front' : 'back'}`, 'pin', [xa, y - pin, z - pin / 2], [xb, y, z + pin / 2]));
        });
      }
    });
  }
  if (plan.backThickness > 0) {
    const r = plan.backRabbet;
    solids.push(box('Back', 'back', [t - r, plan.kick, D], [W - t + r, H, D + plan.backThickness]));
  }
  // Face frame and doors stand in front of the case (negative depth).
  if (plan.frame) {
    const f = plan.frame;
    const z: [number, number] = [-f.thickness, 0];
    const fbox = (name: string, x0: number, x1: number, y0: number, y1: number) =>
      solids.push(box(name, 'frame', [x0, y0, z[0]], [x1, y1, z[1]]));
    fbox('Face frame left stile', 0, f.stileWidth, 0, H);
    fbox('Face frame right stile', W - f.stileWidth, W, 0, H);
    fbox('Face frame top rail', f.stileWidth, W - f.stileWidth, H - f.topRail, H);
    fbox('Face frame bottom rail', f.stileWidth, W - f.stileWidth, 0, f.bottomRail);
    f.mullionXs.forEach((cx, i) => fbox(`Face frame mullion ${i + 1}`, cx - f.stileWidth / 2, cx + f.stileWidth / 2, f.bottomRail, H - f.topRail));
  }
  const doorFront = -(plan.frame ? plan.frame.thickness : 0);
  plan.doors.forEach((dr, i) => {
    solids.push(box(`Door ${i + 1}`, 'door', [dr.x, dr.y, doorFront - t], [dr.x + dr.width, dr.y + dr.height, doorFront]));
  });
  if (plan.cleatGap > 0) {
    const z0 = D + plan.backThickness;
    const z1 = z0 + plan.cleatGap;
    const h = config.cleatHeight;
    const top = H - (hasTop ? t : 0);
    const bevel = Math.min(plan.cleatGap, h / 2);
    // Cabinet cleat: tall face against the back, 45° bevel down toward the wall.
    solids.push({ name: 'Cabinet cleat', kind: 'cleat', shape: 'prism', x0: t, x1: W - t,
      profile: [[z0, top], [z1, top], [z1, top - h + bevel], [z0, top - h]] });
    // Wall cleat: nests under it, bevel up against the wall.
    solids.push({ name: 'Wall cleat', kind: 'wall-cleat', shape: 'prism', x0: t, x1: W - t,
      profile: [[z0, top - h], [z1, top - h + bevel], [z1, top - 2 * h + bevel], [z0, top - 2 * h]] });
    solids.push(box('Bottom spacer', 'cleat', [t, 0, z0], [W - t, h, z1]));
  }
  return solids;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Nearest 1/32" as a mixed fraction, e.g. 17 3/8". Flags values that were rounded. */
export function fmt(inches: number, unit = '"'): string {
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const thirtySeconds = Math.round(abs * 32);
  const whole = Math.floor(thirtySeconds / 32);
  const rem = thirtySeconds % 32;
  const approx = Math.abs(thirtySeconds / 32 - abs) > 1e-4 ? '≈' : '';
  if (rem === 0) return `${approx}${sign}${whole}${unit}`;
  const g = gcd(rem, 32);
  const frac = `${rem / g}/${32 / g}`;
  return `${approx}${sign}${whole > 0 ? `${whole} ` : ''}${frac}${unit}`;
}

export const MM_PER_INCH = 25.4;

/** Millimeters, rounded to 0.1 mm, e.g. 444.5 mm. */
export function fmtMm(inches: number): string {
  const mm = Math.round(inches * MM_PER_INCH * 10 + 1e-9) / 10;
  return `${Number.isInteger(mm) ? mm : mm.toFixed(1)} mm`;
}

export function formatLength(inches: number, unit: LengthUnit): string {
  return unit === 'mm' ? fmtMm(inches) : fmt(inches);
}

/**
 * Parses a length typed in either system and returns inches. An explicit unit
 * always wins (`18mm`, `1.8 cm`, `3/4"`, `3/4 in`, `2' 6`); a bare number uses
 * the default unit. Inches accept fractions such as `17 1/2` or `23/32`.
 */
export function parseLength(raw: string, defaultUnit: LengthUnit): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, '.');
  if (s === '') return null;
  const metric = s.match(/^(\d*\.?\d+)\s*(mm|cm|m)$/);
  if (metric) {
    const factor = metric[2] === 'mm' ? 1 : metric[2] === 'cm' ? 10 : 1000;
    const value = Number(metric[1]) * factor / MM_PER_INCH;
    return value > 0 ? value : null;
  }
  const inchSuffix = s.match(/^(.*?)\s*(in|inch|inches)$/);
  if (inchSuffix) return strictInches(inchSuffix[1]);
  if (/["'’”]/.test(s) || /\//.test(s) || /[½¼¾⅛⅜⅝⅞]/.test(s)) return strictInches(s);
  if (defaultUnit === 'mm') {
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const value = Number(s) / MM_PER_INCH;
    return value > 0 ? value : null;
  }
  return strictInches(s);
}

// Whole-string inch grammar: optional feet, then a decimal, a whole number plus a
// fraction, a bare fraction, or a vulgar fraction, then an optional inch mark.
// parseInches reads prefixes (so "96x" would become 96); this rejects typos instead.
const INCH_SYNTAX = /^(?:\d+\s*['’]\s*)?(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+|\d*\s*[½¼¾⅛⅜⅝⅞])?\s*(?:"|''|”)?$/u;

function strictInches(text: string): number | null {
  const s = text.trim();
  if (!/[\d½¼¾⅛⅜⅝⅞]/u.test(s) || !INCH_SYNTAX.test(s)) return null;
  if (/\/0+(?!\d)/.test(s)) return null; // x/0
  const value = parseInches(s);
  return value !== null && Number.isFinite(value) ? value : null;
}

/** Writes a length back into a form field in the given unit, keeping it exact where possible. */
export function lengthToField(inches: number, unit: LengthUnit): string {
  if (unit === 'mm') return String(Math.round(inches * MM_PER_INCH * 100) / 100);
  // Millimeter fields keep 0.01 mm, so a value within half of that of a 1/32"
  // mark came from a fraction (23/32" → 18.26 mm) and goes back to it.
  const nearest = Math.round(inches * 32) / 32;
  if (Math.abs(inches - nearest) <= 0.005 / MM_PER_INCH + 1e-9) return fmt(nearest, '');
  return String(Number(inches.toFixed(4)));
}

/** Compact decimal string for the cut plan optimizer, which parses inches. */
export function decimalString(inches: number): string {
  return String(Number(inches.toFixed(4)));
}

// ── Project cut list export ───────────────────────────────────────────────────

export interface ProjectCutItemInput {
  part_name: string;
  qty: number;
  length: string;
  width: string;
  thickness: string;
  material: string;
}

/**
 * Project cut lists are read as inches everywhere (detail page, sheet layout),
 * so parts are written in inches: exact fractions where possible, otherwise a
 * 4-place decimal — never millimeters, which those readers would misparse.
 */
export function projectCutItems(plan: ShelfPlan, material = 'Plywood'): ProjectCutItemInput[] {
  return plan.parts.map(part => ({
    part_name: part.name,
    qty: part.qty,
    length: lengthToField(part.length, 'in'),
    width: lengthToField(part.width, 'in'),
    thickness: lengthToField(part.thickness, 'in'),
    material,
  }));
}

/** A default title for a new project, e.g. "Shelving unit 73 3/4\" × 74\"". */
export function shelfProjectTitle(plan: ShelfPlan, units: LengthUnit): string {
  return `Shelving unit ${formatLength(plan.overallWidth, units)} × ${formatLength(plan.overallHeight, units)}`;
}

// ── Saved designs ─────────────────────────────────────────────────────────────

export const SHELF_DESIGN_VERSION = 1;

export interface SavedShelfDesign {
  version: 1;
  units: LengthUnit;
  /** Which height the designer typed; the config always stores the overall height. */
  heightMode: HeightMode;
  config: ShelfConfig;
}

export function toSavedShelfDesign(config: ShelfConfig, units: LengthUnit, heightMode: HeightMode = 'overall'): SavedShelfDesign {
  return { version: SHELF_DESIGN_VERSION, units, heightMode, config: { ...config, units } };
}

/**
 * Reads a design back from storage, rejecting anything that isn't a usable
 * design (wrong version, missing or out-of-range sizes) rather than guessing.
 */
export function readSavedShelfDesign(raw: unknown): SavedShelfDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== SHELF_DESIGN_VERSION || !value.config || typeof value.config !== 'object') return null;
  const c = value.config as Record<string, unknown>;
  const units: LengthUnit = value.units === 'mm' ? 'mm' : 'in';
  const num = (key: string, min: number, max: number) => {
    const n = c[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const thickness = num('thickness', 0.05, 3);
  const bayWidth = num('bayWidth', 1, 200);
  const shelfDepth = num('shelfDepth', 1, 100);
  const height = num('height', 1, 200);
  const bays = num('bays', 1, 12);
  if (thickness === null || bayWidth === null || shelfDepth === null || height === null || bays === null) return null;
  const shelves = Array.isArray(c.shelvesPerBay) ? c.shelvesPerBay : [];
  const shelvesPerBay = Array.from({ length: Math.floor(bays) }, (_, i) => {
    const n = shelves[i];
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(20, Math.max(0, Math.floor(n))) : 0;
  });
  return {
    version: SHELF_DESIGN_VERSION,
    units,
    // Designs saved before opening height existed were typed as overall height.
    // ('bay' was a short-lived total-clear-height mode; reopen those as opening height.)
    heightMode: value.heightMode === 'opening' || value.heightMode === 'bay' ? 'opening' : 'overall',
    config: {
      thickness, bayWidth, shelfDepth, height,
      bays: Math.floor(bays),
      shelvesPerBay,
      topPanel: c.topPanel !== false,
      bottomPanel: c.bottomPanel !== false,
      backPanel: c.backPanel !== false,
      joinery: c.joinery === 'butt' ? 'butt' : 'dado',
      dadoDepth: num('dadoDepth', 0, 3) ?? 0,
      mounting: c.mounting === 'wall' ? 'wall' : 'floor',
      toeKick: num('toeKick', 0, 24) ?? 0,
      frenchCleat: c.frenchCleat === true,
      cleatHeight: num('cleatHeight', 0.5, 24) ?? 3,
      units,
      bayWidths: Array.isArray(c.bayWidths)
        ? Array.from({ length: Math.floor(bays) }, (_, i) => {
          const w = (c.bayWidths as unknown[])[i];
          return typeof w === 'number' && Number.isFinite(w) && w >= 1 && w <= 200 ? w : bayWidth;
        })
        : undefined,
      adjustablePerBay: Array.from({ length: Math.floor(bays) }, (_, i) => {
        const a = Array.isArray(c.adjustablePerBay) ? (c.adjustablePerBay as unknown[])[i] : 0;
        return typeof a === 'number' && Number.isFinite(a) ? Math.min(20, Math.max(0, Math.floor(a))) : 0;
      }),
      pinSystem: c.pinSystem === 'metric' ? 'metric' : 'imperial',
      backJoint: c.backJoint === 'rabbet' ? 'rabbet' : 'inset',
      faceFrame: readFaceFrame(c.faceFrame),
      doorsPerBay: Array.from({ length: Math.floor(bays) }, (_, i) => Array.isArray(c.doorsPerBay) && (c.doorsPerBay as unknown[])[i] === true),
      shelfLoad: c.shelfLoad === 'light' || c.shelfLoad === 'heavy' ? c.shelfLoad : 'books',
      edgeBanding: c.edgeBanding === true,
      bandingThickness: num('bandingThickness', 0, 0.15) ?? 0.02,
    },
  };
}

function readFaceFrame(raw: unknown): FaceFrameConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Record<string, unknown>;
  const ok = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (f.enabled !== true || !ok(f.stileWidth, 0.5, 12) || !ok(f.railWidth, 0.5, 12) || !ok(f.thickness, 0.25, 3)) return undefined;
  return { enabled: true, stileWidth: f.stileWidth as number, railWidth: f.railWidth as number, thickness: f.thickness as number };
}

export interface ShelfDesignFields {
  units: LengthUnit;
  thickness: string;
  bayWidth: string;
  shelfDepth: string;
  /** Which of the two height fields drives the design. */
  heightMode: HeightMode;
  /** Clear height of each shelf opening (in the bay with the most shelves). */
  openingHeight: string;
  /** Overall height of the unit. */
  height: string;
  bays: number;
  shelvesPerBay: number[];
  topPanel: boolean;
  bottomPanel: boolean;
  backPanel: boolean;
  joinery: Joinery;
  dadoDepth: string;
  mounting: Mounting;
  toeKick: string;
  frenchCleat: boolean;
  cleatHeight: string;
  /** 'same' uses bayWidth for every bay; 'custom' uses bayWidths. */
  bayWidthMode: 'same' | 'custom';
  bayWidths: string[];
  adjustablePerBay: number[];
  pinSystem: PinSystem;
  backJoint: BackJoint;
  faceFrame: boolean;
  stileWidth: string;
  railWidth: string;
  frameThickness: string;
  doorsPerBay: boolean[];
  shelfLoad: ShelfLoad;
  edgeBanding: boolean;
  /** Kept with its unit (e.g. "0.5 mm") so it reads the same in either unit mode. */
  bandingThickness: string;
}

/** Turns a saved design back into Shelf Builder form fields, in the unit it was designed in. */
export function shelfDesignToFields(saved: SavedShelfDesign): ShelfDesignFields {
  const { config, units } = saved;
  const field = (inches: number) => lengthToField(inches, units);
  return {
    units,
    thickness: field(config.thickness),
    bayWidth: field(config.bayWidth),
    shelfDepth: field(config.shelfDepth),
    heightMode: saved.heightMode,
    openingHeight: field(openingHeightFromOverall(config.height, config.shelvesPerBay, config)),
    height: field(config.height),
    bays: config.bays,
    shelvesPerBay: [...config.shelvesPerBay],
    topPanel: config.topPanel,
    bottomPanel: config.bottomPanel,
    backPanel: config.backPanel,
    joinery: config.joinery,
    dadoDepth: config.dadoDepth > 0 ? field(config.dadoDepth) : (units === 'mm' ? '6' : '1/4'),
    mounting: config.mounting,
    toeKick: config.toeKick > 0 ? field(config.toeKick) : '0',
    frenchCleat: config.frenchCleat,
    cleatHeight: field(config.cleatHeight),
    ...extraFields(config, units),
  };
}

// ── Opening height ↔ overall height ───────────────────────────────────────────

/**
 * 'opening': the designer gives the clear height of each shelf opening and the
 * overall height is built up from it. 'overall': the designer gives the overall
 * height and the openings divide whatever is inside.
 */
export type HeightMode = 'opening' | 'overall';

type HeightInputs = Pick<ShelfConfig, 'thickness' | 'topPanel' | 'bottomPanel' | 'mounting' | 'toeKick'>;

/**
 * What the case adds around the clear bay height: the top and bottom panels,
 * plus the toe kick (floor units with a bottom only — the same rule buildShelfPlan uses).
 */
export function heightAllowance(c: HeightInputs): number {
  const kick = c.mounting === 'floor' && c.bottomPanel ? Math.max(0, c.toeKick) : 0;
  return (c.topPanel ? c.thickness : 0) + (c.bottomPanel ? c.thickness : 0) + kick;
}

/** The bay with the most shelves sets the height; the others get taller openings. */
function mostShelves(shelvesPerBay: number[]): number {
  return Math.max(0, ...shelvesPerBay.map(n => Math.max(0, Math.floor(n))));
}

/**
 * Overall height when every opening in the fullest bay is `openingHeight` clear:
 * openings × height + the shelves between them + top, bottom and toe kick.
 * e.g. 2 openings of 3" in 1/2" plywood: 2×3 + 1×½ (shelf) + ½ + ½ = 7½".
 */
export function overallFromOpeningHeight(openingHeight: number, shelvesPerBay: number[], c: HeightInputs): number {
  const shelves = mostShelves(shelvesPerBay);
  return (shelves + 1) * openingHeight + shelves * c.thickness + heightAllowance(c);
}

/** Opening height in the fullest bay for a given overall height. */
export function openingHeightFromOverall(overall: number, shelvesPerBay: number[], c: HeightInputs): number {
  const shelves = mostShelves(shelvesPerBay);
  return (overall - heightAllowance(c) - shelves * c.thickness) / (shelves + 1);
}

/** Defaults for the optional design fields (adjustable shelves, frame, doors, …). */
export function extraFields(config: Partial<ShelfConfig> & Pick<ShelfConfig, 'bays' | 'bayWidth'>, units: LengthUnit): Pick<ShelfDesignFields,
  'bayWidthMode' | 'bayWidths' | 'adjustablePerBay' | 'pinSystem' | 'backJoint' | 'faceFrame' | 'stileWidth' | 'railWidth' | 'frameThickness' | 'doorsPerBay' | 'shelfLoad' | 'edgeBanding' | 'bandingThickness'> {
  const field = (inches: number) => lengthToField(inches, units);
  const n = Math.max(1, Math.floor(config.bays));
  const widths = bayWidthsOf({ bays: n, bayWidth: config.bayWidth, bayWidths: config.bayWidths });
  const custom = widths.some(w => Math.abs(w - config.bayWidth) > 1e-6);
  const ff = config.faceFrame;
  const metric = units === 'mm';
  return {
    bayWidthMode: custom ? 'custom' : 'same',
    bayWidths: widths.map(field),
    adjustablePerBay: Array.from({ length: n }, (_, i) => config.adjustablePerBay?.[i] ?? 0),
    pinSystem: config.pinSystem ?? (metric ? 'metric' : 'imperial'),
    backJoint: config.backJoint ?? 'inset',
    faceFrame: ff?.enabled ?? false,
    stileWidth: ff ? field(ff.stileWidth) : metric ? '38' : '1 1/2',
    railWidth: ff ? field(ff.railWidth) : metric ? '38' : '1 1/2',
    frameThickness: ff ? field(ff.thickness) : metric ? '19' : '3/4',
    doorsPerBay: Array.from({ length: n }, (_, i) => config.doorsPerBay?.[i] ?? false),
    shelfLoad: config.shelfLoad ?? 'books',
    edgeBanding: config.edgeBanding ?? false,
    bandingThickness: `${Math.round((config.bandingThickness ?? 0.02) * MM_PER_INCH * 10) / 10} mm`,
  };
}
