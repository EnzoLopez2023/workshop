import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL } from '../src/lib/drawerUnit.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { guidePrintHtml } from '../src/lib/buildGuide.ts';
import { formatLength } from '../src/lib/shelving.ts';

const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};
const guide = (patch = {}) => {
  const config = { ...base, ...patch };
  return { config, plan: buildDrawerPlan(config), guide: drawerGuideSteps(buildDrawerPlan(config), config, 'in') };
};

test('steps follow the build order, with the base where it belongs', () => {
  assert.deepEqual(guide().guide.steps.map(s => s.id), [
    'overview', 'sheets-0.75', 'sheets-0.5', 'sheets-0.25', 'cut', 'joinery', 'pulls', 'case', 'back', 'slides', 'boxes', 'drawers', 'fronts', 'finish',
  ]);
  const feet = guide({ base: 'feet' }).guide.steps.map(s => s.id);
  assert.ok(feet.indexOf('tnuts') < feet.indexOf('case'), 'T-nuts go into the loose bottom panel');
  const casters = guide({ base: 'casters' }).guide.steps.map(s => s.id);
  assert.ok(casters.indexOf('casters') > casters.indexOf('back'), 'casters go on once the case is square');
  assert.ok(!guide({ pull: { ...DEFAULT_PULL, enabled: false } }).guide.steps.some(s => s.id === 'pulls'));
});

test('every illustrated part exists, and the sheet steps cover every piece', () => {
  for (const patch of [{}, { base: 'feet' }, { base: 'casters', width: 32 }]) {
    const { plan, guide: g } = guide(patch);
    const names = new Set(g.solids.map(s => s.name));
    for (const step of g.steps) {
      if (!step.scene) continue;
      for (const name of [...step.scene.visible, ...step.scene.highlight]) assert.ok(names.has(name), `${step.id}: ${name}`);
    }
    const placed = g.steps.filter(s => s.sheets).reduce((n, s) => n + s.sheets.layouts.reduce((m, l) => m + l.placed.length, 0), 0);
    assert.equal(placed, plan.parts.reduce((n, p) => n + p.qty, 0));
  }
});

test('the measurements in the steps are this design’s', () => {
  const { plan, guide: g } = guide({ base: 'feet' });
  const f = inches => formatLength(inches, 'in');
  const slides = g.steps.find(s => s.id === 'slides');
  for (const d of plan.drawers) assert.ok(slides.instructions.join(' ').includes(f(d.slideMark)), `drawer ${d.index + 1} slide mark`);
  assert.match(g.steps.find(s => s.id === 'pulls').instructions[0], /3 1\/4" each side/, 'half the pull width');
  assert.match(g.steps.find(s => s.id === 'tnuts').instructions[0], /5\/16"/);
  const html = guidePrintHtml(g, new Map(), 'Desk pedestal', 'sub', f);
  assert.match(html, /Cut the finger pulls/);
  assert.match(html, /Desk pedestal/);
});
