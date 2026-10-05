import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-drawer-design-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'drawer-design-test-secret-at-least-thirty-two-bytes';
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
  const res = await request('/api/projects', { user, method: 'POST', body: { title: 'Drawers' } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

const design = {
  version: 1, kind: 'drawer-unit', units: 'in', heightMode: 'overall',
  config: { thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5 },
};

test('a project keeps its drawer design apart from its shelf design', async () => {
  const id = await createProject();
  assert.deepEqual(await (await request(`/api/projects/${id}/drawer-design`)).json(), { design: null });
  assert.equal((await request(`/api/projects/${id}/drawer-design`, { method: 'PUT', body: { design } })).status, 200);
  assert.deepEqual(await (await request(`/api/projects/${id}/drawer-design`)).json(), { design });
  assert.deepEqual(await (await request(`/api/projects/${id}/shelf-design`)).json(), { design: null }, 'no shelf design appears');
  assert.equal((await request(`/api/projects/${id}/drawer-design`, { method: 'PUT', body: { design: null } })).status, 200);
  assert.deepEqual(await (await request(`/api/projects/${id}/drawer-design`)).json(), { design: null });

  for (const body of [{}, { design: 'drawers' }, { design: [] }, { design: { version: 1 } }]) {
    assert.equal((await request(`/api/projects/${id}/drawer-design`, { method: 'PUT', body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await request('/api/projects/999999/drawer-design')).status, 404);
});

test('the drawer design library saves, updates, lists, and deletes, separate from shelf designs', async () => {
  const created = await (await request('/api/drawer-designs', { method: 'POST', body: { name: ' Desk pedestal ', design } })).json();
  assert.equal(created.name, 'Desk pedestal');
  assert.deepEqual(created.design, design);
  const shelves = await (await request('/api/shelf-designs')).json();
  assert.ok(!shelves.some(d => d.name === 'Desk pedestal'), 'shelf library is untouched');

  const changed = { ...design, config: { ...design.config, drawers: 9 } };
  const updated = await (await request(`/api/drawer-designs/${created.id}`, { method: 'PUT', body: { design: changed } })).json();
  assert.equal(updated.design.config.drawers, 9);
  assert.equal(updated.name, 'Desk pedestal');
  const list = await (await request('/api/drawer-designs')).json();
  assert.equal(list[0].id, created.id);

  assert.equal((await request('/api/drawer-designs', { method: 'POST', body: { name: '', design } })).status, 400);
  assert.equal((await request('/api/drawer-designs', { method: 'POST', body: { name: 'Huge', design: { ...design, config: { note: 'x'.repeat(25_000) } } } })).status, 413);
  assert.equal((await request(`/api/drawer-designs/${created.id}`, { user: USER_B, method: 'DELETE' })).status, 404, 'other accounts can’t touch it');
  assert.equal((await request(`/api/drawer-designs/${created.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/drawer-designs/${created.id}`)).status, 404);
});

test('demo mode can list drawer designs but not save them', async () => {
  const { default: Database } = await import('better-sqlite3');
  const seed = new Database(process.env.SEED_DB_PATH);
  api.initSchema(seed);
  seed.close();
  const list = await request('/api/drawer-designs', { user: null, headers: { 'X-Demo': '1' } });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), []);
  const write = await request('/api/drawer-designs', { user: null, method: 'POST', body: { name: 'Demo', design }, headers: { 'X-Demo': '1' } });
  assert.equal(write.status, 403);
});

test('Add to project writes drawer parts and the cost lines the project page reads back', async () => {
  const { buildDrawerPlan, DEFAULT_PULL, drawerProjectCutItems } = await import('../src/lib/drawerUnit.ts');
  const { saveCutListToProject } = await import('../src/lib/projectCutList.ts');
  const { parseInches } = await import('../src/lib/cutPlan.ts');
  const config = {
    thickness: 0.75, width: 14.125, height: 27.5, depth: 22.875, drawers: 5, gap: 0.125, pull: DEFAULT_PULL,
    boxThickness: 0.5, bottomThickness: 0.25, backThickness: 0.25, base: 'feet', footHeight: 0.5, casterHeight: 2,
  };
  const plan = buildDrawerPlan(config);
  const items = drawerProjectCutItems(plan);
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
  const result = await saveCutListToProject(writer, id, items, [], 'append');
  assert.equal(result.error, null);
  const rows = (await (await request(`/api/projects/${id}`)).json()).cut_list;
  assert.deepEqual(rows.map(r => r.part_name), items.map(i => i.part_name));
  const side = rows.find(r => r.part_name === 'Side');
  assert.equal(parseInches(side.length), 27);
  assert.equal(parseInches(side.thickness), 0.75);
  assert.ok(rows.some(r => parseInches(r.thickness) === 0.25), 'thin back and bottoms keep their thickness');
});
