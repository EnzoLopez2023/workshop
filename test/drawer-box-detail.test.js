import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, BOTTOM_GROOVE_DEPTH, BOTTOM_GROOVE_OFFSET } from '../src/lib/drawerUnit.ts';
import { boxDetail, boxJointDetail, bottomGrooveWidth, detailDrawer } from '../src/lib/drawerBoxDetail.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { guidePrintHtml } from '../src/lib/buildGuide.ts';
import { formatLength } from '../src/lib/shelving.ts';

const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};
const f = inches => formatLength(inches, 'in');
const prismX = s => [s.x0, s.x1];

test('the close-up shows the box most drawers share', () => {
  const plan = buildDrawerPlan({ ...base, frontHeights: [4, 5.75, 5.75, 5.75, 5.75] });
  const picked = detailDrawer(plan);
  assert.equal(picked.sameAs.length, 4);
  assert.notEqual(picked.drawer.index, 0, 'not the odd shallow top drawer');
});

test('sides carry real end rabbets and a groove; front and back sit in the rabbets', () => {
  const plan = buildDrawerPlan(base);
  const detail = boxDetail(plan, base);
  const { width: W, height: H, depth: D } = detail;
  const b = 0.5;
  const part = (variant, name) => detail.solids.filter(s => s.name.startsWith(`Box close-up (${variant}) · ${name}`) && s.kind !== 'groove');
  const left = part('close', 'left side');
  // Outer half runs the full depth; the inner half stops b short of each end (the rabbets).
  const outer = left.filter(s => s.x0 === 0);
  const inner = left.filter(s => s.x1 === b);
  assert.ok(outer.some(s => Math.min(...s.profile.map(p => p[0])) === 0 && Math.max(...s.profile.map(p => p[0])) === D));
  for (const s of inner) {
    const zs = s.profile.map(p => p[0]);
    assert.deepEqual([Math.min(...zs), Math.max(...zs)], [b, D - b], 'rabbet b wide at each end');
    assert.deepEqual(prismX(s), [b / 2, b], 'rabbet b/2 deep');
  }
  // The inner layer is split by the groove: nothing between its top and bottom edges.
  const ys = inner.map(s => [Math.min(...s.profile.map(p => p[1])), Math.max(...s.profile.map(p => p[1]))]).sort((p, q) => p[0] - q[0]);
  assert.deepEqual(ys, [[0, BOTTOM_GROOVE_OFFSET], [BOTTOM_GROOVE_OFFSET + bottomGrooveWidth(0.25), H]]);

  // Front: between the sides' rabbet floors (box width − b long), grooved on its inside face.
  const front = part('close', 'front');
  const xs = front.flatMap(s => s.outline.map(p => p[0]));
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [b / 2, W - b / 2]);
  assert.ok(front.some(s => s.z0 === 0 && s.z1 === b - BOTTOM_GROOVE_DEPTH));

  // The bottom reaches into the grooves, 1/32" short of their floors.
  const [bottom] = part('close', 'bottom');
  assert.ok(Math.abs(bottom.min[0] - (b - BOTTOM_GROOVE_DEPTH + 1 / 32)) < 1e-9);
  assert.ok(Math.abs(bottom.max[2] - (D - b + BOTTOM_GROOVE_DEPTH - 1 / 32)) < 1e-9);
});

test('the corner close-up has only the front rabbet and the groove', () => {
  const { scenes } = boxDetail(buildDrawerPlan(base), base);
  const cuts = new Set(scenes.corner.highlight.map(n => n.split(' · ').slice(1).join(' · ').replace(/ [-+][xyz]$/, '')));
  assert.deepEqual([...cuts].sort(), ['front · bottom groove', 'left side · bottom groove', 'left side · front rabbet']);
});

test('the cutting scene lays every part flat with its cuts marked', () => {
  const detail = boxDetail(buildDrawerPlan(base), base);
  const { cut } = detail.scenes;
  assert.equal(cut.view, 'above');
  // Each side: two rabbets (floor and shoulder) and a groove (floor and two walls); front and back a groove each.
  assert.equal(cut.highlight.length, 2 * (2 + 2 + 3) + 3 + 3);
  const byName = new Map(detail.solids.map(s => [s.name, s]));
  for (const name of cut.highlight) assert.equal(byName.get(name).kind, 'groove');
  for (const name of [...cut.visible, ...cut.highlight]) assert.ok(byName.get(name).pose, `${name} is laid out`);
  // Glue-up runs in order: each scene adds parts to what's already built.
  const { glue, bottom, close } = detail.scenes;
  assert.equal(bottom.visible.length, glue.visible.length + glue.highlight.length);
  assert.equal(close.visible.length, bottom.visible.length + bottom.highlight.length);
});

test('the guide shows the first box step by step, with a dimensioned joint drawing', () => {
  const plan = buildDrawerPlan(base);
  const guide = drawerGuideSteps(plan, base, 'in');
  assert.equal(guide.steps.find(s => s.id === 'joinery').highlightSwatch, 'groove');
  const joints = guide.steps.find(s => s.id === 'box-joints');
  assert.equal(joints.scene.view, 'corner');
  const [drawing] = joints.details;
  assert.match(drawing.svg, /^<svg[^>]*xmlns/);
  for (const label of [f(0.5), f(0.25), f(BOTTOM_GROOVE_OFFSET)]) assert.ok(drawing.svg.includes(label.replace(/"/g, '"')), label);
  assert.match(drawing.alt, /rabbet .* wide and .* deep/);
  const names = new Set(guide.solids.map(s => s.name));
  for (const id of ['box-joints', 'box-glue', 'box-bottom', 'box-close']) {
    const step = guide.steps.find(s => s.id === id);
    assert.ok(['detail', 'corner'].includes(step.scene.view));
    for (const name of [...step.scene.visible, ...step.scene.highlight]) assert.ok(names.has(name), name);
  }
  const html = guidePrintHtml(guide, new Map(), 'Unit', '', f);
  assert.match(html, /class="detail"><img src="data:image\/svg\+xml/);
});

test('the joint drawing follows the box stock', () => {
  const metric = boxJointDetail({ ...base, boxThickness: 12 / 25.4, bottomThickness: 6 / 25.4 }, inches => formatLength(inches, 'mm'));
  assert.match(metric.title, /12 mm × 6 mm rabbets/);
  assert.ok(!/NaN/.test(metric.svg));
});
