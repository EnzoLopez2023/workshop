import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan } from '../src/lib/shelving.ts';
import { planGuideSheets } from '../src/lib/buildGuide.ts';
import { flipFaces, hingePositions, partDxf, partFaces, partSvg, pinJig, pinJigDxf, pinJigSvg, sheetDxf, sheetSvg } from '../src/lib/shelfExport.ts';

const base = {
  thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 3, shelvesPerBay: [2, 3, 2],
  topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
  mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3,
};
const faceOf = (faces, id) => faces.find(f => f.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('each machined face lists its dados, rabbets, pin holes and hinge cups in its own frame', () => {
  const config = { ...base, backJoint: 'rabbet', adjustablePerBay: [1, 0, 0], doorsPerBay: [true, false, false] };
  const plan = buildShelfPlan(config);
  const faces = partFaces(plan, config);
  const left = faceOf(faces, 'left-side-inside');
  const dados = left.features.filter(f => f.label.includes('dado'));
  assert.equal(dados.length, 2 + 2, 'two shelves plus top and bottom housings');
  const firstShelf = dados.find(f => f.label === 'Shelf dado 1');
  close(firstShelf.u, plan.bays[0].shelfYs[0]);
  close(firstShelf.length, 0.75);
  close(firstShelf.depth, 0.25);
  const rabbet = left.features.find(f => f.label === 'Back rabbet');
  close(rabbet.v, 11.25);
  close(rabbet.depth, 0.375);
  assert.ok(left.features.some(f => f.kind === 'hole' && f.label === 'Shelf pin'));

  // Divider faces are measured from the divider's own bottom end (it sits on the bottom panel, in its dado).
  const d1Right = faceOf(faces, 'divider-1-right');
  close(d1Right.features[0].u, plan.bays[1].shelfYs[0] - (plan.interiorBottom - 0.25));
  // The top's underside has a dado for each divider.
  assert.equal(faceOf(faces, 'top').features.length, 2);
  // Door hinge cups: 74"-ish doors get four, 3" from each end.
  const door = faces.find(f => f.part === 'Door');
  assert.equal(door.features.length, 4);
  close(door.features[0].u, 3);
  close(door.features[3].u, door.length - 3);
  assert.deepEqual(hingePositions(30).length, 2);
});

test('faces are drawn without mirroring: handedness checked with real 3D vectors', () => {
  // Right-handed world: X right, Y up, Z toward the front. Depth from the front edge runs along −Z.
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const neg = v => v.map(c => -c);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // [u axis, v axis, outward normal of the machined face]
  const frames = {
    'left-side-inside': [Y, neg(Z), X],
    'right-side-inside': [Y, neg(Z), neg(X)],
    'divider-1-left': [Y, neg(Z), neg(X)],
    'divider-1-right': [Y, neg(Z), X],
    top: [X, neg(Z), neg(Y)],
    bottom: [X, neg(Z), Y],
    door: [Y, X, neg(Z)], // v from the hinge edge (the door's left, seen from the front)
  };
  const config = { ...base, doorsPerBay: [true, false, false] };
  const faces = partFaces(buildShelfPlan(config), config);
  for (const [id, [u, v, n]] of Object.entries(frames)) {
    const face = faces.find(f => f.id === id) ?? faces.find(f => f.part === 'Door');
    assert.equal(face.rightHanded, dot(cross(u, v), n) > 0, id);
  }
});

test('part SVGs are real size with Shaper cut types; DXFs carry depths in layer names', () => {
  const plan = buildShelfPlan(base);
  const left = faceOf(partFaces(plan, base), 'left-side-inside');
  const svg = partSvg(left, 'in');
  assert.match(svg, /width="74in" height="12in" viewBox="0 0 74 12"/);
  assert.match(svg, /xmlns:shaper="http:\/\/www.shapertools.com\/namespaces\/shaper"/);
  assert.match(svg, /fill="#000000"[^>]*shaper:cutType="outside" shaper:cutDepth="0.750in"/);
  assert.equal((svg.match(/shaper:cutType="pocket" shaper:cutDepth="0.250in"/g) ?? []).length, 4);
  const mm = partSvg(left, 'mm');
  assert.match(mm, /width="1879.6mm"/);
  assert.match(mm, /shaper:cutDepth="6.4mm"/);

  const dxf = partDxf(left, 'in');
  assert.match(dxf, /\$INSUNITS\n70\n1\n/);
  assert.ok(dxf.includes('OUTSIDE_0.750in'));
  assert.equal((dxf.match(/\nPOLYLINE\n8\nPOCKET_0.250in/g) ?? []).length, 4);
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  assert.match(partDxf(left, 'mm'), /\$INSUNITS\n70\n4\n/);
});

test('sheet files place every piece where the sheet layout put it, joinery face-up, rotations not mirrored', () => {
  const config = { ...base, adjustablePerBay: [1, 1, 0] };
  const plan = buildShelfPlan(config);
  const faces = partFaces(plan, config);
  const sheets = planGuideSheets(plan, config, 'in');
  let outlines = 0;
  for (const layout of sheets.layouts) {
    const svg = sheetSvg(layout, faces, 'in', 'Sheet');
    assert.match(svg, /width="96in" height="48in"/);
    outlines += (svg.match(/shaper:cutType="outside"/g) ?? []).length;
    // Every drawn point stays on the sheet.
    for (const [, x, y] of svg.matchAll(/(?:M|L) ([\d.]+) ([\d.]+)/g)) {
      assert.ok(Number(x) <= 96 + 1e-6 && Number(y) <= 48 + 1e-6);
    }
    assert.match(sheetDxf(layout, faces, 'in'), /ENTITIES/);
  }
  assert.equal(outlines, plan.parts.filter(p => p.material !== 'solid').reduce((n, p) => n + p.qty, 0));
  // Dividers drilled on both faces: the second face needs a flip and its own file.
  assert.ok(flipFaces(faces).some(f => f.piece === 'Divider 1'));
});

test('the shelf-pin jig matches the holes on every face and reads the same flipped over', () => {
  assert.equal(pinJig(buildShelfPlan(base)), null, 'no adjustable shelves, no jig');
  const config = { ...base, shelvesPerBay: [1, 2, 1], adjustablePerBay: [1, 1, 1] };
  const plan = buildShelfPlan(config);
  const jig = pinJig(plan);
  close(jig.width, 1.5 + (11.25 - 1.5));
  close(jig.spacing, 1);
  // Long enough for the longest group of holes on any face.
  const longest = Math.max(...plan.pinHoles.flatMap(run => {
    const groups = [1];
    for (let i = 1; i < run.ys.length; i++) {
      if (run.ys[i] - run.ys[i - 1] <= 1.5) groups[groups.length - 1] += 1; else groups.push(1);
    }
    return groups;
  }));
  assert.equal(jig.holesPerColumn, longest);
  close(jig.length, 2 * 2 + (longest - 1) * 1);
  // Symmetric both ways: flipping over (v → width − v) or end-for-end (u → length − u) gives the same holes.
  const key = h => `${h.u.toFixed(4)},${h.v.toFixed(4)}`;
  const holes = new Set(jig.holes.map(key));
  for (const flip of [h => ({ u: h.u, v: jig.width - h.v }), h => ({ u: jig.length - h.u, v: h.v })]) {
    assert.deepEqual(new Set(jig.holes.map(flip).map(key)), holes);
  }
  // Each hole sits where the panels' holes are: the first is 2" from the end, at the panel insets.
  close(jig.holes[0].u, 2);
  assert.deepEqual([...new Set(jig.holes.map(h => h.v.toFixed(4)))], [plan.pinHoles[0].frontInset.toFixed(4), plan.pinHoles[0].backInset.toFixed(4)]);

  const svg = pinJigSvg(jig, 'in');
  assert.match(svg, new RegExp(`width="${jig.length}in" height="${jig.width}in"`));
  assert.equal((svg.match(/shaper:cutType="inside" shaper:cutDepth="0.500in"/g) ?? []).length, jig.holes.length);
  assert.match(pinJigDxf(jig, 'in'), /DRILL_0.500in/);
  // Banded fronts move the columns to the plywood edge.
  const banded = pinJig(buildShelfPlan({ ...config, edgeBanding: true, bandingThickness: 0.04 }));
  close(banded.frontInset, 1.5 - 0.04);
  // 32 mm system.
  close(pinJig(buildShelfPlan({ ...config, pinSystem: 'metric' })).spacing, 32 / 25.4);
});
