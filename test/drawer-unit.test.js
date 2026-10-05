import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoSlideLength,
  buildDrawerPlan,
  DEFAULT_PULL,
  drawerDesignToFields,
  drawerSolids,
  graduatedFronts,
  notchedOutline,
  overallFromFronts,
  pullProfile,
  readSavedDrawerDesign,
  SLIDE_CLEARANCE,
  toSavedDrawerDesign,
} from '../src/lib/drawerUnit.ts';
import { DRAWER_TEMPLATES } from '../src/lib/drawerTemplates.ts';
import { parseLength } from '../src/lib/shelving.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);

// ALEX 5-drawer size, 3/4" case, 1/2" boxes.
const base = {
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('slides: the longest LONTAN length that fits, and a clear error when none does', () => {
  assert.equal(autoSlideLength(21.875), 20);
  assert.equal(autoSlideLength(10.5), 10);
  assert.equal(autoSlideLength(10.4), null);
  assert.equal(buildDrawerPlan(base).slideLength, 20, '22 7/8 deep less 3/4 fronts and 1/4 back leaves 21 7/8');

  const shallow = buildDrawerPlan({ ...base, depth: 11 });
  assert.match(shallow.errors.join(' '), /shortest slide is 10"/);
  assert.match(shallow.errors.join(' '), /at least 11 1\/2" deep/);

  const tooLong = buildDrawerPlan({ ...base, slideLength: 22 });
  assert.match(tooLong.errors.join(' '), /longest that fits is 20"/);
  assert.match(buildDrawerPlan({ ...base, slideLength: 15 }).errors.join(' '), /isn’t a slide length/);
  assert.deepEqual(buildDrawerPlan({ ...base, slideLength: 16 }).errors, []);
});

test('boxes are the opening less 1/2" per side for the slides, and as deep as the slide', () => {
  const plan = buildDrawerPlan(base);
  for (const d of plan.drawers) {
    close(d.box.width, base.width - 2 * base.thickness - 2 * SLIDE_CLEARANCE, 'box width');
    assert.equal(d.box.depth, 20);
    close(d.box.x, base.thickness + SLIDE_CLEARANCE, 'box sits 1/2" in from the side');
  }
  const side = plan.parts.find(p => p.name === 'Box side · drawer 1');
  assert.equal(side.length, 20);
  const front = plan.parts.find(p => p.name === 'Box front · drawer 1');
  close(front.length, plan.drawers[0].box.width - base.boxThickness, 'box front fits into 1/4" rabbets in the sides');
});

test('fronts and gaps fill the case exactly, overlaying it top to bottom', () => {
  const plan = buildDrawerPlan(base);
  const total = plan.drawers.reduce((a, d) => a + d.front.height, 0) + base.drawers * base.gap;
  close(total, plan.caseHeight);
  close(plan.drawers[0].front.y + plan.drawers[0].front.height, plan.overallHeight - base.gap / 2, 'top reveal');
  close(plan.drawers.at(-1).front.y, base.gap / 2, 'bottom reveal');
  for (let i = 1; i < plan.drawers.length; i++) {
    close(plan.drawers[i - 1].front.y - (plan.drawers[i].front.y + plan.drawers[i].front.height), base.gap, 'gap between fronts');
  }
});

test('per-front heights build the overall height, including feet or casters', () => {
  const fronts = [6, 7.25, 8.5, 10];
  const config = { ...base, drawers: 4, frontHeights: fronts, base: 'feet', footHeight: 0.5 };
  const plan = buildDrawerPlan(config);
  close(plan.overallHeight, 31.75 + 4 * 0.125 + 0.5);
  close(overallFromFronts(fronts, config), plan.overallHeight);
  assert.deepEqual(plan.drawers.map(d => d.front.height), fronts);
  assert.equal(plan.baseHeight, 0.5);
  assert.equal(plan.supports, 4);
  assert.equal(buildDrawerPlan({ ...config, width: 32 }).supports, 6, 'wide units get a middle pair');

  const grad = graduatedFronts(4, 20);
  close(grad.reduce((a, b) => a + b, 0), 20);
  assert.ok(grad.every((h, i) => i === 0 || h > grad[i - 1]), 'fronts grow toward the floor');
});

test('the finger-pull notch has the asked width and depth, and the box front clears it', () => {
  for (const shape of ['arc', 'slot']) {
    const pts = pullProfile({ shape, width: 4.75, depth: 1 });
    assert.deepEqual(pts[0], [-4.75 / 2, 0]);
    assert.deepEqual(pts.at(-1), [4.75 / 2, 0]);
    close(Math.min(...pts.map(p => p[1])), -1, `${shape} depth`);
    assert.ok(pts.every(p => Math.abs(p[0]) <= 4.75 / 2 + 1e-9), `${shape} stays within its width`);
  }
  const outline = notchedOutline(0, 0, 14, 5, { shape: 'arc', width: 4, depth: 1 });
  assert.deepEqual(outline.slice(0, 3), [[0, 0], [14, 0], [14, 5]], 'all four corners');
  assert.deepEqual(outline.at(-1), [0, 5]);
  close(Math.min(...outline.filter(p => p[0] > 6 && p[0] < 8).map(p => p[1])), 4, 'notch bottom 1" below the top');

  const plan = buildDrawerPlan(base);
  for (const d of plan.drawers) {
    const boxTop = d.box.y + d.box.height;
    const reach = d.front.y + d.front.height - DEFAULT_PULL.depth;
    assert.ok(boxTop - d.boxNotchDepth <= reach - 3 / 8 + 1e-9, `drawer ${d.index + 1}: fingers have 3/8" behind the front`);
  }
  assert.match(buildDrawerPlan({ ...base, pull: { ...DEFAULT_PULL, depth: 4.5 } }).errors.join(' '), /too far/);
  assert.match(buildDrawerPlan({ ...base, pull: { ...DEFAULT_PULL, width: 13 } }).errors.join(' '), /wider than/);
  const noPull = buildDrawerPlan({ ...base, pull: { ...DEFAULT_PULL, enabled: false } });
  assert.ok(noPull.drawers.every(d => d.boxNotchDepth === 0));
});

test('measurement problems are explained with the numbers to fix them', () => {
  assert.match(buildDrawerPlan({ ...base, width: 6 }).errors.join(' '), /at least 6 1\/2" wide/);
  assert.match(buildDrawerPlan({ ...base, height: 10, drawers: 5 }).errors.join(' '), /slides need at least 2 1\/4"/);
  assert.match(buildDrawerPlan({ ...base, backThickness: 0.75 }).errors.join(' '), /thinner than the case/);
  assert.ok(buildDrawerPlan({ ...base, width: 40 }).warnings.some(w => w.includes('twists and binds')));
  assert.ok(buildDrawerPlan({ ...base, thickness: 0.5, base: 'feet' }).warnings.some(w => w.includes('T-nuts')));
  const metric = buildDrawerPlan({ ...base, units: 'mm', depth: 11 });
  assert.match(metric.errors.join(' '), /254 mm/);
});

test('3D solids stay inside the unit, with fronts ahead of the case', () => {
  for (const config of [base, { ...base, base: 'casters' }, { ...base, base: 'feet', width: 34 }]) {
    const plan = buildDrawerPlan(config);
    const solids = drawerSolids(plan, config);
    const fronts = solids.filter(s => s.kind === 'drawer-front');
    assert.equal(fronts.length, config.drawers);
    assert.ok(fronts.every(s => s.shape === 'plate' && s.z1 === 0 && s.z0 === -config.thickness));
    for (const s of solids) {
      if (s.shape === 'box') {
        assert.ok(s.min.every((v, i) => v < s.max[i]), s.name);
        assert.ok(s.min[0] >= -1e-9 && s.max[0] <= plan.overallWidth + 1e-9, `${s.name} x`);
        assert.ok(s.min[1] >= -1e-9 && s.max[1] <= plan.overallHeight + 1e-9, `${s.name} y`);
        assert.ok(s.min[2] >= -1e-9 && s.max[2] <= plan.caseDepth + 1e-9, `${s.name} z`);
      }
    }
    assert.equal(solids.filter(s => s.kind === 'slide').length, 2 * config.drawers);
    const support = config.base === 'feet' ? 'foot' : config.base === 'casters' ? 'caster' : null;
    if (support) assert.ok(solids.some(s => s.kind === support));
  }
});

test('every template builds with no errors', () => {
  const P = s => parseLength(s, 'in');
  for (const t of DRAWER_TEMPLATES) {
    const f = t.fields;
    const plan = buildDrawerPlan({
      ...base, width: P(f.width), depth: P(f.depth), height: f.height ? P(f.height) : 0, drawers: f.drawers,
      frontHeights: f.frontHeights?.map(P), base: f.base ?? 'none',
      columns: f.columns > 1 ? f.columnDrawers.map(n => ({ drawers: n })) : undefined,
    });
    assert.deepEqual(plan.errors, [], t.id);
  }
});

test('saved designs round-trip and bad ones are rejected rather than guessed', () => {
  const config = { ...base, drawers: 4, frontHeights: [6, 7.25, 8.5, 10], base: 'casters' };
  const saved = JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'mm', 'fronts')));
  const read = readSavedDrawerDesign(saved);
  assert.equal(read.units, 'mm');
  assert.equal(read.heightMode, 'fronts');
  assert.deepEqual(buildDrawerPlan(read.config).parts, buildDrawerPlan({ ...config, units: 'mm' }).parts);

  const overall = toSavedDrawerDesign(config, 'in', 'overall');
  assert.equal(overall.config.frontHeights, undefined, 'overall mode keeps no stale front list');

  assert.equal(readSavedDrawerDesign(null), null);
  assert.equal(readSavedDrawerDesign({ ...saved, kind: 'shelf' }), null);
  assert.equal(readSavedDrawerDesign({ ...saved, version: 2 }), null);
  assert.equal(readSavedDrawerDesign({ ...saved, config: { ...saved.config, width: 'wide' } }), null);
  assert.equal(readSavedDrawerDesign({ ...saved, config: { ...saved.config, frontHeights: [6, 7] } }), null);

  const fields = drawerDesignToFields(read);
  assert.equal(fields.frontHeights.length, 4);
  assert.equal(fields.units, 'mm');
  assert.equal(fields.base, 'casters');
});
