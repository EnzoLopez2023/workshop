import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'workshop-bambu-import-'));
process.env.NODE_ENV = 'test';
process.env.AZURE_HOME_TENANT_ID = '00000000-0000-0000-0000-000000000001';
process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-thirty-two-bytes-long';
process.env.APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = 'test-provider-encryption-key-that-is-at-least-thirty-two-bytes';
process.env.DB_PATH = join(tempRoot, 'legacy.db');
process.env.USERS_DIR = join(tempRoot, 'users');
process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

const api = await import(`../server.js?bambu-import-test=${Date.now()}`);
const userKey = '11111111-1111-4111-8111-111111111111';
let apiServer;
let baseUrl;
let accessToken;
let entry;

before(async () => {
  entry = api.getUserDb(userKey);
  ({ accessToken } = await api.mintSession(userKey));
  apiServer = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    apiServer.once('listening', resolve);
    apiServer.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  await new Promise(resolve => apiServer.close(resolve));
  api.closeAllDatabases();
  rmSync(tempRoot, { recursive: true, force: true });
});

function request(path, { auth = true, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (auth) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function waitForBridgeJob(projectId, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request(
      `/api/bambu-projects/${projectId}/makerworld-bridge-jobs/${jobId}`,
    );
    const job = await response.json();
    if (job.status === 'complete' || job.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('MakerWorld bridge test job did not finish');
}

test('Bambu source URLs normalize all supported provider forms', () => {
  assert.deepEqual(
    api.parseBambuSourceUrl('https://makerworld.com/en/models/2792836-table-saw-sled#profileId-3105792'),
    {
      site: 'makerworld',
      modelId: '2792836',
      profileId: '3105792',
      sourceUrl: 'https://makerworld.com/en/models/2792836-table-saw-sled#profileId-3105792',
    },
  );
  assert.deepEqual(
    api.parseBambuSourceUrl('https://www.thingiverse.com/thing:3491303/files'),
    {
      site: 'thingiverse',
      modelId: '3491303',
      profileId: null,
      sourceUrl: 'https://www.thingiverse.com/thing:3491303',
    },
  );
  assert.deepEqual(
    api.parseBambuSourceUrl('https://www.printables.com/model/1391192-systainer-s76/files'),
    {
      site: 'printables',
      modelId: '1391192',
      profileId: null,
      sourceUrl: 'https://www.printables.com/model/1391192-systainer-s76',
    },
  );
  assert.throws(
    () => api.parseBambuSourceUrl('https://example.com/model/1'),
    /MakerWorld, Thingiverse, or Printables/,
  );
});

test('Bambu analysis response exposes manifest counts and durable provider warnings', () => {
  assert.deepEqual(api.bambuAnalysisResponse({
    sourceSite: 'makerworld',
    sourceModelId: '2792836',
    title: 'Table saw sled',
    description: 'A printable sled.',
    creatorName: 'SparksTech',
    licenseName: 'Standard Digital File License',
    images: [{ downloadUrl: 'https://cdn.example/cover.jpg' }],
    files: [
      { filename: 'sled.3mf', kind: 'model' },
      { filename: 'readme.pdf', kind: 'file' },
    ],
    warnings: ['MakerWorld requires sign-in for model files.'],
  }), {
    source_site: 'makerworld',
    source_model_id: '2792836',
    title: 'Table saw sled',
    description: 'A printable sled.',
    creator_name: 'SparksTech',
    license_name: 'Standard Digital File License',
    preview_image_url: 'https://cdn.example/cover.jpg',
    image_count: 1,
    file_count: 2,
    files: [
      { filename: 'sled.3mf', kind: 'model' },
      { filename: 'readme.pdf', kind: 'file' },
    ],
    warnings: ['MakerWorld requires sign-in for model files.'],
  });
});

test('Bambu schema reports local asset counts and cascades project deletion', () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Organizer',
    source_url: 'https://www.printables.com/model/1-organizer',
    source_site: 'printables',
    source_model_id: '1',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  const assetId = Number(entry.stmts.insertBambuAsset.run({
    bambu_project_id: projectId,
    kind: 'image',
    filename: 'cover.jpg',
    content_type: 'image/jpeg',
    size_bytes: 100,
    original_url: 'https://media.printables.com/cover.jpg',
    file_path: 'local-cover.jpg',
    sort_order: 0,
  }).lastInsertRowid);

  const listRow = entry.stmts.listBambuProjects.get();
  assert.equal(listRow.image_count, 1);
  assert.equal(listRow.file_count, 0);
  assert.equal(listRow.hero_asset_id, assetId);
  assert.equal(listRow.import_warnings, '[]');
  assert.equal(entry.stmts.bambuStorageUsage.get().total_bytes, 100);

  entry.stmts.deleteBambuProject.run(projectId);
  assert.equal(entry.stmts.getBambuAsset.get(assetId), undefined);
});

test('Thingiverse connection stores only an encrypted per-user token and returns status', async () => {
  const disconnected = await request('/api/provider-connections');
  assert.equal(disconnected.status, 200);
  assert.deepEqual(await disconnected.json(), {
    thingiverse: {
      connected: false,
      source: 'none',
      storage_configured: true,
    },
  });

  const realFetch = globalThis.fetch;
  let validationRequest;
  globalThis.fetch = (input, options) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.hostname === 'api.thingiverse.com') {
      validationRequest = { url: url.href, authorization: new Headers(options?.headers).get('Authorization') };
      return Promise.resolve(new Response('{"name":"Workshop tester"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return realFetch(input, options);
  };

  const token = 'official-thingiverse-token-value';
  try {
    const connected = await request('/api/provider-connections/thingiverse', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(connected.status, 200);
    assert.deepEqual(await connected.json(), {
      connected: true,
      source: 'account',
      storage_configured: true,
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(validationRequest.url, 'https://api.thingiverse.com/users/me');
  assert.equal(validationRequest.authorization, `Bearer ${token}`);
  const stored = entry.stmts.getProviderCredential.get('thingiverse');
  assert.ok(stored.token_enc.startsWith('v1:'));
  assert.equal(stored.token_enc.includes(token), false);

  const status = await request('/api/provider-connections');
  const statusBody = await status.json();
  assert.equal(statusBody.thingiverse.source, 'account');
  assert.equal('token' in statusBody.thingiverse, false);

  const removed = await request('/api/provider-connections/thingiverse', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).source, 'none');
  assert.equal(entry.stmts.getProviderCredential.get('thingiverse'), undefined);
});

test('manual Bambu file upload is private, downloadable with auth, and deletable', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Private model',
    source_url: 'https://makerworld.com/en/models/123-private-model',
    source_site: 'makerworld',
    source_model_id: '123',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  const form = new FormData();
  form.append('file', new Blob(['solid private-model\nendsolid private-model'], {
    type: 'model/stl',
  }), 'private-model.stl');

  const upload = await request(`/api/bambu-projects/${projectId}/assets`, {
    method: 'POST',
    body: form,
  });
  assert.equal(upload.status, 201);
  const asset = await upload.json();
  assert.equal(asset.filename, 'private-model.stl');
  assert.equal(asset.kind, 'model');
  assert.equal('file_path' in asset, false);

  const stored = entry.stmts.getBambuAsset.get(asset.id);
  assert.equal(existsSync(join(process.env.UPLOADS_PATH, stored.file_path)), true);

  const anonymousDownload = await request(`/api/bambu-assets/${asset.id}`, { auth: false });
  assert.equal(anonymousDownload.status, 401);
  const publicImageAttempt = await request(
    `/api/bambu-assets/${asset.id}/image?userKey=${userKey}`,
    { auth: false },
  );
  assert.equal(publicImageAttempt.status, 404);

  const download = await request(`/api/bambu-assets/${asset.id}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /private-model\.stl/);
  assert.equal(await download.text(), 'solid private-model\nendsolid private-model');

  const remove = await request(`/api/bambu-assets/${asset.id}`, { method: 'DELETE' });
  assert.equal(remove.status, 200);
  assert.equal(entry.stmts.getBambuAsset.get(asset.id), undefined);
  assert.equal(existsSync(join(process.env.UPLOADS_PATH, stored.file_path)), false);
});

test('parallel Bambu uploads serialize quota checks per account', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Quota model',
    source_url: 'https://makerworld.com/en/models/456-quota-model',
    source_site: 'makerworld',
    source_model_id: '456',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  const quotaOwnerId = Number(entry.stmts.insertBambuProject.run({
    title: 'Existing account storage',
    source_url: 'https://makerworld.com/en/models/457-existing-storage',
    source_site: 'makerworld',
    source_model_id: '457',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  entry.stmts.insertBambuAsset.run({
    bambu_project_id: quotaOwnerId,
    kind: 'file',
    filename: 'quota-placeholder.bin',
    content_type: 'application/octet-stream',
    size_bytes: (5 * 1024 * 1024 * 1024) - 50,
    original_url: 'https://makerworld.com/en/models/456-quota-model',
    file_path: 'quota-placeholder.bin',
    sort_order: 0,
  });

  const makeForm = name => {
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(40)]), name);
    return form;
  };
  const responses = await Promise.all([
    request(`/api/bambu-projects/${projectId}/assets`, {
      method: 'POST',
      body: makeForm('first.bin'),
    }),
    request(`/api/bambu-projects/${projectId}/assets`, {
      method: 'POST',
      body: makeForm('second.bin'),
    }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 413]);

  const remove = await request(`/api/bambu-projects/${projectId}`, { method: 'DELETE' });
  assert.equal(remove.status, 200);
  const removeOwner = await request(`/api/bambu-projects/${quotaOwnerId}`, { method: 'DELETE' });
  assert.equal(removeOwner.status, 200);
});

test('manual Bambu uploads include existing project bytes in the 1 GB limit', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Project quota model',
    source_url: 'https://makerworld.com/en/models/458-project-quota',
    source_site: 'makerworld',
    source_model_id: '458',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  entry.stmts.insertBambuAsset.run({
    bambu_project_id: projectId,
    kind: 'file',
    filename: 'existing-project.bin',
    content_type: 'application/octet-stream',
    size_bytes: (1024 * 1024 * 1024) - 20,
    original_url: 'https://makerworld.com/en/models/458-project-quota',
    file_path: 'existing-project.bin',
    sort_order: 0,
  });
  const form = new FormData();
  form.append('file', new Blob(['x'.repeat(40)]), 'over-limit.bin');
  const upload = await request(`/api/bambu-projects/${projectId}/assets`, {
    method: 'POST',
    body: form,
  });
  assert.equal(upload.status, 413);
  assert.match((await upload.json()).error, /1 GB/);

  const remove = await request(`/api/bambu-projects/${projectId}`, { method: 'DELETE' });
  assert.equal(remove.status, 200);
});

test('Bambu PUT treats omitted optional metadata as an explicit clear', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Metadata model',
    source_url: 'https://www.printables.com/model/789-metadata-model',
    source_site: 'printables',
    source_model_id: '789',
    description: 'Remove me',
    creator_name: 'Old creator',
    license_name: 'Old license',
  }).lastInsertRowid);

  const update = await request(`/api/bambu-projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Metadata model',
      source_url: 'https://www.printables.com/model/789-metadata-model',
    }),
  });
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.description, null);
  assert.equal(updated.creator_name, null);
  assert.equal(updated.license_name, null);

  entry.stmts.deleteBambuProject.run(projectId);
});

test('MakerWorld bridge consumes signed URLs once without persisting them', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Automatic MakerWorld model',
    source_url: 'https://makerworld.com/en/models/123-automatic-model',
    source_site: 'makerworld',
    source_model_id: '123',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  entry.stmts.saveBambuImportWarnings.run({
    id: projectId,
    warnings: JSON.stringify(['MakerWorld requires sign-in to download 1 original file: model.stl.']),
  });

  const start = await request(`/api/bambu-projects/${projectId}/makerworld-bridge-jobs`, {
    method: 'POST',
  });
  assert.equal(start.status, 201);
  const job = await start.json();
  assert.equal(job.design_id, '123');
  assert.equal(job.status, 'waiting');
  assert.ok(job.token.length >= 32);

  const waiting = await request(
    `/api/bambu-projects/${projectId}/makerworld-bridge-jobs/${job.id}`,
  );
  const waitingBody = await waiting.json();
  assert.equal(waitingBody.status, 'waiting');
  assert.equal('token' in waitingBody, false);

  const signedUrl = 'https://makerworld.bblmw.com/model/private-model.stl?at=1&exp=2&key=test';
  const realFetch = globalThis.fetch;
  let signedFetches = 0;
  globalThis.fetch = (input, options) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.hostname === 'makerworld.bblmw.com') {
      signedFetches += 1;
      return Promise.resolve(new Response('solid automatic-model\nendsolid automatic-model', {
        status: 200,
        headers: { 'Content-Type': 'model/stl' },
      }));
    }
    return realFetch(input, options);
  };

  try {
    const submit = await request(job.submit_path, {
      auth: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: job.token,
        design_id: '123',
        assets: [{
          source_key: 'instance:456',
          filename: 'private-model.stl',
          url: signedUrl,
        }],
      }),
    });
    assert.equal(submit.status, 202);
    assert.equal(submit.headers.get('access-control-allow-origin'), '*');

    let completed;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await request(
        `/api/bambu-projects/${projectId}/makerworld-bridge-jobs/${job.id}`,
      );
      completed = await status.json();
      if (completed.status === 'complete' || completed.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(completed.status, 'complete');
    assert.equal(completed.imported_count, 1);
    assert.equal(completed.failed_count, 0);
    assert.equal(signedFetches, 1);

    const stored = entry.db.prepare(`
      SELECT filename, original_url, source_key
      FROM bambu_assets
      WHERE bambu_project_id = ? AND source_key = ?
    `).get(projectId, 'instance:456');
    assert.deepEqual(stored, {
      filename: 'private-model.stl',
      original_url: 'https://makerworld.com/en/models/123-automatic-model',
      source_key: 'instance:456',
    });
    assert.equal(stored.original_url.includes('?'), false);
    assert.deepEqual(
      JSON.parse(entry.stmts.getBambuProject.get(projectId).import_warnings),
      [],
    );

    const repeatStart = await request(
      `/api/bambu-projects/${projectId}/makerworld-bridge-jobs`,
      { method: 'POST' },
    );
    const repeatJob = await repeatStart.json();
    assert.deepEqual(repeatJob.existing_source_keys, ['instance:456']);
    const repeatSubmit = await request(repeatJob.submit_path, {
      auth: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: repeatJob.token,
        design_id: '123',
        assets: [{
          source_key: 'instance:456',
          filename: 'private-model.stl',
          url: signedUrl,
        }],
      }),
    });
    assert.equal(repeatSubmit.status, 202);

    let repeated;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await request(
        `/api/bambu-projects/${projectId}/makerworld-bridge-jobs/${repeatJob.id}`,
      );
      repeated = await status.json();
      if (repeated.status === 'complete' || repeated.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(repeated.status, 'complete');
    assert.equal(repeated.imported_count, 0);
    assert.equal(repeated.skipped_count, 1);
    assert.equal(signedFetches, 1);
  } finally {
    globalThis.fetch = realFetch;
  }

  const remove = await request(`/api/bambu-projects/${projectId}`, { method: 'DELETE' });
  assert.equal(remove.status, 200);
});

test('MakerWorld bridge includes existing project bytes in the 1 GB limit', async () => {
  const projectId = Number(entry.stmts.insertBambuProject.run({
    title: 'Bridge quota model',
    source_url: 'https://makerworld.com/en/models/124-bridge-quota',
    source_site: 'makerworld',
    source_model_id: '124',
    description: null,
    creator_name: null,
    license_name: null,
  }).lastInsertRowid);
  entry.stmts.insertBambuAsset.run({
    bambu_project_id: projectId,
    kind: 'file',
    filename: 'existing-project.bin',
    content_type: 'application/octet-stream',
    size_bytes: (1024 * 1024 * 1024) - 20,
    original_url: 'https://makerworld.com/en/models/124-bridge-quota',
    file_path: 'existing-project.bin',
    sort_order: 0,
  });
  const start = await request(`/api/bambu-projects/${projectId}/makerworld-bridge-jobs`, {
    method: 'POST',
  });
  const job = await start.json();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.hostname === 'makerworld.bblmw.com') {
      return Promise.resolve(new Response('x'.repeat(40), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    }
    return realFetch(input, options);
  };
  try {
    const submit = await request(job.submit_path, {
      auth: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: job.token,
        design_id: '124',
        assets: [{
          source_key: 'instance:999',
          filename: 'over-limit.bin',
          url: 'https://makerworld.bblmw.com/model/over-limit.bin?key=test',
        }],
      }),
    });
    assert.equal(submit.status, 202);
    const completed = await waitForBridgeJob(projectId, job.id);
    assert.equal(completed.status, 'complete');
    assert.equal(completed.imported_count, 0);
    assert.equal(completed.failed_count, 1);
    assert.match(completed.warnings[0], /1 GB/);
  } finally {
    globalThis.fetch = realFetch;
  }

  const remove = await request(`/api/bambu-projects/${projectId}`, { method: 'DELETE' });
  assert.equal(remove.status, 200);
});
