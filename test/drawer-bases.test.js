import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign, drawerDesignToFields, sheetParts } from '../src/lib/drawerUnit.ts';
import { drawerPartFaces, drawerJigs, panelTop } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';

const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 24, height: 34.5, depth: 22.875, drawers: 4, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};
const plan = (patch = {}) => buildDrawerPlan({ ...base, ...patch });
const part = (p, name) => p.parts.find(x => x.name === name);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('every toe-kick base lifts the case by the kick height, with no feet or casters', () => {
  for (const kind of ['plinth', 'kick', 'flush']) {
    const p = plan({ base: kind, kickHeight: 4 });
    assert.deepEqual(p.errors, [], kind);
    assert.equal(p.baseHeight, 4);
    assert.equal(p.supports, 0);
    assert.equal(p.overallHeight, 34.5);
    close(p.caseHeight, 30.5, `${kind} case height`);
  }
});

test('integrated kick: sides run to the floor, notched, with a kick board and nailer', () => {
  const p = plan({ base: 'kick', kickHeight: 4, kickSetback: 3 });
  close(part(p, 'Side').length, 34.5, 'side runs floor to top');
  assert.match(part(p, 'Side').note, /toe-kick notch/);
  assert.deepEqual(p.partOutlines.Side.slice(0, 2), [[0, 3], [0, p.caseDepth]]);
  assert.ok(part(p, 'Toe kick') && part(p, 'Kick nailer'));
  assert.equal(p.sideBottom, 0);
  // Slide marks measure from the side's bottom edge — now the floor.
  const plain = plan({ base: 'plinth', kickHeight: 4 });
  p.drawers.forEach((d, i) => {
    close(d.slideMark, d.slideY, `drawer ${i + 1} from the floor`);
    close(d.slideMark, plain.drawers[i].slideMark + 4, `drawer ${i + 1} vs a plinth`);
  });
  close(panelTop(p, 0.75), 4.75, 'bottom panel top from the side bottom');
  const sides = drawerPartFaces(p, { ...base, base: 'kick', kickHeight: 4, kickSetback: 3 }).filter(f => f.part === 'Side');
  assert.ok(sides.every(f => f.outline && f.outline.length === 6));
  const left = drawerSolids(p, { ...base, base: 'kick' }).find(s => s.name === 'Left side');
  assert.equal(left.shape, 'prism');
  // The story stick stands on the bottom panel, so its marks don't change.
  const stick = drawerJigs(p, { ...base, base: 'kick' }, String).find(j => j.face.id === 'story-stick');
  const plainStick = drawerJigs(plain, { ...base, base: 'plinth' }, String).find(j => j.face.id === 'story-stick');
  assert.deepEqual(stick.face.length, plainStick.face.length);
});

test('plinth: set back at the front and on exposed ends, stretchers no more than 24" apart', () => {
  const p = plan({ base: 'plinth', width: 60, exposedSides: { left: true, right: false } });
  assert.deepEqual(p.base.sideSetbacks, [3, 0]);
  const rails = part(p, 'Plinth front and back');
  close(rails.length, 57, 'rails stop short of the exposed end');
  const xs = p.base.plinthXs;
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] - 0.75 <= 24 + 1e-6);
  assert.equal(part(p, 'Plinth ends and stretchers').qty, xs.length);
  assert.ok(drawerGuideSteps(p, { ...base, base: 'plinth', width: 60 }, 'in').steps.some(s => s.id === 'plinth'));
});

test('flush base: baseboard wraps the exposed ends, mitred, and stays clear of the fronts', () => {
  const config = { ...base, base: 'flush', kickHeight: 4, baseboardThickness: 0.5, exposedSides: { left: true, right: true } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.base.baseboard.faces, ['front', 'left', 'right']);
  const front = part(p, 'Baseboard, front');
  close(front.length, 25, 'front long point to long point');
  assert.equal(front.material, 'solid');
  assert.match(front.note, /mitre at both ends/);
  assert.equal(part(p, 'Baseboard, side').qty, 2);
  close(p.base.footprint.width, 25, 'footprint grows by the wrap');
  // Inset fronts start above the bottom panel, so the board laps 1/2" over the case.
  close(p.base.baseboard.height, 4.5, 'auto height');
  assert.ok(!sheetParts(p.parts).some(x => x.name.startsWith('Baseboard')), 'baseboard is not cut from sheets');
  assert.ok(!drawerPartFaces(p, config).some(f => f.part.startsWith('Baseboard')));
  const tall = buildDrawerPlan({ ...config, baseboardHeight: 6 });
  assert.match(tall.errors.join(' '), /couldn’t open/);
  const short = buildDrawerPlan({ ...config, baseboardHeight: 3 });
  assert.match(short.errors.join(' '), /shorter than the 4" base/);
  const hw = drawerHardwareList(p, config, 'in');
  assert.ok(hw.some(i => i.key === 'baseboard' && i.unit === 'ft'));
  assert.ok(hw.some(i => i.key === 'shims'));
  const ids = drawerGuideSteps(p, config, 'in').steps.map(s => s.id);
  assert.ok(ids.indexOf('baseboard') > ids.indexOf('fronts') && ids.indexOf('baseboard') < ids.indexOf('finish'));
});

test('overlay fronts reach the base, so the baseboard can only just cover the plinth', () => {
  const p = plan({ base: 'flush', frontStyle: 'overlay' });
  assert.deepEqual(p.errors, []);
  assert.ok(p.base.baseboard.height < 4.1);
});

test('the new base settings survive a save', () => {
  const config = { ...base, base: 'flush', kickHeight: 3.5, baseboardHeight: 4, baseboardThickness: 0.625, exposedSides: { left: false, right: true } };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.equal(read.config.base, 'flush');
  assert.equal(read.config.kickHeight, 3.5);
  assert.deepEqual(read.config.exposedSides, { left: false, right: true });
  const fields = drawerDesignToFields(read);
  assert.equal(fields.exposedLeft, false);
  assert.equal(fields.baseboardHeight, '4');
  // Old designs (no base fields) still read.
  assert.equal(readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(base, 'in')))).config.base, 'none');
});
