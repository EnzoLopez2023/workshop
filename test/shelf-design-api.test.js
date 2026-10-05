import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-shelf-design-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'shelf-design-test-secret-at-least-thirty-two-bytes';
process.env.APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
process.env.DB_PATH = join(tempRoot, 'legacy.db');
process.env.USERS_DIR = join(tempRoot, 'users');
process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

const api = await import('../server.js');
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';
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

async function createProject(user = USER_A) {
  const res = await request('/api/projects', { user, method: 'POST', body: { title: 'Shelves' } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

const design = { version: 1, units: 'in', config: { thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 2, shelvesPerBay: [3, 3] } };

test('a project has no design until one is saved, then returns it exactly', async () => {
  const id = await createProject();
  assert.deepEqual(await (await request(`/api/projects/${id}/shelf-design`)).json(), { design: null });

  const put = await request(`/api/projects/${id}/shelf-design`, { method: 'PUT', body: { design } });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await request(`/api/projects/${id}/shelf-design`)).json(), { design });

  const clear = await request(`/api/projects/${id}/shelf-design`, { method: 'PUT', body: { design: null } });
  assert.equal(clear.status, 200);
  assert.deepEqual(await (await request(`/api/projects/${id}/shelf-design`)).json(), { design: null });
});

test('malformed designs and missing projects are refused', async () => {
  const id = await createProject();
  for (const body of [{}, { design: 'shelves' }, { design: [] }, { design: { version: 1 } }]) {
    const res = await request(`/api/projects/${id}/shelf-design`, { method: 'PUT', body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const huge = { ...design, config: { ...design.config, note: 'x'.repeat(95_000) } };
  assert.equal((await request(`/api/projects/${id}/shelf-design`, { method: 'PUT', body: { design: huge } })).status, 413);
  assert.equal((await request('/api/projects/999999/shelf-design')).status, 404);
  assert.equal((await request('/api/projects/999999/shelf-design', { method: 'PUT', body: { design } })).status, 404);
});

test('designs stay in their own account and demo mode cannot write', async () => {
  const id = await createProject(USER_A);
  await request(`/api/projects/${id}/shelf-design`, { method: 'PUT', body: { design } });
  // USER_B's database has no project with this id (or a different one) — never USER_A's design.
  const other = await request(`/api/projects/${id}/shelf-design`, { user: USER_B });
  assert.ok(other.status === 404 || (await other.json()).design === null);

  const demo = await request(`/api/projects/${id}/shelf-design`, {
    user: null, method: 'PUT', body: { design }, headers: { 'X-Demo': '1' },
  });
  assert.equal(demo.status, 403);
});

test('Add to project writes parts the project page reads back, and replace swaps them', async () => {
  const { buildShelfPlan, projectCutItems } = await import('../src/lib/shelving.ts');
  const { saveCutListToProject } = await import('../src/lib/projectCutList.ts');
  const { parseInches } = await import('../src/lib/cutPlan.ts');
  const config = {
    thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 2, shelvesPerBay: [3, 4],
    topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
    mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3,
  };
  const plan = buildShelfPlan(config);
  const items = projectCutItems(plan);
  const writer = {
    add: async (projectId, item) => {
      const res = await request(`/api/projects/${projectId}/cut-list`, { method: 'POST', body: item });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    remove: async id => {
      const res = await request(`/api/cut-list/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  };
  const id = await createProject();
  const cutList = async () => (await (await request(`/api/projects/${id}`)).json()).cut_list;

  // Start with one unrelated part, then append.
  await writer.add(id, { part_name: 'Existing apron', qty: 1, length: '30', width: '4', thickness: '3/4', material: 'Oak', sort_order: 0 });
  const appended = await saveCutListToProject(writer, id, items, await cutList(), 'append');
  assert.equal(appended.error, null);
  let rows = await cutList();
  assert.equal(rows.length, items.length + 1);
  assert.equal(rows[0].part_name, 'Existing apron', 'appended parts sort after the existing one');
  const shelf = rows.find(r => r.part_name === 'Shelf');
  assert.equal(shelf.qty, 7);
  assert.equal(parseInches(shelf.length), 18);
  assert.equal(shelf.material, 'Plywood');

  // Replace leaves exactly the shelf parts.
  const replaced = await saveCutListToProject(writer, id, items, rows, 'replace');
  assert.equal(replaced.error, null);
  assert.equal(replaced.removed, items.length + 1);
  rows = await cutList();
  assert.deepEqual(rows.map(r => r.part_name), items.map(i => i.part_name));
});

test('cost lines saved as materials show up with their costs and in order', async () => {
  const { buildShelfPlan } = await import('../src/lib/shelving.ts');
  const { costEstimate, defaultPrices, hardwareList } = await import('../src/lib/shelfEstimate.ts');
  const config = {
    thickness: 0.75, bayWidth: 17.5, shelfDepth: 11.25, height: 74, bays: 2, shelvesPerBay: [3, 3],
    topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: 0.25,
    mounting: 'floor', toeKick: 3, frenchCleat: false, cleatHeight: 3, doorsPerBay: [true, false],
  };
  const plan = buildShelfPlan(config);
  const estimate = costEstimate(plan, 3, '3/4" plywood', hardwareList(plan, config, 'in'), defaultPrices(0.75));
  const id = await createProject();
  // Same calls the Add to project panel makes, numbered from 1.
  for (const [index, line] of estimate.lines.entries()) {
    const res = await request(`/api/projects/${id}/materials`, {
      method: 'POST', body: { name: line.name, qty_label: line.qtyLabel, cost: Math.round(line.total * 100) / 100, sort_order: index + 1 },
    });
    assert.equal(res.status, 201);
  }
  const project = await (await request(`/api/projects/${id}`)).json();
  assert.deepEqual(project.materials.map(m => m.name), estimate.lines.map(l => l.name));
  assert.equal(project.materials[0].qty_label, '3 sheets');
  assert.ok(Math.abs(project.total_cost - estimate.total) < 0.05, `${project.total_cost} vs ${estimate.total}`);
});

test('the design library saves, lists newest first, updates, renames and deletes designs', async () => {
  const save = (name, d = design) => request('/api/shelf-designs', { method: 'POST', body: { name, design: d } });
  const first = await (await save('  Garage wall  ')).json();
  assert.equal(first.name, 'Garage wall', 'names are trimmed');
  assert.deepEqual(first.design, design);
  const second = await (await save('Pantry')).json();
  let list = await (await request('/api/shelf-designs')).json();
  assert.deepEqual(list.slice(0, 2).map(d => d.name), ['Pantry', 'Garage wall']);

  const changed = { ...design, config: { ...design.config, bays: 3, shelvesPerBay: [1, 2, 3] } };
  const updated = await (await request(`/api/shelf-designs/${first.id}`, { method: 'PUT', body: { design: changed } })).json();
  assert.equal(updated.name, 'Garage wall', 'a design-only update keeps the name');
  assert.equal(updated.design.config.bays, 3);
  const renamed = await (await request(`/api/shelf-designs/${first.id}`, { method: 'PUT', body: { name: 'Garage wall v2' } })).json();
  assert.equal(renamed.design.config.bays, 3, 'a rename keeps the design');
  list = await (await request('/api/shelf-designs')).json();
  assert.equal(list[0].name, 'Garage wall v2', 'the most recently changed design comes first');

  const one = await request(`/api/shelf-designs/${first.id}`);
  assert.equal(one.status, 200);
  assert.equal((await one.json()).name, 'Garage wall v2');
  assert.equal((await request('/api/shelf-designs/999999')).status, 404);
  assert.equal((await request(`/api/shelf-designs/${second.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/shelf-designs/${second.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/shelf-designs/999999', { method: 'PUT', body: { name: 'x' } })).status, 404);
});

test('the design library rejects bad input and keeps accounts and demo mode apart', async () => {
  const post = body => request('/api/shelf-designs', { method: 'POST', body });
  assert.equal((await post({ name: '', design })).status, 400);
  assert.equal((await post({ name: 'x'.repeat(121), design })).status, 400);
  assert.equal((await post({ name: 'No design' })).status, 400);
  assert.equal((await post({ name: 'Array', design: [] })).status, 400);
  assert.equal((await post({ name: 'Huge', design: { ...design, config: { ...design.config, note: 'x'.repeat(95_000) } } })).status, 413);

  const mine = await (await post({ name: 'Only mine', design })).json();
  const theirs = await (await request('/api/shelf-designs', { user: USER_B })).json();
  assert.ok(!theirs.some(d => d.name === 'Only mine'));
  assert.equal((await request(`/api/shelf-designs/${mine.id}`, { user: USER_B, method: 'DELETE' })).status, 404);

  // Give demo mode a seed snapshot (the server creates every table when it opens it).
  const { default: Database } = await import('better-sqlite3');
  const seed = new Database(process.env.SEED_DB_PATH);
  api.initSchema(seed);
  seed.close();
  const demoList = await request('/api/shelf-designs', { user: null, headers: { 'X-Demo': '1' } });
  assert.equal(demoList.status, 200);
  assert.deepEqual(await demoList.json(), []);
  const demoWrite = await request('/api/shelf-designs', { user: null, method: 'POST', body: { name: 'Demo', design }, headers: { 'X-Demo': '1' } });
  assert.equal(demoWrite.status, 403);
});
