import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { exportJWK, SignJWT } from 'jose';

const HOME_TID = '52188f12-db6b-46c6-88ff-08c802f0ed3b';
const EXTERNAL_TID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXTERNAL_TID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MSA_TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const SHARED_OID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME_OID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MSA_OID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const API_AUDIENCE = '0f303f8f-207f-4b7f-84a5-b5d0abcf49d1';

let api;
let apiServer;
let baseUrl;
let tempRoot;
let usersPath;
let signingKey;
let signingKid;
let badSigningKey;

const userKey = (tid, oid) => tid === HOME_TID ? oid : `${tid}_${oid}`;

async function mintToken({
  tid,
  oid,
  issuer = `https://login.microsoftonline.com/${tid}/v2.0`,
  audience = API_AUDIENCE,
  scope = 'access_as_user',
  key = signingKey,
  kid = signingKid,
}) {
  return new SignJWT({ tid, oid, scp: scope })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function createProject(token, title) {
  const response = await request('/api/projects', {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  assert.equal(response.status, 201);
}

before(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'workshop-entra-auth-'));
  usersPath = join(tempRoot, 'users');

  const trustedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  signingKey = trustedKeys.privateKey;
  signingKid = 'trusted-entra-test-key';
  const publicJwk = {
    ...await exportJWK(trustedKeys.publicKey),
    alg: 'RS256',
    kid: signingKid,
    use: 'sig',
  };
  badSigningKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

  process.env.NODE_ENV = 'test';
  process.env.AZURE_HOME_TENANT_ID = HOME_TID;
  process.env.API_AUDIENCE = API_AUDIENCE;
  process.env.ENTRA_TEST_JWKS = JSON.stringify({ keys: [publicJwk] });
  process.env.DB_PATH = join(tempRoot, 'legacy.db');
  process.env.USERS_DIR = usersPath;
  process.env.SEED_DB_PATH = join(tempRoot, 'seed.db');
  process.env.UPLOADS_PATH = join(tempRoot, 'uploads');

  api = await import(`../server.js?entra-multitenant-test=${Date.now()}`);
  apiServer = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    apiServer.once('listening', resolve);
    apiServer.once('error', reject);
  });
  const address = apiServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  api?.closeAllDatabases();
  if (apiServer) {
    await new Promise((resolve, reject) => {
      apiServer.close(error => error ? reject(error) : resolve());
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('home-tenant v2 and v1 access tokens preserve the bare oid data key', async () => {
  const uppercaseOid = HOME_OID.toUpperCase();
  const v2Token = await mintToken({ tid: HOME_TID, oid: uppercaseOid });
  assert.equal(await api.userKeyFromBearer(v2Token), HOME_OID);

  const response = await request('/api/projects', { token: v2Token });
  assert.equal(response.status, 200);
  assert.equal(existsSync(join(usersPath, `${HOME_OID}.db`)), true);

  const v1Token = await mintToken({
    tid: HOME_TID,
    oid: HOME_OID,
    issuer: `https://sts.windows.net/${HOME_TID}/`,
    audience: `api://${API_AUDIENCE}`,
  });
  assert.equal(await api.userKeyFromBearer(v1Token), HOME_OID);
});

test('external Entra and MSA tokens use tenant-namespaced data keys', async () => {
  const externalToken = await mintToken({ tid: EXTERNAL_TID_A, oid: SHARED_OID });
  const msaToken = await mintToken({ tid: MSA_TID, oid: MSA_OID });

  assert.equal(
    await api.userKeyFromBearer(externalToken),
    userKey(EXTERNAL_TID_A, SHARED_OID)
  );
  assert.equal(await api.userKeyFromBearer(msaToken), userKey(MSA_TID, MSA_OID));
  assert.equal((await request('/api/projects', { token: msaToken })).status, 200);
  assert.equal(existsSync(join(usersPath, `${userKey(MSA_TID, MSA_OID)}.db`)), true);
});

test('two tenants with the same oid cannot share data or account deletion', async () => {
  const tokenA = await mintToken({ tid: EXTERNAL_TID_A, oid: SHARED_OID });
  const tokenB = await mintToken({ tid: EXTERNAL_TID_B, oid: SHARED_OID });
  const keyA = userKey(EXTERNAL_TID_A, SHARED_OID);
  const keyB = userKey(EXTERNAL_TID_B, SHARED_OID);

  await createProject(tokenA, 'Tenant A project');
  await createProject(tokenB, 'Tenant B project');

  const listA = await request('/api/projects', { token: tokenA });
  const listB = await request('/api/projects', { token: tokenB });
  assert.deepEqual((await listA.json()).map(project => project.title), ['Tenant A project']);
  assert.deepEqual((await listB.json()).map(project => project.title), ['Tenant B project']);
  assert.equal(existsSync(join(usersPath, `${keyA}.db`)), true);
  assert.equal(existsSync(join(usersPath, `${keyB}.db`)), true);

  const dbA = api.getUserDb(keyA).db;
  const dbB = api.getUserDb(keyB).db;
  for (const [db, marker, filename] of [
    [dbA, 'tenant-a-image', 'tenant-a-build.jpg'],
    [dbB, 'tenant-b-image', 'tenant-b-build.jpg'],
  ]) {
    db.prepare(`
      INSERT INTO project_images (
        project_id, kind, image_data, image_type, sort_order
      ) VALUES (1, 'sketch', ?, 'text/plain', 1)
    `).run(Buffer.from(marker));
    db.prepare(`
      INSERT INTO build_log_entries (project_id, note, file_path, image_type)
      VALUES (1, 'Build', ?, 'text/plain')
    `).run(filename);
    writeFileSync(join(tempRoot, 'uploads', filename), `${marker}-build`);
  }

  const imageA = await request(`/api/images/1?userKey=${keyA}`);
  const imageB = await request(`/api/images/1?userKey=${keyB}`);
  assert.equal(await imageA.text(), 'tenant-a-image');
  assert.equal(await imageB.text(), 'tenant-b-image');
  const buildA = await request(`/api/build-log/1/image?userKey=${keyA}`);
  const buildB = await request(`/api/build-log/1/image?userKey=${keyB}`);
  assert.equal(await buildA.text(), 'tenant-a-image-build');
  assert.equal(await buildB.text(), 'tenant-b-image-build');

  const deletion = await request('/api/account', { method: 'DELETE', token: tokenA });
  assert.equal(deletion.status, 200);
  assert.deepEqual(await deletion.json(), { success: true });
  assert.equal(existsSync(join(usersPath, `${keyA}.db`)), false);
  assert.equal(existsSync(join(usersPath, `${keyB}.db`)), true);
  assert.equal(existsSync(join(tempRoot, 'uploads', 'tenant-a-build.jpg')), false);
  assert.equal(existsSync(join(tempRoot, 'uploads', 'tenant-b-build.jpg')), true);

  const survivingList = await request('/api/projects', { token: tokenB });
  assert.equal(survivingList.status, 200);
  assert.deepEqual(
    (await survivingList.json()).map(project => project.title),
    ['Tenant B project']
  );
});

test('bad audience, issuer, tid, signature, and scope are rejected', async (t) => {
  const cases = [
    ['audience', { tid: EXTERNAL_TID_A, oid: SHARED_OID, audience: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
    ['issuer', { tid: EXTERNAL_TID_A, oid: SHARED_OID, issuer: `https://login.microsoftonline.com/${EXTERNAL_TID_B}/v2.0` }],
    ['tid', { tid: 'not-a-guid', oid: SHARED_OID, issuer: 'https://login.microsoftonline.com/not-a-guid/v2.0' }],
    ['signature', { tid: EXTERNAL_TID_A, oid: SHARED_OID, key: badSigningKey }],
    ['scope', { tid: EXTERNAL_TID_A, oid: SHARED_OID, scope: 'openid profile' }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const response = await request('/api/projects', { token: await mintToken(options) });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'invalid token' });
    });
  }
});
