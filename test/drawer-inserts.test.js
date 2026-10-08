import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, deskSolids, drawerDesignToFields, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { INSERT_PLAY, layoutInsert, pieceOutline, SLOT_PLAY } from '../src/lib/drawerInserts.ts';
import { drawerJigs, drawerPartFaces, TEMPLATE_OVERHANG } from '../src/lib/drawerExport.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { formatLength } from '../src/lib/shelving.ts';

const f = inches => formatLength(inches, 'in');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);
const base = {
  frontStyle: 'overlay',
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};
const marker = { kind: 'markers', diameter: 16 / 25.4, length: 150 / 25.4, spacing: 0.125 };

test('a divider grid laps together: slots meet at half height and line up with the other pieces', () => {
  const inside = { width: 12, depth: 19, height: 4 };
  const layout = layoutInsert({ kind: 'grid', columns: 3, rows: 2 }, inside, 0.25, f);
  assert.equal(layout.error, null);
  assert.equal(layout.cells, 6);
  const length = layout.pieces.find(p => p.role === 'lengthwise');
  const cross = layout.pieces.find(p => p.role === 'crosswise');
  assert.equal(length.qty, 2);
  assert.equal(cross.qty, 1);
  close(length.length, 19 - INSERT_PLAY);
  close(cross.length, 12 - INSERT_PLAY);
  close(length.height, 3.75, 'stops 1/4" below the box top');
  for (const c of [...length.cuts, ...cross.cuts]) {
    close(c.depth, length.height / 2, 'half-height laps');
    close(c.width, 0.25 + SLOT_PLAY);
  }
  // A crosswise slot sits where a lengthwise divider stands, measured from the piece's own end.
  const placedX = layout.placements.filter(p => p.role === 'lengthwise').map(p => p.x + 0.125);
  const slotX = cross.cuts.map(c => c.center + INSERT_PLAY / 2);
  placedX.forEach((x, i) => close(slotX[i], x, 'slot over divider'));

  assert.match(layoutInsert({ kind: 'grid', columns: 12, rows: 2 }, inside, 0.25, f).error, /cells/);
  assert.match(layoutInsert({ kind: 'grid', columns: 2, rows: 2 }, { ...inside, height: 1 }, 0.25, f).error, /too shallow/);
  assert.equal(layoutInsert({ kind: 'grid', columns: 1, rows: 1 }, inside, 0.25, f).pieces.length, 0);
});

test('marker trays count markers, give two ribs per row, and refuse markers that don’t fit', () => {
  const layout = layoutInsert(marker, { width: 12.125, depth: 19, height: 4 }, 0.25, f);
  assert.equal(layout.error, null);
  const rib = layout.pieces[0];
  const perRow = rib.cuts.length;
  assert.equal(layout.capacity, perRow * 2, 'two rows of 150 mm markers (6.66" each with end room) in 19"');
  assert.equal(rib.qty, 4);
  assert.ok(perRow >= 15 && perRow <= 17, `${perRow} per row`);
  const centres = rib.cuts.map(c => c.center);
  close(centres[0], rib.length - centres.at(-1), 'notches centred');
  assert.match(layoutInsert({ ...marker, length: 20 }, { width: 12, depth: 19, height: 4 }, 0.25, f).error, /point them side to side/);
  assert.match(layoutInsert({ ...marker, diameter: 4 }, { width: 12, depth: 19, height: 4 }, 0.25, f).error, /deep inside/);
});

test('piece outlines are closed shapes with the slots and notches cut in', () => {
  const outline = pieceOutline(10, 4, [
    { kind: 'slot', center: 5, width: 0.25, depth: 2, from: 'top' },
    { kind: 'slot', center: 3, width: 0.25, depth: 2, from: 'bottom' },
  ]);
  assert.deepEqual(outline[0], [0, 0]);
  assert.deepEqual(outline.at(-1), [0, 4]);
  assert.ok(outline.some(([u, v]) => Math.abs(u - 4.875) < 1e-9 && v === 2), 'top slot bottom');
  assert.ok(outline.some(([u, v]) => Math.abs(u - 2.875) < 1e-9 && v === 2), 'bottom slot top');
  const rib = pieceOutline(10, 1, [{ kind: 'round', center: 5, radius: 0.5 }]);
  close(Math.min(...rib.map(p => p[1])), 0);
  close(Math.min(...rib.filter(p => p[1] > 0).map(p => p[1])), 0.5, 'half-round notch bottom');
});

test('inserts join the cut list, CNC files and 3D view', () => {
  const config = { ...base, inserts: [{ kind: 'grid', columns: 3, rows: 2 }, marker, marker, null, { kind: 'grid', columns: 2, rows: 3 }] };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  const names = plan.parts.map(p => p.name);
  assert.ok(names.includes('Lengthwise divider · drawer 1'));
  assert.ok(names.includes('Marker rib · drawers 2–3'), names.join(', '));
  assert.equal(plan.parts.find(p => p.name === 'Marker rib · drawers 2–3').qty, plan.inserts[1].pieces[0].qty * 2);
  const faces = drawerPartFaces(plan, config);
  assert.ok(faces.filter(face => /divider|rib/.test(face.part)).every(face => face.outline));
  const solids = drawerSolids(plan, config).filter(s => s.kind === 'insert');
  assert.ok(solids.length > 0);
  for (const s of solids.filter(s => s.shape === 'box')) {
    const box = plan.drawers[Number(s.name.match(/Drawer (\d+)/)[1]) - 1].box;
    assert.ok(s.min[0] >= box.x && s.max[0] <= box.x + box.width + 1e-9, `${s.name} inside the box`);
    assert.ok(s.max[1] <= box.y + box.height + 1e-9, `${s.name} below the box top`);
  }
});

test('a desk doubles the units, adds the top, and checks knee space and height', () => {
  const desk = { enabled: true, layout: 'both', width: 60, height: 29, depth: 24, topLayers: 2 };
  const single = buildDrawerPlan({ ...base, height: 27.5 });
  const plan = buildDrawerPlan({ ...base, height: 27.5, desk });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.unitCount, 2);
  assert.equal(plan.parts.find(p => p.name === 'Side').qty, 4);
  assert.equal(plan.parts.find(p => p.name === 'Desk top').qty, 2);
  close(plan.desk.knee, 60 - 2 * 14.125);
  assert.deepEqual(plan.desk.unitXs, [0, 60 - 14.125]);
  const solids = deskSolids(plan, { ...base, desk });
  assert.equal(solids.filter(s => s.kind === 'drawer-front').length, 10);
  assert.ok(solids.some(s => s.name === 'Right unit · Drawer 1 front'));
  assert.equal(drawerHardwareList(plan, { ...base, desk }, 'in').find(i => i.key === 'slides').qty, 10);
  assert.equal(drawerHardwareList(single, base, 'in').find(i => i.key === 'slides').qty, 5);

  assert.match(buildDrawerPlan({ ...base, desk: { ...desk, width: 40 } }).errors.join(' '), /for your legs/);
  assert.match(buildDrawerPlan({ ...base, height: 30, desk }).errors.join(' '), /must be 27 1\/2" tall/);
  assert.match(buildDrawerPlan({ ...base, height: 27.5, desk: { ...desk, width: 100 } }).errors.join(' '), /butcher-block/);
});

test('jigs: pull templates match the parts, and the story stick carries every slide mark', () => {
  const plan = buildDrawerPlan(base);
  const jigs = drawerJigs(plan, base, f);
  const template = jigs.find(j => j.face.id === 'pull-template').face;
  const front = plan.parts.find(p => p.name.startsWith('Drawer front'));
  close(template.length, front.length, 'as long as the front, so its ends centre it');
  const edge = template.width - TEMPLATE_OVERHANG;
  close(Math.min(...template.outline.filter(p => p[1] > 0).map(p => p[1])), edge - DEFAULT_PULL.depth, 'notch depth below the fence line');
  assert.ok(template.features.some(x => x.kind === 'guide' && x.points[0][1] === edge), 'fence line');
  assert.ok(jigs.some(j => j.face.id.startsWith('box-template')), 'box-front template');

  const stick = jigs.find(j => j.face.id === 'story-stick').face;
  close(stick.length, plan.caseHeight - 1.5);
  const lines = stick.features.filter(x => x.kind === 'guide').map(x => x.points[0][0]);
  plan.drawers.forEach((d, i) => close(lines[i], d.slideMark - 0.75, `drawer ${i + 1}`));
  assert.ok(jigs.some(j => j.face.id === 'gap-spacer'));
  assert.ok(!drawerJigs(buildDrawerPlan({ ...base, pull: { ...DEFAULT_PULL, enabled: false } }), { ...base, pull: { ...DEFAULT_PULL, enabled: false } }, f)
    .some(j => j.face.id.startsWith('pull-template') || j.face.id.startsWith('box-template')));
});

test('the guide adds insert and desk steps that only show parts that exist', () => {
  const desk = { enabled: true, layout: 'left', width: 48, height: 29, depth: 24, topLayers: 1 };
  const config = { ...base, height: 28.25, inserts: [marker, null, null, null, { kind: 'grid', columns: 2, rows: 2 }], desk };
  const plan = buildDrawerPlan(config);
  assert.deepEqual(plan.errors, []);
  const guide = drawerGuideSteps(plan, config, 'in');
  const ids = guide.steps.map(s => s.id);
  assert.ok(ids.indexOf('inserts') > ids.indexOf('boxes') && ids.indexOf('desk') > ids.indexOf('fronts'));
  const names = new Set(guide.solids.map(s => s.name));
  for (const step of guide.steps) {
    for (const name of [...(step.scene?.visible ?? []), ...(step.scene?.highlight ?? [])]) assert.ok(names.has(name), `${step.id}: ${name}`);
  }
  const slides = guide.steps.find(s => s.id === 'slides').scene;
  assert.ok(![...slides.visible, ...slides.highlight].some(n => n.startsWith('Unit ·')), 'unit steps show one unit');
});

test('inserts and the desk survive a save and reopen', () => {
  const desk = { enabled: true, layout: 'right', width: 50, height: 29, depth: 24, topLayers: 2, openEnd: 'panel' };
  const config = { ...base, inserts: [{ kind: 'grid', columns: 4, rows: 3 }, marker, null, null, null], insertThickness: 0.25, desk };
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in', 'overall'))));
  assert.deepEqual(read.config.inserts, config.inserts);
  assert.deepEqual(read.config.desk, desk);
  const fields = drawerDesignToFields(read);
  assert.deepEqual(fields.insertKinds, ['grid', 'markers', 'none', 'none', 'none']);
  assert.equal(fields.gridColumns[0], 4);
  assert.equal(fields.desk, true);
  assert.equal(fields.deskLayout, 'right');
  assert.equal(readSavedDrawerDesign({ ...toSavedDrawerDesign(base, 'in'), config: { ...base, inserts: [{ kind: 'shelf' }] } }).config.inserts[0], null);
});
