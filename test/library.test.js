import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-library-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-thirty-two-bytes-long';
process.env.APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
process.env.DB_PATH = join(tempRoot, 'legacy.db');
process.env.USERS_DIR = join(tempRoot, 'users');
process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

const api = await import(`../server.js?library-test=${Date.now()}`);
const lib = await import('../library-server.js');
const userKey = '22222222-2222-4222-8222-222222222222';
const otherKey = '33333333-3333-4333-8333-333333333333';
let server;
let baseUrl;
let accessToken;
let otherToken;

before(async () => {
  api.getUserDb(userKey);
  api.getUserDb(otherKey);
  ({ accessToken } = await api.mintSession(userKey));
  ({ accessToken: otherToken } = await api.mintSession(otherKey));
  server = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  api.closeAllDatabases();
  rmSync(tempRoot, { recursive: true, force: true });
});

function request(path, { token = accessToken, device, body, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (device) headers.set('Authorization', `Device ${device}`);
  else if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && !(body instanceof Uint8Array)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers, body });
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const PNG_HASH = sha(PNG);

function syncedModel(overrides = {}) {
  return {
    id: '0b6f7a8e-1111-4c2a-9d7e-000000000001',
    title: 'Systainer Latch',
    category: 'Festool',
    folder: 'Festool/Systainer Latch',
    status: 'want',
    tags: ['festool', 'Festool', 'latch'],
    notes: '',
    designer: 'Deltaprints',
    source: { site: 'makerworld', modelId: 'US123', url: null },
    workshopVersion: 0,
    thumb: PNG_HASH,
    files: [
      { relPath: 'Festool/Systainer Latch/Systainer Latch.stl', filename: 'Systainer Latch.stl', kind: 'stl', size: 1000, sha256: sha('a'), geomHash: sha('geom-a'), triangles: 12, bbox: [10, 20, 5] },
      { relPath: 'Festool/Systainer Latch/Systainer Latch (sliced).gcode.3mf', filename: 'Systainer Latch (sliced).gcode.3mf', kind: '3mf', size: 5000, sha256: sha('b'), isSliced: true, grams: 12.5, seconds: 3600, printer: 'Bambu Lab X2D', plates: [{ index: 1, name: 'Latch' }] },
    ],
    ...overrides,
  };
}

test('device tokens are created once, scoped to sync routes, and revocable', async () => {
  const created = await request('/api/library/devices', { method: 'POST', body: { name: 'Studio Mac' } });
  assert.equal(created.status, 201);
  const { token, id } = await created.json();
  assert.match(token, new RegExp(`^wl1\\.${userKey}\\.`));

  // The token is not a bearer credential for the rest of the API.
  assert.equal((await request('/api/library/models', { token: null, device: token })).status, 401);
  assert.equal((await request('/api/library/sync/edits', { device: 'wl1.nope.' + 'x'.repeat(40) })).status, 401);
  assert.equal((await request('/api/library/sync/edits', { device: token })).status, 200);

  // Another account cannot revoke it.
  assert.equal((await request(`/api/library/devices/${id}`, { method: 'DELETE', token: otherToken })).status, 404);
  assert.equal((await request(`/api/library/devices/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request('/api/library/sync/edits', { device: token })).status, 401);
});

test('sync upserts models, stores thumbnails, marks missing, and round-trips edits', async () => {
  const { token } = await (await request('/api/library/devices', { method: 'POST', body: { name: 'Mac' } })).json();
  const startedAt = new Date().toISOString();

  const missing = await (await request('/api/library/sync/thumbs/missing', { method: 'POST', device: token, body: { hashes: [PNG_HASH, 'bad'] } })).json();
  assert.deepEqual(missing.missing, [PNG_HASH]);
  assert.equal((await request(`/api/library/sync/thumbs/${sha('other')}`, { method: 'PUT', device: token, headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(PNG) })).status, 400);
  assert.equal((await request(`/api/library/sync/thumbs/${PNG_HASH}`, { method: 'PUT', device: token, headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(PNG) })).status, 204);

  const second = syncedModel({ id: '0b6f7a8e-1111-4c2a-9d7e-000000000002', title: 'Skadis Hook', category: 'Skadis', folder: 'Skadis/Skadis Hook', status: 'inbox', tags: [], thumb: null, files: [{ relPath: 'Skadis/Skadis Hook/hook.stl', filename: 'hook.stl', kind: 'stl', size: 10, sha256: sha('c'), geomHash: sha('geom-a') }] });
  const upsert = await request('/api/library/sync/models', { method: 'POST', device: token, body: { startedAt, models: [syncedModel(), second, { id: '../../etc' }] } });
  assert.deepEqual(await upsert.json(), { accepted: 2, errors: [{ id: '../../etc', error: 'model id is required' }] });
  // A thumbnail used only by the pending plan must survive the post-sync prune.
  const PLAN_PNG = Buffer.concat([PNG, Buffer.from('plan-only')]);
  const PLAN_HASH = sha(PLAN_PNG);
  await request(`/api/library/sync/thumbs/${PLAN_HASH}`, { method: 'PUT', device: token, headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(PLAN_PNG) });
  const commit = await (await request('/api/library/sync/commit', { method: 'POST', device: token, body: { startedAt, plan: { createdAt: startedAt, summary: { models: 3 }, models: [{ id: 'x', thumb: PLAN_HASH }] } } })).json();
  assert.equal(commit.missing, 0);
  assert.equal((await fetch(`${baseUrl}/api/library/thumbs/${PLAN_HASH}?userKey=${userKey}`)).status, 200);

  const list = await (await request('/api/library/models?q=latch')).json();
  assert.equal(list.total, 1);
  const card = list.items[0];
  assert.equal(card.title, 'Systainer Latch');
  assert.deepEqual(card.tags, ['festool', 'latch']);
  assert.deepEqual(card.formats, ['sliced', 'stl']);
  assert.equal(card.est_grams, 12.5);
  assert.equal(card.plate_count, 1);

  // Thumbnails are auth-exempt for <img>, but scoped by userKey.
  const thumb = await fetch(`${baseUrl}/api/library/thumbs/${PNG_HASH}?userKey=${userKey}`);
  assert.equal(thumb.status, 200);
  assert.deepEqual(Buffer.from(await thumb.arrayBuffer()), PNG);
  assert.equal((await fetch(`${baseUrl}/api/library/thumbs/${PNG_HASH}?userKey=${otherKey}`)).status, 404);

  // Other accounts see nothing.
  assert.equal((await (await request('/api/library/models', { token: otherToken })).json()).total, 0);

  // Same geometry in two models is reported as a duplicate group.
  const dupes = await (await request('/api/library/duplicates')).json();
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].files.length, 2);

  // Edit in Workshop -> pending edit for the Mac; a stale disk sync does not clobber it.
  const edited = await request(`/api/library/models/${card.id}`, { method: 'PUT', body: { title: 'Systainer Latch v2', status: 'queued', tags: ['sys3'] } });
  assert.equal((await edited.json()).status, 'queued');
  const edits = (await (await request('/api/library/sync/edits', { device: token })).json()).edits;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].workshopVersion, 1);
  const resync = new Date().toISOString();
  await request('/api/library/sync/models', { method: 'POST', device: token, body: { startedAt: resync, models: [syncedModel(), second] } });
  assert.equal((await (await request(`/api/library/models/${card.id}`)).json()).title, 'Systainer Latch v2');
  // Once the Mac has written the edit into model.json it syncs back with the new version.
  await request('/api/library/sync/models', { method: 'POST', device: token, body: { startedAt: resync, models: [syncedModel({ title: 'Systainer Latch v2', status: 'queued', tags: ['sys3'], workshopVersion: 1 })] } });
  assert.equal((await (await request('/api/library/sync/edits', { device: token })).json()).edits.length, 0);

  // The second model was not in the last sync -> missing, not deleted.
  const commit2 = await (await request('/api/library/sync/commit', { method: 'POST', device: token, body: { startedAt: new Date(Date.now() + 1000).toISOString() } })).json();
  assert.equal(commit2.missing, 2);
  assert.equal((await (await request('/api/library/models?state=missing')).json()).total, 2);

  const overview = await (await request('/api/library/overview')).json();
  assert.equal(overview.missing, 2);
  assert.equal(overview.planSummary.pending, 1);
  assert.equal(overview.printHistory.available, false);
});

test('manual prints update status; demo mode is read-only', async () => {
  const id = '0b6f7a8e-1111-4c2a-9d7e-000000000001';
  const created = await request(`/api/library/models/${id}/prints`, { method: 'POST', body: { result: 'completed', notes: 'PETG, 0.2mm' } });
  assert.equal(created.status, 201);
  const detail = await (await request(`/api/library/models/${id}`)).json();
  assert.equal(detail.status, 'printed');
  assert.equal(detail.printed_count, 1);
  assert.equal(detail.prints[0].notes, 'PETG, 0.2mm');
  assert.equal(detail.files.length, 2);

  const demoWrite = await fetch(`${baseUrl}/api/library/models/${id}`, { method: 'PUT', headers: { 'X-Demo': '1', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(demoWrite.status, 403);
});

test('print job matching: exact names auto-link, near names are suggested, ambiguous stays unmatched', () => {
  const models = [
    { id: 'a', title: 'Systainer Latch' },
    { id: 'b', title: 'Skadis Hook' },
    { id: 'c', title: 'Skadis Hook Mini' },
  ];
  const files = new Map([
    ['a', [{ filename: 'Systainer Latch (sliced).gcode.3mf', grams: 12.5, plates_json: '[{"name":"Latch"}]' }]],
    ['b', [{ filename: 'hook.stl', plates_json: '[]' }]],
    ['c', [{ filename: 'hook mini.stl', plates_json: '[]' }]],
  ]);
  const exact = lib.scoreJobAgainstModels({ title: 'Systainer_Latch_plate_1', grams: 12.4 }, models, files);
  assert.equal(exact.modelId, 'a');
  assert.ok(exact.score >= lib.AUTO_MATCH_SCORE);
  // Printing a single plate of a multi-plate project still auto-links on an exact name.
  const onePlate = lib.scoreJobAgainstModels({ title: 'Systainer Latch', grams: 3 }, models, files);
  assert.ok(onePlate.score >= lib.AUTO_MATCH_SCORE, String(onePlate.score));
  const near = lib.scoreJobAgainstModels({ title: 'Systainer Latch v2' }, models, files);
  assert.equal(near.modelId, 'a');
  assert.ok(near.score >= lib.SUGGEST_MATCH_SCORE && near.score < lib.AUTO_MATCH_SCORE, String(near.score));
  const none = lib.scoreJobAgainstModels({ title: 'Benchy' }, models, files);
  assert.ok(none.score < lib.SUGGEST_MATCH_SCORE);
  assert.equal(lib.normalizeTitle('light+weight (2).gcode.3mf'), 'light weight');
});

test('imported ShapePilot jobs are matched and mark models printed', async () => {
  const { stmts } = api.getUserDb(userKey);
  const l = stmts.library;
  l.setModelStatus.run('want', '0b6f7a8e-1111-4c2a-9d7e-000000000002');
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Integration k');
    assert.equal(new URL(url).pathname, '/api/integrations/print-jobs');
    return new Response(JSON.stringify({
      cursor: '2026-09-30T00:00:00Z',
      jobs: [
        { id: 'j1', title: 'Skadis Hook', result: 'completed', startedAt: '2026-09-29T10:00:00Z', grams: 3 },
        { id: 'j2', title: 'Something else entirely', result: 'failed_or_aborted' },
      ],
    }));
  };
  const result = await lib.importShapePilotJobs(l, { url: 'https://shapepilot.test', key: 'k', fetchImpl });
  assert.equal(result.imported, 2);
  assert.equal(result.auto, 1);
  assert.equal(l.getModel.get('0b6f7a8e-1111-4c2a-9d7e-000000000002').status, 'printed');
  // Re-import is idempotent.
  await lib.importShapePilotJobs(l, { url: 'https://shapepilot.test', key: 'k', fetchImpl });
  assert.equal(api.getUserDb(userKey).db.prepare(`SELECT COUNT(*) AS n FROM library_prints WHERE source = 'shapepilot'`).get().n, 2);

  // Non-owner accounts cannot trigger print-history sync.
  assert.equal((await request('/api/library/print-history/sync', { method: 'POST', token: otherToken })).status, 403);
});

test('MakerWorld profile names match only with weight agreement, and never on a shared guess', () => {
  const profile = '0.16mm layer, 2 walls, 15% infill';
  const models = [
    { id: 'stand', title: 'Design Headphone Stand' },
    { id: 'clip', title: 'Bag Clip' },
    { id: 'drawer', title: 'Stacking Drawer' },
  ];
  const files = new Map([
    ['stand', [{ filename: 'Headphone Stand.3mf', grams: 120, plates_json: '[]', profile_title: profile }]],
    ['clip', [{ filename: 'Bag Clip.3mf', grams: 9, plates_json: '[]', profile_title: profile }]],
    ['drawer', [{ filename: 'drawer.3mf', plates_json: '[]', profile_title: '彩色条纹 + 弧形顶面' }]],
  ]);
  const byWeight = lib.scoreJobAgainstModels({ title: profile, grams: 118 }, models, files);
  assert.equal(byWeight.modelId, 'stand');
  assert.ok(byWeight.score >= lib.AUTO_MATCH_SCORE && !byWeight.ambiguous, JSON.stringify(byWeight));

  const noWeight = lib.scoreJobAgainstModels({ title: profile }, models, files);
  assert.ok(noWeight.ambiguous, 'two models share the profile name and nothing tells them apart');

  const unique = lib.scoreJobAgainstModels({ title: '彩色条纹 + 弧形顶面' }, models, files);
  assert.equal(unique.modelId, 'drawer');
  assert.ok(unique.score >= lib.SUGGEST_MATCH_SCORE && unique.score < lib.AUTO_MATCH_SCORE, String(unique.score));
});

test('a same-named copy saved after the print started does not block the match', () => {
  const models = [
    { id: 'festool', title: 'Systainer Latch with screw final' },
    { id: 'inbox', title: 'Systainer Latch with screw final' },
  ];
  const file = (mtime) => [{ filename: 'Systainer Latch with screw final.3mf', plates_json: '[]', mtime }];
  const files = new Map([
    ['festool', file('2026-09-28T03:53:00.000Z')],
    ['inbox', file('2026-09-28T17:11:00.000Z')],
  ]);
  const job = { title: 'Systainer Latch with screw final', started_at: '2026-09-28T16:14:00.000Z' };
  const match = lib.scoreJobAgainstModels(job, models, files);
  assert.equal(match.modelId, 'festool');
  assert.ok(match.score >= lib.AUTO_MATCH_SCORE && !match.ambiguous, JSON.stringify(match));

  // Both copies predate the print: nothing tells them apart.
  const later = lib.scoreJobAgainstModels({ ...job, started_at: '2026-09-29T00:00:00.000Z' }, models, files);
  assert.ok(later.ambiguous);
  // No start time: unchanged behaviour.
  assert.ok(lib.scoreJobAgainstModels({ title: job.title }, models, files).ambiguous);
});

test('library schema migrates databases from the first release', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE bambu_projects (id INTEGER PRIMARY KEY)');
  db.exec(`CREATE TABLE library_files (id INTEGER PRIMARY KEY, model_id TEXT, rel_path TEXT UNIQUE, filename TEXT, kind TEXT,
    size INTEGER, sha256 TEXT, geom_hash TEXT, mtime TEXT, triangles INTEGER, bbox_json TEXT, is_sliced INTEGER, printer TEXT,
    seconds REAL, grams REAL, plates_json TEXT, filaments_json TEXT, generator TEXT, thumb_hash TEXT)`);
  lib.initLibrarySchema(db);
  lib.initLibrarySchema(db);
  const cols = db.prepare('PRAGMA table_info(library_files)').all().map((c) => c.name);
  assert.ok(cols.includes('profile_title'));
  assert.doesNotThrow(() => lib.buildLibraryStmts(db));
  db.close();
});
