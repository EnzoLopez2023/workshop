import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan, fmt, formatLength, lengthToField, parseLength, projectCutItems, readSavedShelfDesign, shelfDesignToFields, shelfProjectTitle, shelfSolids, sidePanelDepth, toSavedShelfDesign } from '../src/lib/shelving.ts';

const base = {
  thickness: 0.75,
  bayWidth: 17.5,
  shelfDepth: 11.25,
  height: 74,
  bays: 4,
  shelvesPerBay: [6, 7, 2, 5],
  topPanel: true,
  bottomPanel: true,
  backPanel: true,
  joinery: 'butt',
  dadoDepth: 0.25,
  mounting: 'floor',
  toeKick: 0,
  frenchCleat: false,
  cleatHeight: 3,
};

const part = (plan, name) => plan.parts.find(p => p.name === name);

test('French cleat deepens the sides by the back plus the cleat (build thickness)', () => {
  assert.equal(sidePanelDepth({ shelfDepth: 8.25, thickness: 0.5, backPanel: true, frenchCleat: true, mounting: 'wall' }), 9.25);
  assert.equal(sidePanelDepth({ shelfDepth: 8.25, thickness: 0.75, backPanel: true, frenchCleat: true, mounting: 'wall' }), 9.75);
  // A floor unit ignores the cleat setting.
  assert.equal(sidePanelDepth({ shelfDepth: 8.25, thickness: 0.75, backPanel: true, frenchCleat: true, mounting: 'floor' }), 9);
  assert.equal(sidePanelDepth({ shelfDepth: 8.25, thickness: 0.75, backPanel: false, frenchCleat: false, mounting: 'floor' }), 8.25);

  const plan = buildShelfPlan({ ...base, mounting: 'wall', frenchCleat: true, backPanel: false, thickness: 0.5, shelfDepth: 8.25 });
  assert.equal(part(plan, 'Side').width, 9.25);
  assert.ok(part(plan, 'Cabinet cleat'));
  assert.ok(part(plan, 'Wall cleat'));
  assert.ok(plan.parts.some(p => p.name.startsWith('Back')), 'a cleat forces a back panel');
});

test('butt joints: shelves equal the bay width; dados add twice the dado depth', () => {
  const butt = buildShelfPlan(base);
  assert.equal(butt.overallWidth, 4 * 17.5 + 5 * 0.75);
  assert.equal(part(butt, 'Shelf').length, 17.5);
  assert.equal(part(butt, 'Shelf').qty, 20);
  assert.equal(part(butt, 'Top').length, butt.innerSpan);
  assert.equal(part(butt, 'Divider').length, 74 - 1.5);
  assert.equal(part(butt, 'Divider').qty, 3);

  const dado = buildShelfPlan({ ...base, joinery: 'dado' });
  assert.equal(part(dado, 'Shelf').length, 18);
  assert.equal(part(dado, 'Top').length, dado.innerSpan + 0.5);
  assert.equal(part(dado, 'Divider').length, 74 - 1.5 + 0.5);
});

test('shelves are evenly spaced inside the interior and toe kick raises the bottom', () => {
  const plan = buildShelfPlan({ ...base, bays: 1, shelvesPerBay: [2], toeKick: 3 });
  const [bay] = plan.bays;
  assert.equal(plan.interiorBottom, 3.75);
  assert.equal(plan.interiorTop, 73.25);
  const opening = (73.25 - 3.75 - 1.5) / 3;
  assert.ok(Math.abs(bay.openingHeight - opening) < 1e-9);
  assert.ok(Math.abs(bay.shelfYs[0] - (3.75 + opening)) < 1e-9);
  assert.equal(part(plan, 'Toe kick').width, 3);
  assert.equal(part(plan, 'Back').length, 71);
});

test('an oversized back is split at divider centers', () => {
  const plan = buildShelfPlan(base);
  const backs = plan.parts.filter(p => p.name.startsWith('Back'));
  assert.ok(backs.length >= 2);
  const total = backs.reduce((sum, p) => sum + p.width, 0);
  assert.ok(Math.abs(total - plan.innerSpan) < 1e-9);
  assert.ok(backs.every(p => p.width <= 48));
});

test('deep opposing dados and impossible inputs are reported', () => {
  const deep = buildShelfPlan({ ...base, joinery: 'dado', dadoDepth: 0.375, shelvesPerBay: [3, 3, 3, 3] });
  assert.ok(deep.warnings.some(w => w.includes('both faces')));
  const bad = buildShelfPlan({ ...base, joinery: 'dado', dadoDepth: 0.75 });
  assert.ok(bad.errors.length > 0);
  const crowded = buildShelfPlan({ ...base, height: 10, shelvesPerBay: [20, 0, 0, 0] });
  assert.ok(crowded.errors.some(e => e.includes('Bay 1')));
});

test('fractions format to the nearest 1/32 and flag rounding', () => {
  assert.equal(fmt(17.375), '17 3/8"');
  assert.equal(fmt(0.71875), '23/32"');
  assert.equal(fmt(9.25), '9 1/4"');
  assert.equal(fmt(10.1), '≈10 3/32"');
});

test('3D solids stay inside the overall envelope and include cleats only when hung on one', () => {
  const config = { ...base, mounting: 'wall', frenchCleat: true };
  const plan = buildShelfPlan(config);
  const solids = shelfSolids(plan, config);
  const boxes = solids.filter(s => s.shape === 'box');
  assert.equal(boxes.filter(s => s.kind === 'shelf').length, 20);
  for (const s of boxes) {
    assert.ok(s.min.every((v, i) => v >= -1e-9 && v < s.max[i]), s.name);
    assert.ok(s.max[0] <= plan.overallWidth + 1e-9 && s.max[1] <= plan.overallHeight + 1e-9 && s.max[2] <= plan.sideDepth + 1e-9, s.name);
  }
  assert.ok(solids.some(s => s.name === 'Cabinet cleat' && s.shape === 'prism'));
  assert.ok(!shelfSolids(buildShelfPlan(base), base).some(s => s.kind === 'cleat'));
});

test('lengths parse in either unit, with an explicit unit overriding the default', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  close(parseLength('18', 'mm'), 18 / 25.4);
  close(parseLength('18mm', 'in'), 18 / 25.4);
  close(parseLength('1.8 cm', 'in'), 18 / 25.4);
  close(parseLength('3/4', 'mm'), 0.75);
  close(parseLength('3/4"', 'mm'), 0.75);
  close(parseLength('17 1/2 in', 'mm'), 17.5);
  close(parseLength('17 1/2', 'in'), 17.5);
  close(parseLength('444,5', 'mm'), 17.5);
  close(parseLength("2' 6", 'mm'), 30);
  assert.equal(parseLength('abc', 'mm'), null);
  assert.equal(parseLength('0', 'mm'), null);
});

test('lengths format and round-trip between units', () => {
  assert.equal(formatLength(17.5, 'mm'), '444.5 mm');
  assert.equal(formatLength(0.75, 'mm'), '19.1 mm');
  assert.equal(formatLength(17.5, 'in'), '17 1/2"');
  assert.equal(lengthToField(17.5, 'mm'), '444.5');
  assert.equal(lengthToField(17.5, 'in'), '17 1/2');
  assert.equal(lengthToField(18 / 25.4, 'in'), '0.7087');
  assert.equal(lengthToField(18 / 25.4, 'mm'), '18');

  const metric = buildShelfPlan({ ...base, units: 'mm', joinery: 'dado', dadoDepth: 0.5 });
  assert.ok(metric.warnings.some(w => w.includes('12.7 mm dado')));
});

test('typos are rejected instead of reading the leading number', () => {
  for (const bad of ['96x', '3/4x', '17 1/2 3', '12..5', '3/0', '18 mmm', 'x96', '1 1/2/3']) {
    assert.equal(parseLength(bad, 'in'), null, bad);
  }
  for (const [good, inches] of [['96', 96], ['95 7/8', 95.875], ['3/4"', 0.75], ['11½', 11.5], ["2' 6", 30], ["2'", 24], ['.5', 0.5], ['3/4 in', 0.75]]) {
    assert.ok(Math.abs(parseLength(good, 'in') - inches) < 1e-9, good);
  }
});

test('fractions survive a round trip through millimeters', () => {
  for (const frac of ['23/32', '15/32', '3/4', '17 1/2', '11 1/4', '95 7/8']) {
    const mm = lengthToField(parseLength(frac, 'in'), 'mm');
    assert.equal(lengthToField(parseLength(mm, 'mm'), 'in'), frac, `${frac} → ${mm} mm`);
  }
  assert.equal(lengthToField(18 / 25.4, 'in'), '0.7087', 'a true metric size stays decimal');
});

test('project cut items are written in inches that the project sheet layout can read', async () => {
  const { parseInches } = await import('../src/lib/cutPlan.ts');
  const metric = buildShelfPlan({ ...base, units: 'mm', thickness: 18 / 25.4, bayWidth: 400 / 25.4 });
  const items = projectCutItems(metric);
  assert.equal(items.length, metric.parts.length);
  const shelf = items.find(i => i.part_name === 'Shelf');
  assert.equal(shelf.qty, 20);
  assert.equal(shelf.material, 'Plywood');
  for (const item of items) {
    const part = metric.parts.find(p => p.name === item.part_name);
    assert.ok(Math.abs(parseInches(item.length) - part.length) < 1e-4, item.part_name);
    assert.ok(Math.abs(parseInches(item.width) - part.width) < 1e-4, item.part_name);
    assert.ok(!/mm/.test(item.length + item.width + item.thickness));
  }
  assert.equal(projectCutItems(buildShelfPlan(base)).find(i => i.part_name === 'Shelf').length, '17 1/2');
  assert.equal(shelfProjectTitle(buildShelfPlan(base), 'in'), 'Shelving unit 73 3/4" × 74"');
});

test('saved designs round-trip and bad ones are rejected rather than guessed', () => {
  const config = { ...base, mounting: 'wall', frenchCleat: true, joinery: 'butt' };
  const saved = JSON.parse(JSON.stringify(toSavedShelfDesign(config, 'mm')));
  const read = readSavedShelfDesign(saved);
  assert.equal(read.units, 'mm');
  assert.deepEqual(buildShelfPlan(read.config).parts, buildShelfPlan({ ...config, units: 'mm' }).parts);

  assert.equal(readSavedShelfDesign(null), null);
  assert.equal(readSavedShelfDesign({ version: 2, config }), null);
  assert.equal(readSavedShelfDesign({ version: 1, config: { ...config, height: 'tall' } }), null);
  assert.equal(readSavedShelfDesign({ version: 1, config: { ...config, bays: 40 } }), null);
  const padded = readSavedShelfDesign({ version: 1, config: { ...config, bays: 3, shelvesPerBay: [2] } });
  assert.deepEqual(padded.config.shelvesPerBay, [2, 0, 0]);
});

test('a saved design reopens as form fields that rebuild the same cut list', () => {
  for (const [config, units] of [
    [{ ...base, joinery: 'dado', toeKick: 3 }, 'in'],
    [{ ...base, thickness: 18 / 25.4, bayWidth: 400 / 25.4, mounting: 'wall', frenchCleat: true }, 'mm'],
  ]) {
    const saved = readSavedShelfDesign(JSON.parse(JSON.stringify(toSavedShelfDesign(config, units))));
    const fields = shelfDesignToFields(saved);
    assert.equal(fields.units, units);
    const reparsed = {
      ...saved.config,
      thickness: parseLength(fields.thickness, units),
      bayWidth: parseLength(fields.bayWidth, units),
      shelfDepth: parseLength(fields.shelfDepth, units),
      height: parseLength(fields.height, units),
    };
    const a = buildShelfPlan(saved.config).parts;
    const b = buildShelfPlan(reparsed).parts;
    a.forEach((p, i) => {
      assert.equal(b[i].name, p.name);
      assert.ok(Math.abs(b[i].length - p.length) < 0.001 && Math.abs(b[i].width - p.width) < 0.001, p.name);
    });
  }
  assert.equal(shelfDesignToFields(readSavedShelfDesign(toSavedShelfDesign(base, 'in'))).bayWidth, '17 1/2');
});

test('opening height builds the overall height from openings, shelves, panels and toe kick', async () => {
  const { heightAllowance, openingHeightFromOverall, overallFromOpeningHeight } = await import('../src/lib/shelving.ts');
  // The example: 2 openings of 3" in 1/2" plywood, top and bottom, no toe kick → 7 1/2".
  const half = { thickness: 0.5, topPanel: true, bottomPanel: true, mounting: 'wall', toeKick: 0 };
  assert.equal(overallFromOpeningHeight(3, [1], half), 7.5);
  assert.equal(overallFromOpeningHeight(3, [0], half), 4, 'one opening: 3 + top + bottom');
  assert.equal(overallFromOpeningHeight(3, [2], half), 11, 'adding a shelf adds an opening and a board');
  assert.equal(openingHeightFromOverall(7.5, [1], half), 3);
  // The fullest bay sets the height.
  assert.equal(overallFromOpeningHeight(3, [0, 1, 1], half), 7.5);
  // Toe kick only counts on floor units with a bottom.
  const floor = { thickness: 0.75, topPanel: true, bottomPanel: true, mounting: 'floor', toeKick: 3 };
  assert.equal(heightAllowance(floor), 4.5);
  assert.equal(heightAllowance({ ...floor, mounting: 'wall' }), 1.5);
  assert.equal(heightAllowance({ ...floor, bottomPanel: false }), 0.75);
  // The plan built from it really has openings of exactly that height in the fullest bay.
  for (const c of [half, floor, { ...floor, topPanel: false }, { ...floor, bottomPanel: false }]) {
    const shelvesPerBay = [1, 3, 2];
    const plan = buildShelfPlan({ ...base, ...c, bays: 3, shelvesPerBay, height: overallFromOpeningHeight(8, shelvesPerBay, c) });
    assert.ok(Math.abs(plan.bays[1].openingHeight - 8) < 1e-9, JSON.stringify(c));
    assert.ok(plan.bays[0].openingHeight > 8, 'bays with fewer shelves get taller openings');
  }
});

test('saved designs remember the height mode and reopen with both heights filled in', () => {
  const config = { ...base, bays: 1, shelvesPerBay: [1], thickness: 0.5, mounting: 'wall', toeKick: 0, height: 7.5 };
  const saved = readSavedShelfDesign(JSON.parse(JSON.stringify(toSavedShelfDesign(config, 'in', 'opening'))));
  assert.equal(saved.heightMode, 'opening');
  const fields = shelfDesignToFields(saved);
  assert.equal(fields.heightMode, 'opening');
  assert.equal(fields.openingHeight, '3');
  assert.equal(fields.height, '7 1/2');
  // Older designs: no mode → overall; the brief 'bay' mode → opening height.
  assert.equal(readSavedShelfDesign({ version: 1, units: 'in', config }).heightMode, 'overall');
  assert.equal(readSavedShelfDesign({ version: 1, units: 'in', heightMode: 'bay', config }).heightMode, 'opening');
});
