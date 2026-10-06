import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALEX_TAPER, autoSlideLength, buildDrawerPlan, DEFAULT_PULL, drawerSolids, pullProfile, readSavedDrawerDesign, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { drawerJigs, drawerPartFaces } from '../src/lib/drawerExport.ts';
import { formatLength } from '../src/lib/shelving.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);
// The ALEX 5-drawer, with the new defaults: inset fronts and the ALEX notch.
const alex = {
  thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125,
  pull: DEFAULT_PULL, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'none', footHeight: 0.5, casterHeight: 2,
};

test('inset fronts sit inside the case, flush, with the case showing around them', () => {
  const plan = buildDrawerPlan(alex);
  assert.deepEqual(plan.errors, []);
  for (const d of plan.drawers) {
    close(d.front.x, 0.75 + 0.0625, `${d.label} starts half a gap inside the side`);
    close(d.front.x + d.front.width, 14.125 - 0.75 - 0.0625);
    assert.ok(d.front.y >= 0.75 - 1e-9 && d.front.y + d.front.height <= 27.5 - 0.75 + 1e-9, 'between the top and bottom panels');
  }
  const total = plan.drawers.reduce((a, d) => a + d.front.height, 0) + 5 * 0.125 + 1.5;
  close(total, plan.caseHeight, 'fronts, gaps and the top and bottom panels fill the height');
  close(plan.caseDepth, 22.875, 'the case runs the full depth');
  assert.equal(plan.slideLength, autoSlideLength(22.875 - 0.25 - 0.75), 'slides fit behind the fronts');
  const solids = drawerSolids(plan, alex);
  const front = solids.find(s => s.name === 'Drawer 1 front');
  assert.equal(front.z0, 0);
  assert.equal(front.z1, 0.75, 'flush with the case front');
  const side = solids.find(s => s.name === 'Drawer 1 box left side');
  assert.ok(side.min[2] >= 0.75, 'boxes start behind the fronts');
  const slideLine = drawerPartFaces(plan, alex).find(x => x.piece === 'Left side').features.find(x => x.kind === 'guide');
  close(slideLine.points[0][1], 0.75, 'slides set back by the fronts');
  const setback = drawerJigs(plan, alex, i => formatLength(i, 'in')).find(j => j.face.id === 'slide-front-stop');
  assert.equal(setback.face.piece, 'Slide setback block');
  close(setback.face.length, 0.75);
});

test('inset fronts per front: the overall height adds the top and bottom panels', () => {
  const plan = buildDrawerPlan({ ...alex, drawers: 3, frontHeights: [5, 6, 7] });
  close(plan.overallHeight, 18 + 3 * 0.125 + 1.5);
  const cols = buildDrawerPlan({ ...alex, width: 30, drawers: 5, columns: [{ drawers: 2 }, { drawers: 3 }] });
  assert.deepEqual(cols.errors, []);
  const [left, right] = [cols.drawers.find(d => d.column === 0), cols.drawers.find(d => d.column === 1)];
  assert.ok(left.front.x + left.front.width <= cols.partitionXs[0] - 0.0625 + 1e-9, 'the partition shows between columns');
  close(right.front.x, cols.partitionXs[0] + 0.75 + 0.0625);
});

test('designs saved before inset fronts reopen as overlay; new ones keep their style', () => {
  const saved = JSON.parse(JSON.stringify(toSavedDrawerDesign(alex, 'in')));
  assert.equal(saved.config.frontStyle, 'inset');
  assert.equal(readSavedDrawerDesign(saved).config.frontStyle, 'inset');
  delete saved.config.frontStyle;
  assert.equal(readSavedDrawerDesign(saved).config.frontStyle, 'overlay');
});

test('the ALEX notch: a flat bottom across the middle and smooth curves into the top edge', () => {
  const w = 6.5;
  const d = 1.125;
  const pts = pullProfile({ shape: 'alex', width: w, depth: d });
  assert.deepEqual(pts[0], [-w / 2, -0]);
  close(pts.at(-1)[0], w / 2);
  close(pts.at(-1)[1], 0, 'meets the top edge');
  const flat = pts.filter(([x]) => Math.abs(x) <= (w / 2) * (1 - ALEX_TAPER) + 1e-9);
  assert.ok(flat.length > 2 && flat.every(([, y]) => Math.abs(y + d) < 1e-9), 'flat bottom');
  // Smooth: it leaves the top edge almost level (no sharp corner), unlike a circular arc.
  const [a, b] = [pts[0], pts[1]];
  assert.ok(Math.abs((b[1] - a[1]) / (b[0] - a[0])) < 0.15, 'tangent to the top edge at the ends');
  const arc = pullProfile({ shape: 'arc', width: w, depth: d });
  assert.ok(Math.abs((arc[1][1] - arc[0][1]) / (arc[1][0] - arc[0][0])) > 0.3, 'an arc starts steeply');
  // Never deeper than asked, and dips monotonically to the middle.
  for (let i = 1; i < pts.length / 2; i++) assert.ok(pts[i][1] <= pts[i - 1][1] + 1e-12);
  assert.ok(pts.every(([, y]) => y >= -d - 1e-9));
});
