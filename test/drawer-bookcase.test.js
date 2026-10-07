import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign, drawerDesignToFields, sheetParts } from '../src/lib/drawerUnit.ts';
import { DEFAULT_BOOKCASE, bookcaseFromFields } from '../src/lib/drawerBookcase.ts';

const bookcase = (patch = {}) => ({ ...DEFAULT_BOOKCASE, enabled: true, ...patch });
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 36, height: 30, depth: 22.875, drawers: 4, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'kick', footHeight: 0.5, casterHeight: 2,
  bookcase: bookcase({ bays: 2, height: 48, depth: 12 }),
};
const plan = (patch = {}) => buildDrawerPlan({ ...base, ...patch });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const box = (solids, name) => solids.find(s => s.name === name);

test('the bookcase is the unit’s width, its bays and sides filling it exactly', () => {
  const p = plan();
  assert.deepEqual(p.errors, []);
  const bk = p.bookcase;
  close(bk.shelfPlan.overallWidth, 36, 'bookcase width');
  close(bk.shelfConfig.bayWidth * 2 + 3 * 0.75, 36, 'bays + sides');
  assert.ok(p.parts.some(x => x.name === 'Bookcase side'));
  assert.ok(p.parts.some(x => x.name === 'Bookcase divider' || x.name.startsWith('Bookcase divider')));
});

test('on a countertop: the counter overhangs, the bookcase sits on it with its back on the case back', () => {
  const p = plan();
  const bk = p.bookcase;
  const ct = bk.countertop;
  close(ct.y0, 30, 'counter on the case top');
  close(bk.y0, 30.75, 'bookcase on the counter');
  close(ct.x0, -1, 'left overhang');
  close(ct.x1, 37, 'right overhang');
  close(ct.z0, -1, 'front overhang past inset fronts');
  const solids = drawerSolids(p, base);
  const side = box(solids, 'Bookcase left side');
  close(side.max[2], p.caseDepth, 'bookcase back flush with the case back');
  close(side.min[1], 30.75, 'bookcase side starts on the counter');
  close(p.totalHeight, 30.75 + 48 + 0.75, 'counter, bookcase and cap');
  assert.ok(box(solids, 'Countertop') && box(solids, 'Bookcase top cap'));
});

test('stacked: straight on the case top, no deeper than the case', () => {
  const p = plan({ bookcase: bookcase({ seat: 'stacked', depth: 12 }) });
  assert.equal(p.bookcase.countertop, null);
  close(p.bookcase.y0, 30, 'on the case top');
  const deep = plan({ bookcase: bookcase({ seat: 'stacked', depth: 30 }) });
  assert.match(deep.errors.join(' '), /at most .* deep/);
});

test('crown: mitred solid molding on a plywood nailer, wrapping the ends that show', () => {
  const p = plan({ exposedSides: { left: true, right: false }, bookcase: bookcase({ top: { ...DEFAULT_BOOKCASE.top, style: 'crown' } }) });
  const front = p.parts.find(x => x.name === 'Crown molding, front');
  assert.equal(front.material, 'solid');
  close(front.length, 36 + 2.5, 'one return');
  assert.equal(p.parts.find(x => x.name === 'Crown molding, side').qty, 1);
  assert.ok(!sheetParts(p.parts).some(x => x.name.startsWith('Crown molding')));
  close(p.totalHeight, p.bookcase.topY + 3.5, 'crown on top');
});

test('doors, valance and grommet', () => {
  const p = plan({ bookcase: bookcase({ bays: 2, doors: [true, false], taskLight: true, valanceHeight: 2 }) });
  assert.equal(p.bookcase.shelfPlan.doors.length > 0, true);
  assert.ok(p.parts.some(x => x.name === 'Bookcase light valance'));
  assert.ok(p.bookcase.grommet);
  assert.ok(p.bookcase.grommet.z > p.bookcase.countertop.z0 && p.bookcase.grommet.z < p.bookcase.z0);
});

test('a plywood countertop bigger than a sheet, or a bookcase on casters, a desk or the wall, is refused', () => {
  assert.match(plan({ width: 50, depth: 49 }).errors.join(' '), /countertop is bigger than a 4 × 8/);
  assert.match(plan({ base: 'casters' }).errors.join(' '), /casters/);
  assert.match(plan({ mount: 'wall', mountHeight: 30 }).errors.join(' '), /floor-standing/);
  assert.match(plan({ desk: { enabled: true, layout: 'both', width: 96, height: 30, depth: 24, topLayers: 2 } }).errors.join(' '), /single unit/);
  const butcher = plan({ width: 50, depth: 49, bookcase: bookcase({ countertop: { ...DEFAULT_BOOKCASE.countertop, material: 'butcher' } }) });
  assert.ok(!/countertop is bigger/.test(butcher.errors.join(' ')));
});

test('ceiling: too tall is an error; no room to tilt it up is a warning', () => {
  assert.match(plan({ bookcase: bookcase({ height: 72, ceilingHeight: 96 }) }).errors.join(' '), /ceiling is 96"/);
  const tight = plan({ bookcase: bookcase({ height: 60, ceilingHeight: 91.9 }) });
  assert.deepEqual(tight.errors, []);
  assert.match(tight.warnings.join(' '), /headroom/);
});

test('the bookcase settings survive a save and the form', () => {
  const config = { ...base, bookcase: bookcase({ bays: 3, doors: [true, false, true], top: { ...DEFAULT_BOOKCASE.top, style: 'crown' }, ceilingHeight: 96 }) };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.deepEqual(read.config.bookcase, config.bookcase);
  const fields = drawerDesignToFields(read).bookcase;
  assert.equal(fields.top, 'crown');
  const back = bookcaseFromFields(fields, key => Number(fields[key]));
  assert.deepEqual(back.doors, [true, false, true]);
  assert.equal(back.ceilingHeight, 96);
});

import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerPartFaces } from '../src/lib/drawerExport.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { DRAWER_TEMPLATES } from '../src/lib/drawerTemplates.ts';
import { parseLength } from '../src/lib/shelving.ts';

test('the guide builds the bookcase on the bench, then the counter, the bookcase on it, trim and light', () => {
  const config = { ...base, bookcase: bookcase({ bays: 2, doors: [true, true], top: { ...DEFAULT_BOOKCASE.top, style: 'crown' }, taskLight: true }) };
  const p = buildDrawerPlan(config);
  const guide = drawerGuideSteps(p, config, 'in');
  const ids = guide.steps.map(s => s.id);
  for (const id of ['bookcase-dados', 'bookcase-pins', 'bookcase-case', 'countertop', 'bookcase-set', 'bookcase-doors', 'bookcase-top', 'light']) assert.ok(ids.includes(id), id);
  assert.ok(ids.indexOf('fronts') < ids.indexOf('bookcase-dados') && ids.indexOf('countertop') < ids.indexOf('bookcase-set') && ids.indexOf('bookcase-set') < ids.indexOf('bookcase-top'));
  const names = new Set(guide.solids.map(s => s.name));
  assert.equal(names.size, guide.solids.length, 'names are unique');
  for (const step of guide.steps) {
    for (const name of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(name), `${step.id}: ${name}`);
  }
  assert.equal(guide.steps.find(s => s.id === 'bookcase-dados').highlightSwatch, 'groove');
  assert.ok(guide.steps.find(s => s.id === 'countertop').instructions.join(' ').includes('grommet'));
});

test('CNC: the bookcase panels carry their dados and pin holes; the countertop its grommet', () => {
  const config = { ...base, bookcase: bookcase({ bays: 2, taskLight: true }) };
  const p = buildDrawerPlan(config);
  const faces = drawerPartFaces(p, config);
  const sides = faces.filter(f => f.part === 'Bookcase side');
  assert.equal(sides.length, 2);
  assert.ok(sides.every(f => f.features.some(x => x.kind === 'pocket')), 'dados');
  assert.ok(faces.some(f => f.part.startsWith('Bookcase divider')));
  const counter = faces.find(f => f.part === 'Countertop');
  assert.ok(counter.features.some(x => x.label === 'Cord grommet'));
  for (const part of sheetParts(p.parts)) assert.ok(faces.some(f => f.part === part.name), part.name);
});

test('hardware: pins, hinges, an anchor strap, crown by the foot, butcher block and the light', () => {
  const config = { ...base, bookcase: bookcase({ bays: 2, doors: [true, false], top: { ...DEFAULT_BOOKCASE.top, style: 'crown' }, taskLight: true,
    countertop: { ...DEFAULT_BOOKCASE.countertop, material: 'butcher' } }) };
  const keys = drawerHardwareList(buildDrawerPlan(config), config, 'in').map(i => i.key);
  for (const key of ['bookcase-pins', 'bookcase-hinges', 'bookcase-anchor', 'crown', 'butcher-block', 'figure8', 'led', 'grommet']) assert.ok(keys.includes(key), key);
  assert.ok(!keys.includes('anti-tip'), 'one strap, not two');
});

test('the built-in template builds with no errors', () => {
  const t = DRAWER_TEMPLATES.find(x => x.id === 'built-in-hutch');
  const f = t.fields;
  const P = s => parseLength(s, 'in');
  const config = {
    ...base, width: P(f.width), height: P(f.height), depth: P(f.depth), drawers: f.drawers, base: f.base, kickHeight: P(f.kickHeight),
    columns: f.columnDrawers.map(n => ({ drawers: n })),
    bookcase: bookcaseFromFields(f.bookcase, key => P(f.bookcase[key])),
  };
  assert.deepEqual(buildDrawerPlan(config).errors, []);
});
