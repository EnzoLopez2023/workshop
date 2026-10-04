import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan, shelfSolids } from '../src/lib/shelving.ts';

const base = {
  thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 3, shelvesPerBay: [2, 2, 2],
  topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
  mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3,
};
const part = (plan, name) => plan.parts.find(p => p.name === name);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);

test('per-bay widths set the layout, overall width, and shelf parts by size', () => {
  const plan = buildShelfPlan({ ...base, bayWidths: [12, 30, 12] });
  close(plan.overallWidth, 12 + 30 + 12 + 4 * 0.75);
  close(plan.bays[1].x, 0.75 + 12 + 0.75);
  close(plan.dividerXs[1], 0.75 + 12 + 0.75 + 30);
  const narrow = part(plan, 'Shelf (bays 1, 3)');
  const wide = part(plan, 'Shelf (bay 2)');
  assert.equal(narrow.qty, 4);
  close(narrow.length, 12.5);
  assert.equal(wide.qty, 2);
  close(wide.length, 30.5);
  // Equal widths keep the single "Shelf" part.
  assert.ok(part(buildShelfPlan(base), 'Shelf'));
});

test('adjustable shelves get clearance-sized parts, positions inside openings, and pin holes', () => {
  const plan = buildShelfPlan({ ...base, shelvesPerBay: [1, 1, 1], adjustablePerBay: [2, 0, 1] });
  const adj = part(plan, 'Adjustable shelf');
  assert.equal(adj.qty, 3);
  close(adj.length, 17.5 - 1 / 16);
  close(adj.width, 11.25 - 1 / 8);
  // Each adjustable shelf sits inside an opening, clear of the fixed shelf.
  const bay = plan.bays[0];
  for (const y of bay.adjustableYs) {
    assert.ok(y > plan.interiorBottom && y + 0.75 < plan.interiorTop);
    assert.ok(bay.shelfYs.every(f => y + 0.75 <= f + 1e-9 || y >= f + 0.75 - 1e-9), 'no overlap with the fixed shelf');
  }
  // Holes on both faces bounding each bay that has adjustable shelves, 1" apart by default.
  const runs = plan.pinHoles.filter(r => r.bay === 0);
  assert.deepEqual(runs.map(r => `${r.panel}/${r.face}`), ['Left side/right', 'Divider 1/left']);
  close(runs[0].ys[1] - runs[0].ys[0], 1);
  assert.ok(runs[0].ys.every(y => plan.bays[0].shelfYs.every(f => Math.abs(y - f) > 1.5 && Math.abs(y - (f + 0.75)) > 1.5)));
  // Divider 2 has holes on both faces (bays 2? no — bay 2 has none) → no stagger needed here.
  assert.ok(plan.pinHoles.every(r => !r.staggered));
  // 32 mm system.
  const metric = buildShelfPlan({ ...base, adjustablePerBay: [1, 1, 0], pinSystem: 'metric' });
  close(metric.pinHoles[0].ys[1] - metric.pinHoles[0].ys[0], 32 / 25.4);
  // A divider drilled from both faces in 3/4" stock gets the second face shifted half a step.
  const both = buildShelfPlan({ ...base, adjustablePerBay: [1, 1, 0] });
  const divider = both.pinHoles.filter(r => r.panel === 'Divider 1');
  assert.equal(divider.length, 2);
  assert.ok(divider.some(r => r.staggered));
});

test('a rabbeted back is wider by the rabbet on each side and noted on the sides', () => {
  const inset = buildShelfPlan(base);
  const rabbet = buildShelfPlan({ ...base, backJoint: 'rabbet' });
  close(rabbet.backRabbet, 0.375);
  close(part(rabbet, 'Back 1 of 2').width + part(rabbet, 'Back 2 of 2').width,
    part(inset, 'Back 1 of 2').width + part(inset, 'Back 2 of 2').width + 0.75);
  assert.match(part(rabbet, 'Side').note, /rabbet for the back/);
  assert.match(part(buildShelfPlan({ ...base, backJoint: 'rabbet', mounting: 'wall', frenchCleat: true }), 'Side').note, /groove for the back/);
  close(rabbet.sideDepth, inset.sideDepth, 'side depth is unchanged');
});

test('face frame: solid-wood stiles, rails and mullions, with openings per bay', () => {
  const plan = buildShelfPlan({ ...base, faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } });
  const stile = part(plan, 'Face frame stile');
  assert.equal(stile.material, 'solid');
  assert.equal(stile.qty, 2);
  close(stile.length, 74);
  // Bottom rail covers the toe kick and bottom panel (3.75"); top rail is the 1.5" minimum.
  close(part(plan, 'Face frame bottom rail').width, 3.75);
  close(part(plan, 'Face frame top rail').width, 1.5);
  assert.equal(part(plan, 'Face frame mullion').qty, 2);
  close(part(plan, 'Face frame mullion').length, 74 - 1.5 - 3.75);
  close(plan.frame.openings[0].x0, 1.5);
  close(plan.frontDepth, 0.75);
  close(plan.overallDepth, plan.sideDepth + 0.75);
  // Solid parts never trigger the sheet-size warning.
  assert.ok(!plan.warnings.some(w => w.includes('Face frame')));
});

test('doors: full overlay without a frame, 1/2" overlay with one, pairs on wide bays', () => {
  const frameless = buildShelfPlan({ ...base, doorsPerBay: [true, false, true] });
  assert.equal(frameless.doors.length, 2);
  close(frameless.doors[0].x, 1 / 16);
  close(frameless.doors[0].x + frameless.doors[0].width, frameless.dividerXs[0] + 0.375 - 1 / 16);
  close(frameless.doors[0].y, 3 + 1 / 16, 'starts above the toe kick');
  assert.equal(part(frameless, 'Door').qty, 2);

  const framed = buildShelfPlan({ ...base, bayWidths: [17.5, 30, 17.5], doorsPerBay: [true, true, false], faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } });
  const o = framed.frame.openings[0];
  close(framed.doors[0].width, o.x1 - o.x0 + 1);
  assert.equal(framed.doors.filter(d => d.bay === 1).length, 2, 'a 30" bay gets a pair');
  close(framed.frontDepth, 1.5);
});

test('3D solids include the new parts and nothing overlaps the case front', () => {
  const config = { ...base, bayWidths: [12, 24, 12], adjustablePerBay: [1, 0, 1], backJoint: 'rabbet', doorsPerBay: [true, false, false], faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } };
  const plan = buildShelfPlan(config);
  const solids = shelfSolids(plan, config);
  const kinds = new Set(solids.map(s => s.kind));
  for (const k of ['adjustable', 'frame', 'door', 'back']) assert.ok(kinds.has(k), k);
  for (const s of solids.filter(s => s.kind === 'frame' || s.kind === 'door')) assert.ok(s.max[2] <= 0 + 1e-9, `${s.name} is in front of the case`);
  const back = solids.find(s => s.name === 'Back');
  close(back.min[0], 0.75 - 0.375);
});

test('the new options survive saving to a project and reopening', async () => {
  const { readSavedShelfDesign, shelfDesignToFields, toSavedShelfDesign } = await import('../src/lib/shelving.ts');
  const config = {
    ...base, bayWidths: [12, 30, 12], adjustablePerBay: [2, 0, 1], pinSystem: 'metric', backJoint: 'rabbet',
    doorsPerBay: [true, false, true], faceFrame: { enabled: true, stileWidth: 1.75, railWidth: 2, thickness: 0.75 }, shelfLoad: 'heavy',
  };
  const saved = readSavedShelfDesign(JSON.parse(JSON.stringify(toSavedShelfDesign(config, 'in', 'overall'))));
  assert.deepEqual(saved.config.bayWidths, [12, 30, 12]);
  assert.deepEqual(saved.config.adjustablePerBay, [2, 0, 1]);
  assert.deepEqual(saved.config.doorsPerBay, [true, false, true]);
  assert.equal(saved.config.pinSystem, 'metric');
  assert.equal(saved.config.backJoint, 'rabbet');
  assert.equal(saved.config.shelfLoad, 'heavy');
  assert.deepEqual(saved.config.faceFrame, config.faceFrame);
  assert.deepEqual(buildShelfPlan(saved.config).parts, buildShelfPlan({ ...config, units: 'in' }).parts);
  const fields = shelfDesignToFields(saved);
  assert.equal(fields.bayWidthMode, 'custom');
  assert.deepEqual(fields.bayWidths, ['12', '30', '12']);
  assert.equal(fields.faceFrame, true);
  assert.equal(fields.stileWidth, '1 3/4');
  // Bad values are dropped, not trusted.
  const bad = readSavedShelfDesign({ version: 1, config: { ...config, bayWidths: [12, -4, 'x'], faceFrame: { enabled: true, stileWidth: 99 } } });
  assert.deepEqual(bad.config.bayWidths, [12, 17.5, 17.5]);
  assert.equal(bad.config.faceFrame, undefined);
});

test('edge banding cuts banded parts smaller and tracks how much banding is needed', async () => {
  const { hardwareList } = await import('../src/lib/shelfEstimate.ts');
  const { partFaces } = await import('../src/lib/shelfExport.ts');
  const { buildGuideSteps } = await import('../src/lib/buildGuide.ts');
  const b = 2 / 25.4; // 2 mm PVC
  const plain = buildShelfPlan({ ...base, adjustablePerBay: [1, 0, 0], doorsPerBay: [true, false, false] });
  const config = { ...base, adjustablePerBay: [1, 0, 0], doorsPerBay: [true, false, false], edgeBanding: true, bandingThickness: b };
  const banded = buildShelfPlan(config);
  for (const name of ['Side', 'Divider', 'Top', 'Bottom', 'Shelf', 'Adjustable shelf']) {
    close(part(banded, name).width, part(plain, name).width - b, name);
    close(part(banded, name).length, part(plain, name).length, `${name} length is unchanged`);
    assert.match(part(banded, name).note, /band the front edge/);
  }
  close(part(banded, 'Door').width, part(plain, 'Door').width - 2 * b);
  close(part(banded, 'Door').length, part(plain, 'Door').length - 2 * b);
  close(part(banded, 'Back 1 of 2').width, part(plain, 'Back 1 of 2').width, 'backs are not banded');
  assert.ok(banded.banding.totalLength > 0);
  const item = hardwareList(banded, config, 'in').find(i => i.key === 'banding');
  assert.match(item.name, /PVC/);
  assert.equal(item.qty, Math.ceil(banded.banding.totalLength * 1.1 / 12));
  assert.ok(!hardwareList(plain, base, 'in').some(i => i.key === 'banding'), 'no banding unless turned on');

  // With a face frame only the doors are banded.
  const framed = buildShelfPlan({ ...config, faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } });
  assert.equal(framed.banding.caseFronts, false);
  assert.deepEqual(framed.banding.runs.map(r => r.part), ['Door']);

  // CNC files measure from the plywood edge: the back rabbet and pin holes move forward by the banding.
  const rabbetConfig = { ...config, backJoint: 'rabbet' };
  const rabbetPlan = buildShelfPlan(rabbetConfig);
  const left = partFaces(rabbetPlan, rabbetConfig).find(f => f.id === 'left-side-inside');
  close(left.features.find(f => f.label === 'Back rabbet').v, 11.25 - b);
  close(left.features.find(f => f.label === 'Shelf pin').v, 1.5 - b);

  // The guide bands the edges before assembly.
  const ids = buildGuideSteps(banded, config, 'in').steps.map(s => s.id);
  assert.ok(ids.indexOf('banding') > ids.indexOf('cut') && ids.indexOf('banding') < ids.indexOf('case'));
});

test('each adjustable shelf rests on four pins, inside its bay and touching it from below', () => {
  const config = { ...base, shelvesPerBay: [1, 1, 1], adjustablePerBay: [2, 0, 1] };
  const plan = buildShelfPlan(config);
  const solids = shelfSolids(plan, config);
  const shelves = solids.filter(s => s.kind === 'adjustable');
  assert.equal(shelves.length, 3);
  for (const shelf of shelves) {
    const pins = solids.filter(s => s.kind === 'pin' && s.name.startsWith(`${shelf.name} pin`));
    assert.equal(pins.length, 4, shelf.name);
    const bay = plan.bays[Number(shelf.name.match(/^Bay (\d+)/)[1]) - 1];
    for (const pin of pins) {
      close(pin.max[1], shelf.min[1], 'pin top meets the shelf underside');
      assert.ok(pin.min[0] >= bay.x - 1e-9 && pin.max[0] <= bay.x + bay.width + 1e-9, 'inside the bay');
    }
  }
  assert.ok(!shelfSolids(buildShelfPlan(base), base).some(s => s.kind === 'pin'), 'no adjustable shelves, no pins');
});
