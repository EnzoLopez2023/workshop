import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseplateStl, GF_PITCH, layoutGridfinity, splitUnits } from '../src/lib/gridfinity.ts';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';

const base = {
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('tiles split evenly to fit the bed', () => {
  assert.deepEqual(splitUnits(11, 6), [6, 5]);
  assert.deepEqual(splitUnits(7, 6), [4, 3]);
  assert.deepEqual(splitUnits(6, 6), [6]);
  assert.deepEqual(splitUnits(13, 4), [4, 3, 3, 3]);
});

test('an ALEX-size drawer takes a 6 × 11 grid in two tiles on a 256 mm bed', () => {
  const gf = layoutGridfinity(10.625 * 25.4, 19 * 25.4, 3.75 * 25.4, 256);
  assert.equal(gf.error, null);
  assert.equal(gf.columns, 6);
  assert.equal(gf.rows, 11);
  assert.deepEqual(gf.tiles, [{ columns: 6, rows: 6, count: 1 }, { columns: 6, rows: 5, count: 1 }]);
  assert.ok(Math.abs(gf.marginX - (10.625 * 25.4 - 6 * GF_PITCH) / 2) < 1e-9);
  assert.equal(gf.maxUnits, 13);
  assert.equal(gf.maxUnitsWithLip, 12);
  assert.deepEqual(layoutGridfinity(10.625 * 25.4, 19 * 25.4, 3.75 * 25.4, 180).tiles,
    [{ columns: 3, rows: 4, count: 4 }, { columns: 3, rows: 3, count: 2 }], 'A1 mini: tiles of at most 4 units, six in all');
  assert.match(layoutGridfinity(40, 300, 80, 256).error, /too small/);
  assert.match(layoutGridfinity(300, 300, 12, 256).error, /headroom/);
});

test('the baseplate STL is watertight: every edge shared by two triangles, wound opposite ways', () => {
  const stl = baseplateStl(3, 2);
  const tris = [...stl.matchAll(/outer loop\n((?:\s+vertex [^\n]+\n){3})/g)].map(m =>
    m[1].trim().split('\n').map(line => line.trim().replace('vertex ', '')));
  assert.ok(tris.length > 100);
  const edges = new Map();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(`${p}|${q}`, (edges.get(`${p}|${q}`) ?? 0) + 1);
  }
  for (const [key, n] of edges) {
    const [p, q] = key.split('|');
    assert.equal(n, 1, `directed edge used ${n} times`);
    assert.equal(edges.get(`${q}|${p}`), 1, `edge ${key} has no partner`);
  }
  const xs = tris.flat().map(v => Number(v.split(' ')[0]));
  assert.equal(Math.max(...xs), 3 * GF_PITCH);
  assert.equal(Math.min(...xs), 0);
});

test('a Gridfinity drawer: baseplate in 3D, guide instructions, and it saves', () => {
  const config = { ...base, inserts: [{ kind: 'gridfinity' }, null, null, null, null], gridfinityBed: 180 };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.inserts[0].gridfinity.columns, 6);
  assert.ok(!plan.parts.some(p => /Gridfinity/.test(p.name)), 'printed, so not in the plywood cut list');
  assert.ok(drawerSolids(plan, config).some(s => s.name === 'Drawer 1 Gridfinity baseplate' && s.group === 'Drawer 1'));
  const step = drawerGuideSteps(plan, config, 'in').steps.find(s => s.id === 'inserts');
  assert.match(step.instructions.join(' '), /6 × 11 baseplate/);
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.deepEqual(read.config.inserts[0], { kind: 'gridfinity' });
  assert.equal(read.config.gridfinityBed, 180);
});
