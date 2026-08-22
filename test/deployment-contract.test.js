import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateMonitor } from '../scripts/check-deployment-monitor.mjs';
import {
  checkMigrationCompatibility,
  parseArgs as parseMigrationArgs,
} from '../scripts/check-migration-compatibility.mjs';
import {
  parseArgs as parseVerifierArgs,
  verifyDeployment,
} from '../scripts/verify-deployment.mjs';
import { loadDeploymentInfo } from '../deployment-info.js';

const readSource = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = readSource('.github/workflows/deploy.yml');
const dockerfile = readSource('Dockerfile');
const compose = readSource('docker-compose.yml');
const localDeploy = readSource('deploy.ps1');
const packageManifest = JSON.parse(readSource('package.json'));
const server = readSource('server.js');
const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  },
});

test('P1-11 workflow has bounded source, audit, SBOM, and signed provenance gates', () => {
  assert.match(workflow, /timeout-minutes: 40/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.match(workflow, /npm run ci:deploy/);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high --json/);
  assert.match(workflow, /npm sbom --sbom-format=cyclonedx/);
  assert.match(workflow, /anchore\/sbom-action@[0-9a-f]{40}/);
  assert.match(workflow, /aquasecurity\/trivy-action@[0-9a-f]{40}/);
  assert.match(workflow, /severity: HIGH,CRITICAL/);
  assert.match(workflow, /cosign sign --yes/);
  assert.match(workflow, /cosign verify --certificate-identity/);
  assert.match(workflow, /cosign attest --yes --predicate evidence\/provenance\.slsa\.json --type slsaprovenance1/);
  assert.match(workflow, /cosign attest --yes --predicate evidence\/image-sbom\.spdx\.json --type spdxjson/);
  assert.match(workflow, /runDetails:[\s\S]*builder:/);
});

test('workflow uses a run-attempt candidate and proves the exact inspected digest', () => {
  assert.match(workflow, /BUILD_ID="\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/);
  assert.match(workflow, /candidate="\$IMAGE_REPOSITORY:\$GITHUB_SHA-\$BUILD_ID"/);
  assert.match(workflow, /--build-arg "BUILD_ID=\$BUILD_ID"/);
  assert.match(workflow, /RepoDigests/);
  assert.match(workflow, /\.Config\.Volumes/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /org\.opencontainers\.image\.version/);
  assert.match(workflow, /com\.workshop\.app-version/);
  assert.match(workflow, /--write-enabled false --delete-enabled false/);
  assert.ok(workflow.indexOf('Verify candidate runtime invariants') < workflow.indexOf('Promote verified digest'));
});

test('workflow preserves Workshop SQLite activation, fingerprints, and rollback', () => {
  assert.match(workflow, /PLATFORM_HEALTH_PATH: \/api\/health/);
  assert.match(workflow, /LIVE_PATH: \/api\/live/);
  assert.match(workflow, /READY_PATH: \/api\/ready/);
  assert.match(workflow, /healthCheckPath == \$platform/);
  for (const path of ['/home/data', '/home/data/workshop.db', '/home/data/workshop-seed.db', '/home/data/users', '/home/data/uploads', '/home/data/backups']) {
    assert.ok(workflow.includes(path), `missing protected path ${path}`);
  }
  assert.match(workflow, /WEBSITES_ENABLE_APP_SERVICE_STORAGE == "true"/);
  assert.match(workflow, /SITE_INVARIANTS_FINGERPRINT/);
  assert.match(workflow, /site="\$\(az webapp show/);
  assert.match(workflow, /az webapp stop/);
  assert.match(workflow, /state" == Stopped/);
  assert.match(workflow, /--container-image-name "\$IMAGE_REFERENCE"/);
  assert.match(workflow, /timeout-minutes: 4/);
  assert.match(workflow, /failure\(\) \|\| cancelled\(\)/);
  assert.match(workflow, /--allow-legacy-build-id/);
  assert.match(workflow, /--ready-path "\$PLATFORM_HEALTH_PATH"/);
  assert.match(workflow, /b45c028e33a1b2cdb961870858d1374c7dbe5e6e/);
  for (const setting of [
    'APPLE_BUNDLE_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
    'APPLE_TOKEN_ENCRYPTION_KEY',
  ]) {
    assert.ok(workflow.includes(setting), `missing protected setting check: ${setting}`);
  }
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /retention-days: 30/);
});

test('runtime has distinct public no-store liveness and SQLite/exporter readiness', () => {
  assert.match(server, /app\.get\('\/api\/live'/);
  assert.match(server, /app\.get\('\/api\/ready'/);
  assert.match(server, /readdirSync\(USERS_DIR, \{ withFileTypes: true \}\)/);
  assert.match(server, /new Database\(databasePath, \{ readonly: true, fileMustExist: true \}\)/);
  assert.match(server, /dbRoot: USERS_DIR/);
  assert.match(server, /database: \{ status: 'ready' \}/);
  assert.match(server, /path === '\/live'/);
  assert.match(server, /path === '\/ready'/);
  assert.match(server, /req\.path === '\/health' \|\| req\.path === '\/live'/);
  assert.match(server, /buildId: deploymentInfo\.buildId/);
  assert.match(server, /Cache-Control', 'no-store'/);
});

test('image embeds build identity without an App Service storage volume', () => {
  assert.match(dockerfile, /ARG BUILD_ID/);
  assert.match(dockerfile, /"buildId":"%s"/);
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.version=\$BUILD_ID/);
  assert.match(dockerfile, /LABEL com\.workshop\.app-version=\$APP_VERSION/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/lib\/node_modules\/corepack/);
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\s+.*\/home/m);
});

test('migration checker applies current schema and preserves prior-release reads', async () => {
  assert.equal(await checkMigrationCompatibility(), true);
});

test('monitor checker accepts only the required enabled recovery wiring', () => {
  assert.equal(validateMonitor({
    alert: {
      enabled: true,
      severity: 1,
      scopes: ['/subscriptions/x/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/log-recovery-prod'],
      actions: {
        actionGroups: ['/subscriptions/x/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag-recovery-alerts'],
      },
      criteria: {
        allOf: [{
          query: 'workshop/v1/monitoring/daily/.../_HEALTH[.]json workshop/v1/monitoring/monthly/.../_HEALTH[.]json',
        }],
      },
    },
    actionGroup: {
      enabled: true,
      id: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag-recovery-alerts',
    },
  }), true);
  assert.throws(() => validateMonitor({ alert: { enabled: false }, actionGroup: {} }), /enabled/);
});

test('verifier requires three stable, distinct live and ready identity rounds', async () => {
  let call = 0;
  const fetchImpl = async url => {
    call += 1;
    const body = url.includes('/api/live')
      ? { status: 'ok', sha: 'a'.repeat(40), buildId: '12-3', instanceId: 'fresh' }
      : {
          status: 'ok',
          sha: 'a'.repeat(40),
          buildId: '12-3',
          instanceId: 'fresh',
          db: '/home/data/workshop.db',
          dbRoot: '/home/data/users',
          database: { status: 'ready' },
          exporter: 'healthy',
        };
    return jsonResponse(body);
  };
  const result = await verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    profile: 'sqlite-one-worker', expectedSha: 'a'.repeat(40), expectedBuildId: '12-3',
    previousInstanceId: 'old', attempts: 3, confirmations: 3, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl, sleep: async () => {} });
  assert.equal(result.confirmations, 3);
  assert.equal(call, 6);
});

test('verifier permits no build ID only for the explicitly requested legacy rollback', async () => {
  const fetchImpl = async url => jsonResponse(url.includes('/api/live')
    ? { status: 'ok', sha: 'b'.repeat(40), instanceId: 'legacy' }
    : { status: 'ok', sha: 'b'.repeat(40), instanceId: 'legacy', db: '/home/data/workshop.db', exporter: 'healthy' });
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    profile: 'sqlite-one-worker', expectedSha: 'b'.repeat(40), expectedBuildId: 'legacy',
    attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl }), /verification failed/);
  const result = await verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    profile: 'sqlite-one-worker', expectedSha: 'b'.repeat(40), expectedBuildId: 'legacy',
    allowLegacyBuildId: true, attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl });
  assert.equal(result.instanceId, 'legacy');
});

test('monitor checker rejects incomplete alert queries and the wrong app', () => {
  const actionGroup = {
    enabled: true,
    id: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag-recovery-alerts',
  };
  const alert = {
    enabled: true,
    severity: 1,
    scopes: ['/subscriptions/x/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/log-recovery-prod'],
    actions: { actionGroups: [actionGroup.id] },
    criteria: { allOf: [{ query: 'workshop/v1/monitoring/daily/.../_HEALTH[.]json' }] },
  };
  assert.throws(() => validateMonitor({ alert, actionGroup }), /daily\/monthly/);
  assert.throws(
    () => validateMonitor({
      alert: {
        ...alert,
        criteria: {
          allOf: [{
            query: 'workshop/v1/monitoring/daily/.../_HEALTH[.]json workshop/v1/monitoring/monthly/.../_HEALTH[.]json',
          }],
        },
      },
      actionGroup,
      webapp: 'another-app',
    }),
    /scoped only/,
  );
});

test('verifier rejects cacheable health responses', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    status: 'ok',
    sha: 'a'.repeat(40),
    buildId: '12-3',
    instanceId: 'fresh',
  }), { status: 200 });
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test',
    livePath: '/api/live',
    readyPath: '/api/ready',
    profile: 'sqlite-one-worker',
    expectedSha: 'a'.repeat(40),
    expectedBuildId: '12-3',
    attempts: 1,
    confirmations: 1,
    intervalMs: 0,
    requestTimeoutMs: 100,
  }, { fetchImpl }), /Cache-Control/);
});

test('deployment verifier CLI enforces profile and three-round confirmation contract', () => {
  const required = [
    '--base-url', 'https://example.test',
    '--live-path', '/api/live',
    '--ready-path', '/api/ready',
    '--expected-sha', 'a'.repeat(40),
    '--expected-build-id', '12-3',
    '--profile', 'sqlite-one-worker',
  ];
  assert.equal(parseVerifierArgs(required).confirmations, 3);
  assert.throws(() => parseVerifierArgs([...required, '--confirmations', '2']), /at least 3/);
  const wrongProfile = required.map(value => value === 'sqlite-one-worker' ? 'external-worker' : value);
  assert.throws(() => parseVerifierArgs(wrongProfile), /sqlite-one-worker/);
});

test('migration CLI accepts only the credential-free SQLite profile', () => {
  assert.deepEqual(parseMigrationArgs(['--profile', 'sqlite-one-worker']), {
    initial: false,
    profile: 'sqlite-one-worker',
  });
  assert.throws(() => parseMigrationArgs(['--profile', 'external-worker']), /sqlite-one-worker/);
  assert.throws(() => parseMigrationArgs(['--unexpected']), /unsupported argument/);
});

test('deployment info requires run-attempt identity in production images', t => {
  const root = mkdtempSync(join(tmpdir(), 'workshop-deployment-info-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'build-info.json'), JSON.stringify({
    sha: 'a'.repeat(40),
    version: '1.2.3+build.45',
    buildId: '123-4',
  }));
  assert.deepEqual(loadDeploymentInfo({ appDir: root, nodeEnv: 'production' }), {
    sha: 'a'.repeat(40),
    version: '1.2.3+build.45',
    buildId: '123-4',
  });
  writeFileSync(join(root, 'build-info.json'), JSON.stringify({
    sha: 'a'.repeat(40),
    version: '1.2.3+build.45',
  }));
  assert.throws(
    () => loadDeploymentInfo({ appDir: root, nodeEnv: 'production' }),
    /run-attempt build ID/,
  );
});

test('development deployment info retains semantic version without inventing image identity', t => {
  const root = mkdtempSync(join(tmpdir(), 'workshop-development-info-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'version.json'), JSON.stringify({
    major: 2,
    minor: 4,
    patch: 6,
    build: 8,
  }));
  assert.deepEqual(loadDeploymentInfo({ appDir: root, nodeEnv: 'test' }), {
    sha: null,
    version: '2.4.6+build.8',
    buildId: null,
  });
});

test('local containers receive explicit nonproduction build identity', () => {
  assert.match(compose, /BUILD_SHA: \$\{BUILD_SHA:-[0]{40}\}/);
  assert.match(compose, /APP_VERSION: \$\{APP_VERSION:-0\.0\.0\+build\.0\}/);
  assert.match(compose, /BUILD_ID: \$\{BUILD_ID:-0-0\}/);
  assert.match(localDeploy, /\$env:BUILD_SHA = \$buildSha/);
  assert.match(localDeploy, /\$env:APP_VERSION = \$appVersion/);
  assert.match(localDeploy, /\$env:BUILD_ID = "0-0"/);
});

test('deploy source command covers every applicable local quality gate', () => {
  assert.equal(packageManifest.scripts['ci:deploy'], 'npm test && npm run build');
  assert.equal(packageManifest.scripts['deploy:migration-check'], 'node scripts/check-migration-compatibility.mjs');
  assert.equal(packageManifest.scripts['deploy:monitor-check'], 'node scripts/check-deployment-monitor.mjs');
  assert.doesNotMatch(workflow, /az webapp config appsettings set/);
  assert.doesNotMatch(workflow, /curl[\s\S]{0,120}(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)/);
});
