import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerDesignToFields, drawerSolids, readSavedDrawerDesign, SLIDE_CLEARANCE, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { drawerJigs, drawerPartFaces } from '../src/lib/drawerExport.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { formatLength } from '../src/lib/shelving.ts';

const f = inches => formatLength(inches, 'in');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);
const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 40, height: 34, depth: 20, drawers: 8, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
  columns: [{ drawers: 4 }, { drawers: 4 }],
};

test('two columns: equal openings, a partition between, fronts meeting on its centre line', () => {
  const plan = buildDrawerPlan(base);
  assert.deepEqual(plan.errors, []);
  const opening = (40 - 1.5 - 0.75) / 2;
  plan.columns.forEach(c => close(c.width, opening, `column ${c.index + 1}`));
  close(plan.partitionXs[0], 0.75 + opening);
  const [left, right] = [plan.drawers.find(d => d.column === 0), plan.drawers.find(d => d.column === 1)];
  close(left.front.x, 0.0625);
  close(left.front.x + left.front.width + 0.125, right.front.x, 'one gap between neighbouring fronts');
  close(left.front.x + left.front.width + 0.0625, plan.partitionXs[0] + 0.375, 'they meet on the partition centre');
  close(right.box.x, plan.partitionXs[0] + 0.75 + SLIDE_CLEARANCE, 'box clears the partition by the slide');
  assert.equal(right.label, 'Column 2 drawer 1');
  assert.deepEqual(plan.drawers.map(d => d.index), [0, 1, 2, 3, 4, 5, 6, 7], 'numbered column by column');
  const partition = plan.parts.find(p => p.name === 'Partition');
  close(partition.length, plan.caseHeight - 1.5);
  const fronts = plan.parts.filter(p => p.name.startsWith('Drawer front'));
  assert.equal(fronts.reduce((a, p) => a + p.qty, 0), 8);
  const single = buildDrawerPlan({ ...base, width: 20, columns: undefined, drawers: 4 });
  assert.equal(fronts.length, single.parts.filter(p => p.name.startsWith('Drawer front')).length, 'identical columns share part lines');
});

test('custom widths: given columns keep theirs, the last takes the rest, and impossible ones are explained', () => {
  const plan = buildDrawerPlan({ ...base, columns: [{ drawers: 4, width: 12 }, { drawers: 3 }] });
  assert.deepEqual(plan.errors, []);
  close(plan.columns[0].width, 12);
  close(plan.columns[1].width, 40 - 1.5 - 0.75 - 12);
  assert.ok(plan.parts.some(p => p.name.startsWith('Drawer front ·')), 'different columns get their own part lines');
  assert.match(buildDrawerPlan({ ...base, columns: [{ drawers: 4, width: 35 }, { drawers: 4 }] }).errors.join(' '), /Column 2’s opening is/);
  assert.match(buildDrawerPlan({ ...base, width: 80, columns: [{ drawers: 4 }, { drawers: 4 }] }).warnings.join(' '), /twists and binds/);
});

test('per-front columns must add up to the same case height', () => {
  const plan = buildDrawerPlan({ ...base, columns: [{ drawers: 3, frontHeights: [8, 10, 12] }, { drawers: 2, frontHeights: [15, 15] }] });
  assert.match(plan.errors.join(' '), /Column 2’s fronts and gaps add up to 30 1\/4", but column 1 makes the case 30 3\/8"/);
  const ok = buildDrawerPlan({ ...base, columns: [{ drawers: 3, frontHeights: [8, 10, 12] }, { drawers: 2, frontHeights: [15.125, 15] }] });
  assert.deepEqual(ok.errors, []);
});

test('slides, CNC lines and jigs follow each column', () => {
  const config = { ...base, columns: [{ drawers: 4 }, { drawers: 3 }], drawers: 7 };
  const plan = buildDrawerPlan(config);
  const solids = drawerSolids(plan, config);
  const slide = solids.find(s => s.name === 'Column 2 drawer 1 left slide');
  close(slide.min[0], plan.partitionXs[0] + 0.75, 'left slide of column 2 is on the partition');
  assert.ok(solids.some(s => s.name === 'Partition'));
  const faces = drawerPartFaces(plan, config);
  assert.equal(faces.find(x => x.piece === 'Left side').features.filter(x => x.kind === 'guide').length, 4);
  assert.equal(faces.find(x => x.piece === 'Right side').features.filter(x => x.kind === 'guide').length, 3);
  const leftFace = faces.find(x => x.id === 'partition-left');
  const rightFace = faces.find(x => x.id === 'partition-right');
  assert.equal(leftFace.features.length, 4);
  assert.equal(rightFace.features.length, 3);
  close(leftFace.features[0].points[0][0], plan.drawers[0].slideMark - 0.75, 'partition lines measured from the bottom panel');
  const sticks = drawerJigs(plan, config, f).filter(j => j.face.id.startsWith('story-stick'));
  assert.equal(sticks.length, 2, 'different slide heights, a stick per column');
  assert.equal(drawerHardwareList(plan, config, 'in').find(i => i.key === 'slides').qty, 7);
  const guide = drawerGuideSteps(plan, config, 'in');
  assert.match(guide.steps.find(s => s.id === 'case').instructions.join(' '), /partition/);
  assert.match(guide.steps.find(s => s.id === 'slides').instructions.join(' '), /column 2 drawer 3 at/);
  const names = new Set(guide.solids.map(s => s.name));
  for (const step of guide.steps) for (const n of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(n), n);
});

test('columns survive a save and reopen, and inconsistent ones are refused', () => {
  const config = { ...base, columns: [{ drawers: 3, frontHeights: [8, 10, 12], width: 14 }, { drawers: 2, frontHeights: [15.125, 15] }], drawers: 5 };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in', 'fronts'))));
  assert.deepEqual(read.config.columns, config.columns);
  const fields = drawerDesignToFields(read);
  assert.equal(fields.columns, 2);
  assert.deepEqual(fields.columnDrawers, [3, 2]);
  assert.equal(fields.columnWidthMode, 'custom');
  assert.deepEqual(fields.columnFronts[1], ['15 1/8', '15']);
  const overall = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in', 'overall'))));
  assert.equal(overall.config.columns[0].frontHeights, undefined);
  assert.equal(readSavedDrawerDesign({ ...toSavedDrawerDesign(base, 'in'), config: { ...base, drawers: 9 } }), null, 'columns that don’t add up are refused');
});
