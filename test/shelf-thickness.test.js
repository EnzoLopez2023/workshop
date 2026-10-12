import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildShelfPlan, overallFromOpeningHeight, readSavedShelfDesign, shelfDesignToFields, shelfSolids, sidePanelDepth, toSavedShelfDesign,
} from '../src/lib/shelving.ts';
import { partFaces } from '../src/lib/shelfExport.ts';
import { buildGuideSteps, dadoGrooves, planShelfSheetGroups } from '../src/lib/buildGuide.ts';
import { costEstimate, defaultPrices, hardwareList, sagCheck, sheetPriceKey } from '../src/lib/shelfEstimate.ts';

const base = {
  thickness: 0.75,
  bayWidth: 30,
  shelfDepth: 11.25,
  height: 72,
  bays: 2,
  shelvesPerBay: [3, 3],
  adjustablePerBay: [1, 0],
  topPanel: true,
  bottomPanel: true,
  backPanel: true,
  backJoint: 'rabbet',
  joinery: 'dado',
  dadoDepth: 0.25,
  mounting: 'floor',
  toeKick: 0,
  frenchCleat: false,
  cleatHeight: 3,
};
const mixed = { ...base, shelfThickness: 1, backThickness: 0.25 };
const part = (plan, name) => plan.parts.find(p => p.name === name || (name === 'Back' && p.name.startsWith('Back')));

test('left out, shelves and back use the case thickness', () => {
  const plan = buildShelfPlan(base);
  assert.equal(plan.shelfThickness, 0.75);
  assert.equal(plan.backThickness, 0.75);
  assert.equal(part(plan, 'Shelf').thickness, 0.75);
  assert.equal(part(plan, 'Back').thickness, 0.75);
});

test('the case, shelves and back each take their own thickness', () => {
  const plan = buildShelfPlan(mixed);
  for (const name of ['Side', 'Divider', 'Top', 'Bottom']) assert.equal(part(plan, name).thickness, 0.75, name);
  assert.equal(part(plan, 'Shelf').thickness, 1);
  assert.equal(part(plan, 'Adjustable shelf').thickness, 1);
  assert.equal(part(plan, 'Back').thickness, 0.25);
  // The sides only deepen by the thin back.
  assert.equal(plan.sideDepth, 11.25 + 0.25);
  assert.equal(sidePanelDepth(mixed), 11.5);
  // Three 1" shelves split the 70.5" clear height into four equal openings.
  const opening = (72 - 1.5 - 3 * 1) / 4;
  assert.equal(plan.bays[0].openingHeight, opening);
  assert.deepEqual(plan.bays[0].shelfYs, [0.75 + opening, 0.75 + 2 * opening + 1, 0.75 + 3 * opening + 2]);
  assert.match(part(plan, 'Side').note, /1\/4" rabbet/);
  // 3D: shelves are 1" thick, the back 1/4".
  const solids = shelfSolids(plan, mixed);
  const shelf = solids.find(s => s.name === 'Bay 1 shelf 1');
  assert.equal(shelf.max[1] - shelf.min[1], 1);
  const back = solids.find(s => s.name === 'Back');
  assert.equal(back.max[2] - back.min[2], 0.25);
});

test('opening height counts the shelf stock', () => {
  const inputs = { thickness: 0.75, shelfThickness: 1, topPanel: true, bottomPanel: true, mounting: 'floor', toeKick: 0 };
  assert.equal(overallFromOpeningHeight(10, [3], inputs), 4 * 10 + 3 * 1 + 1.5);
});

test('dados match what goes in them: shelf stock for shelves, case stock for the top and bottom', () => {
  const plan = buildShelfPlan(mixed);
  const left = partFaces(plan, mixed).find(f => f.piece === 'Left side');
  assert.equal(left.features.find(f => f.label === 'Shelf dado 1').length, 1);
  assert.equal(left.features.find(f => f.label === 'Top dado').length, 0.75);
  assert.equal(left.features.find(f => f.label === 'Back rabbet').width, 0.25);
  const divider = partFaces(plan, mixed).find(f => f.piece === 'Divider 1');
  assert.ok(divider.features.filter(f => f.label.startsWith('Shelf dado')).every(f => f.length === 1));
  const grooves = dadoGrooves(plan, mixed).filter(g => g.on === 'Left side' && g.name.startsWith('Groove'));
  assert.deepEqual(grooves.map(g => g.max[1] - g.min[1]).sort(), [0.75, 0.75, 1, 1, 1]);
});

test('each thickness gets its own sheets, priced on its own line, the case first', () => {
  const plan = buildShelfPlan(mixed);
  const groups = planShelfSheetGroups(plan, mixed, 'in');
  assert.deepEqual(groups.map(g => g.thickness), [0.75, 1, 0.25]);
  assert.deepEqual(groups.map(g => sheetPriceKey(g.thickness, plan, mixed)), ['sheet', 'shelfSheet', 'backSheet']);
  const prices = defaultPrices(0.75, 1, 0.25);
  assert.ok(prices.shelfSheet > prices.sheet && prices.backSheet < prices.sheet);
  const lines = groups.map(g => ({ count: g.sheets.layouts.length, label: `${g.thickness}`, priceKey: sheetPriceKey(g.thickness, plan, mixed) }));
  const est = costEstimate(plan, lines, '', hardwareList(plan, mixed, 'in'), prices);
  const sheetLines = est.lines.filter(l => l.key.startsWith('sheets'));
  assert.equal(sheetLines.length, 3);
  assert.equal(sheetLines[1].total, lines[1].count * prices.shelfSheet);
  // The guide lays out each thickness in its own step.
  const ids = buildGuideSteps(plan, mixed, 'in').steps.map(s => s.id);
  assert.deepEqual(ids.filter(id => id.startsWith('sheets')), ['sheets', 'sheets-1', 'sheets-0.25']);
});

test('thicker shelves pass the sag check where case-thickness ones fail', () => {
  const wide = { ...base, bayWidth: 42, bays: 1, shelvesPerBay: [3], adjustablePerBay: [0], bottomPanel: false };
  assert.ok(sagCheck(buildShelfPlan(wide), wide, 'heavy').some(r => !r.ok));
  const thick = { ...wide, shelfThickness: 1.5 };
  assert.ok(sagCheck(buildShelfPlan(thick), thick, 'heavy').every(r => r.ok));
});

test('a back thicker than the sides it is rabbeted into is flagged', () => {
  const plan = buildShelfPlan({ ...base, thickness: 0.5, backThickness: 0.75 });
  assert.ok(plan.warnings.some(w => /back is thicker/.test(w)));
});

test('shelf and back thicknesses survive saving and reopening', () => {
  const saved = readSavedShelfDesign(JSON.parse(JSON.stringify(toSavedShelfDesign(mixed, 'in'))));
  assert.equal(saved.config.shelfThickness, 1);
  assert.equal(saved.config.backThickness, 0.25);
  const fields = shelfDesignToFields(saved);
  assert.equal(fields.shelfThickness, '1');
  assert.equal(fields.backThickness, '1/4');
  // Older designs have neither and read back blank (same as the case).
  const old = shelfDesignToFields(readSavedShelfDesign(JSON.parse(JSON.stringify(toSavedShelfDesign(base, 'in')))));
  assert.equal(old.shelfThickness, '');
  assert.equal(old.backThickness, '');
});

test('a back as thick as the case is glued and screwed; a thinner one is bradded', () => {
  const thick = buildShelfPlan({ ...base, backJoint: 'inset' });
  assert.equal(thick.backScrewed, true);
  assert.match(part(thick, 'Back').note, /Glued and screwed/);
  const hw = hardwareList(thick, { ...base, backJoint: 'inset' }, 'in');
  assert.ok(!hw.some(h => h.key === 'brads'));
  assert.match(hw.find(h => h.key === 'case-screws').note, /screws for the back/);
  const steps = buildGuideSteps(thick, { ...base, backJoint: 'inset' }, 'in').steps;
  assert.ok(steps.find(s => s.id === 'back').instructions.some(t => /screw through each side into the back’s edges/.test(t)));
  const rabbeted = buildShelfPlan(base);
  assert.ok(buildGuideSteps(rabbeted, base, 'in').steps.find(s => s.id === 'back').instructions.some(t => /screw through the back into the rabbets/.test(t)));
  // The plain screw count grows by the back's screws.
  const thinCfg = { ...base, backThickness: 0.25 };
  const thin = buildShelfPlan(thinCfg);
  assert.equal(thin.backScrewed, false);
  const thinHw = hardwareList(thin, thinCfg, 'in');
  assert.ok(thinHw.some(h => h.key === 'brads'));
  assert.ok(hw.find(h => h.key === 'case-screws').uses > thinHw.find(h => h.key === 'case-screws').uses);
});
