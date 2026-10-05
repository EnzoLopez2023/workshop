// Sag check, hardware list, and cost estimate for a Shelf Builder design.
// All lengths are inches; formatting happens at the edges.

import { formatLength, type LengthUnit, type ShelfConfig, type ShelfLoad, type ShelfPlan } from './shelving.ts';

// ── Sag ───────────────────────────────────────────────────────────────────────

/** Load per square foot of shelf for each preset. */
export const SHELF_LOADS: Record<ShelfLoad, { psf: number; label: string }> = {
  light: { psf: 10, label: 'Light — decor, linens' },
  books: { psf: 25, label: 'Books, dishes' },
  heavy: { psf: 50, label: 'Heavy — tools, records, paint' },
};

/** Stiffness used for plywood; on the low side of common hardwood plywoods, so the check errs safe. */
export const PLYWOOD_MODULUS_PSI = 1_000_000;
/** The usual woodworking limit: sag no more than 0.02" per foot of span. */
export const SAG_LIMIT_PER_FOOT = 0.02;

/**
 * Mid-span deflection of a shelf as a simply supported beam under a uniform load
 * (5wL⁴ / 384EI). Treating the ends as free to rotate is conservative for fixed
 * shelves in dados and right for adjustable shelves on pins.
 */
export function shelfSag(span: number, depth: number, thickness: number, loadPsf: number, modulus = PLYWOOD_MODULUS_PSI): number {
  const w = loadPsf * (depth / 12) / 12; // lb per inch of span
  const inertia = depth * thickness ** 3 / 12;
  return 5 * w * span ** 4 / (384 * modulus * inertia);
}

/** Sag is a few hundredths of an inch — too fine for 1/32" fractions. */
export function formatSag(inches: number, units: LengthUnit): string {
  return units === 'mm' ? `${(inches * 25.4).toFixed(1)} mm` : `${inches.toFixed(3)}″`;
}

export interface SagResult {
  bay: number;
  kind: 'fixed' | 'adjustable';
  span: number;
  sag: number;
  limit: number;
  ok: boolean;
  /** Thinnest common plywood (from the list) that would pass, if any. */
  thicknessNeeded: number | null;
}

const COMMON_THICKNESSES = [0.5, 0.625, 0.75, 1, 1.125, 1.5];

export function sagCheck(plan: ShelfPlan, config: ShelfConfig, load: ShelfLoad = config.shelfLoad ?? 'books'): SagResult[] {
  const psf = SHELF_LOADS[load].psf;
  const results: SagResult[] = [];
  for (const bay of plan.bays) {
    const kinds: { kind: 'fixed' | 'adjustable'; span: number; depth: number }[] = [];
    // Fixed shelves, and the bottom panel, which carries load over the same span.
    if (bay.shelfYs.length > 0 || config.bottomPanel) kinds.push({ kind: 'fixed', span: bay.width, depth: config.shelfDepth });
    if (bay.adjustableYs.length > 0) kinds.push({ kind: 'adjustable', span: bay.width, depth: config.shelfDepth - 0.125 });
    for (const k of kinds) {
      const sag = shelfSag(k.span, k.depth, config.thickness, psf);
      const limit = SAG_LIMIT_PER_FOOT * k.span / 12;
      const ok = sag <= limit;
      const thicknessNeeded = ok ? null
        : COMMON_THICKNESSES.find(t => t > config.thickness && shelfSag(k.span, k.depth, t, psf) <= limit) ?? null;
      results.push({ bay: bay.index, kind: k.kind, span: k.span, sag, limit, ok, thicknessNeeded });
    }
  }
  return results;
}

/** Longest span that passes for a thickness, depth and load — for "keep bays under X" advice. */
export function maxSpan(depth: number, thickness: number, loadPsf: number): number {
  // sag/limit grows as span³, so solve directly.
  const w = loadPsf * (depth / 12) / 12;
  const inertia = depth * thickness ** 3 / 12;
  return Math.cbrt((SAG_LIMIT_PER_FOOT / 12) * 384 * PLYWOOD_MODULUS_PSI * inertia / (5 * w));
}

// ── Hardware ──────────────────────────────────────────────────────────────────

export type PriceKey =
  | 'sheet' | 'solidFoot' | 'glue' | 'caseScrews' | 'brads' | 'pocketScrews' | 'structuralScrew'
  | 'shelfPin' | 'hinge' | 'pull' | 'bumper' | 'antiTip' | 'edgeBanding' | 'finish';

export interface HardwareItem {
  key: string;
  name: string;
  /** Quantity to buy, in `unit`s. */
  qty: number;
  unit: string;
  /** Pieces actually used, when buying by the box. */
  uses?: number;
  note?: string;
  priceKey: PriceKey;
  optional?: boolean;
  /** Where to buy it (a store search, or the user's own product link). */
  url?: string;
}

const boxes = (count: number, perBox: number) => Math.max(1, Math.ceil(count / perBox));

function screwLength(thickness: number): number {
  return thickness < 0.6 ? 1.25 : 1.625;
}

export function hingesPerDoor(height: number): number {
  return height <= 40 ? 2 : height <= 60 ? 3 : 4;
}

export function hardwareList(plan: ShelfPlan, config: ShelfConfig, units: LengthUnit): HardwareItem[] {
  const f = (inches: number) => formatLength(inches, units);
  const t = config.thickness;
  const n = plan.bays.length;
  const dado = plan.dadoDepth > 0;
  const fixedShelves = plan.bays.reduce((sum, b) => sum + b.shelfYs.length, 0);
  const adjustable = plan.bays.reduce((sum, b) => sum + b.adjustableYs.length, 0);
  const panels = (config.topPanel ? 1 : 0) + (config.bottomPanel ? 1 : 0);
  const items: HardwareItem[] = [];

  const partCount = plan.parts.reduce((sum, p) => sum + p.qty, 0);
  items.push({ key: 'glue', name: 'Wood glue (8 oz)', qty: partCount > 40 ? 2 : 1, unit: 'bottle', priceKey: 'glue' });

  // Case screws: 3 per butt joint end (2 when the joint is dadoed and glued).
  const perEnd = dado ? 2 : 3;
  let caseScrews = panels * 2 * perEnd; // top/bottom into each side
  caseScrews += (n - 1) * panels * perEnd; // through top/bottom into each divider
  if (!dado) caseScrews += fixedShelves * 2 * 3; // shelves have no dado to carry them
  if (plan.kick > 0) caseScrews += 4;
  const cabinetCleat = plan.cleatGap > 0;
  if (cabinetCleat) caseScrews += Math.ceil(plan.innerSpan / 6) * 2; // cabinet cleat + bottom spacer through the back
  items.push({
    key: 'case-screws',
    name: `Wood screws, ${f(screwLength(t))}`,
    qty: boxes(caseScrews, 100),
    unit: 'box of 100',
    uses: caseScrews,
    note: dado ? 'Dadoed joints are glued; screws pull them tight at the case corners.' : 'Pre-drill and countersink every one.',
    priceKey: 'caseScrews',
  });

  if (plan.backThickness > 0) {
    // Around the perimeter every 6", and into each shelf and divider every 8".
    const backHeight = plan.overallHeight - plan.kick;
    const perimeter = 2 * (plan.innerSpan + backHeight);
    const into = plan.bays.reduce((sum, b) => sum + b.shelfYs.length * b.width, 0) + (n - 1) * backHeight;
    const brads = Math.ceil(perimeter / 6) + Math.ceil(into / 8);
    items.push({ key: 'brads', name: `Brad nails, ${f(1.25)}`, qty: boxes(brads, 1000), unit: 'box of 1000', uses: brads, note: 'For the back, with glue.', priceKey: 'brads' });
  }

  if (plan.frame) {
    const joints = 4 + 2 * (n - 1); // rails into stiles, mullions into rails
    items.push({ key: 'pocket-screws', name: `Pocket screws, ${f(1.25)} coarse`, qty: boxes(joints * 2, 100), unit: 'box of 100', uses: joints * 2, note: 'Two per face-frame joint.', priceKey: 'pocketScrews' });
  }

  if (config.mounting === 'wall') {
    // Studs every 16"; two screws into each the wall cleat (or back) crosses.
    const studs = Math.max(2, Math.floor(plan.innerSpan / 16) + 1);
    items.push({ key: 'structural', name: '3″ (75 mm) structural screws', qty: studs * 2, unit: 'ea', note: `Two into each of about ${studs} studs.`, priceKey: 'structuralScrew' });
  } else if (plan.overallHeight > 30) {
    items.push({ key: 'anti-tip', name: 'Anti-tip furniture strap', qty: 1, unit: 'kit', note: 'Anchors the top to a wall stud.', priceKey: 'antiTip' });
  }

  if (adjustable > 0) {
    const pins = adjustable * 4 + 4;
    items.push({ key: 'pins', name: `Shelf pins, ${config.pinSystem === 'metric' ? '5 mm' : '1/4″'}`, qty: pins, unit: 'ea', note: '4 per shelf plus spares.', priceKey: 'shelfPin' });
  }

  if (plan.doors.length > 0) {
    const hinges = plan.doors.reduce((sum, d) => sum + hingesPerDoor(d.height), 0);
    items.push({
      key: 'hinges',
      name: plan.frame ? 'Concealed face-frame hinges, 1/2″ overlay' : 'Concealed (Euro) hinges, 35 mm cup, full overlay',
      qty: hinges,
      unit: 'ea',
      note: `${plan.doors.length} door${plan.doors.length === 1 ? '' : 's'}; 2–4 each depending on height.`,
      priceKey: 'hinge',
    });
    items.push({ key: 'pulls', name: 'Knobs or pulls', qty: plan.doors.length, unit: 'ea', priceKey: 'pull' });
    items.push({ key: 'bumpers', name: 'Door bumpers', qty: plan.doors.length * 2, unit: 'ea', priceKey: 'bumper' });
  }

  if (plan.banding && plan.banding.totalLength > 0) {
    const b = plan.banding.thickness;
    const kind = b <= 0.025 ? 'Iron-on wood veneer edge banding' : 'PVC edge banding';
    const width = t >= 0.7 ? '7/8″ (22 mm)' : t >= 0.45 ? '5/8″ (16 mm)' : '1/2″ (12 mm)';
    const feet = Math.ceil(plan.banding.totalLength * 1.1 / 12);
    const covers = plan.banding.caseFronts ? `Front edges${plan.doors.length ? ' and doors' : ''}` : 'Door edges (the face frame covers the case)';
    items.push({ key: 'banding', name: `${kind}, ${width} wide`, qty: feet, unit: 'ft', note: `${covers}, plus 10%.`, priceKey: 'edgeBanding' });
  }

  // Finish: both faces of every part, two coats, ~100 sq ft per quart per coat.
  const area = plan.parts.reduce((sum, p) => sum + p.qty * p.length * p.width * 2, 0) / 144;
  items.push({ key: 'finish', name: 'Finish (poly, oil, or paint)', qty: Math.max(1, Math.ceil(area * 2 / 100)), unit: 'quart', note: `About ${Math.round(area)} sq ft, two coats.`, priceKey: 'finish', optional: true });

  return items;
}

// ── Cost ──────────────────────────────────────────────────────────────────────

export type Prices = Record<PriceKey, number>;

/** Typical US retail prices; every one is editable in the Shelf Builder. */
export function defaultPrices(thickness: number): Prices {
  return {
    sheet: thickness >= 0.7 ? 75 : thickness >= 0.45 ? 60 : 40,
    solidFoot: 2.5,
    glue: 8,
    caseScrews: 12,
    brads: 9,
    pocketScrews: 10,
    structuralScrew: 0.6,
    shelfPin: 0.2,
    hinge: 6,
    pull: 5,
    bumper: 0.1,
    antiTip: 10,
    edgeBanding: 0.35,
    finish: 22,
  };
}

export const PRICE_LABELS: Record<PriceKey, string> = {
  sheet: 'Plywood, per sheet',
  solidFoot: 'Solid wood (face frame), per linear foot',
  glue: 'Wood glue, per bottle',
  caseScrews: 'Wood screws, per box',
  brads: 'Brad nails, per box',
  pocketScrews: 'Pocket screws, per box',
  structuralScrew: 'Structural screw, each',
  shelfPin: 'Shelf pin, each',
  hinge: 'Hinge, each',
  pull: 'Knob or pull, each',
  bumper: 'Door bumper, each',
  antiTip: 'Anti-tip strap, per kit',
  edgeBanding: 'Edge banding, per foot',
  finish: 'Finish, per quart',
};

export interface CostLine {
  key: string;
  name: string;
  qtyLabel: string;
  unitPrice: number;
  total: number;
  priceKey: PriceKey;
  optional: boolean;
}

export interface CostEstimate {
  lines: CostLine[];
  /** Everything, including optional edge banding and finish. */
  total: number;
  /** Without the optional lines. */
  required: number;
}

/** Board feet aren't needed: face frames are bought as boards by length, plus 15% for waste. */
function solidFeet(plan: ShelfPlan): number {
  const inches = plan.parts.filter(p => p.material === 'solid').reduce((sum, p) => sum + p.qty * p.length, 0);
  return Math.ceil(inches * 1.15 / 12);
}

/** "3", "12 ft", "2 boxes of 100", "1 bottle". */
export function quantityLabel(qty: number, unit: string): string {
  if (unit === 'ea') return String(qty);
  if (unit === 'ft') return `${qty} ft`;
  const box = unit.match(/^box of (\d+)$/);
  if (box) return `${qty} box${qty === 1 ? '' : 'es'} of ${box[1]}`;
  const pack = unit.match(/^pack of (\d+)$/);
  if (pack) return `${qty} pack${qty === 1 ? '' : 's'} of ${pack[1]}`;
  return `${qty} ${unit}${qty === 1 ? '' : 's'}`;
}

export function costEstimate(
  plan: ShelfPlan,
  sheetCount: number,
  sheetLabel: string,
  hardware: HardwareItem[],
  prices: Prices,
): CostEstimate {
  const lines: CostLine[] = [];
  lines.push({
    key: 'sheets', name: sheetLabel, qtyLabel: `${sheetCount} sheet${sheetCount === 1 ? '' : 's'}`,
    unitPrice: prices.sheet, total: sheetCount * prices.sheet, priceKey: 'sheet', optional: false,
  });
  const feet = solidFeet(plan);
  if (feet > 0) {
    lines.push({
      key: 'solid', name: 'Solid wood for the face frame', qtyLabel: `${feet} ft`,
      unitPrice: prices.solidFoot, total: feet * prices.solidFoot, priceKey: 'solidFoot', optional: false,
    });
  }
  for (const item of hardware) {
    const unitPrice = prices[item.priceKey];
    lines.push({
      key: item.key,
      name: item.name,
      qtyLabel: quantityLabel(item.qty, item.unit),
      unitPrice,
      total: item.qty * unitPrice,
      priceKey: item.priceKey,
      optional: item.optional ?? false,
    });
  }
  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const required = lines.filter(l => !l.optional).reduce((sum, l) => sum + l.total, 0);
  return { lines, total, required };
}
