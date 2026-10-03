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
}

export interface ShelfPart {
  name: string;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  note?: string;
}

export interface BayLayout {
  index: number;
  x: number;
  width: number;
  shelfYs: number[];
  openingHeight: number;
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
}

export const SHEET_LENGTH = 96;
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

/** Bottom edges of `count` evenly spaced fixed shelves inside [bottom, top]. */
export function shelfPositions(bottom: number, top: number, count: number, thickness: number): { ys: number[]; opening: number } {
  const opening = (top - bottom - count * thickness) / (count + 1);
  const ys = Array.from({ length: count }, (_, i) => bottom + (i + 1) * opening + i * thickness);
  return { ys, opening };
}

export function buildShelfPlan(config: ShelfConfig): ShelfPlan {
  const t = config.thickness;
  const W = config.bayWidth;
  const D = config.shelfDepth;
  const H = config.height;
  const n = Math.max(1, Math.floor(config.bays));
  const errors: string[] = [];
  const warnings: string[] = [];
  const fmt = (inches: number) => formatLength(inches, config.units ?? 'in');

  const cleat = config.mounting === 'wall' && config.frenchCleat;
  const hasBack = config.backPanel || cleat;
  const dado = config.joinery === 'dado';
  const d = dado ? config.dadoDepth : 0;
  const kick = config.mounting === 'floor' && config.bottomPanel ? Math.max(0, config.toeKick) : 0;

  if (dado && d >= t) errors.push('Dado depth must be less than the plywood thickness.');
  else if (dado && d > t / 2 + EPS) warnings.push(`A ${fmt(d)} dado is more than half of ${fmt(t)} plywood; 1/3 of the thickness is typical.`);

  const backThickness = hasBack ? t : 0;
  const cleatGap = cleat ? t : 0;
  const sideDepth = D + backThickness + cleatGap;
  const overallWidth = n * W + (n + 1) * t;
  const innerSpan = n * W + (n - 1) * t;

  const interiorBottom = config.bottomPanel ? kick + t : 0;
  const interiorTop = config.topPanel ? H - t : H;
  const clearHeight = interiorTop - interiorBottom;
  if (clearHeight <= 0) errors.push('The height leaves no room between the top and bottom panels.');

  const counts = Array.from({ length: n }, (_, i) => Math.max(0, Math.floor(config.shelvesPerBay[i] ?? 0)));
  const bays: BayLayout[] = counts.map((count, index) => {
    const { ys, opening } = shelfPositions(interiorBottom, interiorTop, count, t);
    if (count > 0 && opening <= 0) errors.push(`Bay ${index + 1} has more shelves than its height can hold.`);
    return { index, x: t + index * (W + t), width: W, shelfYs: ys, openingHeight: opening };
  });
  const dividerXs = Array.from({ length: n - 1 }, (_, i) => t + W + i * (W + t));

  // ── Parts ───────────────────────────────────────────────────────────────────
  const parts: ShelfPart[] = [];
  const housed = dado ? ' Housed in dados.' : '';

  parts.push({
    name: 'Side',
    qty: 2,
    length: H,
    width: sideDepth,
    thickness: t,
    note: [
      hasBack ? `Back sits ${fmt(D)} from the front edge.` : '',
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

  const shelfCount = counts.reduce((sum, c) => sum + c, 0);
  if (shelfCount > 0) {
    parts.push({ name: 'Shelf', qty: shelfCount, length: W + 2 * d, width: D, thickness: t, note: housed.trim() || undefined });
  }

  if (hasBack) {
    const backHeight = H - kick;
    for (const piece of splitBack(backHeight, dividerXs, t, overallWidth)) {
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

  for (const part of parts) {
    if (!fitsSheet(part.length, part.width)) {
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

  return {
    overallWidth,
    overallHeight: H,
    overallDepth: sideDepth,
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
  };
}

/**
 * One back panel when it fits a sheet; otherwise split it into the fewest
 * runs of whole bays, with seams centered on dividers.
 */
function splitBack(height: number, dividerXs: number[], t: number, overallWidth: number) {
  const left = t;
  const right = overallWidth - t;
  if (fitsSheet(height, right - left) || dividerXs.length === 0) {
    return [{ name: 'Back', width: right - left, note: 'Inset between the sides, behind the shelves.' }];
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

export type SolidKind = 'case' | 'shelf' | 'back' | 'cleat' | 'wall-cleat' | 'groove';

export type Solid =
  | {
    name: string; kind: SolidKind; shape: 'box'; min: [number, number, number]; max: [number, number, number];
    /** For grooves: the part they are cut into, and which way its grooved face points along x. */
    on?: string; face?: 1 | -1;
  }
  /** A profile in the (z, y) plane extruded from x0 to x1 — used for beveled cleats. */
  | { name: string; kind: SolidKind; shape: 'prism'; x0: number; x1: number; profile: [number, number][] };

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
  if (plan.backThickness > 0) {
    solids.push(box('Back', 'back', [t, plan.kick, D], [W - t, H, D + plan.backThickness]));
  }
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
  heightMode: 'bay' | 'overall';
  config: ShelfConfig;
}

export function toSavedShelfDesign(config: ShelfConfig, units: LengthUnit, heightMode: 'bay' | 'overall' = 'overall'): SavedShelfDesign {
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
    // Designs saved before bay height existed were all typed as overall height.
    heightMode: value.heightMode === 'bay' ? 'bay' : 'overall',
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
    },
  };
}

export interface ShelfDesignFields {
  units: LengthUnit;
  thickness: string;
  bayWidth: string;
  shelfDepth: string;
  /** Which of the two height fields drives the design. */
  heightMode: 'bay' | 'overall';
  /** Clear height of each bay. */
  bayHeight: string;
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
    bayHeight: field(config.height - heightAllowance(config)),
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
  };
}

// ── Bay height ↔ overall height ───────────────────────────────────────────────

export type HeightMode = 'bay' | 'overall';

type HeightInputs = Pick<ShelfConfig, 'thickness' | 'topPanel' | 'bottomPanel' | 'mounting' | 'toeKick'>;

/**
 * What the case adds around the clear bay height: the top and bottom panels,
 * plus the toe kick (floor units with a bottom only — the same rule buildShelfPlan uses).
 */
export function heightAllowance(c: HeightInputs): number {
  const kick = c.mounting === 'floor' && c.bottomPanel ? Math.max(0, c.toeKick) : 0;
  return (c.topPanel ? c.thickness : 0) + (c.bottomPanel ? c.thickness : 0) + kick;
}

/** Overall height for a clear bay height (bottom panel's top face to the top panel's underside). */
export function overallFromBayHeight(bayHeight: number, c: HeightInputs): number {
  return bayHeight + heightAllowance(c);
}

export function bayHeightFromOverall(overall: number, c: HeightInputs): number {
  return overall - heightAllowance(c);
}
