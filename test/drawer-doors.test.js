import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign, drawerDesignToFields } from '../src/lib/drawerUnit.ts';
import { drawerPartFaces, drawerJigs } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';

const door = (inside = 'shelves', count = 2, hinge = 'auto') => ({ hinge, inside, count });
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 36, height: 30, depth: 22.875, drawers: 4, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
  // Left column: four drawers. Right column: a drawer over a door.
  columns: [{ drawers: 4 }, { drawers: 2, frontHeights: undefined }],
};
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('drawer over door: the door slot has no box or slides; a door over a drawer gets a fixed floor', () => {
  const config = { ...base, drawers: 6, columns: [{ drawers: 4 }, { drawers: 2 }], doors: [null, null, null, null, null, door()] };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const d = p.drawers[5];
  assert.ok(d.open && d.door, 'a door, not a drawer');
  assert.equal(d.label, 'Column 2 door 2');
  assert.equal(d.shelfY, null, 'at the bottom, it stands on the case bottom');
  assert.equal(d.door.leaves.length, 1);
  assert.equal(d.door.leaves[0].hinge, 'right', 'right column hinges on the outside');
  assert.equal(d.door.shelfYs.length, 2);
  assert.ok(p.parts.some(x => x.name.startsWith('Door, hinged right')));
  assert.ok(p.parts.some(x => x.name === 'Door shelf' && x.qty === 2));
  const over = buildDrawerPlan({ ...config, doors: [null, null, null, null, door(), null] });
  assert.deepEqual(over.errors, []);
  assert.ok(over.drawers[4].shelfY !== null, 'a door above a drawer needs a floor');
  assert.ok(over.parts.some(x => x.name === 'Fixed shelf under door'));
  assert.ok(!drawerSolids(p, config).some(s => s.name.startsWith('Column 2 door 2 box')));
});

test('a wide door becomes a pair; hinges by height; inset vs overlay hinge types', () => {
  const wide = buildDrawerPlan({ ...base, columns: undefined, drawers: 1, width: 40, doors: [door('empty', 0)] });
  assert.equal(wide.drawers[0].door.leaves.length, 2);
  assert.deepEqual(wide.drawers[0].door.leaves.map(l => l.hinge), ['left', 'right']);
  assert.equal(wide.drawers[0].door.hinges.length, 2);
  assert.ok(wide.drawers[0].door.leaves.every(l => l.hingeType === 'inset'));
  const overlay = buildDrawerPlan({ ...base, frontStyle: 'overlay', drawers: 6, columns: [{ drawers: 4 }, { drawers: 2 }], doors: [null, null, null, null, null, door('empty', 0, 'left')] });
  assert.equal(overlay.drawers[5].door.leaves[0].hingeType, 'half overlay', 'hinged on the partition');
});

test('pull-out trays: boxes on slides inside spacer panels, counted with the slides', () => {
  const config = { ...base, drawers: 6, columns: [{ drawers: 4 }, { drawers: 2 }], doors: [null, null, null, null, null, door('trays', 2)] };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const trays = p.drawers[5].door.trays;
  assert.equal(trays.length, 2);
  close(trays[0].width, p.columns[1].width - 2 * 0.75 - 1, 'spacers and slide clearance');
  assert.ok(p.parts.some(x => x.name === 'Tray spacer panel' && x.qty === 2));
  assert.ok(p.parts.some(x => x.name === 'Tray side' && x.qty === 4));
  const hw = drawerHardwareList(p, config, 'in');
  assert.equal(hw.filter(i => i.key.startsWith('slides')).reduce((a, i) => a + i.qty, 0), 5 + 2, '5 drawers + 2 trays');
  assert.ok(hw.some(i => i.key.startsWith('hinges-')));
  const faces = drawerPartFaces(p, config);
  assert.ok(faces.find(f => f.part === 'Tray side').features.some(x => x.label === 'Front rabbet'));
  const steps = drawerGuideSteps(p, config, 'in');
  assert.ok(steps.steps.some(s => s.id === 'trays') && steps.steps.some(s => s.id === 'doors'));
});

test('CNC: hinge cups on the door back, plates and pin holes on the panels, and a hinge cup jig', () => {
  const config = { ...base, columns: undefined, drawers: 2, width: 20, frontHeights: undefined, doors: [null, door('shelves', 2, 'left')] };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const faces = drawerPartFaces(p, config);
  const d = faces.find(f => f.part.startsWith('Door, hinged left'));
  const cups = d.features.filter(x => x.label.startsWith('Hinge cup'));
  assert.equal(cups.length, 2);
  assert.ok(cups.every(c => c.u > d.length / 2), 'seen from behind, a left-hinged door has its cups on the right');
  const left = faces.find(f => f.piece === 'Left side');
  assert.ok(left.features.some(x => /hinge plate/.test(x.label)));
  assert.ok(left.features.some(x => x.label.startsWith('Shelf pin')));
  const right = faces.find(f => f.piece === 'Right side');
  assert.ok(!right.features.some(x => /hinge plate/.test(x.label)), 'plates only on the hinge side');
  assert.ok(right.features.some(x => x.label.startsWith('Shelf pin')));
  assert.ok(drawerJigs(p, config, String).some(j => j.title === 'Hinge cup jig'));
  const steps = drawerGuideSteps(p, config, 'in');
  assert.ok(steps.steps.some(s => s.id === 'door-pins'));
  const names = new Set(steps.solids.map(s => s.name));
  for (const step of steps.steps) for (const n of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(n), `${step.id}: ${n}`);
});

test('doors survive a save and the form', () => {
  const config = { ...base, drawers: 6, columns: [{ drawers: 4 }, { drawers: 2 }], doors: [null, null, null, null, null, door('trays', 3, 'pair')] };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.deepEqual(read.config.doors[5], door('trays', 3, 'pair'));
  const fields = drawerDesignToFields(read);
  assert.equal(fields.insertKinds[5], 'door');
  assert.equal(fields.doorInside[5], 'trays');
  assert.equal(fields.doorCounts[5], 3);
});
