import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan } from '../src/lib/shelving.ts';
import { costEstimate, defaultPrices, hardwareList, maxSpan, quantityLabel, sagCheck, shelfSag } from '../src/lib/shelfEstimate.ts';

const base = {
  thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 3, shelvesPerBay: [3, 3, 3],
  topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
  mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3,
};

test('sag follows the beam formula and the 0.02" per foot limit', () => {
  // 36" span, 11 1/4" deep, 3/4" plywood, 25 lb/sq ft: w = 25 × (11.25/12) / 12 lb/in.
  const w = 25 * (11.25 / 12) / 12;
  const expected = 5 * w * 36 ** 4 / (384 * 1e6 * (11.25 * 0.75 ** 3 / 12));
  assert.ok(Math.abs(shelfSag(36, 11.25, 0.75, 25) - expected) < 1e-12);
  // Doubling the span multiplies sag by 16; doubling thickness divides by 8.
  assert.ok(Math.abs(shelfSag(72, 11.25, 0.75, 25) / shelfSag(36, 11.25, 0.75, 25) - 16) < 1e-9);
  assert.ok(Math.abs(shelfSag(36, 11.25, 0.75, 25) / shelfSag(36, 11.25, 1.5, 25) - 8) < 1e-9);
  // maxSpan is exactly where the check flips.
  const span = maxSpan(11.25, 0.75, 25);
  assert.ok(Math.abs(shelfSag(span, 11.25, 0.75, 25) - 0.02 * span / 12) < 1e-9);
});

test('the sag check flags long spans and suggests a thicker shelf', () => {
  const short = sagCheck(buildShelfPlan(base), base, 'books');
  assert.ok(short.every(r => r.ok), '17 1/2" bays in 3/4" ply are fine for books');
  const config = { ...base, bays: 1, shelvesPerBay: [2], adjustablePerBay: [1], bayWidth: 42, thickness: 0.5 };
  const long = sagCheck(buildShelfPlan(config), config, 'books');
  assert.deepEqual(long.map(r => r.kind), ['fixed', 'adjustable']);
  assert.ok(long.every(r => !r.ok));
  assert.ok(long[0].thicknessNeeded > 0.5);
  // Lighter loads pass where heavier ones fail.
  assert.ok(sagCheck(buildShelfPlan({ ...base, bayWidth: 30 }), { ...base, bayWidth: 30 }, 'light').every(r => r.ok));
  assert.ok(sagCheck(buildShelfPlan({ ...base, bayWidth: 30 }), { ...base, bayWidth: 30 }, 'heavy').some(r => !r.ok));
});

test('hardware follows the design', () => {
  const keys = config => hardwareList(buildShelfPlan(config), config, 'in').map(i => i.key);
  assert.deepEqual(keys(base), ['glue', 'case-screws', 'brads', 'anti-tip', 'finish']);
  assert.ok(keys({ ...base, edgeBanding: true }).includes('banding'), 'edge banding only when it is turned on');
  const fancy = { ...base, mounting: 'wall', adjustablePerBay: [2, 0, 1], doorsPerBay: [true, true, false], faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } };
  const list = hardwareList(buildShelfPlan(fancy), fancy, 'in');
  const by = k => list.find(i => i.key === k);
  assert.equal(by('pins').qty, 3 * 4 + 4);
  assert.equal(by('pulls').qty, 2);
  assert.equal(by('hinges').qty, 2 * 4, 'each 74"-tall door needs 4 hinges');
  assert.match(by('hinges').name, /face-frame/);
  assert.ok(by('pocket-screws'));
  assert.ok(by('structural'));
  assert.ok(!by('banding'), 'banding is off unless turned on');
  assert.ok(!by('anti-tip'), 'wall units are screwed to studs instead');
  // Butt joints need more screws than dadoes.
  const butt = hardwareList(buildShelfPlan({ ...base, joinery: 'butt' }), { ...base, joinery: 'butt' }, 'in').find(i => i.key === 'case-screws');
  const dado = hardwareList(buildShelfPlan(base), base, 'in').find(i => i.key === 'case-screws');
  assert.ok(butt.uses > dado.uses);
});

test('the cost estimate multiplies quantities by editable prices', () => {
  const config = { ...base, faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 } };
  const plan = buildShelfPlan(config);
  const hardware = hardwareList(plan, config, 'in');
  const prices = { ...defaultPrices(0.75), sheet: 80 };
  const est = costEstimate(plan, 4, '3/4″ plywood (96″ × 48″)', hardware, prices);
  const sheets = est.lines.find(l => l.key === 'sheets');
  assert.equal(sheets.total, 320);
  assert.equal(sheets.qtyLabel, '4 sheets');
  assert.ok(est.lines.find(l => l.key === 'solid').total > 0);
  assert.ok(Math.abs(est.total - est.lines.reduce((s, l) => s + l.total, 0)) < 1e-9);
  assert.ok(est.required < est.total, 'finish is optional');
  assert.equal(quantityLabel(1, 'box of 100'), '1 box of 100');
  assert.equal(quantityLabel(3, 'box of 100'), '3 boxes of 100');
  assert.equal(quantityLabel(12, 'ft'), '12 ft');
  assert.equal(quantityLabel(2, 'quart'), '2 quarts');
});
