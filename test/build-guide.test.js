import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan } from '../src/lib/shelving.ts';
import { buildGuideSteps, dadoGrooves } from '../src/lib/buildGuide.ts';

const base = {
  thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 3, shelvesPerBay: [4, 5, 2],
  topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
  mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3,
};
const guide = (overrides = {}, units = 'in') => {
  const config = { ...base, ...overrides };
  return buildGuideSteps(buildShelfPlan(config), config, units);
};

test('steps follow the design: dados, dividers, back, and how it is mounted', () => {
  assert.deepEqual(guide().steps.map(s => s.id), ['overview', 'cut', 'dados', 'case', 'dividers', 'shelves', 'back', 'install', 'finish']);
  assert.deepEqual(
    guide({ joinery: 'butt', bays: 1, shelvesPerBay: [3], backPanel: false, mounting: 'wall', frenchCleat: false }).steps.map(s => s.id),
    ['overview', 'cut', 'case', 'shelves', 'install', 'finish'],
  );
  assert.ok(guide({ mounting: 'wall', frenchCleat: true }).steps.some(s => s.id === 'cleat'));
});

test('every scene only refers to solids that exist, and each part is highlighted when it is added', () => {
  const { steps, solids } = guide({ mounting: 'wall', frenchCleat: true });
  const known = new Set(solids.map(s => s.name));
  for (const step of steps) {
    for (const name of [...step.scene.visible, ...step.scene.highlight]) assert.ok(known.has(name), `${step.id}: ${name}`);
  }
  const highlightedAt = name => steps.find(s => s.id !== 'cut' && s.scene.highlight.includes(name))?.id;
  assert.equal(highlightedAt('Left side'), 'case');
  assert.equal(highlightedAt('Divider 1'), 'dividers');
  assert.equal(highlightedAt('Bay 2 shelf 1'), 'shelves');
  assert.equal(highlightedAt('Back'), 'back');
  assert.equal(highlightedAt('Cabinet cleat'), 'cleat');
  // Nothing is shown before it is built.
  const shelvesStep = steps.find(s => s.id === 'shelves');
  assert.ok(!shelvesStep.scene.visible.includes('Back'));
});

test('dado grooves sit on the inside faces at each shelf height', () => {
  const config = { ...base };
  const plan = buildShelfPlan(config);
  const grooves = dadoGrooves(plan, config);
  const left = grooves.filter(g => g.name.startsWith('Groove left side'));
  assert.equal(left.length, 4 + 2, 'four shelves plus the top and bottom housings');
  for (const g of left) assert.ok(g.min[0] < 0.75 && g.max[0] > 0.75 - 0.25);
  assert.deepEqual(dadoGrooves(buildShelfPlan({ ...config, joinery: 'butt' }), { ...config, joinery: 'butt' }), []);
});

test('instructions carry the real measurements in the chosen unit', () => {
  const text = s => [s.summary, ...s.instructions].join(' ');
  const inch = guide({ mounting: 'wall', frenchCleat: true });
  assert.match(text(inch.steps.find(s => s.id === 'dividers')), /17 1\/2"/);
  assert.match(text(guide().steps.find(s => s.id === 'dados')), /Left side \(from the bottom end, inside face\): 3", /, 'floor unit: bottom housing sits on the 3" toe kick');
  assert.match(text(inch.steps.find(s => s.id === 'cleat')), /top point .* above where the bottom/);
  const metric = guide({ thickness: 18 / 25.4, bayWidth: 400 / 25.4 }, 'mm');
  assert.match(text(metric.steps.find(s => s.id === 'dividers')), /400 mm/);
  assert.match(text(metric.steps.find(s => s.id === 'overview')), /18 mm thick/);
  assert.ok(metric.steps.find(s => s.id === 'cut').parts.every(p => / mm × .* mm$/.test(p.size)));
});
