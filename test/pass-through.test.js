import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan } from '../src/lib/shelving.ts';
import { partDxf, partFaces, partSvg } from '../src/lib/shelfExport.ts';
import {
  BENCHPILOT_REACH, passThroughSegments, passThroughStatus, planPassThrough, splitForPassThrough,
} from '../src/lib/passThrough.ts';

// A small bookcase like the screenshot: 1/2" ply, ~33" sides, ~7 5/8" deep.
const config = {
  thickness: 0.5, bayWidth: 11, shelfDepth: 7.625, height: 33.5, bays: 1, shelvesPerBay: [8],
  topPanel: true, bottomPanel: true, backPanel: true, backJoint: 'rabbet', joinery: 'dado', dadoDepth: 0.25,
  mounting: 'floor', toeKick: 0, frenchCleat: false, cleatHeight: 3,
};
const plan = buildShelfPlan(config);
const faces = partFaces(plan, config);
const side = faces.find(f => f.id === 'left-side-inside');
const top = faces.find(f => f.id === 'top');
const reach = BENCHPILOT_REACH.workstation;
const BIT = 0.25;

test('a part that fits the reach is not split', () => {
  assert.equal(passThroughStatus(top, reach, BIT, 'sideways').kind, 'fits');
});

test('a long side is split in two sideways on the Workstation, seams off every dado', () => {
  const p = planPassThrough(side, reach, BIT, 'sideways');
  assert.ok(p);
  assert.equal(p.axis, 'u');
  assert.equal(p.windows.length, 2);
  for (const [a, b] of p.windows) assert.ok(b - a + BIT / 2 <= reach.width + 1e-9, 'each window fits the reach');
  for (const s of p.seams) {
    for (const f of side.features.filter(x => x.kind === 'pocket' && x.label.includes('dado'))) {
      assert.ok(s + p.overlap <= f.u || s - p.overlap >= f.u + f.length, `seam ${s} misses ${f.label}`);
    }
  }
});

test('the split face has open on-line outline pieces and a split back groove', () => {
  const p = planPassThrough(side, reach, BIT, 'sideways');
  const split = splitForPassThrough(side, p);
  assert.equal(split.outlinePaths.length, 2);
  const grooves = split.features.filter(f => f.label.startsWith('Back'));
  assert.deepEqual(grooves.map(g => g.label), ['Back rabbet, segment 1', 'Back rabbet, segment 2']);
  assert.ok(Math.abs(grooves[0].u + grooves[0].length - grooves[1].u - 2 * p.overlap) < 1e-9, 'pieces overlap at the seam');
  // Dados untouched.
  assert.equal(split.features.filter(f => f.label.includes('dado')).length, side.features.filter(f => f.label.includes('dado')).length);
  // Outline is offset by the bit radius all round.
  const us = split.outlinePaths.flat().map(p => p[0]);
  const vs = split.outlinePaths.flat().map(p => p[1]);
  assert.ok(Math.abs(Math.min(...us) + BIT / 2) < 1e-9 && Math.abs(Math.max(...us) - side.length - BIT / 2) < 1e-9);
  assert.ok(Math.abs(Math.min(...vs) + BIT / 2) < 1e-9 && Math.abs(Math.max(...vs) - side.width - BIT / 2) < 1e-9);

  const svg = partSvg(split, 'in');
  assert.match(svg, /shaper:cutType="online"/);
  assert.doesNotMatch(svg, /shaper:cutType="outside"/);
  assert.match(svg, /<desc>PASS-THROUGH in 2 segments/);
  assert.match(svg, new RegExp(`width="${+(side.length + BIT).toFixed(4)}in"`));
  const dxf = partDxf(split, 'in');
  assert.match(dxf, /ONLINE_0\.500in/);
  assert.doesNotMatch(dxf, /OUTSIDE_/);
});

test('a part too wide to feed sideways says the other feed works', () => {
  const back = faces.find(f => f.piece === 'Back');
  assert.ok(back.width + BIT > reach.depth, 'the back is wider than the Workstation depth');
  const status = passThroughStatus(back, reach, BIT, 'sideways');
  assert.equal(status.kind, 'too-wide');
  const fb = passThroughStatus(back, reach, BIT, 'front-to-back');
  assert.equal(fb.kind, 'split');
  for (const [a, b] of fb.plan.windows) assert.ok(b - a + BIT / 2 <= reach.depth + 1e-9);
  // On the bench it goes sideways.
  assert.equal(passThroughStatus(back, BENCHPILOT_REACH.bench, BIT, 'sideways').kind, 'split');
});

test('too wide both ways cannot pass through', () => {
  assert.equal(passThroughSegments(reach, 40, 20, BIT), null);
});
