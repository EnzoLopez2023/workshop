import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL } from '../src/lib/drawerUnit.ts';
import { drawerFeatureSummary, drawerPartFaces, TNUT_HOLE } from '../src/lib/drawerExport.ts';
import { drawerCostEstimate, drawerHardwareList, defaultDrawerPrices, sheetPriceKey } from '../src/lib/drawerEstimate.ts';
import { planSheetsByThickness } from '../src/lib/buildGuide.ts';
import { partDxf, partSvg, sheetSvg } from '../src/lib/shelfExport.ts';
import { quantityLabel } from '../src/lib/shelfEstimate.ts';

const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('drawer fronts are cut with the finger-pull notch as their outline', () => {
  const plan = buildDrawerPlan(base);
  const faces = drawerPartFaces(plan, base);
  const fronts = faces.filter(f => f.part.startsWith('Drawer front'));
  assert.ok(fronts.length > 0);
  for (const face of fronts) {
    assert.ok(face.outline, face.id);
    const notch = face.outline.filter(([u, v]) => v < face.width - 1e-9 && v > 0 && u > 0 && u < face.length);
    const deepest = Math.min(...notch.map(([, v]) => v));
    assert.ok(Math.abs(face.width - deepest - DEFAULT_PULL.depth) < 1e-6, 'notch is 1" deep');
    const wide = Math.max(...notch.map(([u]) => u)) - Math.min(...notch.map(([u]) => u));
    assert.ok(wide <= DEFAULT_PULL.width + 1e-9 && wide > DEFAULT_PULL.width * 0.9, 'notch spans the pull width');
    const svg = partSvg(face, 'in');
    assert.match(svg, /shaper:cutType="outside"/);
    assert.ok((svg.match(/ L /g) ?? []).length > 20, 'the outline follows the curve');
    assert.match(svg, /Z" fill="#000000"/, 'closed path');
  }
  const off = drawerPartFaces(buildDrawerPlan({ ...base, pull: { ...DEFAULT_PULL, enabled: false } }), { ...base, pull: { ...DEFAULT_PULL, enabled: false } });
  assert.ok(off.every(f => !f.outline), 'no pull, plain rectangles');
});

test('banded fronts are notched from the finished edge', () => {
  const config = { ...base, edgeBanding: true, bandingThickness: 0.04 };
  const plan = buildDrawerPlan(config);
  const face = drawerPartFaces(plan, config).find(f => f.part.startsWith('Drawer front'));
  const deepest = Math.min(...face.outline.map(([, v]) => v).filter(v => v > 0));
  assert.ok(Math.abs(face.width - deepest - (DEFAULT_PULL.depth - 0.04)) < 1e-6);
});

test('box parts carry rabbets and the bottom groove; box fronts clear the pull', () => {
  const plan = buildDrawerPlan(base);
  const faces = drawerPartFaces(plan, base);
  const side = faces.find(f => f.part.startsWith('Box side'));
  assert.equal(side.features.filter(f => f.label.includes('rabbet')).length, 2);
  const groove = side.features.find(f => f.label === 'Bottom groove');
  assert.equal(groove.v, 0.5);
  assert.ok(groove.width > base.bottomThickness, 'a hair wider than the bottom');
  assert.equal(drawerFeatureSummary(side), '2 rabbets, 1 groove');
  const boxFronts = faces.filter(f => f.part.startsWith('Box front'));
  assert.ok(boxFronts.every(f => f.outline), 'every box front is notched behind the pull');
  assert.match(drawerFeatureSummary(boxFronts[0]), /^finger-pull notch/);
});

test('case sides get the back rabbet and slide lines; the bottom gets T-nut holes or caster outlines', () => {
  const feet = { ...base, base: 'feet' };
  const plan = buildDrawerPlan(feet);
  const faces = drawerPartFaces(plan, feet);
  const left = faces.find(f => f.piece === 'Left side');
  assert.equal(left.features.filter(f => f.kind === 'guide').length, 5);
  const rabbet = left.features.find(f => f.label === 'Back rabbet');
  assert.equal(rabbet.depth, 0.375);
  assert.match(partDxf(left, 'in'), /\nGUIDE\n/);
  assert.match(partSvg(left, 'in'), /shaper:cutType="guide"/);

  const bottom = faces.find(f => f.part === 'Bottom');
  const holes = bottom.features.filter(f => f.kind === 'hole');
  assert.equal(holes.length, 4);
  assert.ok(holes.every(h => h.radius === TNUT_HOLE / 2 && h.depth === 0.75), 'drilled through for the T-nut');
  assert.ok(holes.every(h => h.u > 0 && h.u < bottom.length && h.v > 0 && h.v < bottom.width), 'inside the bottom');

  const casters = { ...base, base: 'casters', width: 32 };
  const cfaces = drawerPartFaces(buildDrawerPlan(casters), casters);
  assert.equal(cfaces.find(f => f.part === 'Bottom').features.filter(f => f.kind === 'guide' && f.closed).length, 6);
});

test('sheets are planned per thickness and every part lands on one', () => {
  const plan = buildDrawerPlan({ ...base, base: 'feet' });
  const groups = planSheetsByThickness(plan.parts, 'in');
  assert.deepEqual(groups.map(g => g.thickness), [0.75, 0.5, 0.25]);
  const pieces = plan.parts.reduce((s, p) => s + p.qty, 0);
  assert.equal(groups.reduce((s, g) => s + g.sheets.layouts.reduce((n, l) => n + l.placed.length, 0), 0), pieces);
  assert.ok(groups.every(g => g.sheets.unplaced.length === 0));
  const faces = drawerPartFaces(plan, { ...base, base: 'feet' });
  const svg = sheetSvg(groups[0].sheets.layouts[0], faces, 'in', 'Sheet');
  assert.ok((svg.match(/Drawer front/g) ?? []).length >= 5, 'fronts drawn on the case sheet');
});

test('hardware: slide pairs, MROCO packs of 12, casters, and a cost per sheet thickness', () => {
  const feet = { ...base, base: 'feet', width: 32 };
  const plan = buildDrawerPlan(feet);
  const items = drawerHardwareList(plan, feet, 'in');
  const slides = items.find(i => i.key === 'slides');
  assert.equal(slides.qty, 5);
  assert.equal(slides.unit, 'pair');
  assert.match(slides.name, /20"/);
  const pack = items.find(i => i.key === 'feet');
  assert.equal(pack.qty, 1);
  assert.equal(pack.uses, 6);
  assert.equal(quantityLabel(2, 'pack of 12'), '2 packs of 12');

  const casters = { ...base, base: 'casters' };
  assert.equal(drawerHardwareList(buildDrawerPlan(casters), casters, 'in').find(i => i.key === 'casters').qty, 4);

  assert.equal(sheetPriceKey(0.75, feet), 'sheetCase');
  assert.equal(sheetPriceKey(0.5, feet), 'sheetBox');
  assert.equal(sheetPriceKey(0.25, feet), 'sheetThin');
  const prices = defaultDrawerPrices();
  const sheets = [{ thickness: 0.75, count: 2, label: 'case' }, { thickness: 0.25, count: 1, label: 'thin' }];
  const estimate = drawerCostEstimate(sheets, feet, items, prices);
  assert.equal(estimate.lines[0].total, 2 * prices.sheetCase);
  assert.equal(estimate.lines.find(l => l.key === 'slides').total, 5 * prices.slidePair);
  assert.ok(estimate.total > estimate.required, 'finish is optional');
});
