import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, pullHoles, shakerRail, readSavedDrawerDesign, toSavedDrawerDesign, drawerDesignToFields } from '../src/lib/drawerUnit.ts';
import { drawerPartFaces, drawerJigs } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';

const shaker = (method = 'pocket') => ({ style: 'shaker', method, rail: 2.25, depth: 0.25 });
const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 24, height: 30, depth: 22.875, drawers: 3, gap: 0.125,
  pull: { ...DEFAULT_PULL, enabled: false }, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('pull placement: centred on short drawers, near the top of tall ones, near the opening edge of doors', () => {
  const knob = { kind: 'knob', spacing: 0 };
  assert.deepEqual(pullHoles(knob, 20, 6, null).holes, [[10, 3]]);
  assert.deepEqual(pullHoles(knob, 20, 12, null).holes, [[10, 9]]);
  const bar = { kind: 'bar', spacing: 3.75 };
  assert.deepEqual(pullHoles(bar, 20, 6, null).holes, [[10 - 1.875, 3], [10 + 1.875, 3]]);
  assert.equal(pullHoles(bar, 36, 6, null).pulls.length, 2, 'two on wide fronts');
  const door = pullHoles(bar, 15, 24, { hinge: 'left' }).holes;
  assert.ok(door.every(([x]) => x === 13), 'upright, 2" from the free (right) edge');
  close(door[0][1], 21, 'top hole 3" below the top');
  assert.equal(pullHoles({ kind: 'none', spacing: 0 }, 20, 6, null).holes.length, 0);
});

test('Shaker frame: the asked width, narrower on small fronts, none on tiny ones', () => {
  assert.equal(shakerRail(shaker(), 20, 10), 2.25);
  assert.equal(shakerRail(shaker(), 20, 5), 1.75, 'a 5" front keeps a 1 1/2" panel');
  assert.equal(shakerRail(shaker(), 20, 2.5), 0);
});

test('CNC Shaker: the panel is pocketed and the pull holes drilled through', () => {
  const config = { ...base, frontProfile: shaker(), hardware: { kind: 'bar', spacing: 3.75 } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const front = drawerPartFaces(p, config).find(f => f.part.startsWith('Drawer front'));
  const pocket = front.features.find(x => x.label === 'Shaker panel');
  close(pocket.depth, 0.25, 'pocket depth');
  close(pocket.u, 2.25, 'frame width');
  assert.equal(front.features.filter(x => x.label.startsWith('Pull hole')).length, 2);
  // In 3D the frame has a hole where the recessed panel sits.
  const solids = drawerSolids(p, config);
  assert.ok(solids.some(s => s.name === 'Drawer 1 front panel'));
  assert.ok(solids.some(s => s.name === 'Drawer 1 front pull' && s.group === 'Drawer 1'), 'the pull slides out with its drawer');
  const hw = drawerHardwareList(p, config, 'in');
  assert.equal(hw.find(i => i.key === 'pulls').qty, 3);
  assert.ok(drawerJigs(p, config, String).some(j => j.title === 'Pull drilling jig'));
  assert.ok(drawerGuideSteps(p, config, 'in').steps.some(s => s.id === 'front-details'));
});

test('applied Shaker: strips in the cut list, glued on in front of the slab', () => {
  const config = { ...base, frontProfile: shaker('applied') };
  const p = buildDrawerPlan(config);
  const stiles = p.parts.find(x => x.name === 'Shaker stile');
  assert.equal(stiles.qty, 6);
  close(stiles.thickness, 0.25, 'strip stock');
  assert.ok(p.parts.some(x => x.name === 'Shaker rail'));
  const strip = drawerSolids(p, config).find(s => s.name === 'Drawer 1 front left stile');
  assert.ok(strip.max[2] <= -0.75 + 1e-9, 'in front of the overlay front');
});

test('doors get pull holes on the back face (mirrored) and the pocket on an outside face', () => {
  const config = { ...base, frontStyle: 'inset', drawers: 2, doors: [null, { hinge: 'left', inside: 'empty', count: 0 }], frontProfile: shaker(), hardware: { kind: 'knob', spacing: 0 } };
  const p = buildDrawerPlan(config);
  const faces = drawerPartFaces(p, config).filter(f => f.part.startsWith('Door'));
  const back = faces.find(f => f.face === 'back face');
  const hole = back.features.find(x => x.label.startsWith('Pull hole'));
  assert.ok(hole.u < back.length / 2, 'free edge (right from the front) is on the left from behind');
  assert.ok(faces.some(f => f.face === 'outside face' && f.features.some(x => x.label === 'Shaker panel')));
});

test('fronts and pulls survive a save and the form', () => {
  const config = { ...base, frontProfile: shaker('applied'), hardware: { kind: 'cup', spacing: 3 } };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.deepEqual(read.config.frontProfile, shaker('applied'));
  assert.deepEqual(read.config.hardware, { kind: 'cup', spacing: 3 });
  const fields = drawerDesignToFields(read);
  assert.equal(fields.profileMethod, 'applied');
  assert.equal(fields.hardwareKind, 'cup');
});

import { DEFAULT_BOOKCASE } from '../src/lib/drawerBookcase.ts';

test('bookcase doors match the cabinet: Shaker panel, pulls, strips, holes and the count', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, bays: 2, doors: [true, true] };
  const pocket = { ...base, frontStyle: 'inset', base: 'kick', bookcase, frontProfile: shaker(), hardware: { kind: 'bar', spacing: 3.75 } };
  const p = buildDrawerPlan(pocket);
  assert.deepEqual(p.errors, []);
  const solids = drawerSolids(p, pocket);
  assert.ok(solids.some(s => s.name === 'Bookcase door 1 panel'), 'Shaker panel');
  assert.ok(solids.some(s => s.name === 'Bookcase door 1 pull'), 'pull');
  const faces = drawerPartFaces(p, pocket).filter(f => f.part.startsWith('Bookcase door'));
  assert.ok(faces.some(f => f.features.some(x => x.label === 'Hinge cup 1') && f.features.some(x => x.label.startsWith('Pull hole'))));
  assert.ok(faces.some(f => f.face === 'outside face' && f.features.some(x => x.label === 'Shaker panel')));
  const hw = drawerHardwareList(p, pocket, 'in');
  assert.equal(hw.find(i => i.key === 'pulls').qty, 3 + 2, '3 drawers and 2 bookcase doors');
  assert.ok(!hw.some(i => i.key === 'bookcase-pulls'), 'not counted twice');
  const guide = drawerGuideSteps(p, pocket, 'in');
  const names = new Set(guide.solids.map(s => s.name));
  for (const step of guide.steps) for (const n of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(n), `${step.id}: ${n}`);
  assert.ok(guide.steps.find(s => s.id === 'bookcase-doors').scene.highlight.includes('Bookcase door 1 pull'));
  const applied = buildDrawerPlan({ ...pocket, frontProfile: shaker('applied') });
  assert.ok(applied.parts.some(x => x.name === 'Bookcase door Shaker stile' && x.qty === 4));
});
