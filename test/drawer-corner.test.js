import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDrawerPlan, DEFAULT_PULL, deskSolids, drawerSolids, readSavedDrawerDesign, runFootprint, runFootprintRects, runSolids, toSavedDrawerDesign } from '../src/lib/drawerUnit.ts';
import { drawerHardwareList } from '../src/lib/drawerEstimate.ts';
import { DEFAULT_BOOKCASE, bookcaseSolids, buildBookcase, shelvesForOpening } from '../src/lib/drawerBookcase.ts';
import { runFromFields, runToFields } from '../src/lib/drawerRun.ts';
import { drawerJigs, drawerPartFaces } from '../src/lib/drawerExport.ts';
import { drawerGuideSteps } from '../src/lib/drawerGuide.ts';
import { cabinetBox, defaultRoom, layoutIssues } from '../src/lib/builtinRoom.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const base = {
  frontStyle: 'inset',
  thickness: 0.75, width: 24, height: 30, depth: 24, drawers: 3, gap: 0.125,
  pull: { ...DEFAULT_PULL, enabled: false }, boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25,
  base: 'kick', footHeight: 0.5, casterHeight: 2,
};
const cornerRun = (corner = {}, patch = {}) => ({
  enabled: true, wallWidth: 100, leftEnd: 'open', rightEnd: 'wall', deskUppers: false,
  sections: [{ kind: 'cabinet' }, { kind: 'cabinet', mirror: true }],
  corner: { side: 'right', wallLength: 80, end: 'open', sections: [{ kind: 'cabinet' }], ...corner },
  ...patch,
});

test('a right-hand corner: bay at the corner, return past the corner filler, one more cabinet built', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun() });
  assert.deepEqual(p.errors, []);
  const r = p.run;
  // Open left end: the main run is its two cabinets plus the 24" corner bay.
  close(r.width, 24 + 24 + 24, 'main run width');
  assert.deepEqual(r.corner.bay, { x0: 48, x1: 72 });
  close(r.corner.start, 24 + 3, 'return starts past the main fronts and a 3" filler');
  close(r.corner.end, 27 + 24, 'return ends after its cabinet');
  assert.equal(r.cabinetCount, 3);
  assert.equal(p.parts.find(x => x.name === 'Side').qty, 6);
  for (const name of ['Return countertop', 'Corner ledger', 'Corner filler']) assert.ok(p.parts.some(x => x.name === name), name);
  assert.match(p.warnings.join(' '), /blind corner/);
});

test('the return is turned onto the side wall with its fronts facing the room', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun() });
  const solids = runSolids(p, { ...base, run: cornerRun() });
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  const W = p.run.width;
  const front = solids.find(s => s.name === 'Return cabinet 1 · Drawer 1 front');
  assert.equal(front.shape, 'prism', 'a turned front plate becomes a prism');
  // Inset fronts sit just inside the case front, which is cd in from the side wall.
  assert.ok(front.x1 <= W - 24 + 0.75 + 1e-6 && front.x0 >= W - 24 - 1e-6, `front at x ${front.x0}–${front.x1}`);
  const back = solids.find(s => s.name === 'Return cabinet 1 · Back');
  close(back.max[0], W, 'back against the side wall');
  // Return runs forward (negative z) from the main run's front.
  const box = cabinetBox(solids);
  close(box.minZ, 24 - 51 - 1, 'return reaches forward to its countertop’s open-end overhang');
  close(box.maxX, W, 'nothing past the side wall');
});

test('a left-hand corner mirrors it: bay at x 0, return against the left wall', () => {
  const run = cornerRun({ side: 'left' }, { leftEnd: 'wall', rightEnd: 'open' });
  const p = buildDrawerPlan({ ...base, run });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run.corner.bay, { x0: 0, x1: 24 });
  assert.deepEqual(p.run.sections.map(x => x.x), [24, 48]);
  const solids = runSolids(p, { ...base, run });
  const front = solids.find(s => s.name === 'Return cabinet 1 · Drawer 1 front');
  assert.ok(front.x0 >= 24 - 0.75 - 1e-6 && front.x1 <= 24 + 1e-6, `front faces the room at x ${front.x0}–${front.x1}`);
  assert.ok(cabinetBox(solids).minX >= -1e-6);
});

test('a corner desk: knee space on both legs meets in the corner; walls set the fillers', () => {
  const run = cornerRun({ end: 'wall', wallLength: 90, sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet', mirror: true }] },
    { leftEnd: 'wall', wallWidth: 90, sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }] });
  const p = buildDrawerPlan({ ...base, run });
  assert.deepEqual(p.errors, []);
  close(p.run.fillers[0].width, 90 - 24 - 30 - 24, 'one filler, at the far wall only');
  close(p.run.corner.filler.width, 90 - 27 - 30 - 24, 'return end filler');
  assert.ok(!p.warnings.some(w => /blind corner/.test(w)));
  assert.ok(p.parts.some(x => x.name === 'Return desk ledger'));
  const { steps } = drawerGuideSteps(p, { ...base, run }, 'in');
  assert.ok(steps.some(s => s.id === 'run-corner'));
});

test('a return too long for its wall is refused', () => {
  const p = buildDrawerPlan({ ...base, run: cornerRun({ end: 'wall', wallLength: 40 }) });
  assert.match(p.errors.join(' '), /return needs/);
});

test('the return carries its own uppers and trim', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 40, depth: 12, top: { ...DEFAULT_BOOKCASE.top, style: 'cap' } };
  const config = { ...base, bookcase, run: cornerRun() };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.ok(p.run.corner.cap, 'return cap');
  assert.ok(runSolids(p, config).some(s => s.name.startsWith('Return cabinet 1 · Bookcase')));
});

test('corner settings survive the form round trip', () => {
  const run = cornerRun({ sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet', mirror: true }] });
  const fields = runToFields(run, String);
  assert.equal(fields.corner.enabled, true);
  const back = runFromFields(fields, raw => Number(raw));
  assert.deepEqual(back.corner, { ...run.corner, wallLength: 0, style: 'open' });
  assert.equal(runFromFields({ ...fields, corner: { ...fields.corner, enabled: false } }, raw => Number(raw)).corner, undefined);
});

test('a peninsula desk: the attached end rests on a ledger', () => {
  const config = { ...base, height: 28.5, base: 'none', desk: { enabled: true, layout: 'left', width: 76, height: 30, depth: 30, topLayers: 2, openEnd: 'ledger' } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.equal(p.desk.openEnd.kind, 'ledger');
  close(p.desk.knee, 76 - 24 - 0.75, 'knee space');
  assert.ok(p.parts.some(x => x.name === 'Desk end ledger'));
  const ledger = deskSolids(p, config).find(s => s.name === 'Desk end ledger');
  close(ledger.max[0], 76, 'at the right end');
});

test('an all-door wall cabinet needs no slide depth and makes no drawer jigs', () => {
  const config = { ...base, width: 30, depth: 12, drawers: 1, base: 'none', mount: 'wall', mountHeight: 54, cleatHeight: 3, doors: [{ hinge: 'auto', inside: 'shelves', count: 2 }] };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const jigs = drawerJigs(p, config, String);
  assert.ok(jigs.every(j => j.face), 'every jig has a face');
  assert.ok(!jigs.some(j => j.stage === 'slides' || j.stage === 'boxes'));
});

test('the layout plan gets the L, inside the 3D model’s box', () => {
  for (const side of ['right', 'left']) {
    const run = cornerRun({ side }, side === 'left' ? { leftEnd: 'wall', rightEnd: 'open' } : {});
    const p = buildDrawerPlan({ ...base, run });
    const outline = runFootprint(p);
    assert.equal(outline.length, 6, side);
    const box = cabinetBox(runSolids(p, { ...base, run }));
    for (const [x, z] of outline) assert.ok(x >= box.minX - 1e-6 && x <= box.maxX + 1e-6 && z >= box.minZ - 1e-6 && z <= box.maxZ + 1e-6, `${side} ${x},${z}`);
  }
  assert.equal(runFootprint(buildDrawerPlan(base)), null);
});

const blindBase = (blind = { side: 'right', width: 27 }, patch = {}) => ({
  ...base, width: 18, drawers: 2, frontHeights: [6, 23.75],
  doors: [null, { hinge: 'auto', inside: 'shelves', count: 1 }], blind, ...patch,
});

test('a blind corner cabinet: the case runs on into the corner, the drawer hangs from a slide panel', () => {
  const config = blindBase();
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  close(p.blind.totalWidth, 45, 'overall');
  const part = n => p.parts.find(x => x.name === n);
  assert.equal(part('Side').qty, 1);
  assert.equal(part('End side').qty, 1);
  close(part('Top').length, 18 - 1.5 + 27, 'top runs into the corner');
  assert.ok(part('Slide panel') && part('Blind panel'));
  close(part('Door shelf').length, p.columns[0].width + 27 - 1 / 16, 'shelf runs into the blind side');
  // The door hinges away from the blind side.
  assert.equal(p.drawers[1].door.leaves[0].hinge, 'left');
  const solids = drawerSolids(p, config);
  assert.ok(!solids.some(s => s.name === 'Right side'));
  close(cabinetBox(solids).maxX, 45, 'end side at 45');
  const slide = solids.find(s => s.name === 'Slide panel');
  assert.ok(slide.min[1] > p.drawers[1].front.y + p.drawers[1].front.height - 1, 'slide panel stops above the door');
});

test('a left blind side moves the opening right; the guide and export know the new parts', () => {
  const config = blindBase({ side: 'left', width: 27 });
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.equal(p.drawers[1].door.leaves[0].hinge, 'right');
  const box = cabinetBox(drawerSolids(p, config));
  close(box.minX, 0, 'blind end at 0');
  close(box.maxX, 45, 'opening at the right');
  const { steps } = drawerGuideSteps(p, config, 'in');
  assert.ok(steps.some(s => s.id === 'blind-panel'));
  const faces = drawerPartFaces(p, config);
  assert.ok(faces.some(f => f.piece === 'End side') && faces.some(f => f.piece === 'Slide panel'));
  assert.ok(!faces.some(f => f.piece === 'Left side'), 'no side on the blind side');
});

test('a blind cabinet must open into the corner, and its door can’t hinge on the blind side', () => {
  assert.match(buildDrawerPlan(blindBase(undefined, { doors: [null, null] })).errors.join(' '), /opens into the blind corner/);
  assert.match(buildDrawerPlan(blindBase(undefined, { doors: [null, { hinge: 'right', inside: 'empty', count: 0 }] })).errors.join(' '), /hinges on the right, the blind side/);
  assert.match(buildDrawerPlan(blindBase(undefined, { doors: [{ hinge: 'left', inside: 'empty', count: 0 }, null] })).errors.join(' '), /drawers at the top/);
  assert.match(buildDrawerPlan(blindBase(undefined, { base: 'feet' })).errors.join(' '), /toe kick/);
});

test('a blind corner in a wall run: the cabinet beside the corner runs on through the bay, under the run countertop', () => {
  const config = { ...blindBase(undefined), blind: undefined, run: cornerRun({ style: 'blind' }, { sections: [{ kind: 'cabinet' }, { kind: 'cabinet' }] }) };
  config.width = 18;
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const cn = p.run.corner;
  assert.equal(cn.style, 'blind');
  assert.equal(cn.blindSection, 1);
  assert.ok(!p.parts.some(x => x.name === 'Corner ledger'), 'no ledgers under a blind corner');
  assert.ok(p.parts.some(x => x.name === 'End side') && p.parts.some(x => x.name === 'Blind panel'));
  assert.ok(!p.warnings.some(w => /dead space/.test(w)));
  // One fewer full-height side: two plain cabinets and a return keep theirs, the blind one has one plus its end side.
  assert.equal(p.parts.find(x => x.name === 'Side').qty, 5);
  const solids = runSolids(p, config);
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  const end = solids.find(s => s.name === 'Cabinet 2 · End side');
  assert.ok(end, 'the blind cabinet is drawn');
  const xs = end.shape === 'prism' ? [end.x0, end.x1] : [end.min[0], end.max[0]];
  close(Math.max(...xs), p.run.width, 'end side against the side wall');
  assert.ok(!solids.some(s => s.name.startsWith('Corner ledger')));
  assert.ok(solids.some(s => s.name === 'Run countertop'));
});

test('a blind run corner needs a cabinet beside the corner, and the cabinet must open into it', () => {
  const noCab = buildDrawerPlan({ ...base, run: cornerRun({ style: 'blind' }, { sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }] }) });
  assert.match(noCab.errors.join(' '), /make the last section of the main run a cabinet/);
  // A blind corner is one full-height door, whatever the design's fronts, so nothing blocks the corner.
  const config = { ...base, run: cornerRun({ style: 'blind' }) };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const blindSolids = runSolids(p, config).filter(x => x.name.startsWith('Cabinet 2 · '));
  assert.ok(blindSolids.some(x => x.name === 'Cabinet 2 · Door 1'), 'one door');
  assert.ok(!blindSolids.some(x => /Drawer \d+ front/.test(x.name)), 'no drawers');
  assert.ok(blindSolids.some(x => x.name === 'Cabinet 2 · End side'));
});

test('doors swing on their hinge line: unit doors, bookcase doors, mirrored and turned copies', () => {
  const config = blindBase();
  const p = buildDrawerPlan(config);
  const door = drawerSolids(p, config).filter(s => s.kind === 'door');
  assert.ok(door.length && door.every(s => s.group === 'Door 2' && s.swing), 'every door part shares the leaf’s group and swing');
  // Hinged left (away from the blind side): pivot on the left edge, swinging the free edge toward the viewer.
  assert.ok(door[0].swing.angle < 0);
  close(door[0].swing.pivot[0], p.drawers[1].door.leaves[0].x, 'pivot on the hinge edge');

  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 40, depth: 12, bays: 2, doors: [true, true] };
  const withUpper = { ...base, drawers: 2, doors: [null, { hinge: 'left', inside: 'empty', count: 0 }], bookcase };
  const up = drawerSolids(buildDrawerPlan(withUpper), withUpper).filter(s => s.kind === 'door' && /^Bookcase/.test(s.name));
  assert.ok(up.length && up.every(s => s.swing && s.group), 'bookcase doors swing too');
  assert.ok(up.every(s => s.swing.angle < 0), 'single bookcase doors hinge on the left');

  // A mirrored copy in a run swings the other way; a turned return keeps the direction.
  const runConfig = { ...base, drawers: 2, doors: [null, { hinge: 'left', inside: 'empty', count: 0 }],
    run: { enabled: true, wallWidth: 0, leftEnd: 'open', rightEnd: 'open', deskUppers: false, sections: [{ kind: 'cabinet' }, { kind: 'cabinet', mirror: true }] } };
  const rp = buildDrawerPlan(runConfig);
  const rs = runSolids(rp, runConfig);
  const a = rs.find(s => s.name === 'Cabinet 1 · Door 2');
  const b = rs.find(s => s.name === 'Cabinet 2 · Door 2');
  assert.ok(a.swing.angle < 0 && b.swing.angle > 0);
  const leaf = rp.drawers[1].door.leaves[0];
  close(a.swing.pivot[0], leaf.x, 'pivot on the hinge edge');
  close(b.swing.pivot[0], 24 + (24 - leaf.x), 'mirrored pivot on the mirrored hinge edge');
});

test('the layout check sees a corner piece’s L, not its box', () => {
  const config = { ...base, run: cornerRun() };
  const p = buildDrawerPlan(config);
  const box = cabinetBox(runSolids(p, config));
  const pieces = runFootprintRects(p);
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  const room = { ...defaultRoom('in'), width: 200, depth: 200, height: 108, openings: [] };
  const L = { id: 1, label: 'Corner', placement: { x: w / 2, y: d / 2, rotation: 0 }, box, wallHung: false, pieces };
  const small = { minX: 0, maxX: 10, minY: 0, maxY: 30, minZ: 0, maxZ: 10 };
  // Inside the L (in front of the main run, left of the return): clear.
  const inside = { id: 2, label: 'Stool', placement: { x: 8, y: d - 8, rotation: 0 }, box: small, wallHung: false };
  assert.ok(!layoutIssues(room, [L, inside]).some(i => /overlap/.test(i.message)), 'nothing overlaps inside the L');
  // Without the pieces the box would say it does.
  assert.ok(layoutIssues(room, [{ ...L, pieces: null }, inside]).some(i => /overlap/.test(i.message)));
  // On the return's arm it still overlaps.
  const onArm = { ...inside, placement: { x: w - 8, y: d - 8, rotation: 0 } };
  assert.ok(layoutIssues(room, [L, onArm]).some(i => /overlap/.test(i.message)));
});

test('a corner run with uppers closes the corner: an upper over the corner square and one on the side wall', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 40, depth: 12, top: { ...DEFAULT_BOOKCASE.top, style: 'cap' } };
  const config = { ...base, bookcase, run: cornerRun() };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const cn = p.run.corner;
  assert.ok(cn.cornerUpper, 'corner upper');
  // Set back a side's thickness: its own side there is left off, so its shelves start at 12″, against the corner upper's.
  assert.deepEqual([cn.returnUpper.x0, cn.returnUpper.x1], [12 - 0.75, cn.start], 'side-wall upper from the main uppers’ front to the return');
  assert.equal(cn.cornerUpper.config.bays, 1, 'one open bay at the corner');
  close(p.run.cap.x1, p.run.width, 'main cap runs over the corner');
  close(cn.cap.x0, 12 - 0.75, 'return cap starts where the side-wall upper does');
  assert.ok(p.parts.some(x => x.name.startsWith('Corner upper ')) && p.parts.some(x => x.name.startsWith('Corner side upper ')));
  const solids = runSolids(p, config);
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  const up = solids.filter(s => s.name.startsWith('Corner upper · '));
  const side = solids.filter(s => s.name.startsWith('Corner side upper · '));
  assert.ok(up.length && side.length);
  const ub = cabinetBox(up);
  close(ub.maxX, p.run.width, 'corner upper reaches the side wall');
  const sb = cabinetBox(side);
  assert.ok(sb.minX >= p.run.width - 12 - 1e-6, 'side-wall upper stays 12″ deep off the side wall');
  const shelves = cabinetBox(side.filter(s => s.kind === 'shelf' || s.kind === 'adjustable'));
  close(shelves.maxZ, 24 - 12, 'its shelves start right at the main uppers’ front, meeting the corner upper’s');
  // Open at the corner: no side there, a slim post and a back strip instead.
  assert.ok(!side.some(s => s.name === 'Corner side upper · Bookcase left side'));
  assert.ok(solids.some(s => s.name === 'Corner shelf post') && solids.some(s => s.name === 'Corner shelf strip'));
  assert.equal(p.parts.find(x => x.name === 'Corner side upper side').qty, 1);
  assert.equal(p.parts.find(x => x.name === 'Corner shelf strip').qty, 2);
  const faces = drawerPartFaces(p, config);
  assert.ok(faces.some(f => f.part.startsWith('Corner side upper ')));
});

test('a run can mix cabinets: its own width and fronts, with an upper of that width', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 40, depth: 12, bays: 2 };
  const config = { ...base, drawers: 3, bookcase, run: { enabled: true, wallWidth: 0, leftEnd: 'open', rightEnd: 'open', deskUppers: false,
    sections: [{ kind: 'cabinet' }, { kind: 'cabinet', cabinet: { width: 30, layout: 'door' } }, { kind: 'cabinet', mirror: true, cabinet: { layout: 'drawer-door' } }] } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run.sections.map(s => s.width), [24, 30, 24]);
  close(p.run.width, 78, 'run width from the cabinets’ own widths');
  assert.ok(p.run.sections[1].upper, 'the 30″ cabinet gets a 30″ upper');
  assert.ok(!p.run.sections[0].upper && !p.run.sections[2].upper);
  // Parts: one plain cabinet's drawers plus the drawer-over-door cabinet's one drawer.
  const fronts = p.parts.filter(x => /drawer front/i.test(x.name)).reduce((a, x) => a + x.qty, 0);
  assert.equal(fronts, 3 + 1);
  assert.ok(p.parts.some(x => x.name.startsWith('Cabinet 2 upper ')));
  const solids = runSolids(p, config);
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  assert.ok(solids.some(s => s.name === 'Cabinet 2 · Door 1 left leaf'), 'a 30″ door is a pair');
  assert.ok(solids.some(s => s.name === 'Cabinet 3 · Door 2') && solids.some(s => s.name === 'Cabinet 3 · Drawer 1 front'));
  // The mirrored drawer-over-door cabinet hinges its door the other way.
  assert.ok(solids.find(s => s.name === 'Cabinet 3 · Door 2').swing.angle > 0);
  const { steps } = drawerGuideSteps(p, config, 'in');
  assert.ok(steps.length);
  assert.ok(drawerPartFaces(p, config).some(f => f.part.startsWith('Cabinet 2 upper ')));
});

test('a cabinet’s own layout and width survive saving and the form', () => {
  const run = { enabled: true, wallWidth: 0, leftEnd: 'open', rightEnd: 'open', deskUppers: true,
    sections: [{ kind: 'cabinet', mirror: false, cabinet: { width: 30, layout: 'drawers', drawers: 5 } }] };
  const fields = runToFields(run, String);
  assert.equal(fields.sections[0].cabinetLayout, 'drawers');
  assert.deepEqual(runFromFields(fields, raw => Number(raw)).sections[0].cabinet, { width: 30, layout: 'drawers', drawers: 5 });
});

test('shelf presets fit as many shelves as clear the item', () => {
  // 70″ bookcase with 24″ open below: 44 1/2″ of shelf space, 9″ spool openings.
  const fit = shelvesForOpening(70, 24, 0.75, 9);
  assert.deepEqual([fit.fixed, fit.adjustable], [1, 2]);
  assert.ok(fit.each >= 9, `openings ${fit.each}`);
  assert.deepEqual(shelvesForOpening(30, 0, 0.75, 11), { fixed: 0, adjustable: 1, each: (30 - 1.5 - 0.75) / 2 });
});

test('display options: lips on the shelves, lights under them, a pegboard in the open space', () => {
  const bk = { ...DEFAULT_BOOKCASE, enabled: true, height: 48, depth: 10, bays: 2, shelvesPerBay: 1, adjustablePerBay: 1, openBelow: 18, lips: true, pegboard: true, shelfLights: true };
  const config = { ...base, bookcase: bk };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const part = n => p.parts.find(x => x.name === n);
  assert.equal(part('Shelf lip').qty, 2 * 2, 'every shelf in both bays');
  assert.equal(part('Bottom lip').qty, 1);
  assert.equal(part('Light rail').qty, 2 * 2);
  assert.equal(part('Top light rail').qty, 1);
  assert.equal(part('Pegboard spacer').qty, 4);
  const solids = drawerSolids(p, config);
  assert.equal(solids.filter(s => / lip$/.test(s.name)).length, 5);
  assert.ok(solids.some(s => s.name === 'Pegboard'));
  assert.equal(new Set(solids.map(s => s.name)).size, solids.length, 'names unique');
  // A pegboard needs the open space.
  assert.match(buildDrawerPlan({ ...config, bookcase: { ...bk, openBelow: 0 } }).errors.join(' '), /open space/);
});

test('cord grommets in a desk top and a run countertop, outlet cutouts in a back and a backsplash', () => {
  const desk = { ...base, height: 28.5, base: 'none', desk: { enabled: true, layout: 'left', width: 76, height: 30, depth: 30, topLayers: 2, openEnd: 'ledger', grommets: 2 } };
  const dp = buildDrawerPlan(desk);
  assert.deepEqual(dp.errors, []);
  assert.equal(dp.desk.grommets.length, 2);
  assert.ok(dp.desk.grommets.every(g => g.x > 24 && g.x < 76), 'over the knee space');
  assert.match(dp.parts.find(x => x.name === 'Desk top').note, /2 × 2" cord grommet holes/);
  assert.equal(drawerPartFaces(dp, desk).find(f => f.piece === 'Desk top').features.length, 2);

  const runCfg = { ...base, run: cornerRun({ sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet' }] }, { grommets: true, sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }] }) };
  const rp = buildDrawerPlan(runCfg);
  assert.deepEqual(rp.errors, []);
  assert.equal(rp.run.grommets.length, 1);
  close(rp.run.grommets[0].x, 24 + 15, 'centred over the desk gap');
  assert.equal(rp.run.corner.grommets.length, 1);
  const rs = runSolids(rp, runCfg);
  assert.ok(rs.some(s => s.name === 'Run grommet 1') && rs.some(s => s.name === 'Return grommet 1'));

  const withOutlet = { ...base, outlet: { height: 12 } };
  const op = buildDrawerPlan(withOutlet);
  assert.deepEqual(op.errors, []);
  assert.match(op.parts.find(x => x.name === 'Back').note, /outlet cutout/);
  const back = drawerPartFaces(op, withOutlet).find(f => f.piece === 'Back');
  assert.equal(back.features[0].kind, 'cutout');
  assert.match(buildDrawerPlan({ ...base, outlet: { height: 60 } }).errors.join(' '), /misses the back/);

  const splash = buildDrawerPlan({ ...base, bookcase: { ...DEFAULT_BOOKCASE, enabled: true, openBelow: 18, outlet: true } });
  assert.deepEqual(splash.errors, []);
  assert.ok(splash.bookcase.outlet);
});

test('an ALEX notch on the drawers and a knob on the doors', () => {
  const config = { ...blindBase(), pull: { ...DEFAULT_PULL, enabled: true }, doorHardware: { kind: 'knob', spacing: 0 } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const solids = drawerSolids(p, config);
  // The drawer front keeps the notch: its outline dips below the top edge.
  const front = solids.find(s => s.name === 'Drawer 1 front');
  const top = p.drawers[0].front.y + p.drawers[0].front.height;
  assert.ok(front.outline.some(([, y]) => y < top - 0.5), 'drawer notch');
  // The door has a knob and no notch.
  const door = solids.find(s => s.name === 'Door 2');
  const doorTop = p.drawers[1].front.y + p.drawers[1].front.height;
  assert.ok(door.outline.every(([, y]) => y > doorTop - 1e-6 || y < p.drawers[1].front.y + 1e-6), 'no notch on the door');
  assert.ok(solids.some(s => s.kind === 'pin' && /^Door 2 .*knob/i.test(s.name)), 'a knob on the door');
  // One knob to buy; the CNC door face has its hole and no notch outline.
  const knobs = drawerHardwareList(p, config, 'in').find(i => /knob/i.test(i.name));
  assert.equal(knobs.qty, 1);
  const face = drawerPartFaces(p, config).find(f => f.part.startsWith('Door, hinged'));
  assert.equal(face.outline, undefined);
  assert.ok(face.features.some(f => f.kind === 'hole' && /Pull hole/.test(f.label)));
  // Saved and read back.
  const back = readSavedDrawerDesign(JSON.parse(JSON.stringify(toSavedDrawerDesign(config, 'in'))));
  assert.equal(back.config.doorHardware.kind, 'knob');
});

test('return cabinets can have their own fronts and width', () => {
  const config = { ...base, run: cornerRun({ sections: [{ kind: 'cabinet', cabinet: { layout: 'drawers', drawers: 5, width: 30 } }] }) };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  close(p.run.corner.sections[0].width, 30, 'its own width');
  const fronts = runSolids(p, config).filter(x => /^Return cabinet 1 · Drawer \d+ front$/.test(x.name));
  assert.equal(fronts.length, 5);
  const fields = runToFields(config.run, String);
  assert.equal(fields.corner.sections[0].cabinetLayout, 'drawers');
  assert.deepEqual(runFromFields(fields, raw => Number(raw)).corner.sections[0].cabinet, { width: 30, layout: 'drawers', drawers: 5 });
});

test('uppers can hang on the wall: no sides down to the counter, a hanging rail, trimmed CNC sides', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 60, depth: 12, bays: 2, openBelow: 18, floating: true };
  const config = { ...base, bookcase };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const standing = buildDrawerPlan({ ...config, bookcase: { ...bookcase, floating: false } });
  const side = n => p.parts.find(x => x.name === n);
  close(side('Bookcase side').length, standing.parts.find(x => x.name === 'Bookcase side').length - 18, 'sides stop 18″ up');
  assert.ok(side('Bookcase hanging rail'));
  const solids = drawerSolids(p, config);
  const left = solids.find(s => s.name === 'Bookcase left side');
  const bottom = left.shape === 'box' ? left.min[1] : Math.min(...left.profile.map(q => q[1]));
  close(bottom, p.bookcase.y0 + 18, 'nothing in the open space');
  const faces = drawerPartFaces(p, config).filter(f => f.part === 'Bookcase side');
  assert.ok(faces.length && faces.every(f => f.features.every(x => x.kind !== 'hole' || x.u >= 0)));
});

test('a run cabinet can be laid out position by position', () => {
  const config = { ...base, run: { enabled: true, wallWidth: 0, leftEnd: 'open', rightEnd: 'open', deskUppers: false,
    sections: [{ kind: 'cabinet', cabinet: { layout: 'custom', positions: ['drawer', 'open', 'door'] } }] } };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const solids = runSolids(p, config);
  assert.ok(solids.some(s => s.name === 'Cabinet 1 · Drawer 1 front'));
  assert.ok(solids.some(s => s.name === 'Cabinet 1 · Door 3'));
  assert.ok(!solids.some(s => s.name === 'Cabinet 1 · Drawer 2 front'), 'the middle is open');
  const fields = runToFields(config.run, String);
  assert.deepEqual(fields.sections[0].cabinetPositions, ['drawer', 'open', 'door']);
  assert.deepEqual(runFromFields(fields, raw => Number(raw)).sections[0].cabinet, { layout: 'custom', positions: ['drawer', 'open', 'door'] });
});

test('a joint between uppers can be opened above the counter, leaving the others', () => {
  const bookcase = { ...DEFAULT_BOOKCASE, enabled: true, height: 60, depth: 12, bays: 2, openBelow: 18 };
  const run = { enabled: true, wallWidth: 0, leftEnd: 'open', rightEnd: 'open', deskUppers: false,
    sections: [{ kind: 'cabinet' }, { kind: 'cabinet' }, { kind: 'cabinet' }], openJoints: [0] };
  const config = { ...base, bookcase, run };
  const p = buildDrawerPlan(config);
  assert.deepEqual(p.errors, []);
  const solids = runSolids(p, config);
  const bottom = n => { const s = solids.find(x => x.name === n); return s.min[1]; };
  const floor = p.bookcase.y0;
  assert.ok(bottom('Cabinet 1 · Bookcase right side') > floor + 17, 'cabinet 1 right side stops above the counter');
  assert.ok(bottom('Cabinet 2 · Bookcase left side') > floor + 17, 'cabinet 2 left side too');
  close(bottom('Cabinet 2 · Bookcase right side'), floor, 'the joint with cabinet 3 keeps its side');
  close(bottom('Cabinet 1 · Bookcase left side'), floor, 'the outer side keeps it');
  assert.equal(p.parts.find(x => x.name === 'Bookcase side, short').qty, 2);
  assert.equal(p.parts.find(x => x.name === 'Bookcase side').qty, 4);
  assert.ok(drawerPartFaces(p, config).some(f => f.part === 'Bookcase side, short'));
});
