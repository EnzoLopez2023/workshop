import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan, formatLength } from '../src/lib/shelving.ts';
import { buildGuideSteps, dadoGrooves, describeOpenings, guidePrintHtml, planGuideSheets, sheetLayoutSvg } from '../src/lib/buildGuide.ts';

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
  assert.deepEqual(guide().steps.map(s => s.id), ['overview', 'sheets', 'cut', 'dados', 'case', 'dividers', 'shelves', 'back', 'install', 'finish']);
  assert.deepEqual(
    guide({ joinery: 'butt', bays: 1, shelvesPerBay: [3], backPanel: false, mounting: 'wall', frenchCleat: false }).steps.map(s => s.id),
    ['overview', 'sheets', 'cut', 'case', 'shelves', 'install', 'finish'],
  );
  assert.ok(guide({ mounting: 'wall', frenchCleat: true }).steps.some(s => s.id === 'cleat'));
});

test('every scene only refers to solids that exist, and each part is highlighted when it is added', () => {
  const { steps, solids } = guide({ mounting: 'wall', frenchCleat: true });
  const known = new Set(solids.map(s => s.name));
  for (const step of steps.filter(s => s.scene)) {
    for (const name of [...step.scene.visible, ...step.scene.highlight]) assert.ok(known.has(name), `${step.id}: ${name}`);
  }
  const highlightedAt = name => steps.find(s => s.id !== 'cut' && s.scene?.highlight.includes(name))?.id;
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
  assert.match(text(metric.steps.find(s => s.id === 'overview')), /full sheets of 18 mm \(2440 mm × 1220 mm\)/);
  assert.ok(metric.steps.find(s => s.id === 'cut').parts.every(p => / mm × .* mm$/.test(p.size)));
});

test('the printable guide has every step, its picture, and escapes text', () => {
  const g = guide();
  const images = new Map([['case', 'data:image/png;base64,AAAA']]);
  const html = guidePrintHtml(g, images, 'Shelves <for> "Mom"', '4 bays', v => formatLength(v, 'in'));
  for (const step of g.steps) assert.ok(html.includes(step.title), step.id);
  assert.equal((html.match(/class="step( sheets)?"/g) ?? []).length, g.steps.length);
  assert.match(html, /<img src="data:image\/png;base64,AAAA"/);
  const drawnSteps = g.steps.filter(s => s.scene).length;
  assert.equal((html.match(/No illustration/g) ?? []).length, drawnSteps - 1);
  const sheetCount = g.steps.find(s => s.id === 'sheets').sheets.layouts.length;
  assert.equal((html.match(/<img src="data:image\/svg\+xml/g) ?? []).length, sheetCount);
  assert.match(html, /<title>Shelves &lt;for&gt; &quot;Mom&quot; — Build guide<\/title>/);
  assert.ok(!html.includes('<for>'));
});

test('the sheet layout places every part and agrees with the overview', () => {
  const config = { ...base, bays: 4, shelvesPerBay: [6, 7, 2, 5], mounting: 'wall', frenchCleat: true, toeKick: 0 };
  const plan = buildShelfPlan(config);
  const sheets = planGuideSheets(plan, config, 'in');
  const pieces = plan.parts.reduce((n, p) => n + p.qty, 0);
  assert.equal(sheets.layouts.reduce((n, l) => n + l.placed.length, 0), pieces);
  assert.deepEqual(sheets.unplaced, []);
  assert.equal(sheets.sheetSize, '96" × 48"');
  const g = buildGuideSteps(plan, config, 'in');
  assert.match(g.steps[0].instructions[0], new RegExp(`^Plywood: ${sheets.layouts.length} full sheets`));
  // Every placed part stays inside its sheet.
  for (const l of sheets.layouts) {
    for (const p of l.placed) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.length <= l.sheetLength + 1e-6 && p.y + p.width <= l.sheetWidth + 1e-6, p.partName);
  }
  const metric = planGuideSheets(plan, config, 'mm');
  assert.equal(metric.sheetSize, '2440 mm × 1220 mm');
  assert.equal(metric.kerf, '3.2 mm');
});

test('sheet drawings are valid SVG with escaped part names', () => {
  const config = { ...base, bays: 1, shelvesPerBay: [2] };
  const plan = buildShelfPlan(config);
  const sheets = planGuideSheets(plan, config, 'in');
  const layout = { ...sheets.layouts[0], placed: [{ ...sheets.layouts[0].placed[0], partName: 'Side <A&B>' }] };
  const svg = sheetLayoutSvg(layout, new Map([['Side <A&B>', '#477F97']]), v => formatLength(v, 'in'));
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /Side &lt;A&amp;B&gt;/);
  assert.ok(!svg.includes('<A&B>'));
});

test('the guide states the bay height and asks for it to be checked during assembly', () => {
  // 74" overall, 3/4" top and bottom, 3" toe kick → 69 1/2" clear bays.
  const g = guide();
  const text = id => { const s = g.steps.find(x => x.id === id); return [s.summary, ...s.instructions].join(' '); };
  assert.match(text('overview'), /Each bay is 17 1\/2" wide with shelf openings from .* to .* clear\./, 'bays with different counts have a range');
  assert.match(text('case'), /clear height between the bottom and the top is 69 1\/2"/);
  assert.match(text('dividers'), /Each bay should end up 17 1\/2" wide × 69 1\/2" clear/);
  // Without a top panel there's nothing to measure between, so the case check is left out.
  const open = guide({ topPanel: false });
  assert.ok(!open.steps.find(s => s.id === 'case').instructions.some(l => l.includes('clear height between')));

  // Millimeters too.
  const metric = guide({ thickness: 18 / 25.4, bayWidth: 400 / 25.4, height: (1800 + 36 + 76.2) / 25.4 }, 'mm');
  assert.match(metric.steps[0].summary, /Each bay is 400 mm wide with shelf openings/);
});

test('the guide gives the opening height: in the overview, per bay, and as the spacer size', () => {
  // The example: one bay, 2 openings of 3" in 1/2" plywood → 7 1/2" overall.
  const config = { ...base, thickness: 0.5, bays: 1, shelvesPerBay: [1], height: 7.5, mounting: 'wall', toeKick: 0 };
  const g = buildGuideSteps(buildShelfPlan(config), config, 'in');
  assert.match(g.steps[0].summary, /Each bay is 17 1\/2" wide with 2 shelf openings 3" clear\./);
  const shelves = g.steps.find(s => s.id === 'shelves');
  assert.ok(shelves.instructions.includes('Bay 1: 2 openings, 3" clear (1 shelf)'));
  assert.match(shelves.tips[0], /spacer block exactly 3" tall — the opening height/);

  // Uneven bays: a range in the overview and a per-bay spacer tip.
  const mixedConfig = { ...base, bays: 2, shelvesPerBay: [1, 3] };
  const mixedPlan = buildShelfPlan(mixedConfig);
  const d = describeOpenings(mixedPlan, v => formatLength(v, 'in'));
  assert.equal(d.uniform, false);
  assert.ok(d.min < d.max);
  const mixed = buildGuideSteps(mixedPlan, mixedConfig, 'in');
  assert.match(mixed.steps.find(s => s.id === 'shelves').tips[0], /each bay’s opening height/);
});

test('options add their own guide steps in build order', () => {
  const config = {
    ...base, bayWidths: [12, 30, 12], adjustablePerBay: [2, 0, 1], backJoint: 'rabbet',
    doorsPerBay: [true, true, false], faceFrame: { enabled: true, stileWidth: 1.5, railWidth: 1.5, thickness: 0.75 },
  };
  const g = buildGuideSteps(buildShelfPlan(config), config, 'in');
  assert.deepEqual(g.steps.map(s => s.id),
    ['overview', 'sheets', 'cut', 'dados', 'pins', 'case', 'dividers', 'shelves', 'back', 'frame', 'install', 'doors', 'finish']);
  const step = id => g.steps.find(s => s.id === id);
  assert.equal(step('dados').title, 'Cut the dados and back rabbets');
  assert.ok(step('dados').instructions.some(l => /3\/8"-wide, 3\/4"-deep rabbet/.test(l)));
  assert.ok(step('pins').instructions.some(l => l.startsWith('Left side, right face (bay 1)')));
  assert.ok(step('pins').scene.highlight.length > 0 && step('pins').scene.highlight.every(n => n.startsWith('Pin hole')));
  assert.match(step('shelves').summary, /adjustable/);
  assert.ok(step('shelves').parts.some(p => p.name === 'Adjustable shelf (bay 1)' || p.name.startsWith('Adjustable shelf')));
  assert.ok(step('frame').parts.every(p => p.name.startsWith('Face frame')));
  assert.match(step('doors').instructions[0], /face-frame hinges/);
  assert.equal(step('doors').scene.highlight.length, 3, 'one door plus a pair on the 30" bay');
  assert.match(step('dividers').summary, /Bays are 12", 30", 12" clear/);
  assert.match(step('overview').instructions.find(l => l.startsWith('Hardware:')), /shelf pins/);
  // Every scene still only names real solids.
  const known = new Set(g.solids.map(s => s.name));
  for (const s of g.steps.filter(s => s.scene)) for (const name of [...s.scene.visible, ...s.scene.highlight]) assert.ok(known.has(name), `${s.id}: ${name}`);
});

test('the shelves step warns when shelves will sag', () => {
  const config = { ...base, bays: 1, shelvesPerBay: [3], bayWidth: 40, thickness: 0.5, shelfLoad: 'books' };
  const g = buildGuideSteps(buildShelfPlan(config), config, 'in');
  assert.ok(g.steps.find(s => s.id === 'shelves').cautions.some(c => /will sag about/.test(c)));
});
