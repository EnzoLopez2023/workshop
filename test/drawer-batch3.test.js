import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerDesignToFields, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { cuttingOrder, stripsNeeded } from '../src/lib/cuttingOrder.ts';
import { drawerJigs, drawerPartFaces } from '../src/lib/drawerExport.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { binStl, packBins } from '../src/lib/gridfinity.ts';
import { drawerPacketHtml } from '../src/lib/buildPacket.ts';
import { guidePrintHtml } from '../src/lib/buildGuide.ts';
import { quantityLabel } from '../src/lib/shelfEstimate.ts';
import { formatLength } from '../src/lib/shelving.ts';

const f = inches => formatLength(inches, 'in');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);
const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('exploded view: case panels move outward, drawer parts spread, feet stay', () => {
  const config = { ...base, base: 'feet' };
  const solids = drawerSolids(buildDrawerPlan(config), config);
  const by = n => solids.find(s => s.name === n);
  assert.ok(by('Left side').explode[0] < 0 && by('Right side').explode[0] > 0);
  assert.ok(by('Top').explode[1] > 0 && by('Back').explode[2] > 0);
  assert.ok(by('Drawer 1 front').explode[2] < 0, 'fronts come forward');
  assert.ok(by('Drawer 1 box bottom').explode[1] < 0);
  assert.equal(by('Foot 1').explode, undefined);
});

test('cutting order: widest rips first, strips packed along the sheet, every piece accounted for', () => {
  assert.equal(stripsNeeded([48, 48], 96, 0.125), 2, 'two 48s plus a kerf need two strips');
  assert.equal(stripsNeeded([47, 48], 96, 0.125), 1);
  const plan = buildDrawerPlan(base);
  const order = cuttingOrder(plan.parts);
  assert.deepEqual(order.map(g => g.thickness), [0.75, 0.5, 0.25]);
  for (const g of order) {
    assert.deepEqual(g.rips.map(r => r.width), [...g.rips.map(r => r.width)].sort((a, b) => b - a));
    for (const r of g.rips) assert.deepEqual(r.crosscuts.map(c => c.length), [...r.crosscuts.map(c => c.length)].sort((a, b) => b - a));
  }
  const pieces = order.flatMap(g => g.rips).reduce((a, r) => a + r.pieces, 0);
  assert.equal(pieces, plan.parts.reduce((a, p) => a + p.qty, 0));
});

test('open cubbies: no drawer parts or slides, a fixed shelf for a floor, and the jigs skip them', () => {
  const config = { ...base, openSlots: [false, true, false, false, true] };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.drawers[1].label, 'Cubby 2');
  assert.ok(plan.drawers[1].shelfY !== null, 'a middle cubby gets a shelf');
  assert.equal(plan.drawers[4].shelfY, null, 'the bottom cubby sits on the case bottom');
  assert.equal(plan.parts.filter(p => p.name.startsWith('Drawer front')).reduce((a, p) => a + p.qty, 0), 3);
  assert.equal(plan.parts.find(p => p.name === 'Cubby shelf').qty, 1);
  assert.equal(drawerHardwareList(plan, config, 'in').find(i => i.key === 'slides').qty, 3);
  const solids = drawerSolids(plan, config);
  assert.ok(!solids.some(s => s.name.startsWith('Cubby 2 ') && s.kind !== 'shelf'));
  assert.ok(solids.some(s => s.name === 'Cubby 2 shelf'));
  assert.equal(drawerPartFaces(plan, config).find(x => x.piece === 'Left side').features.filter(x => x.kind === 'guide').length, 3);
  const blocks = drawerJigs(plan, config, f).find(j => j.face.id.startsWith('slide-spacer'));
  assert.equal(1 + (blocks.extraFaces?.length ?? 0), 3);
  const guide = drawerGuideSteps(plan, config, 'in');
  assert.match(guide.steps.find(s => s.id === 'case').instructions.join(' '), /cubby shelves/);
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.deepEqual(drawerDesignToFields(read).insertKinds, ['none', 'cubby', 'none', 'none', 'cubby']);
});

test('wall-hung: French cleat behind a grooved-in back, lifted off the floor, screwed into studs', () => {
  const config = { ...base, mount: 'wall', mountHeight: 36, cleatHeight: 3 };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  close(plan.interiorDepth, buildDrawerPlan(base).interiorDepth - 0.75, 'the back moves forward by the cleat');
  assert.ok(['Cabinet cleat', 'Wall cleat', 'Bottom spacer'].every(n => plan.parts.some(p => p.name === n)));
  const groove = drawerPartFaces(plan, config).find(x => x.piece === 'Left side').features.find(x => x.label === 'Back groove');
  close(groove.v, plan.parts.find(p => p.name === 'Side').width - 0.75 - 0.25);
  const solids = drawerSolids(plan, config);
  assert.ok(solids.filter(s => s.shape === 'box').every(s => s.min[1] >= 36 - 1e-9), 'everything hangs 36" up');
  assert.ok(solids.some(s => s.name === 'Wall cleat'));
  assert.ok(drawerHardwareList(plan, config, 'in').some(i => i.key === 'structural'));
  assert.ok(drawerGuideSteps(plan, config, 'in').steps.some(s => s.id === 'install'));
  assert.equal(plan.supports, 0);
  assert.match(buildDrawerPlan({ ...config, desk: { enabled: true, layout: 'both', width: 60, height: 29, depth: 24, topLayers: 2 } }).errors.join(' '), /floor-standing/);
});

test('under a desk: stands on the floor beside your knees, and too tall a unit is refused', () => {
  const config = { ...base, height: 27.75, mount: 'under-desk', mountHeight: 28, base: 'casters', casterHeight: 2 };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.warnings.filter(w => /knees|hangs/.test(w)), [], 'no knee warning: it stands at the side');
  close(plan.lift, 0);
  assert.equal(plan.baseHeight, 2, 'casters still go under it');
  assert.equal(plan.supports, 4);
  const solids = drawerSolids(plan, config);
  const desk = solids.find(s => s.name === 'Desk (existing)');
  close(desk.min[1], 28, 'the desk is above it');
  assert.ok(Math.max(...solids.filter(s => s.shape === 'box' && s.kind === 'case').map(s => s.max[1])) <= 28);
  assert.match(buildDrawerPlan({ ...config, height: 28.5 }).errors.join(' '), /won’t fit under the desk/);
});

test('guide steps carry time estimates for the tracker', () => {
  const guide = drawerGuideSteps(buildDrawerPlan(base), base, 'in');
  const timed = guide.steps.filter(s => s.minutes);
  assert.ok(timed.length >= 8);
  const boxMinutes = ['box-glue', 'box-bottom', 'box-close', 'boxes'].reduce((a, id) => a + guide.steps.find(s => s.id === id).minutes, 0);
  assert.equal(boxMinutes, 100, '20 minutes a box, the first one step by step');
});

test('bin packing: big bins first, turned when that fits, and leftovers reported', () => {
  // 3 + 6 + 3 cells exactly fill a 4 × 3 grid, but only if the 3 × 1 bin is turned.
  const packed = packBins(4, 3, [{ w: 1, d: 1, u: 3, qty: 3 }, { w: 2, d: 3, u: 6, qty: 1 }, { w: 3, d: 1, u: 3, qty: 1 }]);
  assert.equal(packed.unplaced, 0);
  assert.equal(packed.freeCells, 0);
  assert.ok(packed.placements.some(p => p.w === 1 && p.d === 3), 'the long bin was turned');
  const cells = new Set();
  for (const p of packed.placements) for (let x = p.x; x < p.x + p.w; x++) for (let y = p.y; y < p.y + p.d; y++) {
    assert.ok(!cells.has(`${x},${y}`), 'no overlaps');
    cells.add(`${x},${y}`);
  }
  assert.equal(packBins(2, 2, [{ w: 3, d: 1, u: 3, qty: 1 }]).unplaced, 1);
  const plan = buildDrawerPlan({ ...base, inserts: [{ kind: 'gridfinity', bins: [{ w: 2, d: 2, u: 20, qty: 1 }] }, null, null, null, null] });
  assert.match(plan.errors.join(' '), /20u bins are taller/);
});

test('the bin STL is watertight: every edge shared by two triangles, wound opposite ways', () => {
  const stl = binStl(2, 1, 6);
  const tris = [...stl.matchAll(/outer loop\n((?:\s+vertex [^\n]+\n){3})/g)].map(m => m[1].trim().split('\n').map(l => l.trim().replace('vertex ', '')));
  const edges = new Map();
  for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(`${p}|${q}`, (edges.get(`${p}|${q}`) ?? 0) + 1);
  for (const [key, n] of edges) {
    const [p, q] = key.split('|');
    assert.equal(n, 1, key);
    assert.equal(edges.get(`${q}|${p}`), 1, `edge ${key} has no partner`);
  }
  const zs = tris.flat().map(v => Number(v.split(' ')[2]));
  assert.equal(Math.max(...zs), 42, '6u is 42 mm tall');
});

test('the build packet has every section, ahead of the guide, and escapes text', () => {
  const config = { ...base, inserts: [{ kind: 'gridfinity', bins: [{ w: 2, d: 1, u: 6, qty: 3 }] }, null, null, null, null] };
  const plan = buildDrawerPlan(config);
  const html = drawerPacketHtml({
    plan, config, units: 'in', jigs: drawerJigs(plan, config, f), quantity: quantityLabel,
    hardware: drawerHardwareList(plan, config, 'in'), cost: { lines: [{ name: 'Glue <8 oz>', qtyLabel: '1', total: 8, optional: false }], total: 8 },
  });
  for (const heading of ['At a glance', 'Cut list', 'Cutting order', 'Hardware and cost', '3D prints', 'Shop jigs']) assert.match(html, new RegExp(heading));
  assert.match(html, /Glue &lt;8 oz&gt;/);
  assert.match(html, /3 × 2 × 1 bin, 6u/);
  const doc = guidePrintHtml(drawerGuideSteps(plan, config, 'in'), new Map(), 'Desk <pedestal>', 'sub', f, html);
  assert.ok(doc.indexOf('<h2>Cut list') < doc.indexOf('<h2 class="page-break">Build guide'));
  assert.match(doc, /Desk &lt;pedestal&gt;/);
});
