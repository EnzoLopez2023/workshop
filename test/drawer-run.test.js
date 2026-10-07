import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, runSolids, readSavedDrawerDesign, toSavedDrawerDesign, drawerDesignToFields, sheetParts } from '../src/lib/drawerUnit.ts';
import { DEFAULT_BOOKCASE } from '../src/lib/drawerBookcase.ts';
import { runFromFields } from '../src/lib/drawerRun.ts';
import { drawerPartFaces } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';

const run = (patch = {}) => ({
  enabled: true, wallWidth: 120, leftEnd: 'wall', rightEnd: 'wall', deskUppers: true,
  sections: [{ kind: 'cabinet', mirror: false }, { kind: 'desk', width: 48 }, { kind: 'cabinet', mirror: true }], ...patch,
});
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 30, height: 30, depth: 22.875, drawers: 2, gap: 0.125,
  pull: { ...DEFAULT_PULL, enabled: false }, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'kick', footHeight: 0.5, casterHeight: 2,
  doors: [null, { hinge: 'left', inside: 'shelves', count: 1 }],
  run: run(),
};
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('cabinet, desk gap, mirrored cabinet: fillers take up the rest of the wall', () => {
  const p = buildDrawerPlan(base);
  assert.deepEqual(p.errors, []);
  const r = p.run;
  assert.equal(r.cabinetCount, 2);
  close(r.fillers[0].width, (120 - 30 - 48 - 30) / 2, 'filler each side');
  assert.deepEqual(r.sections.map(x => Math.round(x.x * 100) / 100), [6, 36, 84]);
  assert.equal(p.unitCount, 2);
  // Parts double, and the mirrored cabinet's door hinges right.
  assert.equal(p.parts.find(x => x.name === 'Side').qty, 4);
  assert.equal(p.parts.find(x => x.name.startsWith('Door, hinged left')).qty, 1);
  assert.equal(p.parts.find(x => x.name.startsWith('Door, hinged right')).qty, 1);
  assert.ok(p.parts.some(x => x.name === 'Filler, cabinet' && x.qty === 2));
  assert.ok(p.parts.some(x => x.name === 'Desk ledger'));
  assert.ok(p.parts.some(x => x.name === 'Run countertop'));
  assert.ok(!p.parts.some(x => x.name === 'Countertop'), 'one countertop for the run, none per cabinet');
});

test('the mirrored cabinet is drawn as a mirror image', () => {
  const p = buildDrawerPlan(base);
  const solids = runSolids(p, base);
  const left = solids.find(s => s.name === 'Cabinet 1 · Door 2');
  const right = solids.find(s => s.name === 'Cabinet 2 · Door 2');
  const xs = s => s.outline.map(([x]) => x);
  close(Math.min(...xs(left)), 6 + 0.75 + 0.0625, 'cabinet 1 door near its left side');
  close(Math.max(...xs(right)), 84 + 30 - 0.75 - 0.0625, 'mirrored door near the right side of cabinet 2');
  assert.ok(solids.some(s => s.name === 'Run countertop'));
  assert.ok(solids.some(s => s.name === 'Filler left') && solids.some(s => s.name === 'Filler right'));
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
});

test('too wide for the wall, knees too tight, and back-to-back desk gaps are refused', () => {
  assert.match(buildDrawerPlan({ ...base, run: run({ wallWidth: 100 }) }).errors.join(' '), /Narrow a desk gap/);
  assert.match(buildDrawerPlan({ ...base, run: run({ sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 16 }] }) }).errors.join(' '), /knees/);
  assert.match(buildDrawerPlan({ ...base, run: run({ sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }, { kind: 'desk', width: 30 }] }) }).errors.join(' '), /side by side/);
  const open = buildDrawerPlan({ ...base, run: run({ leftEnd: 'open', rightEnd: 'open' }) });
  assert.equal(open.run.fillers.length, 0);
  close(open.run.width, 108, 'open ends: just the sections');
});

test('with the bookcase: uppers over each cabinet and the desk gap, one crown across', () => {
  const config = { ...base, bookcase: { ...DEFAULT_BOOKCASE, enabled: true, bays: 2, top: { ...DEFAULT_BOOKCASE.top, style: 'crown' } } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.ok(p.run.sections[1].upper, 'desk gap upper');
  assert.ok(p.parts.some(x => x.name.startsWith('Desk 1 upper side')));
  assert.equal(p.parts.find(x => x.name === 'Bookcase side').qty, 4, 'two uppers over the cabinets');
  const crown = p.parts.find(x => x.name === 'Run crown molding, front');
  close(crown.length, 120, 'wall to wall');
  assert.ok(!p.parts.some(x => x.name === 'Crown molding, front'));
  assert.ok(p.parts.some(x => x.name === 'Filler, upper'));
  const faces = drawerPartFaces(p, config);
  for (const part of sheetParts(p.parts)) assert.ok(faces.some(f => f.part === part.name), part.name);
  const guide = drawerGuideSteps(p, config, 'in');
  const ids = guide.steps.map(s => s.id);
  for (const id of ['run-cabinets', 'run-fillers', 'run-desk', 'run-countertop', 'run-uppers', 'run-top']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('bookcase-set') && !ids.includes('countertop'));
  const names = new Set(guide.solids.map(s => s.name));
  assert.equal(names.size, guide.solids.length, 'guide names unique');
  for (const step of guide.steps) for (const n of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(n), `${step.id}: ${n}`);
  const hw = drawerHardwareList(p, config, 'in');
  assert.equal(hw.find(i => i.key === 'bookcase-anchor').qty, 3, 'an anchor per upper');
  assert.ok(hw.some(i => i.key === 'crown'));
});

test('the run survives a save and the form', () => {
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(base, 'in'))));
  assert.deepEqual(read.config.run, base.run);
  const fields = drawerDesignToFields(read).run;
  assert.equal(fields.sections[2].mirror, true);
  const back = runFromFields(fields, raw => Number(raw));
  assert.deepEqual(back, base.run);
});
