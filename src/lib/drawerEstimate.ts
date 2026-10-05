// Hardware list and cost estimate for the Drawer Builder. Quantities come from
// the plan; prices are rough placeholders the user overrides with what they pay.

import { SLIDE_CAPACITY_LB, type DrawerConfig, type DrawerPlan } from './drawerUnit.ts';
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

export function drawerHardwareList(plan: DrawerPlan, config: DrawerConfig, units: LengthUnit): DrawerHardwareItem[] {
  const f = (inches: number) => formatLength(inches, units);
  const n = plan.drawers.length;
  const items: DrawerHardwareItem[] = [];

  items.push({
    key: 'slides',
    name: `LONTAN soft-close drawer slides, ${f(plan.slideLength)}`,
    qty: n,
    unit: 'pair',
    note: `Full extension, side mount, ${SLIDE_CAPACITY_LB} lb a pair. Mounting screws come with them.`,
    priceKey: 'slidePair',
  });

  if (config.base === 'feet') {
    items.push({
      key: 'feet',
      name: 'MROCO 1/4″-20 leveling feet with T-nuts',
      qty: Math.ceil(plan.supports / FEET_PER_PACK),
      unit: 'pack of 12',
      uses: plan.supports,
      note: `${plan.supports} feet; drill ${f(5 / 16)} for each T-nut.`,
      priceKey: 'feetPack',
    });
  } else if (config.base === 'casters') {
    items.push({
      key: 'casters',
      name: `Plate casters, ${f(config.casterHeight)} mounted height`,
      qty: plan.supports,
      unit: 'ea',
      note: 'Get locking ones for the front pair.',
      priceKey: 'caster',
    });
  }

  const partCount = plan.parts.reduce((sum, p) => sum + p.qty, 0);
  items.push({ key: 'glue', name: 'Wood glue (8 oz)', qty: partCount > 40 ? 2 : 1, unit: 'bottle', priceKey: 'glue' });

  // Top and bottom into each side: 4 screws per joint end.
  const caseScrews = 2 * 2 * 4;
  items.push({
    key: 'case-screws',
    name: `Wood screws, ${f(config.thickness < 0.6 ? 1.25 : 1.625)}`,
    qty: boxes(caseScrews, 100),
    unit: 'box of 100',
    uses: caseScrews,
    note: 'Top and bottom into the sides. Pre-drill and countersink.',
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
  const brads = Math.ceil(perimeter / 6) + n * 4 * 3;
  items.push({
    key: 'brads', name: `Brad nails, ${f(1.25)}`, qty: boxes(brads, 1000), unit: 'box of 1000', uses: brads,
    note: 'The case back and the drawer-box corners, with glue.', priceKey: 'brads',
  });

  if (config.base !== 'casters' && plan.overallHeight > 30) {
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
