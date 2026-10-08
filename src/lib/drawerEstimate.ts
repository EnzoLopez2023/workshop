// Hardware list and cost estimate for the Drawer Builder. Quantities come from
// the plan; prices are rough placeholders the user overrides with what they pay.

import { boxedDrawers, pullHoles, shakerRail, SLIDE_CAPACITY_LB, type DrawerConfig, type DrawerPlan } from './drawerUnit.ts';
import { hardwareList, quantityLabel, type HardwareItem, type PriceKey } from './shelfEstimate.ts';
import { formatLength, type LengthUnit } from './shelving.ts';

export type DrawerPriceKey =
  | 'sheetCase' | 'sheetBox' | 'sheetThin' | 'slidePair' | 'feetPack' | 'caster'
  | 'glue' | 'caseScrews' | 'frontScrews' | 'brads' | 'antiTip' | 'edgeBanding' | 'finish'
  | 'shims' | 'baseboardFt'
  | 'deskLeg'
  | 'shelfPin' | 'hinge' | 'doorPull' | 'bumper' | 'crownFt' | 'butcherBlock' | 'figure8' | 'ledStrip' | 'grommet';

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

  // One line per slide length (a shallow drawer can take a shorter pair); pull-out trays behind doors use them too.
  const trays = plan.drawers.flatMap(d => d.door?.trays ?? []);
  const runs = [...boxed.map(d => d.box.depth), ...trays.map(t => t.depth)];
  const lengths = [...new Set(runs)].sort((a, b) => b - a);
  for (const length of lengths) {
    const pairs = runs.filter(r => r === length).length * unitCount;
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

  if (plan.base && plan.base.kind !== 'kick') {
    items.push({ key: 'shims', name: 'Composite shims', qty: 1, unit: 'pack', note: 'Level the plinth before the case goes on it.', priceKey: 'shims', url: amazonSearch('composite shims') });
  }
  const baseboard = plan.parts.filter(p => p.name.startsWith('Baseboard'));
  if (baseboard.length) {
    const inches = baseboard.reduce((sum, p) => sum + p.qty * p.length, 0) * unitCount;
    const bb = plan.base?.baseboard;
    items.push({
      key: 'baseboard', name: `Baseboard molding${bb ? `, ${f(bb.height)} × ${f(bb.thickness)}` : ''}`,
      qty: Math.ceil(inches * 1.1 / 12), unit: 'ft',
      note: 'Paint-grade, to match the room. Mitred at the corners, plus 10% for the cuts; nail it to the plinth with brads.',
      priceKey: 'baseboardFt', url: amazonSearch(`baseboard molding ${bb ? Math.round(bb.height * 4) / 4 : 4} inch`),
    });
  }

  // Doors: concealed hinges by overlay type, and shelf pins for the shelves behind them.
  const doors = plan.drawers.filter(d => d.door);
  const hingeTypes = new Map<string, number>();
  for (const d of doors) for (const leaf of d.door!.leaves) hingeTypes.set(leaf.hingeType, (hingeTypes.get(leaf.hingeType) ?? 0) + d.door!.hinges.length);
  for (const [type, count] of hingeTypes) {
    items.push({
      key: `hinges-${type.replace(' ', '-')}`, name: `Concealed soft-close hinges, ${type}`, qty: count * unitCount, unit: 'ea',
      note: `35 mm cup, 110°, with ${type === 'inset' ? 'inset' : type} mounting plates. ${type === 'half overlay' ? 'For doors that share a partition.' : ''}`.trim(),
      priceKey: 'hinge', url: amazonSearch(`35mm concealed cabinet hinge soft close ${type}`),
    });
  }
  // Store-bought pulls: one per front (two on wide drawers), one per door leaf.
  const hw = config.hardware;
  if (hw && hw.kind !== 'none') {
    const rail = (w: number, h: number) => shakerRail(config.frontProfile, w, h);
    // The bookcase's doors take the same pulls (one bookcase per cabinet in a wall run).
    const bookDoors = (plan.bookcase?.shelfPlan.doors ?? []).reduce((a, dr) => a + pullHoles(hw, dr.width, dr.height, { hinge: 'left' }, rail(dr.width, dr.height)).pulls.length, 0);
    const count = bookDoors * unitCount + plan.drawers.reduce((a, d) => a
      + (d.door ? d.door.leaves.reduce((x, l) => x + pullHoles(hw, l.width, d.front.height, { hinge: l.hinge }, rail(l.width, d.front.height)).pulls.length, 0)
        : d.open ? 0 : pullHoles(hw, d.front.width, d.front.height, null, rail(d.front.width, d.front.height)).pulls.length), 0) * unitCount;
    const what = hw.kind === 'knob' ? 'Cabinet knobs' : hw.kind === 'cup' ? `Cup pulls, ${f(hw.spacing)} centres` : `Bar pulls, ${f(hw.spacing)} centres`;
    items.push({
      key: 'pulls', name: what, qty: count, unit: 'ea',
      note: `Drawer fronts are screwed to the boxes, so the pull screws go through both: get ${f(Math.ceil((config.thickness + config.boxThickness + 0.25) * 4) / 4)} (or breakaway) screws.`,
      priceKey: 'doorPull', url: amazonSearch(hw.kind === 'knob' ? 'cabinet knobs' : hw.kind === 'cup' ? `cup pulls ${hw.spacing} inch` : `cabinet bar pulls ${hw.spacing} inch center`),
    });
  }
  const doorShelves = doors.reduce((a, d) => a + d.door!.shelfYs.length, 0) * unitCount;
  if (doorShelves) {
    items.push({ key: 'shelf-pins', name: `Shelf pins, ${units === 'mm' ? '5 mm' : '1/4″'}`, qty: doorShelves * 4 + 4, unit: 'ea', note: '4 per shelf plus spares.', priceKey: 'shelfPin' });
  }

  // A one-unit desk's other end: two bought legs.
  if (plan.desk?.openEnd?.kind === 'legs') {
    const h = plan.desk.openEnd.height;
    items.push({ key: 'desk-legs', name: `Desk legs, ${f(h)} (or adjustable to it)`, qty: 2, unit: 'ea',
      note: 'With mounting plates; screw the plates up into the desk top.', priceKey: 'deskLeg', url: amazonSearch(`desk leg ${Math.round(h)} inch adjustable`) });
  }

  const partCount = plan.parts.reduce((sum, p) => sum + p.qty, 0);
  items.push({ key: 'glue', name: 'Wood glue (8 oz)', qty: partCount > 40 ? 2 : 1, unit: 'bottle', priceKey: 'glue' });

  // Top and bottom into each side: 4 screws per joint end. A desk top is screwed down
  // through each unit's top (8 per unit), and a double top is screwed together every 8".
  const desk = plan.desk;
  const laminate = desk && config.desk?.topLayers === 2 ? Math.ceil(desk.width / 8) * Math.ceil(desk.depth / 8) : 0;
  // Each partition is screwed through the top and bottom: 4 at each end.
  // A toe-kick base adds 8: the case down onto a plinth, or the kick board and nailer between the sides.
  const caseScrews = (2 * 2 * 4 + plan.partitionXs.length * 2 * 4 + (plan.base ? 8 : 0)) * unitCount + (desk ? 8 * unitCount + laminate : 0);
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
  }

  // The bookcase's own hardware comes from the Shelf Builder's list; glue, banding and finish are already counted above.
  const bk = plan.bookcase;
  if (bk) {
    // Its door pulls are counted with the cabinet's when store-bought pulls are chosen.
    const keep: Partial<Record<PriceKey, DrawerPriceKey>> = { caseScrews: 'caseScrews', brads: 'brads', shelfPin: 'shelfPin', hinge: 'hinge', bumper: 'bumper', pocketScrews: 'caseScrews',
      ...(config.hardware && config.hardware.kind !== 'none' ? {} : { pull: 'doorPull' as const }) };
    // In a wall run there's one bookcase per cabinet, plus any over the desk gaps.
    const uppers = [{ plan: bk, count: plan.run ? plan.run.cabinetCount : 1 }, ...(plan.run?.sections.filter(x => x.upper).map(x => ({ plan: x.upper!, count: 1 })) ?? [])];
    const merged = new Map<string, DrawerHardwareItem>();
    for (const u of uppers) {
      for (const item of hardwareList(u.plan.shelfPlan, u.plan.shelfConfig, units)) {
        const priceKey = keep[item.priceKey];
        if (!priceKey) continue;
        const key = `bookcase-${item.key}`;
        const prev = merged.get(key);
        if (prev) { prev.qty += item.qty * u.count; if (prev.uses !== undefined && item.uses !== undefined) prev.uses += item.uses * u.count; }
        else merged.set(key, { ...item, key, qty: item.qty * u.count, uses: item.uses !== undefined ? item.uses * u.count : undefined, name: `Bookcase: ${item.name.charAt(0).toLowerCase()}${item.name.slice(1)}`, priceKey });
      }
    }
    items.push(...merged.values());
    const anchors = uppers.reduce((a, u) => a + u.count, 0);
    items.push({ key: 'bookcase-anchor', name: 'Anti-tip furniture strap', qty: anchors, unit: 'kit', note: `A bookcase on a cabinet is top-heavy: anchor ${anchors === 1 ? 'the bookcase' : 'each upper'} to a wall stud.`, priceKey: 'antiTip' });
    const runCrown = plan.parts.filter(p => p.name.startsWith('Run crown molding'));
    if (runCrown.length && plan.run?.crown) {
      const inches = runCrown.reduce((sum, p) => sum + p.qty * p.length, 0);
      items.push({ key: 'crown', name: `Crown molding, ${f(plan.run.crown.height)}`, qty: Math.ceil(inches * 1.1 / 12), unit: 'ft', note: 'Across the whole run, plus 10% for the cuts and any splice.', priceKey: 'crownFt', url: amazonSearch(`crown molding ${Math.round(plan.run.crown.height * 4) / 4} inch`) });
    }
    const runButcher = plan.run?.countertop.material === 'butcher' ? plan.run.countertop : null;
    if (runButcher) {
      items.push({ key: 'butcher-block', name: `Butcher-block countertop, ${f((runButcher.x1 - runButcher.x0) / runButcher.pieces)} × ${f(runButcher.z1 - runButcher.z0)}`, qty: runButcher.pieces, unit: 'ea', note: 'Buy each slab at least this size; seal both faces.', priceKey: 'butcherBlock', url: amazonSearch('butcher block countertop') });
      items.push({ key: 'figure8', name: 'Figure-8 tabletop fasteners', qty: 4 + 4 * plan.run!.cabinetCount, unit: 'ea', note: 'Let a solid-wood top move with the seasons.', priceKey: 'figure8' });
    }
    const crown = plan.parts.filter(p => p.name.startsWith('Crown molding'));
    if (!plan.run && crown.length && bk.crown) {
      const inches = crown.reduce((sum, p) => sum + p.qty * p.length, 0);
      items.push({ key: 'crown', name: `Crown molding, ${f(bk.crown.height)}`, qty: Math.ceil(inches * 1.1 / 12), unit: 'ft', note: 'Mitred at the corners, plus 10% for the cuts.', priceKey: 'crownFt', url: amazonSearch(`crown molding ${Math.round(bk.crown.height * 4) / 4} inch`) });
    }
    if (!plan.run && bk.countertop?.material === 'butcher') {
      const c = bk.countertop;
      items.push({ key: 'butcher-block', name: `Butcher-block countertop, ${f(c.x1 - c.x0)} × ${f(c.z1 - c.z0)}`, qty: 1, unit: 'ea', note: 'Buy it at least this size and cut it down; seal both faces.', priceKey: 'butcherBlock', url: amazonSearch('butcher block countertop') });
      items.push({ key: 'figure8', name: 'Figure-8 tabletop fasteners', qty: 8, unit: 'ea', note: 'Let a solid-wood top move with the seasons.', priceKey: 'figure8' });
    }
    if (bk.config.taskLight) {
      items.push({ key: 'led', name: `LED strip light kit, ${f(Math.ceil((plan.run ? plan.run.width : plan.overallWidth) / 12) * 12)}`, qty: 1, unit: 'kit', note: 'Under-cabinet strip with a plug-in driver; it sits behind the valance.', priceKey: 'ledStrip', url: amazonSearch('under cabinet LED strip light kit plug in') });
      if (bk.grommet) items.push({ key: 'grommet', name: `Desk grommet, ${f(bk.grommet.diameter)}`, qty: 1, unit: 'ea', note: 'For the light’s cord through the countertop.', priceKey: 'grommet', url: amazonSearch('2 inch desk grommet') });
    }
  }

  if (!bk && !desk && plan.mount === 'floor' && config.base !== 'casters' && plan.overallHeight > 30) {
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
    shims: 6,
    baseboardFt: 1.6,
    deskLeg: 15,
    shelfPin: 0.15,
    hinge: 4,
    doorPull: 4,
    bumper: 0.1,
    crownFt: 3,
    butcherBlock: 150,
    figure8: 0.5,
    ledStrip: 25,
    grommet: 6,
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
  shims: 'Shims, per pack',
  baseboardFt: 'Baseboard molding, per foot',
  deskLeg: 'Desk leg, each',
  shelfPin: 'Shelf pin, each',
  hinge: 'Door hinge, each',
  doorPull: 'Door knob or pull, each',
  bumper: 'Door bumper, each',
  crownFt: 'Crown molding, per foot',
  butcherBlock: 'Butcher-block top, each',
  figure8: 'Figure-8 fastener, each',
  ledStrip: 'LED strip kit, each',
  grommet: 'Desk grommet, each',
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
