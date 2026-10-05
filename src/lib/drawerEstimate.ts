// Hardware list and cost estimate for the Drawer Builder. Quantities come from
// the plan; prices are rough placeholders the user overrides with what they pay.

import { boxedDrawers, SLIDE_CAPACITY_LB, type DrawerConfig, type DrawerPlan } from './drawerUnit.ts';
import { quantityLabel, type HardwareItem } from './shelfEstimate.ts';
import { formatLength, type LengthUnit } from './shelving.ts';

export type DrawerPriceKey =
  | 'sheetCase' | 'sheetBox' | 'sheetThin' | 'slidePair' | 'feetPack' | 'caster'
  | 'glue' | 'caseScrews' | 'frontScrews' | 'brads' | 'antiTip' | 'edgeBanding' | 'finish';

export type DrawerPrices = Record<DrawerPriceKey, number>;

/** MROCO leveling feet come 12 to a pack, T-nuts included. */
export const FEET_PER_PACK = 12;

export interface DrawerHardwareItem extends Omit<HardwareItem, 'priceKey'> {
  priceKey: DrawerPriceKey;
}

const boxes = (count: number, perBox: number) => Math.max(1, Math.ceil(count / perBox));

/** A store search rather than a specific listing, so it never points at a stale product. */
export function amazonSearch(query: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(query).replace(/%20/g, '+')}`;
}

export function drawerHardwareList(plan: DrawerPlan, config: DrawerConfig, units: LengthUnit): DrawerHardwareItem[] {
  const f = (inches: number) => formatLength(inches, units);
  const unitCount = plan.unitCount;
  const boxed = boxedDrawers(plan);
  const n = boxed.length * unitCount;
  const supports = plan.supports * unitCount;
  const items: DrawerHardwareItem[] = [];

  // One line per slide length (a shallow drawer can take a shorter pair).
  const lengths = [...new Set(boxed.map(d => d.box.depth))].sort((a, b) => b - a);
  for (const length of lengths) {
    const pairs = boxed.filter(d => d.box.depth === length).length * unitCount;
    items.push({
      key: lengths.length === 1 ? 'slides' : `slides-${length}`,
      name: `LONTAN soft-close drawer slides, ${f(length)}`,
      qty: pairs,
      unit: 'pair',
      note: `Full extension, side mount, ${SLIDE_CAPACITY_LB} lb a pair. Mounting screws come with them.`,
      priceKey: 'slidePair',
      url: amazonSearch(`LONTAN soft close drawer slides ${length} inch`),
    });
  }

  if (config.base === 'feet') {
    items.push({
      key: 'feet',
      name: 'MROCO 1/4″-20 leveling feet with T-nuts',
      qty: Math.ceil(supports / FEET_PER_PACK),
      unit: 'pack of 12',
      uses: supports,
      note: `${supports} feet; drill ${f(5 / 16)} for each T-nut.`,
      priceKey: 'feetPack',
      url: amazonSearch('MROCO furniture leveling feet 1/4-20 T-nuts 12 pack'),
    });
  } else if (config.base === 'casters') {
    items.push({
      key: 'casters',
      name: `Plate casters, ${f(config.casterHeight)} mounted height`,
      qty: supports,
      unit: 'ea',
      note: 'Get locking ones for the front pair.',
      priceKey: 'caster',
      url: amazonSearch(`${config.casterHeight} inch plate casters locking`),
    });
  }

  const partCount = plan.parts.reduce((sum, p) => sum + p.qty, 0);
  items.push({ key: 'glue', name: 'Wood glue (8 oz)', qty: partCount > 40 ? 2 : 1, unit: 'bottle', priceKey: 'glue' });

  // Top and bottom into each side: 4 screws per joint end. A desk top is screwed down
  // through each unit's top (8 per unit), and a double top is screwed together every 8".
  const desk = plan.desk;
  const laminate = desk && config.desk?.topLayers === 2 ? Math.ceil(desk.width / 8) * Math.ceil(desk.depth / 8) : 0;
  // Each partition is screwed through the top and bottom: 4 at each end.
  const caseScrews = (2 * 2 * 4 + plan.partitionXs.length * 2 * 4) * unitCount + (desk ? 8 * unitCount + laminate : 0);
  items.push({
    key: 'case-screws',
    name: `Wood screws, ${f(config.thickness < 0.6 ? 1.25 : 1.625)}`,
    qty: boxes(caseScrews, 100),
    unit: 'box of 100',
    uses: caseScrews,
    note: desk ? 'Case corners, the desk top through each unit’s top, and the two top layers together.' : 'Top and bottom into the sides. Pre-drill and countersink.',
    priceKey: 'caseScrews',
  });

  // Each front is screwed on from inside the box: 4 screws, short enough not to poke through.
  const frontScrew = config.boxThickness + config.thickness * 0.6;
  items.push({
    key: 'front-screws',
    name: `Pan-head screws, ${f(Math.floor(frontScrew * 8) / 8)}`,
    qty: boxes(n * 4, 100),
    unit: 'box of 100',
    uses: n * 4,
    note: 'Four per drawer front, through the box front. Drill the box holes oversize so the front can be adjusted.',
    priceKey: 'frontScrews',
  });

  // Back every 6" around the case; 3 per box corner.
  const perimeter = 2 * (plan.caseHeight + plan.overallWidth);
  const brads = Math.ceil(perimeter / 6) * unitCount + n * 4 * 3;
  items.push({
    key: 'brads', name: `Brad nails, ${f(1.25)}`, qty: boxes(brads, 1000), unit: 'box of 1000', uses: brads,
    note: 'The case back and the drawer-box corners, with glue.', priceKey: 'brads',
  });

  if (plan.mount === 'wall') {
    // Two screws into each stud the wall cleat crosses (studs every 16").
    const studs = Math.max(2, Math.floor(plan.interiorWidth / 16) + 1);
    const full = plan.loads.reduce((a, l) => a + l.pounds, 0);
    items.push({ key: 'structural', name: '3″ (75 mm) structural screws', qty: studs * 2, unit: 'ea',
      note: `Wall cleat into about ${studs} studs. Full, the drawers could hold about ${Math.round(full)} lb — studs only, never drywall anchors.`, priceKey: 'caseScrews' });
  } else if (plan.mount === 'under-desk') {
    items.push({ key: 'desk-screws', name: `Wood screws, ${f(1.25)}`, qty: 8, unit: 'ea', note: 'Up through the unit’s top into the desk, two near each corner. Check they won’t come through the desk top.', priceKey: 'caseScrews' });
  }

  if (!desk && plan.mount === 'floor' && config.base !== 'casters' && plan.overallHeight > 30) {
    items.push({ key: 'anti-tip', name: 'Anti-tip furniture strap', qty: 1, unit: 'kit', note: 'Open drawers shift the weight forward; anchor the top to a stud.', priceKey: 'antiTip' });
  }

  if (plan.banding && plan.banding.totalLength > 0) {
    const b = plan.banding.thickness;
    const t = config.thickness;
    const kind = b <= 0.025 ? 'Iron-on wood veneer edge banding' : 'PVC edge banding';
    const width = t >= 0.7 ? '7/8″ (22 mm)' : t >= 0.45 ? '5/8″ (16 mm)' : '1/2″ (12 mm)';
    const feet = Math.ceil(plan.banding.totalLength * 1.1 / 12);
    items.push({ key: 'banding', name: `${kind}, ${width} wide`, qty: feet, unit: 'ft', note: 'Case front edges and drawer fronts, plus 10%.', priceKey: 'edgeBanding' });
  }

  // Both faces of every part, two coats, ~100 sq ft per quart per coat.
  const area = plan.parts.reduce((sum, p) => sum + p.qty * p.length * p.width * 2, 0) / 144;
  items.push({ key: 'finish', name: 'Finish (paint, poly, or oil)', qty: Math.max(1, Math.ceil(area * 2 / 100)), unit: 'quart', note: `About ${Math.round(area)} sq ft, two coats.`, priceKey: 'finish', optional: true });

  return items;
}

/** The sheet price key for a thickness: case stock, box stock, or thin back/bottom stock. */
export function sheetPriceKey(thickness: number, config: DrawerConfig): DrawerPriceKey {
  if (Math.abs(thickness - config.thickness) < 1e-6) return 'sheetCase';
  if (Math.abs(thickness - config.boxThickness) < 1e-6) return 'sheetBox';
  return 'sheetThin';
}

/** Rough US retail; every one is editable. */
export function defaultDrawerPrices(): DrawerPrices {
  return {
    sheetCase: 75,
    sheetBox: 60,
    sheetThin: 40,
    slidePair: 12,
    feetPack: 12,
    caster: 5,
    glue: 8,
    caseScrews: 12,
    frontScrews: 8,
    brads: 9,
    antiTip: 10,
    edgeBanding: 0.35,
    finish: 22,
  };
}

export const DRAWER_PRICE_LABELS: Record<DrawerPriceKey, string> = {
  sheetCase: 'Case plywood, per sheet',
  sheetBox: 'Drawer-box plywood, per sheet',
  sheetThin: 'Back and bottom plywood, per sheet',
  slidePair: 'Drawer slides, per pair',
  feetPack: 'Leveling feet, per pack of 12',
  caster: 'Caster, each',
  glue: 'Wood glue, per bottle',
  caseScrews: 'Wood screws, per box',
  frontScrews: 'Pan-head screws, per box',
  brads: 'Brad nails, per box',
  antiTip: 'Anti-tip strap, per kit',
  edgeBanding: 'Edge banding, per foot',
  finish: 'Finish, per quart',
};

export interface DrawerCostLine {
  key: string;
  name: string;
  qtyLabel: string;
  unitPrice: number;
  total: number;
  priceKey: DrawerPriceKey;
  optional: boolean;
}

export interface DrawerCostEstimate {
  lines: DrawerCostLine[];
  total: number;
  required: number;
}

/** Sheets by thickness (from the sheet plans) plus every hardware line. */
export function drawerCostEstimate(
  sheets: { thickness: number; count: number; label: string }[],
  config: DrawerConfig,
  hardware: DrawerHardwareItem[],
  prices: DrawerPrices,
): DrawerCostEstimate {
  const lines: DrawerCostLine[] = sheets.map(s => {
    const priceKey = sheetPriceKey(s.thickness, config);
    return {
      key: `sheets-${s.thickness}`, name: s.label, qtyLabel: `${s.count} sheet${s.count === 1 ? '' : 's'}`,
      unitPrice: prices[priceKey], total: s.count * prices[priceKey], priceKey, optional: false,
    };
  });
  for (const item of hardware) {
    const unitPrice = prices[item.priceKey];
    lines.push({
      key: item.key, name: item.name, qtyLabel: quantityLabel(item.qty, item.unit),
      unitPrice, total: item.qty * unitPrice, priceKey: item.priceKey, optional: item.optional ?? false,
    });
  }
  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const required = lines.filter(l => !l.optional).reduce((sum, l) => sum + l.total, 0);
  return { lines, total, required };
}
