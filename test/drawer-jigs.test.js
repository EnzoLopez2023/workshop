import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, SLIDE_HEIGHT } from '../src/lib/drawerUnit.ts';
import { drawerJigs, JIG_STAGES } from '../src/lib/drawerExport.ts';
import { partDxf, partSvg } from '../src/lib/shelfExport.ts';
import { formatLength } from '../src/lib/shelving.ts';

const f = inches => formatLength(inches, 'in');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1 / 32 + 1e-9, `${msg ?? ''} ${a} ≠ ${b}`);
const base = {
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'feet', footHeight: 0.5, casterHeight: 2,
};
const byId = (jigs, prefix) => jigs.find(j => j.face.id.startsWith(prefix));
const pieces = jig => [jig.face, ...(jig.extraFaces ?? [])];

test('every jig is grouped by build stage and exports cleanly', () => {
  const plan = buildDrawerPlan(base);
  const jigs = drawerJigs(plan, base, f);
  const stages = JIG_STAGES.map(s => s.stage);
  assert.deepEqual([...jigs.map(j => j.stage)], [...jigs.map(j => j.stage)].sort((a, b) => stages.indexOf(a) - stages.indexOf(b)), 'in build order');
  for (const jig of jigs) {
    for (const piece of pieces(jig)) {
      assert.ok(piece.length > 0 && piece.width > 0, piece.id);
      assert.match(partSvg(piece, 'in'), /shaper:cutType="outside"/, piece.id);
      assert.match(partDxf(piece, 'in'), /OUTSIDE_/, piece.id);
    }
  }
  for (const id of ['slide-spacer', 'slide-front-stop', 'box-slide-block', 'squaring-frame', 'setup-gauge', 'clamping-square', 'tnut-template', 'reveal-gauge', 'screw-template']) {
    assert.ok(byId(jigs, id), id);
  }
});

test('slide spacer blocks stack up to every slide mark', () => {
  const plan = buildDrawerPlan(base);
  const blocks = pieces(byId(drawerJigs(plan, base, f), 'slide-spacer'));
  assert.equal(blocks.length, 5);
  // Bottom block from the bottom panel, then each block sits on the slide below.
  const bottomUp = [...plan.drawers].reverse();
  let top = base.thickness;
  bottomUp.forEach((d, k) => {
    top += blocks[k].width;
    close(top, d.slideMark, d.label);
    top += SLIDE_HEIGHT;
  });
});

test('box slide blocks, squaring frames and screw templates match the boxes', () => {
  const plan = buildDrawerPlan(base);
  const jigs = drawerJigs(plan, base, f);
  const offsets = new Set(plan.drawers.map(d => Math.round((d.slideY - d.box.y) * 32) / 32));
  assert.equal(pieces(byId(jigs, 'box-slide-block')).length, offsets.size);
  const frame = byId(jigs, 'squaring-frame').face;
  const d = plan.drawers[0];
  close(frame.length, d.box.width - 1 - 1 / 32);
  close(frame.width, d.box.depth - 1 - 1 / 32);
  assert.ok(frame.features.some(x => x.kind === 'cutout'));
  const screw = byId(jigs, 'screw-template');
  for (const t of pieces(screw)) {
    const holes = t.features.filter(x => x.kind === 'hole');
    assert.ok(holes.length >= 2);
    assert.ok(holes.every(h => h.u > 1 && h.u < t.length - 1), 'near the ends');
  }
  // With a wide pull, the holes stay below the box-front notch.
  const wide = { ...base, pull: { ...DEFAULT_PULL, shape: 'wide', depth: 0.75 } };
  const widePlan = buildDrawerPlan(wide);
  const t = byId(drawerJigs(widePlan, wide, f), 'screw-template');
  for (const face of pieces(t)) {
    const drawer = widePlan.drawers.find(x => Math.abs(x.box.height - face.width) < 1e-6);
    for (const h of face.features.filter(x => x.kind === 'hole')) assert.ok(h.v + h.radius < face.width - drawer.boxNotchDepth, 'below the notch');
  }
});

test('the setup gauge has a step for every machine setting, lowest first', () => {
  const gauge = byId(drawerJigs(buildDrawerPlan(base), base, f), 'setup-gauge');
  const tops = gauge.face.outline.filter(([, v]) => v > 0).map(([, v]) => v);
  for (const v of [0.25, 0.375, 0.5]) assert.ok(tops.some(x => Math.abs(x - v) < 1e-9), `step ${v}`);
  assert.match(gauge.steps.join(' '), /groove depth/);
  assert.match(gauge.steps.join(' '), /back rabbet depth/);
});

test('optional jigs appear only when the design needs them', () => {
  const plain = { ...base, base: 'none', gap: 0 };
  const jigs = drawerJigs(buildDrawerPlan(plain), plain, f);
  assert.ok(!byId(jigs, 'tnut-template'));
  assert.ok(!byId(jigs, 'reveal-gauge'));
  assert.ok(!byId(jigs, 'partition-spacer'));
  assert.ok(!byId(jigs, 'slot-strip'));

  const cols = { ...base, width: 40, height: 34, depth: 20, drawers: 7, columns: [{ drawers: 4, width: 14 }, { drawers: 3 }],
    inserts: [{ kind: 'grid', columns: 3, rows: 2 }, null, null, null, null, null, null] };
  const plan = buildDrawerPlan(cols);
  assert.deepEqual(plan.errors, []);
  const all = drawerJigs(plan, cols, f);
  const spacers = pieces(byId(all, 'partition-spacer'));
  assert.deepEqual(spacers.map(s => s.length).sort((a, b) => a - b), [14, Math.round(plan.columns[1].width * 32) / 32].sort((a, b) => a - b));
  const strips = pieces(byId(all, 'slot-strip'));
  assert.equal(strips.length, 2, 'one per slotted divider');
  const lengthwise = plan.parts.find(p => p.name.startsWith('Lengthwise'));
  close(strips[0].length, lengthwise.length);
  assert.ok(pieces(byId(all, 'slide-spacer')).length > 0);
  assert.equal(all.filter(j => j.face.id.startsWith('slide-spacer')).length, 2, 'different columns, different spacer sets');
});
