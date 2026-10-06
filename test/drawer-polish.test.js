import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bottomSag, buildDrawerPlan, DEFAULT_PULL, drawerDesignToFields, drawerSolids, finishColors, frontNotch, handHole,
  pullReach, readSavedDrawerDesign, toSavedDrawerDesign, WIDE_PULL_MARGIN,
} from '../src/lib/drawerUnit.ts';
import { drawerJigs, drawerPartFaces } from '../src/lib/drawerExport.ts';
import { amazonSearch, drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { partDxf, partSvg } from '../src/lib/shelfExport.ts';
import { formatLength } from '../src/lib/shelving.ts';

const f = inches => formatLength(inches, 'in');
const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('load check: pounds per drawer against the slides, and bottom sag against its span', () => {
  // A square plate's sag scales with the load and inversely with thickness cubed.
  const sag = bottomSag(12, 12, 0.25, 25);
  assert.ok(Math.abs(bottomSag(12, 12, 0.5, 25) - sag / 8) < 1e-9);
  assert.ok(Math.abs(bottomSag(12, 12, 0.25, 50) - 2 * sag) < 1e-9);
  assert.ok(bottomSag(12, 24, 0.25, 25) > sag, 'a long narrow bottom sags more');

  const alex = buildDrawerPlan(base);
  assert.ok(alex.loads.every(l => !l.overSlides && !l.sags), 'ALEX-size drawers are fine for paper and tools');
  const wide = buildDrawerPlan({ ...base, width: 34, depth: 26, load: 'heavy' });
  assert.ok(wide.warnings.some(w => /rated for/.test(w)), 'too heavy for 100 lb slides');
  assert.ok(wide.warnings.some(w => /would sag about/.test(w) && /Use (3\/8|1\/2|3\/4)" bottoms/.test(w)));
  assert.equal(buildDrawerPlan({ ...base, width: 34, depth: 26, load: 'light' }).warnings.filter(w => /sag|rated/.test(w)).length, 0);
});

test('pull styles: wide spans the front, hand holes cut through, and boxes clear both', () => {
  const wide = { ...DEFAULT_PULL, shape: 'wide', depth: 0.75 };
  assert.deepEqual(frontNotch(wide, 14), { shape: 'slot', width: 14 - 2 * WIDE_PULL_MARGIN, depth: 0.75 });
  const hole = { ...DEFAULT_PULL, shape: 'handhole', width: 3.5, depth: 1.25 };
  assert.equal(frontNotch(hole, 14), null);
  assert.deepEqual(handHole(hole), { width: 3.5, height: 1.25, top: 0.75 });
  assert.equal(pullReach(hole, 14), 2);

  const plan = buildDrawerPlan({ ...base, pull: hole });
  assert.deepEqual(plan.errors, []);
  for (const d of plan.drawers) {
    assert.ok(d.box.y + d.box.height - d.boxNotchDepth <= d.front.y + d.front.height - 2 - 3 / 8 + 1e-9, 'fingers reach behind the hole');
  }
  const front = drawerSolids(plan, { ...base, pull: hole }).find(s => s.name === 'Drawer 1 front');
  assert.equal(front.holes.length, 1);
  assert.equal(front.outline.length, 4, 'a hand-hole front keeps a plain top edge');
  const face = drawerPartFaces(plan, { ...base, pull: hole }).find(x => x.part.startsWith('Drawer front'));
  assert.ok(face.features.some(x => x.kind === 'cutout'));
  assert.match(partSvg(face, 'in'), /shaper:cutType="inside"/);
  assert.match(partDxf(face, 'in'), /INSIDE_0\.750in/);
  const template = drawerJigs(plan, { ...base, pull: hole }, f).find(j => j.face.id === 'pull-template');
  assert.equal(template.face.piece, 'Hand-hole template');
  assert.ok(template.face.features.some(x => x.kind === 'cutout'));

  assert.deepEqual(buildDrawerPlan({ ...base, pull: wide }).errors, []);
  assert.match(buildDrawerPlan({ ...base, width: 5.5, pull: wide }).errors.join(' '), /too narrow/);
  assert.match(buildDrawerPlan({ ...base, pull: { ...hole, depth: 4 } }).errors.join(' '), /hand hole reaches/);
});

test('per-drawer slides: a shorter box, its own slide line, and its own hardware line', () => {
  const config = { ...base, slideLengths: [12, null, null, null, null] };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.drawers[0].box.depth, 12);
  assert.equal(plan.drawers[1].box.depth, 20);
  assert.ok(plan.parts.some(p => p.name.startsWith('Box side') && p.length === 12));
  const items = drawerHardwareList(plan, config, 'in').filter(i => i.priceKey === 'slidePair');
  assert.deepEqual(items.map(i => [i.qty, i.name.match(/(\d+)"/)[1]]), [[4, '20'], [1, '12']]);
  const left = drawerPartFaces(plan, config).find(x => x.piece === 'Left side');
  assert.ok(left.features.some(x => x.kind === 'guide' && x.points[1][1] === 12), 'slide line as long as its slide');
  assert.match(buildDrawerPlan({ ...base, slideLengths: [22, null, null, null, null] }).errors.join(' '), /don’t fit/);
  assert.match(drawerGuideSteps(plan, config, 'in').steps.find(s => s.id === 'slides').summary, /4 pairs of 20" and 1 pair of 12" slides/);
});

test('finish colours and shopping links', () => {
  assert.deepEqual(finishColors({ front: '#f4f1ea', case: '#2e2e2e' }), { 'drawer-front': 0xf4f1ea, case: 0x2e2e2e, back: 0x2e2e2e });
  assert.deepEqual(finishColors(undefined), {});
  const feet = { ...base, base: 'feet' };
  const items = drawerHardwareList(buildDrawerPlan(feet), feet, 'in');
  assert.equal(items.find(i => i.key === 'slides').url, 'https://www.amazon.com/s?k=LONTAN+soft+close+drawer+slides+20+inch');
  assert.match(items.find(i => i.key === 'feet').url, /^https:\/\/www\.amazon\.com\/s\?k=MROCO/);
  assert.equal(items.find(i => i.key === 'glue').url, undefined);
  assert.equal(amazonSearch('a/b c'), 'https://www.amazon.com/s?k=a%2Fb+c');
});

test('the new options survive a save and reopen, and bad values are dropped', () => {
  const config = {
    ...base, pull: { ...DEFAULT_PULL, shape: 'handhole', width: 3.5, depth: 1.25 },
    slideLengths: [12, null, null, null, null], load: 'heavy', finish: { front: '#2e2e2e', case: '#e3c79d' },
  };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.equal(read.config.pull.shape, 'handhole');
  assert.deepEqual(read.config.slideLengths, [12, null, null, null, null]);
  assert.equal(read.config.load, 'heavy');
  assert.deepEqual(read.config.finish, config.finish);
  const fields = drawerDesignToFields(read);
  assert.deepEqual(fields.drawerSlides, ['12', '', '', '', '']);
  assert.equal(fields.finishFront, '#2e2e2e');
  const bad = readSavedDrawerDesign({ ...toSavedDrawerDesign(base, 'in'), config: { ...base, slideLengths: [15], finish: { front: 'red', case: '#000000' } } });
  assert.deepEqual(bad.config.slideLengths, [null, null, null, null, null]);
  assert.equal(bad.config.finish, undefined);
});

test('each drawer’s front, box and insert slide out together; slides and case stay put', async () => {
  const { DRAWER_OPEN_FRACTION, deskSolids } = await import('../src/lib/drawerUnit.ts');
  const config = { ...base, inserts: [{ kind: 'grid', columns: 2, rows: 2 }, null, null, null, null] };
  const plan = buildDrawerPlan(config);
  const solids = drawerSolids(plan, config);
  const first = solids.filter(s => s.group === 'Drawer 1');
  assert.ok(first.some(s => s.kind === 'drawer-front') && first.some(s => s.kind === 'drawer-box') && first.some(s => s.kind === 'insert'));
  assert.ok(first.every(s => Math.abs(s.travel - 20 * DRAWER_OPEN_FRACTION) < 1e-9));
  assert.ok(solids.filter(s => s.kind === 'slide' || s.kind === 'case').every(s => !s.group));
  const desk = { enabled: true, layout: 'both', width: 60, height: 29, depth: 24, topLayers: 2 };
  const groups = new Set(deskSolids(buildDrawerPlan({ ...config, desk }), { ...config, desk }).map(s => s.group).filter(Boolean));
  assert.ok(groups.has('Drawer 1') && groups.has('Right unit · Drawer 1'), 'each unit’s drawers open on their own');
});
