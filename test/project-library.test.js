import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import Database from 'better-sqlite3';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-project-library-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'project-library-test-secret-at-least-thirty-two-bytes';
process.env.APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
process.env.DB_PATH = join(tempRoot, 'legacy.db');
process.env.USERS_DIR = join(tempRoot, 'users');
process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

const api = await import('../server.js');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const libraries = [
  { resource: 'projects', table: 'projects', insert: 'insertProject' },
  { resource: 'shaper-projects', table: 'shaper_projects', insert: 'insertShaperProject' },
  { resource: 'bambu-projects', table: 'bambu_projects', insert: 'insertBambuProject' },
];
let server;
let baseUrl;
const tokens = new Map();

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

beforeEach(() => {
  for (const user of [USER_A, USER_B]) {
    const { db } = api.getUserDb(user);
    for (const { table } of libraries) db.exec(`DELETE FROM ${table}`);
  }
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  api.closeAllDatabases();
  rmSync(tempRoot, { recursive: true, force: true });
});

function insertProject(library, title, user = USER_A) {
  return Number(api.getUserDb(user).stmts[library.insert].run({
    title,
    description: 'Keep this description',
    source_url: 'https://www.printables.com/model/1-fixture',
    cut_plan_url: null,
    status: 'idea',
    difficulty: 'Beginner',
    estimated_hours: 1,
    wood_types: '[]',
    tools_needed: '[]',
    shaper_url: 'https://hub.shapertools.com/shares/fixture',
    photo_url: null,
    materials: '[]',
    instructions: 'Keep these instructions',
    source_site: 'printables',
    source_model_id: '1',
    creator_name: 'Fixture creator',
    license_name: 'Fixture license',
  }).lastInsertRowid);
}

function request(path, { user = USER_A, body, headers = {}, method = 'GET' } = {}) {
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

async function listIds(resource, user = USER_A) {
  const response = await request(`/api/${resource}`, { user });
  assert.equal(response.status, 200);
  return (await response.json()).map(project => project.id);
}

test('additive library migrations retain old order and data and are idempotent', () => {
  const db = new Database(':memory:');
  try {
    api.initSchema(db);
    for (const { table } of libraries) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN sort_order`);
      if (table !== 'projects') db.exec(`ALTER TABLE ${table} DROP COLUMN is_completed`);
      const source = table === 'bambu_projects' ? ", source_url, source_site" : '';
      const values = table === 'bambu_projects' ? ", 'https://www.printables.com/model/1', 'printables'" : '';
      db.exec(`
        INSERT INTO ${table} (id, title, updated_at${source}) VALUES
          (1, 'Older', '2026-01-01'${values}),
          (2, 'Newer', '2026-01-03'${values}),
          (3, 'Middle', '2026-01-02'${values})
      `);
    }
    api.initSchema(db);
    for (const { table } of libraries) {
      assert.deepEqual(
        db.prepare(`SELECT id FROM ${table} ORDER BY sort_order`).all().map(row => row.id),
        [2, 3, 1],
      );
      assert.equal(db.prepare(`SELECT title FROM ${table} WHERE id = 1`).get().title, 'Older');
      if (table !== 'projects') {
        assert.equal(db.prepare(`SELECT SUM(is_completed) AS completed FROM ${table}`).get().completed, 0);
        db.exec(`UPDATE ${table} SET is_completed = 1 WHERE id = 1`);
      }
      db.exec(`UPDATE ${table} SET sort_order = -1 WHERE id = 1`);
    }
    api.initSchema(db);
    for (const { table } of libraries) {
      assert.equal(db.prepare(`SELECT sort_order FROM ${table} WHERE id = 1`).get().sort_order, -1);
      if (table !== 'projects') {
        assert.equal(db.prepare(`SELECT is_completed FROM ${table} WHERE id = 1`).get().is_completed, 1);
      }
    }
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    db.close();
  }
});

for (const library of libraries) {
  const { resource, table } = library;

  test(`${resource} saves order per account, survives reopen, and places new projects first`, async () => {
    const ids = ['First', 'Second', 'Third'].map(title => insertProject(library, title));
    const otherIds = ['Other first', 'Other second'].map(title => insertProject(library, title, USER_B));
    if (table === 'projects') {
      const templateId = insertProject(library, 'Template');
      api.getUserDb(USER_A).db.prepare('UPDATE projects SET is_template = 1 WHERE id = ?').run(templateId);
    }
    assert.deepEqual(await listIds(resource), [...ids].reverse());
    const ordered = [ids[0], ids[2], ids[1]];
    const before = api.getUserDb(USER_A).db.prepare(`SELECT id, updated_at FROM ${table} ORDER BY id`).all();
    const response = await request(`/api/${resource}/order`, {
      method: 'PUT', body: { ids: ordered },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(await listIds(resource), ordered);
    assert.deepEqual(await listIds(resource, USER_B), [...otherIds].reverse());
    assert.deepEqual(api.getUserDb(USER_A).db.prepare(`SELECT id, updated_at FROM ${table} ORDER BY id`).all(), before);

    api.closeAllDatabases();
    assert.deepEqual(await listIds(resource), ordered);
    const newest = insertProject(library, 'Newest');
    assert.deepEqual(await listIds(resource), [newest, ...ordered]);
  });

  test(`${resource} rejects malformed, stale, unauthenticated, and demo reorder requests without partial changes`, async () => {
    const ids = ['First', 'Second', 'Third'].map(title => insertProject(library, title));
    const original = await listIds(resource);
    for (const body of [{}, { ids: 'bad' }, { ids: [ids[0], ids[0]] }, { ids: [1.5] }, { ids: ['1'] }, { ids: [-1] }]) {
      const response = await request(`/api/${resource}/order`, { method: 'PUT', body });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /unique positive/);
      assert.deepEqual(await listIds(resource), original);
    }
    for (const ordered of [[], ids.slice(1), [...ids.slice(1), 999_999]]) {
      const response = await request(`/api/${resource}/order`, { method: 'PUT', body: { ids: ordered } });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Reload/);
      assert.deepEqual(await listIds(resource), original);
    }
    const unauthenticated = await request(`/api/${resource}/order`, { user: null, method: 'PUT', body: { ids } });
    assert.equal(unauthenticated.status, 401);
    const demo = await request(`/api/${resource}/order`, {
      user: null, method: 'PUT', headers: { 'X-Demo': '1' }, body: { ids },
    });
    assert.equal(demo.status, 403);
    assert.deepEqual(await listIds(resource), original);
  });
}

for (const library of libraries.filter(library => library.table !== 'projects')) {
  const { resource, table } = library;

  test(`${resource} completion is reversible, persistent, private, and independent of metadata and order`, async () => {
    const first = insertProject(library, 'First');
    insertProject(library, 'Second');
    const other = insertProject(library, 'Other account', USER_B);
    const order = await listIds(resource);
    const before = api.getUserDb(USER_A).db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(first);
    for (const completed of [true, true, false, true]) {
      const response = await request(`/api/${resource}/${first}/completion`, {
        method: 'PUT', body: { is_completed: completed },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).is_completed, completed);
      const detail = await request(`/api/${resource}/${first}`);
      assert.equal((await detail.json()).is_completed, completed);
      const list = await request(`/api/${resource}`);
      assert.equal((await list.json()).find(project => project.id === first).is_completed, completed);
      assert.deepEqual(await listIds(resource), order);
      assert.equal(api.getUserDb(USER_B).db.prepare(`SELECT is_completed FROM ${table} WHERE id = ?`).get(other).is_completed, 0);
    }
    const after = api.getUserDb(USER_A).db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(first);
    assert.deepEqual({ ...after, is_completed: before.is_completed, updated_at: before.updated_at }, before);
    api.closeAllDatabases();
    const reloaded = await request(`/api/${resource}/${first}`);
    assert.equal((await reloaded.json()).is_completed, true);

    const edited = await request(`/api/${resource}/${first}`, {
      method: 'PUT', body: { title: 'Renamed', description: before.description, creator_name: before.creator_name, license_name: before.license_name },
    });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).is_completed, true);
    assert.deepEqual(await listIds(resource), order);
  });

  test(`${resource} rejects invalid completion flags and keeps the demo read-only`, async () => {
    const id = insertProject(library, 'Unfinished');
    for (const value of [null, 0, 1, 'true', [], {}]) {
      const response = await request(`/api/${resource}/${id}/completion`, {
        method: 'PUT', body: { is_completed: value },
      });
      assert.equal(response.status, 400);
    }
    const missing = await request(`/api/${resource}/999999/completion`, {
      method: 'PUT', body: { is_completed: true },
    });
    assert.equal(missing.status, 404);
    const unauthenticated = await request(`/api/${resource}/${id}/completion`, {
      user: null, method: 'PUT', body: { is_completed: true },
    });
    assert.equal(unauthenticated.status, 401);
    const demo = await request(`/api/${resource}/${id}/completion`, {
      user: null, method: 'PUT', headers: { 'X-Demo': '1' }, body: { is_completed: true },
    });
    assert.equal(demo.status, 403);
    const detail = await request(`/api/${resource}/${id}`);
    assert.equal((await detail.json()).is_completed, false);
  });
}
