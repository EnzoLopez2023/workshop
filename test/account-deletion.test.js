import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { exportJWK, jwtVerify, SignJWT } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_BUNDLE_ID = 'com.nintek.workshop.tests';
const APPLE_TEAM_ID = 'TEAMID1234';
const APPLE_KEY_ID = 'KEYID12345';
const APPLE_SUB_A = 'apple-user-a';
const APPLE_SUB_B = 'apple-user-b';
const APPLE_SUB_LEGACY = 'apple-user-legacy';
const USER_A = appleUserKey(APPLE_SUB_A);
const USER_B = appleUserKey(APPLE_SUB_B);
const USER_LEGACY = appleUserKey(APPLE_SUB_LEGACY);
const USER_C = '11111111-1111-4111-8111-111111111111';
const USER_D = '22222222-2222-4222-8222-222222222222';

let api;
let apiServer;
let appleServer;
let appleSigningKey;
let applePublicJwk;
let clientPublicKey;
let baseUrl;
let tempRoot;
let usersPath;
let uploadsPath;
let userADbPath;
let userBDbPath;
let userA;
let userB;
let userATokens;
let userBTokens;
let appleRevocationError = null;
let failRevocationTokenOnce = null;
let delayedTokenExchange = null;

const authorizationCodes = new Map([
  ['authorization-code-a', APPLE_SUB_A],
  ['authorization-code-b', APPLE_SUB_B],
]);
const issuedRefreshTokens = new Set();
const tokenExchangeRequests = [];
const revocationRequests = [];

function appleUserKey(sub) {
  return `apple_${createHash('sha256').update(sub).digest('hex')}`;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function verifyClientSecret(form) {
  const clientId = form.get('client_id');
  const clientSecret = form.get('client_secret');
  if (!clientId || !clientSecret) throw new Error('missing client credentials');
  const { protectedHeader } = await jwtVerify(clientSecret, clientPublicKey, {
    issuer: APPLE_TEAM_ID,
    subject: clientId,
    audience: APPLE_ISSUER,
  });
  if (protectedHeader.alg !== 'ES256' || protectedHeader.kid !== APPLE_KEY_ID) {
    throw new Error('invalid client secret header');
  }
  return clientId;
}

async function mintAppleIdentityToken(sub) {
  return new SignJWT({ sub, email: `${sub}@example.com` })
    .setProtectedHeader({ alg: 'ES256', kid: applePublicJwk.kid })
    .setIssuer(APPLE_ISSUER)
    .setAudience(APPLE_BUNDLE_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(appleSigningKey);
}

async function handleAppleRequest(req, res) {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/auth/keys') {
    return sendJson(res, 200, { keys: [applePublicJwk] });
  }
  if (req.method !== 'POST' || (path !== '/auth/token' && path !== '/auth/revoke')) {
    return sendJson(res, 404, { error: 'not_found' });
  }

  try {
    const form = await readForm(req);
    const clientId = await verifyClientSecret(form);
    if (clientId !== APPLE_BUNDLE_ID) {
      return sendJson(res, 400, { error: 'invalid_client' });
    }

    if (path === '/auth/token') {
      const code = form.get('code');
      const sub = authorizationCodes.get(code);
      tokenExchangeRequests.push({
        clientId,
        code,
        grantType: form.get('grant_type'),
      });
      if (!sub || form.get('grant_type') !== 'authorization_code') {
        return sendJson(res, 400, { error: 'invalid_grant' });
      }
      if (delayedTokenExchange?.code === code) {
        delayedTokenExchange.started();
        await delayedTokenExchange.release;
      }
      authorizationCodes.delete(code);
      const refreshToken = `refresh-token-for-${sub}-${code}`;
      issuedRefreshTokens.add(refreshToken);
      return sendJson(res, 200, {
        access_token: `access-token-for-${sub}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        id_token: await mintAppleIdentityToken(sub),
      });
    }

    const token = form.get('token');
    revocationRequests.push({
      clientId,
      token,
      tokenTypeHint: form.get('token_type_hint'),
      accountDbExisted: userADbPath ? existsSync(userADbPath) : null,
    });
    if (appleRevocationError) {
      const status = appleRevocationError === 'server_error' ? 500 : 400;
      return sendJson(res, status, { error: appleRevocationError });
    }
    if (failRevocationTokenOnce === token) {
      failRevocationTokenOnce = null;
      return sendJson(res, 500, { error: 'server_error' });
    }
    if (!issuedRefreshTokens.has(token) || form.get('token_type_hint') !== 'refresh_token') {
      return sendJson(res, 400, { error: 'invalid_grant' });
    }
    issuedRefreshTokens.delete(token);
    res.writeHead(200);
    return res.end();
  } catch {
    return sendJson(res, 400, { error: 'invalid_client' });
  }
}

function insertProject(db, title, isTemplate = 0) {
  const info = db.prepare(`
    INSERT INTO projects (
      title, description, status, difficulty, estimated_hours,
      wood_types, tools_needed, is_template, template_name
    ) VALUES (?, ?, 'planning', 'Intermediate', 3, '["Walnut"]', '["Saw"]', ?, ?)
  `).run(title, `${title} description`, isTemplate, isTemplate ? title : null);
  return Number(info.lastInsertRowid);
}

function seedCompleteAccount(db, filenames) {
  const projectId = insertProject(db, 'Caller project');
  const linkedProjectId = insertProject(db, 'Caller template', 1);

  db.prepare(`
    INSERT INTO project_images (
      project_id, kind, image_data, image_type, file_path, sort_order
    ) VALUES (?, 'sketch', ?, 'image/png', ?, 1)
  `).run(projectId, Buffer.from('embedded image'), filenames.project);
  db.prepare(`
    INSERT INTO project_images (
      project_id, kind, image_type, file_path, sort_order
    ) VALUES (?, 'inspiration', 'image/png', ?, 2)
  `).run(projectId, filenames.shared);
  db.prepare(`
    INSERT INTO cut_list_items (
      project_id, part_name, qty, length, width, thickness, material, sort_order
    ) VALUES (?, 'Side', 2, '12', '4', '0.75', 'Walnut', 1)
  `).run(projectId);
  db.prepare(`
    INSERT INTO materials (project_id, name, qty_label, cost, purchased, sort_order)
    VALUES (?, 'Walnut board', '1', 20, 1, 1)
  `).run(projectId);
  db.prepare(`
    INSERT INTO build_log_entries (project_id, note, file_path, image_type)
    VALUES (?, 'Assembly', ?, 'image/jpeg')
  `).run(projectId, filenames.build);
  db.prepare(`
    INSERT INTO finish_log_entries (
      project_id, product_name, finish_type, color, coats, notes, applied_at
    ) VALUES (?, 'Oil', 'oil', 'clear', 2, 'Done', '2026-08-10')
  `).run(projectId);
  db.prepare(`
    INSERT INTO project_links (project_id, linked_project_id, relationship)
    VALUES (?, ?, 'related')
  `).run(projectId, linkedProjectId);

  const shaperId = Number(db.prepare(`
    INSERT INTO shaper_projects (
      title, shaper_url, description, materials, instructions
    ) VALUES ('Shaper project', 'https://hub.shapertools.com/example', 'Shaper data', '[]', 'Cut it')
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO cut_list_items (
      shaper_project_id, part_name, qty, length, width, thickness, material, sort_order
    ) VALUES (?, 'Shaper part', 1, '4', '4', '0.5', 'Plywood', 1)
  `).run(shaperId);

  const bambuId = Number(db.prepare(`
    INSERT INTO bambu_projects (
      title, source_url, source_site, source_model_id, description
    ) VALUES (
      'Bambu project', 'https://www.printables.com/model/1-example',
      'printables', '1', '3D model data'
    )
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO bambu_assets (
      bambu_project_id, kind, filename, content_type,
      size_bytes, original_url, file_path, sort_order
    ) VALUES (
      ?, 'model', 'part.stl', 'model/stl',
      12, 'https://files.printables.com/part.stl', ?, 1
    )
  `).run(bambuId, filenames.bambu);

  const pageId = Number(db.prepare(`
    INSERT INTO notebook_pages (title, body) VALUES ('Legacy note', 'Account-owned note')
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO notebook_links (page_id, url, caption, sort_order)
    VALUES (?, 'https://example.com', 'Reference', 1)
  `).run(pageId);
  db.prepare(`
    INSERT INTO user_profile (id, display_name, email)
    VALUES (1, 'Caller', 'caller@example.com')
  `).run();
  return projectId;
}

function writeUpload(filename, contents) {
  writeFileSync(join(uploadsPath, filename), contents);
}

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function signInWithApple(sub, authorizationCode, name) {
  const response = await request('/api/auth/apple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_token: await mintAppleIdentityToken(sub),
      authorization_code: authorizationCode,
      name,
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

before(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'workshop-account-deletion-'));
  usersPath = join(tempRoot, 'users');
  uploadsPath = join(tempRoot, 'uploads');

  const clientKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  clientPublicKey = clientKeys.publicKey;
  const clientPrivateKey = clientKeys.privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const appleKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  appleSigningKey = appleKeys.privateKey;
  applePublicJwk = {
    ...await exportJWK(appleKeys.publicKey),
    alg: 'ES256',
    kid: 'APPLEKEY01',
    use: 'sig',
  };

  appleServer = createServer((req, res) => {
    handleAppleRequest(req, res);
  });
  appleServer.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    appleServer.once('listening', resolve);
    appleServer.once('error', reject);
  });
  const appleAddress = appleServer.address();
  const appleBaseUrl = `http://127.0.0.1:${appleAddress.port}`;

  process.env.NODE_ENV = 'test';
  process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000001';
  process.env.API_AUDIENCE = '00000000-0000-0000-0000-000000000002';
  process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-thirty-two-bytes-long';
  process.env.APPLE_BUNDLE_ID = APPLE_BUNDLE_ID;
  process.env.APPLE_TEAM_ID = APPLE_TEAM_ID;
  process.env.APPLE_KEY_ID = APPLE_KEY_ID;
  process.env.APPLE_PRIVATE_KEY = clientPrivateKey;
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key-that-is-at-least-thirty-two-bytes';
  process.env.APPLE_OAUTH_BASE_URL = appleBaseUrl;
  process.env.APPLE_JWKS_URL = `${appleBaseUrl}/auth/keys`;
  process.env.DB_PATH = join(tempRoot, 'legacy.db');
  process.env.USERS_DIR = usersPath;
  process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
  process.env.UPLOADS_PATH = uploadsPath;

  const legacySeed = new Database(process.env.SEED_DB_PATH);
  legacySeed.exec(`
    CREATE TABLE project_images (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      kind       TEXT NOT NULL,
      image_data BLOB,
      image_type TEXT,
      image_url  TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  legacySeed.close();

  api = await import(`../server.js?account-deletion-test=${Date.now()}`);
  apiServer = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    apiServer.once('listening', resolve);
    apiServer.once('error', reject);
  });
  const address = apiServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  userA = api.getUserDb(USER_A);
  userB = api.getUserDb(USER_B);
  userADbPath = join(usersPath, `${USER_A}.db`);
  userBDbPath = join(usersPath, `${USER_B}.db`);

  const callerProjectId = seedCompleteAccount(userA.db, {
    project: 'caller-project.png',
    build: 'caller-build.jpg',
    bambu: 'caller-model.stl',
    shared: 'shared-reference.png',
  });
  userA.db.prepare(`
    INSERT INTO project_images (
      project_id, kind, image_type, file_path, sort_order
    ) VALUES (?, 'inspiration', 'image/png', 'cleanup-blocker', 3)
  `).run(callerProjectId);
  const otherProjectId = insertProject(userB.db, 'Other user project');
  userB.db.prepare(`
    INSERT INTO project_images (
      project_id, kind, image_type, file_path, sort_order
    ) VALUES (?, 'sketch', 'image/png', 'other-user.png', 1)
  `).run(otherProjectId);
  userB.db.prepare(`
    INSERT INTO project_images (
      project_id, kind, image_type, file_path, sort_order
    ) VALUES (?, 'inspiration', 'image/png', 'shared-reference.png', 2)
  `).run(otherProjectId);
  userB.db.prepare(`
    INSERT INTO user_profile (id, display_name, email)
    VALUES (1, 'Other User', 'other@example.com')
  `).run();

  writeUpload('caller-project.png', 'caller project');
  writeUpload('caller-build.jpg', 'caller build');
  writeUpload('caller-model.stl', 'solid model');
  writeUpload('shared-reference.png', 'shared');
  writeUpload('other-user.png', 'other user');
  mkdirSync(join(uploadsPath, 'cleanup-blocker'));

  userATokens = await signInWithApple(APPLE_SUB_A, 'authorization-code-a', 'Caller');
  userBTokens = await signInWithApple(APPLE_SUB_B, 'authorization-code-b', 'Other User');
});

after(async () => {
  api?.closeAllDatabases();
  if (apiServer) {
    await new Promise((resolve, reject) => {
      apiServer.close(error => error ? reject(error) : resolve());
    });
  }
  if (appleServer) {
    await new Promise((resolve, reject) => {
      appleServer.close(error => error ? reject(error) : resolve());
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('Apple-backed DELETE /api/account', async (t) => {
  await t.test('exchanges authorization codes and encrypts refresh tokens', () => {
    assert.deepEqual(tokenExchangeRequests, [
      {
        clientId: APPLE_BUNDLE_ID,
        code: 'authorization-code-a',
        grantType: 'authorization_code',
      },
      {
        clientId: APPLE_BUNDLE_ID,
        code: 'authorization-code-b',
        grantType: 'authorization_code',
      },
    ]);
    const credential = userA.db.prepare(`
      SELECT client_id, refresh_token_enc FROM apple_credentials ORDER BY id LIMIT 1
    `).get();
    assert.equal(credential.client_id, APPLE_BUNDLE_ID);
    assert.match(credential.refresh_token_enc, /^v1:/);
    assert.equal(credential.refresh_token_enc.includes('refresh-token-for'), false);
  });

  await t.test('keeps legacy Apple sign-in compatible without an authorization code', async () => {
    const sub = 'missing-code-user';
    const response = await request('/api/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_token: await mintAppleIdentityToken(sub),
      }),
    });

    assert.equal(response.status, 200);
    const tokens = await response.json();
    const legacy = api.getUserDb(appleUserKey(sub));
    assert.equal(legacy.stmts.countAppleCredentials.get().count, 0);

    const deletion = await request('/api/account', {
      method: 'DELETE',
      token: tokens.accessToken,
    });
    assert.equal(deletion.status, 409);
    assert.deepEqual(await deletion.json(), { error: 'apple_reauthentication_required' });
  });

  await t.test('requires authentication for deletion', async () => {
    const response = await request('/api/account', { method: 'DELETE' });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'missing token' });
    assert.equal(existsSync(userADbPath), true);
  });

  await t.test('requires legacy Apple accounts to reauthenticate first', async () => {
    const legacy = api.getUserDb(USER_LEGACY);
    insertProject(legacy.db, 'Legacy Apple project');
    const legacyTokens = await api.mintSession(USER_LEGACY);

    const response = await request('/api/account', {
      method: 'DELETE',
      token: legacyTokens.accessToken,
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'apple_reauthentication_required' });
    assert.equal(existsSync(join(usersPath, `${USER_LEGACY}.db`)), true);
  });

  await t.test('preserves the account when Apple revocation is unavailable', async () => {
    appleRevocationError = 'server_error';
    const response = await request('/api/account', {
      method: 'DELETE',
      token: userATokens.accessToken,
    });
    appleRevocationError = null;

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'apple_token_revocation_failed' });
    assert.equal(existsSync(userADbPath), true);
    assert.equal(existsSync(join(uploadsPath, 'caller-project.png')), true);
    assert.equal(revocationRequests.at(-1).accountDbExisted, true);
  });

  await t.test('does not treat Apple invalid_grant as successful revocation', async () => {
    appleRevocationError = 'invalid_grant';
    const response = await request('/api/account', {
      method: 'DELETE',
      token: userATokens.accessToken,
    });
    appleRevocationError = null;

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'apple_token_revocation_failed' });
    assert.equal(existsSync(userADbPath), true);
  });

  await t.test('persists revocation and file-cleanup progress across retries', async () => {
    const concurrentCode = 'authorization-code-a-concurrent';
    const concurrentRefreshToken = `refresh-token-for-${APPLE_SUB_A}-${concurrentCode}`;
    authorizationCodes.set(concurrentCode, APPLE_SUB_A);
    let markExchangeStarted;
    let releaseExchange;
    const exchangeStarted = new Promise(resolve => { markExchangeStarted = resolve; });
    const exchangeRelease = new Promise(resolve => { releaseExchange = resolve; });
    delayedTokenExchange = {
      code: concurrentCode,
      started: markExchangeStarted,
      release: exchangeRelease,
    };

    const concurrentSignIn = request('/api/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_token: await mintAppleIdentityToken(APPLE_SUB_A),
        authorization_code: concurrentCode,
      }),
    });
    await exchangeStarted;
    const deletion = request('/api/account', {
      method: 'DELETE',
      token: userATokens.accessToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey: USER_B }),
    });
    failRevocationTokenOnce = concurrentRefreshToken;
    await new Promise(resolve => setTimeout(resolve, 50));
    releaseExchange();

    const signInResponse = await concurrentSignIn;
    const partialRevocationResponse = await deletion;
    delayedTokenExchange = null;

    assert.equal(signInResponse.status, 409);
    assert.deepEqual(await signInResponse.json(), { error: 'account_deletion_in_progress' });
    assert.equal(partialRevocationResponse.status, 502);
    assert.deepEqual(
      await partialRevocationResponse.json(),
      { error: 'apple_token_revocation_failed' }
    );
    assert.equal(existsSync(userADbPath), true);

    const localCleanupResponse = await request('/api/account', {
      method: 'DELETE',
      token: userATokens.accessToken,
    });
    assert.equal(localCleanupResponse.status, 500);
    assert.deepEqual(await localCleanupResponse.json(), { error: 'account_deletion_failed' });
    assert.equal(existsSync(userADbPath), true);
    assert.equal(
      userA.db.prepare(`
        SELECT COUNT(*) AS count
        FROM apple_credentials
        WHERE revoked_at IS NULL
      `).get().count,
      0
    );
    assert.equal(
      userA.db.prepare(`
        SELECT COUNT(*) AS count
        FROM bambu_assets
        WHERE file_path = 'caller-model.stl'
      `).get().count,
      0
    );
    assert.equal(
      userA.db.prepare(`
        SELECT COUNT(*) AS count
        FROM project_images
        WHERE file_path IN ('caller-project.png', 'cleanup-blocker')
      `).get().count,
      0
    );
    assert.equal(
      userA.db.prepare(`
        SELECT COUNT(*) AS count
        FROM build_log_entries
        WHERE file_path = 'caller-build.jpg'
      `).get().count,
      0
    );
    assert.deepEqual(
      userA.db.prepare(`SELECT filename FROM account_deletion_files ORDER BY filename`).all(),
      [{ filename: 'cleanup-blocker' }]
    );

    rmSync(join(uploadsPath, 'cleanup-blocker'), { recursive: true, force: true });
    const revocationCountBeforeFinalCleanup = revocationRequests.length;
    const response = await request('/api/account', {
      method: 'DELETE',
      token: userATokens.accessToken,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(revocationRequests.length, revocationCountBeforeFinalCleanup);
    assert.deepEqual(
      revocationRequests.slice(-3),
      [
        {
          clientId: APPLE_BUNDLE_ID,
          token: `refresh-token-for-${APPLE_SUB_A}-authorization-code-a`,
          tokenTypeHint: 'refresh_token',
          accountDbExisted: true,
        },
        {
          clientId: APPLE_BUNDLE_ID,
          token: concurrentRefreshToken,
          tokenTypeHint: 'refresh_token',
          accountDbExisted: true,
        },
        {
          clientId: APPLE_BUNDLE_ID,
          token: concurrentRefreshToken,
          tokenTypeHint: 'refresh_token',
          accountDbExisted: true,
        },
      ]
    );
    assert.equal(existsSync(userADbPath), false);
    assert.equal(existsSync(`${userADbPath}-wal`), false);
    assert.equal(existsSync(`${userADbPath}-shm`), false);
    assert.equal(existsSync(join(uploadsPath, 'caller-project.png')), false);
    assert.equal(existsSync(join(uploadsPath, 'caller-build.jpg')), false);
    assert.equal(existsSync(join(uploadsPath, 'caller-model.stl')), false);
    assert.equal(existsSync(join(uploadsPath, 'shared-reference.png')), true);
    assert.equal(readFileSync(join(uploadsPath, 'shared-reference.png'), 'utf8'), 'shared');

    assert.equal(existsSync(userBDbPath), true);
    assert.equal(existsSync(join(uploadsPath, 'other-user.png')), true);
    assert.equal(userB.db.prepare(`SELECT COUNT(*) AS count FROM projects`).get().count, 1);
    assert.equal(
      userB.db.prepare(`SELECT display_name FROM user_profile WHERE id = 1`).get().display_name,
      'Other User'
    );

    const otherUserResponse = await request('/api/projects', {
      token: userBTokens.accessToken,
    });
    assert.equal(otherUserResponse.status, 200);
    assert.equal((await otherUserResponse.json())[0].title, 'Other user project');
  });

  await t.test('serializes concurrent deletion of the last shared-file references', async () => {
    const userC = api.getUserDb(USER_C);
    const userD = api.getUserDb(USER_D);
    const projectC = insertProject(userC.db, 'Shared owner C');
    const projectD = insertProject(userD.db, 'Shared owner D');
    for (const [db, projectId] of [[userC.db, projectC], [userD.db, projectD]]) {
      db.prepare(`
        INSERT INTO project_images (
          project_id, kind, image_type, file_path, sort_order
        ) VALUES (?, 'sketch', 'image/png', 'cross-delete-shared.png', 1)
      `).run(projectId);
    }
    writeUpload('cross-delete-shared.png', 'shared by deleting accounts');
    const tokensC = await api.mintSession(USER_C);
    const tokensD = await api.mintSession(USER_D);

    const [responseC, responseD] = await Promise.all([
      request('/api/account', { method: 'DELETE', token: tokensC.accessToken }),
      request('/api/account', { method: 'DELETE', token: tokensD.accessToken }),
    ]);

    assert.equal(responseC.status, 200);
    assert.equal(responseD.status, 200);
    assert.equal(existsSync(join(usersPath, `${USER_C}.db`)), false);
    assert.equal(existsSync(join(usersPath, `${USER_D}.db`)), false);
    assert.equal(existsSync(join(uploadsPath, 'cross-delete-shared.png')), false);
  });

  await t.test('revokes Workshop tokens without public-read resurrection', async () => {
    const accessResponse = await request('/api/projects', {
      token: userATokens.accessToken,
    });
    assert.equal(accessResponse.status, 401);

    const refreshResponse = await request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: userATokens.refreshToken }),
    });
    assert.equal(refreshResponse.status, 401);
    assert.equal(existsSync(userADbPath), false);

    const publicImageResponse = await request(`/api/images/1?oid=${USER_A}`);
    assert.equal(publicImageResponse.status, 404);
    const publicBambuAssetResponse = await request(`/api/bambu-assets/1/image?oid=${USER_A}`);
    assert.equal(publicBambuAssetResponse.status, 404);
    assert.equal(existsSync(userADbPath), false);

    const recreated = api.getUserDb(USER_A);
    assert.equal(recreated.db.prepare(`SELECT COUNT(*) AS count FROM projects`).get().count, 0);
    assert.equal(existsSync(userADbPath), true);

    const resurrectedAccess = await request('/api/projects', {
      token: userATokens.accessToken,
    });
    assert.equal(resurrectedAccess.status, 401);

    const resurrectedRefresh = await request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: userATokens.refreshToken }),
    });
    assert.equal(resurrectedRefresh.status, 401);
  });
});
