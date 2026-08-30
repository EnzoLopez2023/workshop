import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Safari bridge requests only the hosts and permissions needed for handoff', async () => {
  const manifest = JSON.parse(await readSource('extensions/makerworld-bridge/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['tabs']);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.ok(manifest.host_permissions.includes('https://makerworld.com/*'));
  assert.ok(manifest.host_permissions.includes('https://workshop.nintek.com/*'));
  assert.equal(manifest.host_permissions.some(host => host.includes('localhost')), false);
  assert.equal(manifest.host_permissions.some(host => host.includes('127.0.0.1')), false);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  assert.equal(manifest.content_scripts.length, 2);
});

test('MakerWorld collector accepts only short-lived provider download URLs', async () => {
  const source = await readSource('extensions/makerworld-bridge/makerworld-client.js');
  const context = { URL, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  const client = context.WorkshopMakerWorldClient;

  assert.equal(
    client.allowedSignedUrl('https://makerworld.bblmw.com/model/file.3mf?at=1&key=test'),
    true,
  );
  assert.equal(
    client.allowedSignedUrl('https://makerworld.bblmw.com/model/file.3mf'),
    false,
  );
  assert.equal(
    client.allowedSignedUrl('https://evil.example/file.3mf?key=test'),
    false,
  );
  assert.equal(client.safeFilename('../../private\r\nfile.3mf', 'fallback'), 'privatefile.3mf');

  const entries = client.collectSignedEntries({
    data: {
      name: 'Workbench profile.3mf',
      url: 'https://makerworld.bblmw.com/model/workbench.3mf?at=1&key=test',
      coverUrl: 'https://makerworld.bblmw.com/images/cover.jpg',
      foreignUrl: 'https://evil.example/file.3mf?key=test',
    },
  }, 'instance:42', 'profile.3mf');
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [{
    source_key: 'instance:42:0',
    filename: 'Workbench profile.3mf',
    url: 'https://makerworld.bblmw.com/model/workbench.3mf?at=1&key=test',
  }]);
});

test('MakerWorld collector merges the complete profile endpoint with embedded profiles', async () => {
  const source = await readSource('extensions/makerworld-bridge/makerworld-client.js');
  const responses = new Map([
    ['/api/v1/design-service/design/123', {
      title: 'Complete model',
      instances: [{ id: 1, title: 'Embedded profile' }],
    }],
    ['/api/v1/design-service/design/123/instances', {
      hits: [
        { id: 1, title: 'Embedded profile' },
        { id: 2, title: 'Additional profile' },
      ],
    }],
    ['/api/v1/design-service/design/123/model', {}],
    ['/api/v1/design-service/instance/1/f3mf', {
      name: 'embedded.3mf',
      url: 'https://makerworld.bblmw.com/model/embedded.3mf?key=one',
    }],
    ['/api/v1/design-service/instance/2/f3mf', {
      name: 'additional.3mf',
      url: 'https://makerworld.bblmw.com/model/additional.3mf?key=two',
    }],
  ]);
  const requestedPaths = [];
  const context = {
    URL,
    Response,
    setTimeout,
    clearTimeout,
    window: { location: { origin: 'https://makerworld.com' } },
    fetch: async url => {
      const parsed = url instanceof URL ? url : new URL(String(url));
      requestedPaths.push(parsed.pathname);
      const payload = responses.get(parsed.pathname);
      return payload
        ? new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('{}', { status: 404 });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.WorkshopMakerWorldClient.collect('123', {
    existingSourceKeys: ['instance:1'],
    profileDelayMs: 0,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.assets.map(asset => asset.source_key))),
    ['instance:2'],
  );
  assert.equal(requestedPaths.includes('/api/v1/design-service/instance/1/f3mf'), false);
  assert.equal(requestedPaths.includes('/api/v1/design-service/instance/2/f3mf'), true);
});

test('bridge protocol never requests or relays MakerWorld credentials', async () => {
  const [background, workshop, makerworld, generator] = await Promise.all([
    readSource('extensions/makerworld-bridge/background.js'),
    readSource('extensions/makerworld-bridge/content-workshop.js'),
    readSource('extensions/makerworld-bridge/content-makerworld.js'),
    readSource('scripts/generate-makerworld-safari-extension.sh'),
  ]);
  assert.doesNotMatch(background, /chrome\.cookies|browser\.cookies|password|refreshToken|accessToken/);
  assert.match(background, /token: payload\.token/);
  assert.match(background, /assets: collected\.assets/);
  assert.match(background, /up_to_date: collected\.upToDate === true/);
  assert.match(workshop, /WORKSHOP_MAKERWORLD_BRIDGE_READY/);
  assert.match(makerworld, /WorkshopMakerWorldClient\.collect/);
  assert.doesNotMatch(generator, /rm\s+-rf/);
  assert.doesNotMatch(generator, /--ios-only|--macos-only/);
});
