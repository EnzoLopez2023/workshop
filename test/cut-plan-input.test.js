import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateKerf, validateStockRows } from '../src/lib/cutPlanInput.ts';

const row = overrides => ({ lengthStr: '', widthStr: '', thicknessStr: '', qtyStr: '1', label: '', ...overrides });

test('an untouched row explains that the grey numbers are only examples', () => {
  const { issues, stocks } = validateStockRows([row()], 'in');
  assert.equal(stocks.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /only examples/);
});

test('each bad field is named with what was typed and what would work', () => {
  const { issues } = validateStockRows([
    row({ lengthStr: '96', widthStr: '48' }),
    row({ lengthStr: '96x', widthStr: '', thicknessStr: '3/4x', qtyStr: '1.5' }),
  ], 'in');
  const byField = Object.fromEntries(issues.map(i => [i.field, i]));
  assert.equal(issues.length, 4);
  assert.ok(issues.every(i => i.row === 1));
  assert.match(byField.length.message, /^Row 2: Length "96x" isn't a measurement/);
  assert.match(byField.width.message, /^Row 2: Width is empty/);
  assert.match(byField.thickness.message, /Thickness "3\/4x"/);
  assert.match(byField.qty.message, /Quantity "1.5" must be a whole number/);
});

test('valid rows convert to inches, blank extra rows are ignored, zero is called out', () => {
  const ok = validateStockRows([row({ lengthStr: '2440', widthStr: '1220', qtyStr: '3' }), row()], 'mm');
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.stocks.length, 1);
  assert.ok(Math.abs(ok.stocks[0].length - 2440 / 25.4) < 1e-9);
  assert.equal(ok.stocks[0].qty, 3);

  const zero = validateStockRows([row({ lengthStr: '0', widthStr: '48' })], 'in');
  assert.match(zero.issues[0].message, /greater than 0/);
});

test('kerf problems explain the unit and the typical value', () => {
  assert.equal(validateKerf('3.2', 'mm').kerf, 3.2 / 25.4);
  assert.equal(validateKerf('0', 'in').kerf, 0);
  assert.match(validateKerf('', 'mm').issue.message, /empty.*3\.2 is typical/);
  assert.match(validateKerf('-1', 'in').issue.message, /negative/);
  assert.match(validateKerf('3.2', 'in').issue.message, /wider than any saw blade.*inches/);
});

test('a row with only the prefilled design thickness still counts as untouched', () => {
  const { issues } = validateStockRows([row({ thicknessStr: '3/4' })], 'in');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /only examples/);
  const extra = validateStockRows([row({ lengthStr: '96', widthStr: '48', thicknessStr: '3/4' }), row({ thicknessStr: '3/4' })], 'in');
  assert.deepEqual(extra.issues, []);
  assert.equal(extra.stocks.length, 1);
});
