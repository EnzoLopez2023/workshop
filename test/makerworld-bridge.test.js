import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser bridge is directly loadable by Chrome with narrowly scoped access', async () => {
  const manifest = JSON.parse(await readSource('extensions/makerworld-bridge/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.4.1');
  assert.deepEqual(manifest.permissions, ['scripting']);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.ok(manifest.host_permissions.includes('https://makerworld.com/*'));
  assert.ok(manifest.host_permissions.includes('https://workshop.nintek.com/*'));
  assert.ok(manifest.host_permissions.includes(
    'https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net/*',
  ));
  assert.equal(manifest.host_permissions.some(host => host.includes('localhost')), false);
  assert.equal(manifest.host_permissions.some(host => host.includes('127.0.0.1')), false);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  assert.equal(manifest.content_scripts.length, 2);

  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(script => script.js),
  ];
  await Promise.all(
    [...new Set(referencedFiles)].map(path =>
      access(new URL(`../extensions/makerworld-bridge/${path}`, import.meta.url))
    ),
  );
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
  const requestedUrls = [];
  const context = {
    URL,
    Response,
    setTimeout,
    clearTimeout,
    window: { location: { origin: 'https://makerworld.com' } },
    fetch: async url => {
      const parsed = url instanceof URL ? url : new URL(String(url));
      requestedUrls.push(parsed);
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
  assert.equal(
    requestedUrls.some(url => url.pathname === '/api/v1/design-service/instance/1/f3mf'),
    false,
  );
  assert.equal(
    requestedUrls.some(url =>
      url.pathname === '/api/v1/design-service/instance/2/f3mf'
      && url.searchParams.get('fileType') === '3mfstl'
    ),
    true,
  );
});

test('MakerWorld collector requests the current whole-model download shape', async () => {
  const source = await readSource('extensions/makerworld-bridge/makerworld-client.js');
  const requestedUrls = [];
  const context = {
    URL,
    Response,
    setTimeout,
    clearTimeout,
    window: { location: { origin: 'https://makerworld.com' } },
    fetch: async url => {
      const parsed = url instanceof URL ? url : new URL(String(url));
      requestedUrls.push(parsed);
      if (parsed.pathname.endsWith('/design/1130362')) {
        return new Response(JSON.stringify({
          id: 1130362,
          title: 'Drawer installation spacers',
          instances: [{ id: 1130523, title: '0.2mm layer, 6 walls' }],
          designExtension: { model_files: [{ modelName: 'dystanse.skp' }] },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (
        parsed.pathname.endsWith('/design/1130362/model')
        && parsed.searchParams.get('modelType') === 'all'
        && parsed.searchParams.get('type') === 'download'
      ) {
        return new Response(JSON.stringify({
          data: {
            downloadUrl: 'https://makerworld.bblmw.com/model/all.zip?at=1&key=all',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (parsed.pathname.endsWith('/design/1130362/instances')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.WorkshopMakerWorldClient.collect('1130362', {
    existingSourceKeys: ['instance:1130523'],
    profileDelayMs: 0,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.assets)),
    [{
      source_key: 'design:1130362:model',
      filename: 'Drawer installation spacers source files.zip',
      url: 'https://makerworld.bblmw.com/model/all.zip?at=1&key=all',
    }],
  );
  assert.equal(
    requestedUrls.some(url =>
      url.pathname.endsWith('/design/1130362/model')
      && url.searchParams.get('modelType') === 'all'
      && url.searchParams.get('type') === 'download'
    ),
    true,
  );
});

test('MakerWorld collector preserves actionable provider failures', async (t) => {
  const source = await readSource('extensions/makerworld-bridge/makerworld-client.js');

  for (const testCase of [
    {
      name: 'login response returned with HTTP 200',
      response: { status: 200, body: { code: 1, error: 'Please log in to download models.' } },
      code: 'makerworld_sign_in_required',
      message: /Sign in to MakerWorld/,
    },
    {
      name: 'verification challenge',
      response: { status: 418, body: { code: 1, error: 'We need to confirm that you are not a robot.' } },
      code: 'makerworld_challenge',
      message: /Download button once/,
    },
    {
      name: 'non-JSON rate limit',
      response: { status: 429, body: 'Too many requests', contentType: 'text/plain' },
      code: 'makerworld_rate_limited',
      message: /Wait 30 seconds/,
    },
  ]) {
    await t.test(testCase.name, async () => {
      let profileRequests = 0;
      const context = {
        URL,
        Response,
        setTimeout,
        clearTimeout,
        window: { location: { origin: 'https://makerworld.com' } },
        fetch: async url => {
          const parsed = url instanceof URL ? url : new URL(String(url));
          if (parsed.pathname.endsWith('/design/1130362')) {
            return new Response(JSON.stringify({
              id: 1130362,
              title: 'Drawer installation spacers',
              instances: [
                { id: 1130523, title: '0.2mm layer, 6 walls' },
                { id: 1130524, title: 'Second print profile' },
              ],
              designExtension: { model_files: [] },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (parsed.pathname.endsWith('/design/1130362/instances')) {
            return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
          }
          profileRequests += 1;
          const body = testCase.response.contentType === 'text/plain'
            ? testCase.response.body
            : JSON.stringify(testCase.response.body);
          return new Response(body, {
            status: testCase.response.status,
            headers: { 'Content-Type': testCase.response.contentType ?? 'application/json' },
          });
        },
      };
      context.globalThis = context;
      vm.createContext(context);
      vm.runInContext(source, context);

      await assert.rejects(
        context.WorkshopMakerWorldClient.collect('1130362', { profileDelayMs: 0 }),
        error => error.code === testCase.code && testCase.message.test(error.message),
      );
      assert.equal(profileRequests, 1);
    });
  }
});

test('bridge protocol remains browser-neutral and never requests or relays credentials', async () => {
  const [
    background,
    workshop,
    makerworldContent,
    makerworldClient,
    popup,
    bridgeClient,
    detail,
    readme,
    chromePackager,
    safariGenerator,
  ] = await Promise.all([
    readSource('extensions/makerworld-bridge/background.js'),
    readSource('extensions/makerworld-bridge/content-workshop.js'),
    readSource('extensions/makerworld-bridge/content-makerworld.js'),
    readSource('extensions/makerworld-bridge/makerworld-client.js'),
    readSource('extensions/makerworld-bridge/popup.html'),
    readSource('src/lib/makerWorldBridge.ts'),
    readSource('src/pages/BambuProjectDetail.tsx'),
    readSource('extensions/makerworld-bridge/README.md'),
    readSource('scripts/package-makerworld-chrome-extension.sh'),
    readSource('scripts/generate-makerworld-safari-extension.sh'),
  ]);
  assert.doesNotMatch(background, /chrome\.cookies|browser\.cookies|password|refreshToken|accessToken/);
  assert.match(background, /token: payload\.token/);
  assert.match(background, /assets: collected\.assets/);
  assert.match(background, /up_to_date: collected\.upToDate === true/);
  assert.match(background, /executeScripts\(tabId, \["makerworld-client\.js", "content-makerworld\.js"\]\)/);
  assert.match(workshop, /WORKSHOP_MAKERWORLD_BRIDGE_READY/);
  assert.match(workshop, /runtime\.getManifest\(\)\.version/);
  assert.match(makerworldContent, /WorkshopMakerWorldClient\.collect/);
  for (const source of [
    background,
    workshop,
    makerworldContent,
    makerworldClient,
    popup,
    bridgeClient,
    detail,
  ]) {
    assert.doesNotMatch(source, /\bSafari\b/);
  }
  assert.match(readme, /chrome:\/\/extensions/);
  assert.match(readme, /Load unpacked/);
  assert.match(readme, /macOS or Windows/);
  assert.match(readme, /unpacked extensions/);
  assert.match(chromePackager, /workshop-makerworld-bridge\.zip/);
  assert.doesNotMatch(chromePackager, /rm\s+-rf/);
  assert.doesNotMatch(safariGenerator, /rm\s+-rf/);
  assert.doesNotMatch(safariGenerator, /--ios-only|--macos-only/);
});
