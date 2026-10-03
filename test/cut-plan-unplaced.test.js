import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainUnplaced, optimizeCuts } from '../src/lib/cutPlan.ts';

const sheet = overrides => ({ id: 's', length: 96, width: 48, qty: 1, label: '', thickness: '', ...overrides });
const piece = (id, partName, length, width, overrides = {}) => ({ id, partName, length, width, material: 'plywood', thickness: '0.5', ...overrides });

const explain = (stocks, pieces) => explainUnplaced(stocks, pieces, optimizeCuts(stocks, pieces, 0.125).layouts);

test('a thickness mismatch is reported as such, not as "too large"', () => {
  const groups = explain([sheet({ thickness: '0.75' })], [piece('a', 'Shelf', 18, 11), piece('b', 'Side', 74, 12)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'thickness');
  assert.deepEqual(groups[0].parts, ['Shelf', 'Side']);
  assert.deepEqual(groups[0].thicknesses, ['0.5']);
  assert.equal(groups[0].count, 2);
});

test('label, size, and quantity problems are told apart', () => {
  assert.equal(explain([sheet({ label: 'birch' })], [piece('a', 'Shelf', 18, 11)])[0].reason, 'material');
  assert.equal(explain([sheet()], [piece('a', 'Back', 100, 50)])[0].reason, 'too-large');
  const out = explain([sheet()], [piece('a', 'Back', 90, 40), piece('b', 'Back', 90, 40)]);
  assert.equal(out[0].reason, 'out-of-stock');
  assert.equal(out[0].count, 1);
  assert.deepEqual(explain([sheet({ qty: 2 })], [piece('a', 'Back', 90, 40), piece('b', 'Back', 90, 40)]), []);
});
