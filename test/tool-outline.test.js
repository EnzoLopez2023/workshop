import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dxfOutlines, growRegions, nestRings, signedArea, svgUnitScaleMm, toolFromRegions } from '../src/lib/toolOutline.ts';
import { arrangeTools } from '../src/lib/drawerInserts.ts';
import { buildDrawerPlan, DEFAULT_PULL, drawerSolids, readSavedDrawerDesign, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { drawerPartFaces } from '../src/lib/drawerExport.ts';
import { partDxf, partSvg } from '../src/lib/shelfExport.ts';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg ?? ''} ${a} ≠ ${b}`);
const dxf = (header, entities) => ['0', 'SECTION', '2', 'HEADER', ...header, '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n');

test('DXF: a closed polyline with a bulge (a stadium), in inches', () => {
  // 4" long, 1" wide, with round ends from bulges of 1 (half circles).
  const text = dxf(['9', '$INSUNITS', '70', '1'], [
    '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1',
    '10', '0', '20', '0', '42', '0',
    '10', '3', '20', '0', '42', '1',
    '10', '3', '20', '1', '42', '0',
    '10', '0', '20', '1', '42', '1',
  ]);
  const [region] = dxfOutlines(text);
  const xs = region[0].map(p => p[0]);
  close(Math.min(...xs), -0.5 * 25.4, 0.05, 'left end rounds out half an inch');
  close(Math.max(...xs), 3.5 * 25.4, 0.05);
  const area = Math.abs(signedArea(region[0])) / 25.4 ** 2;
  close(area, 3 + Math.PI * 0.25, 0.01, 'rectangle plus two half circles');
});

test('DXF: LINE and ARC runs chain into a closed outline; a circle inside becomes a hole', () => {
  const text = dxf(['9', '$INSUNITS', '70', '4'], [
    '0', 'LINE', '10', '0', '20', '0', '11', '40', '21', '0',
    '0', 'LINE', '10', '40', '20', '0', '11', '40', '21', '20',
    '0', 'ARC', '10', '20', '20', '20', '40', '20', '50', '0', '51', '180',
    '0', 'LINE', '10', '0', '20', '20', '11', '0', '21', '0',
    '0', 'CIRCLE', '10', '20', '20', '15', '40', '3',
  ]);
  const regions = dxfOutlines(text);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].length, 2, 'outline plus the hole');
  assert.throws(() => dxfOutlines(dxf([], ['0', 'LINE', '10', '0', '20', '0', '11', '5', '21', '0'])), /no closed outlines/);
});

test('SVG units: real-world width over the viewBox, else 96 dpi', () => {
  close(svgUnitScaleMm('<svg width="100mm" height="50mm" viewBox="0 0 200 100">'), 0.5, 1e-9);
  close(svgUnitScaleMm('<svg width="4in" viewBox="0 0 4 2">'), 25.4, 1e-9);
  close(svgUnitScaleMm('<svg viewBox="0 0 10 10">'), 25.4 / 96, 1e-9);
});

test('nesting and growing: holes shrink, outlines grow by the clearance with round corners', () => {
  const square = (s, o = 0) => [[o, o], [o + s, o], [o + s, o + s], [o, o + s]];
  const regions = nestRings([square(10, 20), square(50)]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].length, 2);
  const [grown] = growRegions([[square(10)]], 1);
  const area = Math.abs(signedArea(grown[0]));
  close(area, 100 + 4 * 10 + Math.PI, 0.2, 'Minkowski sum with a 1 mm disc');
  const tool = toolFromRegions([[square(50.8)]], 1 / 32, 'Block');
  close(tool.width, 2 + 1 / 16, 0.01, 'clearance on both sides');
  assert.ok(tool.rings[0].every(([x, y]) => x >= -1e-9 && y >= -1e-9), 'moved to the origin');
});

test('tools are arranged on the board in rows, and too-big ones are explained', () => {
  const tool = (name, w, h) => ({ name, rings: [[[0, 0], [w, 0], [w, h], [0, h]]], width: w, height: h });
  const placed = arrangeTools([tool('A', 6, 2), tool('B', 4, 3), tool('C', 2, 1)], 12, 18, true);
  assert.equal(placed.length, 3);
  for (const p of placed) assert.ok(p.x >= 0.5 && p.x + p.width + 0.5 <= 12 && p.y + p.height <= 18);
  assert.match(arrangeTools([tool('Saw', 30, 2)], 12, 18, false), /doesn’t fit .* try turning it/);
  assert.equal(arrangeTools([{ ...tool('Saw', 16, 2), rotated: true }], 12, 18, false)[0].width, 2, 'turned 90°');
});

test('a shadow-board drawer: board in the cut list, pockets in the CNC file, saved and reopened', () => {
  const tool = { name: 'Chisel', rings: [[[0, 0], [8, 0], [8, 1.25], [0, 1.25]]], width: 8, height: 1.25 };
  const base = {
    thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
    pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25, base: 'none', footHeight: 0.5, casterHeight: 2,
    inserts: [{ kind: 'tools', tools: [tool, tool], boardThickness: 0.75, pocketDepth: 0.5, fingerHoles: true }, null, null, null, null],
  };
  const plan = buildDrawerPlan(base);
  assert.deepEqual(plan.errors, []);
  const part = plan.parts.find(p => p.name.startsWith('Tool board'));
  assert.equal(part.thickness, 0.75);
  assert.match(part.note, /2 tool pockets, 1\/2" deep/);
  const face = drawerPartFaces(plan, base).find(x => x.part === part.name);
  assert.equal(face.features.filter(x => x.kind === 'pocketPath').length, 2);
  assert.equal(face.features.filter(x => x.label === 'Finger hole').length, 2);
  assert.match(partSvg(face, 'in'), /fill-rule="evenodd"[^>]*shaper:cutType="pocket" shaper:cutDepth="0.500in"/);
  assert.match(partDxf(face, 'in'), /POCKET_0\.500in/);
  assert.ok(drawerSolids(plan, base).some(s => s.name === 'Drawer 1 tool board'));
  assert.match(buildDrawerPlan({ ...base, inserts: [{ ...base.inserts[0], boardThickness: 6 }, null, null, null, null] }).errors.join(' '), /tool board won’t fit/);
  const read = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(base, 'in'))));
  assert.equal(read.config.inserts[0].tools.length, 2);
  assert.equal(read.config.inserts[0].tools[0].name, 'Chisel');
});
