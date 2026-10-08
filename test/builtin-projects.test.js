import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  autoPlace, cabinetBox, clampPlacement, defaultRoom, frontLine, layoutIssues, modelToPlan, newOpening, nextRotation,
  placedRect, readRoom, roomProblems, snapPlacement, wallPieces, WALL_THICKNESS,
} from '../src/lib/builtinRoom.ts';
import { buildDrawerPlan, drawerSolids, readSavedDrawerDesign } from '../src/lib/drawerUnit.ts';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-builtin-projects-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'builtin-projects-test-secret-at-least-thirty-two-bytes';
process.env.APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
process.env.DB_PATH = join(tempRoot, 'legacy.db');
process.env.USERS_DIR = join(tempRoot, 'users');
process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

const api = await import('../server.js');
const USER_A = '55555555-5555-4555-8555-555555555555';
const USER_B = '66666666-6666-4666-8666-666666666666';
const tokens = new Map();
let server;
let baseUrl;

before(async () => {
  for (const user of [USER_A, USER_B]) {
    api.getUserDb(user);
    tokens.set(user, (await api.mintSession(user)).accessToken);
  }
  server = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  api.closeAllDatabases();
  rmSync(tempRoot, { recursive: true, force: true });
});

function request(path, { user = USER_A, body, method = 'GET', headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokens.get(user)}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const design = {
  version: 1, kind: 'drawer-unit', units: 'in', heightMode: 'overall',
  config: { thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5 },
};

async function saveDesign(name, user = USER_A) {
  const res = await request('/api/drawer-designs', { user, method: 'POST', body: { name, design } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

async function createProject(name = 'Pantry', user = USER_A) {
  const res = await request('/api/builtin-projects', { user, method: 'POST', body: { name } });
  assert.equal(res.status, 201);
  return res.json();
}

const room = {
  version: 1, units: 'in', width: 96, depth: 30, height: 96,
  walls: { north: true, east: true, south: false, west: true },
  openings: [{ id: 'w1', kind: 'window', wall: 'north', offset: 30, width: 36, height: 40, sill: 42 }],
};

// ── API ─────────────────────────────────────────────────────────────────────

test('a built-in project groups saved designs, holds a room and keeps a layout', async () => {
  const designId = await saveDesign('Base drawers');
  const project = await createProject('  Pantry cubby ');
  assert.equal(project.name, 'Pantry cubby');
  assert.equal(project.room, null);
  assert.deepEqual(project.cabinets, []);

  const add = async () => {
    const res = await request(`/api/builtin-projects/${project.id}/cabinets`, { method: 'POST', body: { design_id: designId } });
    assert.equal(res.status, 201);
    return res.json();
  };
  const first = await add();
  const second = await add();
  assert.equal(first.design.name, 'Base drawers');
  assert.deepEqual(first.design.design, design);
  assert.equal(first.placement, null);

  const saved = await request(`/api/builtin-projects/${project.id}`, { method: 'PUT', body: { room } });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).room, room);

  const layout = await request(`/api/builtin-projects/${project.id}/layout`, {
    method: 'PUT',
    body: { placements: [{ id: first.id, placement: { x: 10, y: 12, rotation: 0 } }, { id: second.id, placement: { x: 80, y: 12, rotation: 90 } }] },
  });
  assert.equal(layout.status, 200);
  const body = await layout.json();
  assert.deepEqual(body.cabinets.map(c => c.placement), [{ x: 10, y: 12, rotation: 0 }, { x: 80, y: 12, rotation: 90 }]);

  const relabel = await request(`/api/builtin-projects/${project.id}/cabinets/${second.id}`, { method: 'PUT', body: { label: ' Left of window ', placement: null } });
  assert.equal(relabel.status, 200);
  const relabelled = await relabel.json();
  assert.equal(relabelled.label, 'Left of window');
  assert.equal(relabelled.placement, null);

  const list = await (await request('/api/builtin-projects')).json();
  const summary = list.find(p => p.id === project.id);
  assert.equal(summary.has_room, true);
  assert.equal(summary.cabinet_count, 2);
  assert.equal(summary.placed_count, 1);

  // Removing the room keeps the placements; the cabinets just wait for a room.
  await request(`/api/builtin-projects/${project.id}`, { method: 'PUT', body: { room: null } });
  const reread = await (await request(`/api/builtin-projects/${project.id}`)).json();
  assert.equal(reread.room, null);
  assert.deepEqual(reread.cabinets[0].placement, { x: 10, y: 12, rotation: 0 });

  assert.equal((await request(`/api/builtin-projects/${project.id}/cabinets/${first.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await request(`/api/builtin-projects/${project.id}`)).json()).cabinets.length, 1);
  assert.equal((await request(`/api/builtin-projects/${project.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/builtin-projects/${project.id}`)).status, 404);
});

test('editing a saved design shows in every project, and deleting it takes its cabinets out', async () => {
  const designId = await saveDesign('Tall');
  const a = await createProject('Kitchen');
  const b = await createProject('Garage');
  for (const p of [a, b]) await request(`/api/builtin-projects/${p.id}/cabinets`, { method: 'POST', body: { design_id: designId } });
  await request(`/api/drawer-designs/${designId}`, { method: 'PUT', body: { name: 'Tall pantry' } });
  for (const p of [a, b]) {
    const read = await (await request(`/api/builtin-projects/${p.id}`)).json();
    assert.equal(read.cabinets[0].design.name, 'Tall pantry');
  }
  await request(`/api/drawer-designs/${designId}`, { method: 'DELETE' });
  for (const p of [a, b]) assert.deepEqual((await (await request(`/api/builtin-projects/${p.id}`)).json()).cabinets, []);
});

test('built-in project input is checked', async () => {
  const designId = await saveDesign('Checked');
  const project = await createProject('Checks');
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 7 }]) {
    assert.equal((await request('/api/builtin-projects', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  const badRooms = [
    'room', [], { ...room, width: 6 }, { ...room, depth: 5000 }, { ...room, height: 12 },
    { ...room, walls: { north: false, east: false, south: false, west: false } },
    { ...room, walls: { north: true } },
    { ...room, openings: 'none' },
    { ...room, openings: [{ kind: 'skylight', wall: 'north', offset: 0, width: 10, height: 10 }] },
    { ...room, openings: [{ kind: 'door', wall: 'north', offset: -1, width: 30, height: 80 }] },
  ];
  for (const r of badRooms) {
    assert.equal((await request(`/api/builtin-projects/${project.id}`, { method: 'PUT', body: { room: r } })).status, 400, JSON.stringify(r));
  }
  const huge = { ...room, openings: [{ ...room.openings[0], note: 'x'.repeat(31_000) }] };
  assert.equal((await request(`/api/builtin-projects/${project.id}`, { method: 'PUT', body: { room: huge } })).status, 413);

  assert.equal((await request(`/api/builtin-projects/${project.id}/cabinets`, { method: 'POST', body: { design_id: 999999 } })).status, 400);
  assert.equal((await request(`/api/builtin-projects/${project.id}/cabinets`, { method: 'POST', body: { design_id: designId, label: 'x'.repeat(121) } })).status, 400);
  assert.equal((await request('/api/builtin-projects/999999/cabinets', { method: 'POST', body: { design_id: designId } })).status, 404);
  const cabinet = await (await request(`/api/builtin-projects/${project.id}/cabinets`, { method: 'POST', body: { design_id: designId } })).json();

  for (const placement of [{ x: 1, y: 1, rotation: 45 }, { x: 'a', y: 1, rotation: 0 }, { x: 1e9, y: 1, rotation: 0 }, [1, 2]]) {
    assert.equal((await request(`/api/builtin-projects/${project.id}/cabinets/${cabinet.id}`, { method: 'PUT', body: { placement } })).status, 400, JSON.stringify(placement));
    assert.equal((await request(`/api/builtin-projects/${project.id}/layout`, { method: 'PUT', body: { placements: [{ id: cabinet.id, placement }] } })).status, 400);
  }
  assert.equal((await request(`/api/builtin-projects/${project.id}/layout`, { method: 'PUT', body: { placements: 'all' } })).status, 400);
  assert.equal((await request(`/api/builtin-projects/${project.id}/layout`, { method: 'PUT', body: { placements: [{ placement: null }] } })).status, 400);

  // A cabinet only answers to its own project.
  const other = await createProject('Other');
  assert.equal((await request(`/api/builtin-projects/${other.id}/cabinets/${cabinet.id}`, { method: 'PUT', body: { label: 'Stolen' } })).status, 404);
  assert.equal((await request(`/api/builtin-projects/${other.id}/cabinets/${cabinet.id}`, { method: 'DELETE' })).status, 404);
  const stray = await request(`/api/builtin-projects/${other.id}/layout`, { method: 'PUT', body: { placements: [{ id: cabinet.id, placement: { x: 1, y: 1, rotation: 0 } }] } });
  assert.equal(stray.status, 200, 'unknown ids are skipped, not applied');
  const mine = await (await request(`/api/builtin-projects/${project.id}`)).json();
  assert.equal(mine.cabinets[0].placement, null);
  assert.equal(mine.cabinets[0].label, '');
});

test('built-in projects stay with their owner', async () => {
  const project = await createProject('Private');
  assert.equal((await request(`/api/builtin-projects/${project.id}`, { user: USER_B })).status, 404);
  assert.equal((await request(`/api/builtin-projects/${project.id}`, { user: USER_B, method: 'DELETE' })).status, 404);
  assert.ok(!(await (await request('/api/builtin-projects', { user: USER_B })).json()).some(p => p.name === 'Private'));
  assert.equal((await request('/api/builtin-projects', { user: null })).status, 401);
});

test('demo mode can read built-in projects but not change them', async () => {
  const { default: Database } = await import('better-sqlite3');
  const seed = new Database(process.env.SEED_DB_PATH);
  api.initSchema(seed);
  seed.close();
  const list = await request('/api/builtin-projects', { user: null, headers: { 'X-Demo': '1' } });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), []);
  const write = await request('/api/builtin-projects', { user: null, method: 'POST', body: { name: 'Demo' }, headers: { 'X-Demo': '1' } });
  assert.equal(write.status, 403);
});

// ── Room geometry ───────────────────────────────────────────────────────────

const box = { minX: 0, maxX: 30, minY: 0, maxY: 34.5, minZ: 0, maxZ: 24 };

test('rooms are read strictly and explain what is wrong with them', () => {
  assert.equal(readRoom(null), null);
  assert.equal(readRoom({ width: 'wide' }), null);
  const read = readRoom({ ...room, units: 'cubits', walls: { north: 'yes', east: true }, openings: [...room.openings, { kind: 'portal', wall: 'north', offset: 0, width: 1, height: 1 }] });
  assert.equal(read.units, 'in');
  assert.deepEqual(read.walls, { north: false, east: true, south: false, west: false });
  assert.equal(read.openings.length, 1);

  assert.deepEqual(roomProblems(defaultRoom()), []);
  assert.deepEqual(roomProblems(readRoom(room)), []);
  const r = defaultRoom();
  assert.match(roomProblems({ ...r, walls: { north: false, east: false, south: false, west: false } }).join(' '), /at least one wall/);
  assert.match(roomProblems({ ...r, width: 6 }).join(' '), /width/);
  const door = newOpening('door', 'north', r, 'd');
  assert.match(roomProblems({ ...r, openings: [{ ...door, offset: 130 }] }).join(' '), /runs past the end/);
  assert.match(roomProblems({ ...r, openings: [door, { ...door, id: 'd2', offset: door.offset + 4 }] }).join(' '), /overlap/);
  assert.match(roomProblems({ ...r, walls: { ...r.walls, north: false }, openings: [door] }).join(' '), /turned off/);
  const win = newOpening('window', 'east', r, 'w');
  assert.match(roomProblems({ ...r, openings: [{ ...win, sill: 60 }] }).join(' '), /taller than the wall/);
});

test('rotations map the cabinet front to the right side of its footprint', () => {
  const at = (rotation) => ({ x: 50, y: 50, rotation });
  // 0°: front faces south (larger y).
  assert.deepEqual(frontLine(at(0), box), [[35, 62], [65, 62]]);
  // 90°: back on the east wall, front faces west.
  assert.deepEqual(frontLine(at(90), box), [[38, 35], [38, 65]]);
  assert.deepEqual(frontLine(at(180), box), [[65, 38], [35, 38]]);
  assert.deepEqual(frontLine(at(270), box), [[62, 65], [62, 35]]);
  assert.deepEqual(placedRect(at(90), box), { x0: 38, y0: 35, x1: 62, y1: 65 });
  assert.deepEqual(modelToPlan(at(0), box, 15, 12), [50, 50]);
  assert.equal(nextRotation(270), 0);
  assert.equal(nextRotation(0, -1), 270);
});

test('dragging near a wall turns the cabinet to back onto it and snaps it flush', () => {
  const r = defaultRoom();
  const north = snapPlacement({ room: r, box, x: 40, y: 18, rotation: 90 });
  assert.deepEqual(north, { x: 40, y: 12, rotation: 0, wall: 'north' });
  const east = snapPlacement({ room: r, box, x: 128, y: 60, rotation: 0 });
  assert.deepEqual(east, { x: 132, y: 60, rotation: 90, wall: 'east' });
  // Without auto-rotation the cabinet keeps its turn and only snaps if its back is near.
  const kept = snapPlacement({ room: r, box, x: 128, y: 60, rotation: 0, autoRotate: false });
  assert.equal(kept.rotation, 0);
  assert.equal(kept.wall, null);
  // A wall that's turned off isn't snapped to.
  const open = snapPlacement({ room: { ...r, walls: { ...r.walls, north: false } }, box, x: 72, y: 16, rotation: 0 });
  assert.equal(open.wall, null);
  // Edges line up with a neighbour and the room's corner.
  const neighbour = { rect: placedRect({ x: 40, y: 12, rotation: 0 }, box) };
  const beside = snapPlacement({ room: r, box, x: 71.5, y: 14, rotation: 0, others: [neighbour] });
  assert.deepEqual(beside, { x: 70, y: 12, rotation: 0, wall: 'north' });
  const corner = snapPlacement({ room: r, box, x: 16.5, y: 13, rotation: 0 });
  assert.equal(corner.x, 15);
  // Never outside the room.
  const out = snapPlacement({ room: r, box, x: -50, y: 500, rotation: 0, autoRotate: false });
  assert.deepEqual([out.x, out.y], [15, 108]);
  assert.deepEqual(clampPlacement(r, box, { x: 1000, y: -3, rotation: 90 }), { x: 132, y: 15, rotation: 90 });
});

test('auto-placing fills the walls in order without overlapping', () => {
  const r = { ...defaultRoom(), width: 70 };
  const placed = [];
  for (let i = 0; i < 3; i++) {
    const p = autoPlace(r, box, placed.map(q => ({ rect: placedRect(q, box), bottom: box.minY, top: box.maxY })));
    placed.push(p);
  }
  assert.deepEqual(placed[0], { x: 15, y: 12, rotation: 0 });
  assert.deepEqual(placed[1], { x: 45, y: 12, rotation: 0 });
  assert.equal(placed[2].rotation, 90, 'the north wall is full, so it moves to the east wall');
  assert.equal(placed[2].x, 58);
  // A wall cabinet can hang above a base cabinet in the same spot.
  const upper = { ...box, minY: 54, maxY: 84, maxZ: 12 };
  const above = autoPlace(r, upper, [{ rect: placedRect(placed[0], box), bottom: box.minY, top: box.maxY }]);
  assert.equal(above.x, 15);
});

test('layout checks catch clashes, blocked doors, covered windows and loose wall cabinets', () => {
  const r = { ...defaultRoom(), openings: [
    { id: 'd', kind: 'door', wall: 'south', offset: 50, width: 32, height: 80, sill: 0, swing: 'in', hinge: 'start' },
    { id: 'w', kind: 'window', wall: 'north', offset: 80, width: 36, height: 40, sill: 42 },
  ] };
  const item = (id, placement, b = box, wallHung = false) => ({ id, label: `C${id}`, placement, box: b, wallHung });
  assert.deepEqual(layoutIssues(r, [item(1, { x: 15, y: 12, rotation: 0 })]), []);

  const overlap = layoutIssues(r, [item(1, { x: 15, y: 12, rotation: 0 }), item(2, { x: 30, y: 12, rotation: 0 })]);
  assert.deepEqual(overlap.map(i => i.ids), [[1, 2]]);
  // A wall cabinet above a base cabinet isn't a clash.
  const upper = { ...box, minY: 54, maxY: 84, maxZ: 12 };
  assert.deepEqual(layoutIssues(r, [item(1, { x: 15, y: 12, rotation: 0 }), item(2, { x: 15, y: 6, rotation: 0 }, upper, true)]), []);

  assert.match(layoutIssues(r, [item(1, { x: 66, y: 108, rotation: 180 })])[0].message, /blocks the door/);
  // A base cabinet sits below the window sill; a tall one covers it.
  assert.deepEqual(layoutIssues(r, [item(1, { x: 98, y: 12, rotation: 0 })]), []);
  const tall = { ...box, maxY: 84 };
  assert.match(layoutIssues(r, [item(1, { x: 98, y: 12, rotation: 0 }, tall)])[0].message, /covers part of the window/);
  assert.match(layoutIssues(r, [item(1, { x: 70, y: 60, rotation: 0 }, upper, true)])[0].message, /isn't against a wall/);
  assert.match(layoutIssues(r, [item(1, { x: 15, y: 12, rotation: 0 }, { ...box, maxY: 120 })])[0].message, /taller than the/);
  assert.match(layoutIssues(r, [item(1, { x: 5, y: 12, rotation: 0 })])[0].message, /sticks out/);
});

test('walls are split around their openings for the 3D view', () => {
  const r = { ...defaultRoom(), walls: { north: true, east: false, south: false, west: true }, openings: [
    { id: 'w', kind: 'window', wall: 'north', offset: 40, width: 30, height: 40, sill: 36 },
  ] };
  const north = wallPieces(r).filter(p => p.wall === 'north');
  assert.ok(north.some(p => p.a0 === -WALL_THICKNESS && p.a1 === 40 && p.y0 === 0 && p.y1 === 96), 'runs past the west corner');
  assert.ok(north.some(p => p.a0 === 40 && p.a1 === 70 && p.y0 === 0 && p.y1 === 36), 'below the sill');
  assert.ok(north.some(p => p.a0 === 40 && p.a1 === 70 && p.y0 === 76 && p.y1 === 96), 'above the window');
  assert.ok(north.some(p => p.a0 === 70 && p.a1 === 144), 'stops at the open east side');
  assert.equal(wallPieces(r).filter(p => p.wall === 'east' || p.wall === 'south').length, 0);
});

test('a saved drawer design gives a footprint matching its size', () => {
  const saved = readSavedDrawerDesign(design);
  const plan = buildDrawerPlan(saved.config);
  assert.deepEqual(plan.errors, []);
  const b = cabinetBox(drawerSolids(plan, saved.config));
  assert.ok(Math.abs((b.maxX - b.minX) - 14.125) < 0.01, `width ${b.maxX - b.minX}`);
  assert.ok(b.maxZ - b.minZ >= 22.875 - 0.01, `depth ${b.maxZ - b.minZ}`);
  assert.ok(Math.abs(b.minY) < 0.01);
});
