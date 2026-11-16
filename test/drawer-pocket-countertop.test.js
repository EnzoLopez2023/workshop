import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boxPocketsPerEnd,
  buildDrawerPlan,
  DEFAULT_COUNTERTOP,
  DEFAULT_PULL,
  drawerDesignToFields,
  drawerSolids,
  readSavedDrawerDesign,
  TOP_STRETCHER_WIDTH,
  toSavedDrawerDesign,
} from '../src/lib/drawerUnit.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { drawerPartFaces } from '../src/lib/drawerExport.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);

// Two columns of four drawers on feet, like a wide office unit.
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 70, height: 30, depth: 24, drawers: 8, gap: 0.125,
  columns: [{ drawers: 4 }, { drawers: 4 }],
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.5, backThickness: 0.25,
  base: 'feet', footHeight: 0.5, casterHeight: 2,
};
const part = (plan, name) => plan.parts.find(p => p.name === name);

test('pocket-screwed boxes: the front and back fit between full-depth sides, with no rabbets', () => {
  const rabbet = buildDrawerPlan(base);
  const plan = buildDrawerPlan({ ...base, boxJoinery: 'pocket' });
  assert.deepEqual(plan.errors, []);
  assert.equal(rabbet.boxJoint, 'rabbet');
  assert.equal(rabbet.boxPocket, null);
  assert.equal(plan.boxJoint, 'pocket');

  const box = plan.drawers[0].box;
  close(part(rabbet, 'Box front').length, box.width - 0.5, 'rabbeted: half-way into each side');
  close(part(plan, 'Box front').length, box.width - 1, 'pocket-screwed: between the sides');
  close(part(plan, 'Box back').length, box.width - 1);
  assert.equal(part(plan, 'Box side').length, part(rabbet, 'Box side').length, 'sides stay the slide length');
  assert.doesNotMatch(part(plan, 'Box side').note, /rabbet/);
  assert.match(part(plan, 'Box side').note, /groove/);
  assert.match(part(plan, 'Box back').note, /pocket holes? in each end/);
  // The bottom still rides in the same groove.
  assert.deepEqual([part(plan, 'Box bottom').length, part(plan, 'Box bottom').width], [part(rabbet, 'Box bottom').length, part(rabbet, 'Box bottom').width]);

  // Four corners per box, by box height.
  const perEnd = boxPocketsPerEnd(box.height);
  assert.equal(plan.boxPocket.count, 8 * 4 * perEnd);
  assert.equal(plan.boxPocket.screw, 1, '1" screws for 1/2" stock');
  assert.deepEqual([boxPocketsPerEnd(2.5), boxPocketsPerEnd(5.625), boxPocketsPerEnd(10)], [1, 2, 3]);

  // 3D: the sides run the full depth and the front sits between them.
  const solids = drawerSolids(plan, { ...base, boxJoinery: 'pocket' });
  const name = plan.drawers[0].label;
  const side = solids.find(s => s.name === `${name} box left side`);
  const back = solids.find(s => s.name === `${name} box back`);
  close(side.max[2] - side.min[2], box.depth, 'side runs the full depth');
  close(back.max[0] - back.min[0], box.width - 1, 'back between the sides');
});

test('pocket-screwed boxes: guide, hardware and CNC files drop the rabbets', () => {
  const config = { ...base, boxJoinery: 'pocket' };
  const plan = buildDrawerPlan(config);
  const guide = drawerGuideSteps(plan, config, 'in');
  const text = guide.steps.filter(s => /box|joinery/.test(s.id)).map(s => [s.title, s.summary, ...s.instructions, ...s.tips, ...s.cautions].join(' ')).join(' ');
  assert.doesNotMatch(text, /side’s rabbets|side rabbets|Brad/);
  assert.match(text, /pocket screws/);
  assert.ok(guide.steps.some(s => s.title === 'Drill the box pocket holes'));
  assert.equal(guide.steps.find(s => s.id === 'joinery').title, 'Cut the back rabbet and the bottom grooves');

  const items = drawerHardwareList(plan, config, 'in');
  const screws = items.find(i => i.key === 'box-pocket-screws');
  assert.equal(screws.uses, plan.boxPocket.count);
  assert.doesNotMatch(items.find(i => i.key === 'brads')?.note ?? '', /drawer-box/);

  const faces = drawerPartFaces(plan, config);
  const sideFace = faces.find(f => f.part === 'Box side');
  assert.deepEqual(sideFace.features.map(f => f.label), ['Bottom groove']);
  const rabbetFaces = drawerPartFaces(buildDrawerPlan(base), base);
  assert.equal(rabbetFaces.find(f => f.part === 'Box side').features.length, 3);
});

test('a countertop replaces the full top with a front and a back stretcher', () => {
  const config = { ...base, countertop: { ...DEFAULT_COUNTERTOP } };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  assert.equal(part(plan, 'Top'), undefined);
  const st = part(plan, 'Top stretcher');
  assert.equal(st.qty, 2);
  close(st.length, 70 - 1.5);
  assert.equal(st.width, TOP_STRETCHER_WIDTH);

  const ct = part(plan, 'Countertop');
  close(ct.length, 70 + 2, '1" over each exposed end');
  close(ct.width, 24 + 1, '1" past the inset fronts');
  close(plan.countertop.y0, 30);
  close(plan.totalHeight, 30.75);
  // The drawers don't move: the stretchers are as thick as the top they replace.
  assert.deepEqual(plan.drawers.map(d => d.box), buildDrawerPlan(base).drawers.map(d => d.box));

  const solids = drawerSolids(plan, config);
  const names = solids.map(s => s.name);
  assert.ok(!names.includes('Top'));
  const front = solids.find(s => s.name === 'Top stretcher, front');
  const backSt = solids.find(s => s.name === 'Top stretcher, back');
  assert.deepEqual([front.min[2], front.max[2]], [0, 4]);
  close(backSt.max[2], plan.interiorDepth);
  close(front.max[1], 30);
  assert.ok(names.includes('Countertop'));

  // Against a wall on the left: no overhang there.
  const walled = buildDrawerPlan({ ...config, exposedSides: { left: false, right: true } });
  assert.equal(walled.countertop.x0, 0);
  // Butcher block: bought, not cut from the sheets, and held with figure-8 clips.
  const butcherConfig = { ...config, countertop: { ...DEFAULT_COUNTERTOP, material: 'butcher', thickness: 1.5 } };
  const butcher = buildDrawerPlan(butcherConfig);
  assert.equal(part(butcher, 'Countertop (butcher block)').material, 'solid');
  close(butcher.totalHeight, 31.5);
  const items = drawerHardwareList(butcher, butcherConfig, 'in');
  assert.ok(items.some(i => i.key === 'butcher-block') && items.some(i => i.key === 'figure8'));

  const guide = drawerGuideSteps(plan, config, 'in');
  const caseStep = guide.steps.find(s => s.id === 'case');
  assert.match(caseStep.summary, /top stretchers and bottom/);
  assert.ok(caseStep.parts.some(p => p.name === 'Top stretcher'));
  assert.ok(caseStep.scene.highlight.includes('Top stretcher, front'));
  const fit = guide.steps.find(s => s.id === 'countertop');
  assert.match(fit.instructions.join(' '), /up through the front and back stretchers/);
});

test('countertop with a pocket-screwed case counts the stretcher holes; without one nothing changes', () => {
  const full = buildDrawerPlan({ ...base, pocketCase: true });
  // Top and bottom into each side, and the partition into both: (4 + 2) ends.
  assert.equal(full.pocket.count, 6 * full.pocket.perEnd);
  const plan = buildDrawerPlan({ ...base, pocketCase: true, countertop: { ...DEFAULT_COUNTERTOP } });
  assert.equal(plan.pocket.stretcherPerEnd, 2);
  assert.equal(plan.pocket.count, 3 * plan.pocket.perEnd + 6 * 2);
  assert.match(part(plan, 'Top stretcher').note, /2 pocket holes in each end/);
  assert.equal(buildDrawerPlan(base).topStretchers, null);
  assert.equal(buildDrawerPlan(base).countertop, null);
});

test('a countertop only goes on a single floor-standing cabinet', () => {
  const ct = { ...DEFAULT_COUNTERTOP };
  assert.match(buildDrawerPlan({ ...base, countertop: ct, mount: 'wall' }).errors.join(' '), /floor-standing cabinet/);
  assert.match(buildDrawerPlan({ ...base, countertop: { ...ct, overhangFront: 6 } }).errors.join(' '), /front overhang/);
  // A 97" double-thickness plywood top doesn't fit a sheet.
  assert.match(buildDrawerPlan({ ...base, width: 96, columns: [{ drawers: 4 }, { drawers: 4 }, { drawers: 4 }], drawers: 12, countertop: ct }).errors.join(' '), /bigger than a 4 × 8 sheet/);
});

test('both options survive a save and reload, and old designs read back without them', () => {
  const config = { ...base, boxJoinery: 'pocket', countertop: { ...DEFAULT_COUNTERTOP, material: 'butcher', thickness: 1.75, overhangFront: 1.5 } };
  const saved = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.equal(saved.config.boxJoinery, 'pocket');
  assert.deepEqual(saved.config.countertop, { material: 'butcher', thickness: 1.75, layers: 1, overhangFront: 1.5, overhangSides: 1 });
  const fields = drawerDesignToFields(saved);
  assert.equal(fields.boxJoinery, 'pocket');
  assert.equal(fields.countertop, true);
  assert.equal(fields.counterThickness, '1 3/4');

  const old = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(base, 'in'))));
  assert.equal(old.config.boxJoinery, undefined);
  assert.equal(old.config.countertop, undefined);
  assert.equal(drawerDesignToFields(old).boxJoinery, 'rabbet');
  assert.equal(drawerDesignToFields(old).countertop, false);
});
