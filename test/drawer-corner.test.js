import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, deskSolids, runFootprint, runSolids } from '../src/lib/drawerUnit.ts';
import { DEFAULT_BOOKCASE } from '../src/lib/drawerBookcase.ts';
import { runFromFields, runToFields } from '../src/lib/drawerRun.ts';
import { drawerJigs } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { cabinetBox } from '../src/lib/builtinRoom.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 24, height: 30, depth: 24, drawers: 3, gap: 0.125,
  pull: { ...DEFAULT_PULL, enabled: false }, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'kick', footHeight: 0.5, casterHeight: 2,
};
const cornerRun = (corner = {}, patch = {}) => ({
  enabled: true, wallWidth: 100, leftEnd: 'open', rightEnd: 'wall', deskUppers: false,
  sections: [{ kind: 'cabinet' }, { kind: 'cabinet', mirror: true }],
  corner: { side: 'right', wallLength: 80, end: 'open', sections: [{ kind: 'cabinet' }], ...corner },
  ...patch,
});

test('a right-hand corner: bay at the corner, return past the corner filler, one more cabinet built', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun() });
  assert.deepEqual(p.errors, []);
  const r = p.run;
  // Open left end: the main run is its two cabinets plus the 24" corner bay.
  close(r.width, 24 + 24 + 24, 'main run width');
  assert.deepEqual(r.corner.bay, { x0: 48, x1: 72 });
  close(r.corner.start, 24 + 3, 'return starts past the main fronts and a 3" filler');
  close(r.corner.end, 27 + 24, 'return ends after its cabinet');
  assert.equal(r.cabinetCount, 3);
  assert.equal(p.parts.find(x => x.name === 'Side').qty, 6);
  for (const name of ['Return countertop', 'Corner ledger', 'Corner filler']) assert.ok(p.parts.some(x => x.name === name), name);
  assert.match(p.warnings.join(' '), /blind corner/);
});

test('the return is turned onto the side wall with its fronts facing the room', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun() });
  const solids = runSolids(p, { ...base, run: cornerRun() });
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  const W = p.run.width;
  const front = solids.find(s => s.name === 'Return cabinet 1 · Drawer 1 front');
  assert.equal(front.shape, 'prism', 'a turned front plate becomes a prism');
  // Inset fronts sit just inside the case front, which is cd in from the side wall.
  assert.ok(front.x1 <= W - 24 + 0.75 + 1e-6 && front.x0 >= W - 24 - 1e-6, `front at x ${front.x0}–${front.x1}`);
  const back = solids.find(s => s.name === 'Return cabinet 1 · Back');
  close(back.max[0], W, 'back against the side wall');
  // Return runs forward (negative z) from the main run's front.
  const box = cabinetBox(solids);
  close(box.minZ, 24 - 51 - 1, 'return reaches forward to its countertop’s open-end overhang');
  close(box.maxX, W, 'nothing past the side wall');
});

test('a left-hand corner mirrors it: bay at x 0, return against the left wall', () => {
  const run = cornerRun({ side: 'left' }, { leftEnd: 'wall', rightEnd: 'open' });
  const p = buildDrawerPlan({ ...base, run });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run.corner.bay, { x0: 0, x1: 24 });
  assert.deepEqual(p.run.sections.map(x => x.x), [24, 48]);
  const solids = runSolids(p, { ...base, run });
  const front = solids.find(s => s.name === 'Return cabinet 1 · Drawer 1 front');
  assert.ok(front.x0 >= 24 - 0.75 - 1e-6 && front.x1 <= 24 + 1e-6, `front faces the room at x ${front.x0}–${front.x1}`);
  assert.ok(cabinetBox(solids).minX >= -1e-6);
});

test('a corner desk: knee space on both legs meets in the corner; walls set the fillers', () => {
  const run = cornerRun({ end: 'wall', wallLength: 90, sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet', mirror: true }] },
    { leftEnd: 'wall', wallWidth: 90, sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }] });
  const p = buildDrawerPlan({ ...base, run });
  assert.deepEqual(p.errors, []);
  close(p.run.fillers[0].width, 90 - 24 - 30 - 24, 'one filler, at the far wall only');
  close(p.run.corner.filler.width, 90 - 27 - 30 - 24, 'return end filler');
  assert.ok(!p.warnings.some(w => /blind corner/.test(w)));
  assert.ok(p.parts.some(x => x.name === 'Return desk ledger'));
  const { steps } = drawerGuideSteps(p, { ...base, run }, 'in');
  assert.ok(steps.some(s => s.id === 'run-corner'));
});

test('a return too long for its wall is refused', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun({ end: 'wall', wallLength: 40 }) });
  assert.match(p.errors.join(' '), /return needs/);
});

test('uppers stop at the corner bay, and the return carries its own', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 40, depth: 12, top: { ...DEFAULT_BOOKCASE.top, style: 'cap' } };
  const config = { ...base, bookcase, run: cornerRun() };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.ok(p.run.cap.x1 <= p.run.corner.bay.x0 + bookcase.top.capProjection + 1e-6, 'main cap ends at the bay');
  assert.ok(p.run.corner.cap, 'return cap');
  assert.ok(runSolids(p, config).some(s => s.name.startsWith('Return cabinet 1 · Bookcase')));
});

test('corner settings survive the form round trip', () => {
  const run = cornerRun({ sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet', mirror: true }] });
  const fields = runToFields(run, String);
  assert.equal(fields.corner.enabled, true);
  const back = runFromFields(fields, raw => Number(raw));
  assert.deepEqual(back.corner, { ...run.corner, wallLength: 0 });
  assert.equal(runFromFields({ ...fields, corner: { ...fields.corner, enabled: false } }, raw => Number(raw)).corner, undefined);
});

test('a peninsula desk: the attached end rests on a ledger', () => {
  const config = { ...base, height: 28.5, base: 'none', desk: { enabled: true, layout: 'left', width: 76, height: 30, depth: 30, topLayers: 2, openEnd: 'ledger' } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.equal(p.desk.openEnd.kind, 'ledger');
  close(p.desk.knee, 76 - 24 - 0.75, 'knee space');
  assert.ok(p.parts.some(x => x.name === 'Desk end ledger'));
  const ledger = deskSolids(p, config).find(s => s.name === 'Desk end ledger');
  close(ledger.max[0], 76, 'at the right end');
});

test('an all-door wall cabinet needs no slide depth and makes no drawer jigs', () => {
  const config = { ...base, width: 30, depth: 12, drawers: 1, base: 'none', mount: 'wall', mountHeight: 54, cleatHeight: 3, doors: [{ hinge: 'auto', inside: 'shelves', count: 2 }] };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const jigs = drawerJigs(p, config, String);
  assert.ok(jigs.every(j => j.face), 'every jig has a face');
  assert.ok(!jigs.some(j => j.stage === 'slides' || j.stage === 'boxes'));
});

test('the layout plan gets the L, inside the 3D model’s box', () => {
  for (const side of ['right', 'left']) {
    const run = cornerRun({ side }, side === 'left' ? { leftEnd: 'wall', rightEnd: 'open' } : {});
    const p = buildDrawerPlan({ ...base, run });
    const outline = runFootprint(p);
    assert.equal(outline.length, 6, side);
    const box = cabinetBox(runSolids(p, { ...base, run }));
    for (const [x, z] of outline) assert.ok(x >= box.minX - 1e-6 && x <= box.maxX + 1e-6 && z >= box.minZ - 1e-6 && z <= box.maxZ + 1e-6, `${side} ${x},${z}`);
  }
  assert.equal(runFootprint(buildDrawerPlan(base)), null);
});
