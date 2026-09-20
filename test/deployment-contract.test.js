import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectMonitor, validateMonitor } from '../scripts/check-deployment-monitor.mjs';
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
const workflowJobs = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
const jobSections = [...workflowJobs.matchAll(/^  ([a-z][a-z-]*):\n/gm)];
const jobs = Object.fromEntries(jobSections.map((match, index) => [
  match[1],
  workflowJobs.slice(match.index, jobSections[index + 1]?.index ?? workflowJobs.length),
]));
const stepSource = (job, name) => {
  const source = jobs[job].split(`      - name: ${name}\n`)[1]?.split(/\n      - /)[0];
  assert.ok(source, `missing ${job} step: ${name}`);
  return source;
};
const stepScript = (job, name) => {
  const source = stepSource(job, name).split('        run: |\n')[1];
  assert.ok(source, `missing ${job} script: ${name}`);
  return source.replace(/^          /gm, '');
};
const dockerfile = readSource('Dockerfile');
const compose = readSource('docker-compose.yml');
const localDeploy = readSource('deploy.ps1');
const verifierSource = readSource('scripts/verify-deployment.mjs');
const packageManifest = JSON.parse(readSource('package.json'));
const server = readSource('server.js');
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  },
});

test('workflow retains source checks and full-strength observable diagnostics', () => {
  assert.match(jobs.build, /npm ci --no-audit --no-fund/);
  assert.match(jobs.build, /npm test/);
  assert.doesNotMatch(jobs.build, /npm run (?:ci:deploy|build)/);
  assert.match(dockerfile, /RUN npm run build/);
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
  assert.match(workflow, /ignore-unfixed: false/);
  for (const [name, action] of [['Record exact-image SBOM result', 'sbom'], ['Record image vulnerability findings', 'scan']]) {
    const source = stepSource('image-diagnostics', name);
    assert.match(source, new RegExp(`execution-error: \\$\\{\\{ steps\\.${action}\\.outcome != 'success'`));
    assert.doesNotMatch(source, /exit-code:/);
  }
  assert.doesNotMatch(workflow, /signatureVerified:true|provenanceVerified:true|monitoringChecked:true/);
});

test('only production mutation is serialized and diagnostics cannot be needs ancestors', () => {
  assert.doesNotMatch(workflow, /^concurrency:/m);
  assert.match(jobs.deploy, /concurrency:\n      group: deploy-workshop\n      cancel-in-progress: false\n      queue: max/);
  assert.match(jobs.deploy, /with: \{ fetch-depth: 0 \}/);
  assert.doesNotMatch(workflow, /current-source|Exclude stale builds/);
  for (const [id, source] of Object.entries(jobs)) {
    if (id !== 'deploy') assert.doesNotMatch(source, /concurrency:/);
  }
  const dependencies = Object.fromEntries(Object.entries(jobs).map(([id, source]) => [
    id, (source.match(/^    needs: (.+)$/m)?.[1] ?? '').replace(/[[\]\s]/g, '').split(',').filter(Boolean),
  ]));
  const ancestors = id => dependencies[id].flatMap(parent => [parent, ...ancestors(parent)]);
  assert.deepEqual(ancestors('build'), []);
  assert.deepEqual(ancestors('deploy'), ['build']);
  assert.deepEqual(dependencies['source-diagnostics'], []);
  assert.deepEqual(dependencies['image-diagnostics'], ['build']);
  assert.deepEqual(Object.keys(jobs), ['build', 'source-diagnostics', 'deploy', 'image-diagnostics']);
  assert.match(jobs['image-diagnostics'], /if: \$\{\{ always\(\) && needs\.build\.outputs\.ref != '' \}\}/);
  assert.match(jobs['image-diagnostics'], /DIAGNOSTIC_BUILD_ID: \$\{\{ needs\.build\.outputs\.build-id \}\}/);
  for (const id of ['build', 'deploy']) {
    assert.doesNotMatch(jobs[id], /npm audit|npm sbom|cosign |trivy-action|sbom-action|check-deployment-monitor|deploy:migration-check/);
    assert.doesNotMatch(jobs[id], /^    continue-on-error:/m);
  }
  for (const id of ['source-diagnostics', 'image-diagnostics']) {
    assert.match(jobs[id], /mode: aggregate/);
    assert.match(jobs[id], /if: \$\{\{ always\(\) \}\}\n        continue-on-error: true\n        uses: actions\/upload-artifact/);
    assert.match(jobs[id], /steps\.evidence\.outcome == 'failure'/);
    assert.match(jobs[id], /retention-days: 30/);
  }
  assert.equal((workflow.match(/deploy:monitor-check/g) ?? []).length, 1);
  assert.match(jobs['source-diagnostics'], /deploy:monitor-check -- --phase predeploy/);
  assert.doesNotMatch(workflow, /monitoring-postcheck|MONITOR_PHASE|monitor-phase/);
});

test('runner builds once with shared cached dependencies and fresh runtime patches', () => {
  assert.equal((workflow.match(/uses: docker\/build-push-action@/g) ?? []).length, 1);
  assert.match(jobs.build, /docker\/setup-buildx-action@[0-9a-f]{40}/);
  assert.match(jobs.build, /platforms: linux\/amd64/);
  assert.match(jobs.build, /push: true/);
  assert.match(jobs.build, /pull: true/);
  assert.match(jobs.build, /cache-from: type=gha,scope=workshop/);
  assert.match(jobs.build, /cache-to: type=gha,mode=max,scope=workshop/);
  assert.match(jobs.build, /no-cache-filters: runner/);
  assert.doesNotMatch(workflow, /az acr build/);
  assert.equal((dockerfile.match(/npm ci /g) ?? []).length, 1);
  assert.match(dockerfile, /--mount=type=cache,target=\/root\/\.npm/);
  assert.match(dockerfile, /FROM deps AS production-deps\nRUN npm prune --omit=dev/);
  assert.match(dockerfile, /FROM deps AS builder/);
  assert.match(dockerfile, /COPY --from=production-deps \/app\/node_modules/);
});

test('workflow uses a run-attempt candidate and proves the exact inspected digest', () => {
  assert.match(workflow, /BUILD_ID="\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/);
  assert.match(workflow, /candidate="\$IMAGE_REPOSITORY:\$GITHUB_SHA-\$BUILD_ID"/);
  assert.match(workflow, /BUILD_ID=\$\{\{ steps\.metadata\.outputs\.build-id \}\}/);
  assert.match(workflow, /"\$DIGEST" == "\$BUILT_DIGEST"/);
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
  assert.match(workflow, /ROLLBACK_MAX_ATTEMPTS: '120'/);
  assert.doesNotMatch(workflow, /readiness-grace-attempts/);
  assert.match(stepSource('deploy', 'Verify candidate runtime invariants'), /timeout-minutes: 10/);
  assert.match(stepSource('deploy', 'Roll back failed candidate'), /timeout-minutes: 4/);
  assert.match(stepScript('deploy', 'Roll back failed candidate'), /rollback_deadline="\$\(\(SECONDS\+235\)\)"/);
  assert.match(stepScript('deploy', 'Roll back failed candidate'), /within_rollback_budget node scripts\/verify-deployment\.mjs/);
  assert.match(stepScript('deploy', 'Roll back failed candidate'), /--max-duration-ms "\$\(\(\(rollback_deadline-SECONDS\)\*1000\)\)"/);
  assert.match(workflow, /failure\(\) \|\| cancelled\(\)/);
  assert.match(workflow, /--allow-legacy-build-id/);
  assert.match(workflow, /--allow-health-readiness/);
  assert.match(workflow, /--ready-path "\$PLATFORM_HEALTH_PATH"/);
  assert.match(workflow, /b45c028e33a1b2cdb961870858d1374c7dbe5e6e/);
  assert.match(workflow, /\$s\.OFFHOST_BACKUP_ENABLED == "false"/);
  assert.doesNotMatch(workflow, /OFFHOST_BACKUP_ACCOUNT/);
  assert.doesNotMatch(workflow, /OFFHOST_BACKUP_CONTAINER/);
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

test('runtime has public liveness and SQLite-only readiness with export retired', () => {
  assert.match(server, /app\.get\('\/api\/live'/);
  assert.match(server, /app\.get\('\/api\/ready'/);
  assert.match(server, /readdirSync\(USERS_DIR, \{ withFileTypes: true \}\)/);
  assert.match(server, /new Database\(databasePath, \{ readonly: true, fileMustExist: true \}\)/);
  assert.match(server, /dbRoot: USERS_DIR/);
  assert.match(server, /database: \{ status: 'ready' \}/);
  assert.match(server, /path === '\/live'/);
  assert.match(server, /path === '\/ready'/);
  assert.match(
    server,
    /\(req\.method === 'GET' \|\| req\.method === 'HEAD'\)[\s\S]*req\.path === '\/ready'/,
  );
  assert.match(server, /buildId: deploymentInfo\.buildId/);
  assert.match(server, /Cache-Control', 'no-store'/);
  assert.match(server, /const OFFHOST_EXPORT_STATUS = 'retired'/);
  assert.doesNotMatch(server, /startOffhostExportSchedule|runAfterBackup/);
  assert.doesNotMatch(verifierSource, /ready\.exporter/);
  assert.match(dockerfile, /ENV OFFHOST_BACKUP_ENABLED=false/);
  assert.match(compose, /OFFHOST_BACKUP_ENABLED: "false"/);
});

test('image embeds build identity without an App Service storage volume', () => {
  assert.match(dockerfile, /ARG BUILD_ID/);
  assert.match(dockerfile, /"buildId":"%s"/);
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.version=\$BUILD_ID/);
  assert.match(dockerfile, /LABEL com\.workshop\.app-version=\$APP_VERSION/);
  assert.match(dockerfile, /FROM node:22-alpine AS runner[\s\S]*RUN apk upgrade --no-cache/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/lib\/node_modules\/corepack/);
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\s+.*\/home/m);
});

test('migration checker applies current schema and preserves prior-release reads', async () => {
  assert.equal(await checkMigrationCompatibility(), true);
});

test('monitor checker preserves alert retirement without requiring paid resources', () => {
  assert.equal(validateMonitor({
    alert: null,
  }), true);
  assert.throws(
    () => validateMonitor({
      alert: { enabled: false },
    }),
    /remain absent/,
  );
  const calls = [];
  assert.equal(validateMonitor(inspectMonitor({
    resourceGroup: 'example-rg', webapp: 'app-workshop-prod-lwxhu7jxlrbtu',
  }, args => { calls.push(args); return []; })), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['resource', 'list']);
  assert.match(calls[0].join(' '), /alert-workshop-offhost-backup-stale/);
  assert.doesNotMatch(calls[0].join(' '), /action-group|workspace|create|update/);
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
          exporter: 'retired',
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
    : { status: 'ok', sha: 'b'.repeat(40), instanceId: 'legacy', db: '/home/data/workshop.db', exporter: 'disabled' });
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    profile: 'sqlite-one-worker', expectedSha: 'b'.repeat(40), expectedBuildId: 'legacy',
    attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl }), /verification failed/);
  const result = await verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    profile: 'sqlite-one-worker', expectedSha: 'b'.repeat(40), expectedBuildId: 'legacy',
    allowLegacyBuildId: true, allowHealthReadiness: true,
    attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl });
  assert.equal(result.instanceId, 'legacy');
});

test('verifier accepts predecessor health shape only for explicit rollback compatibility', async () => {
  const fetchImpl = async url => {
    const common = {
      sha: 'a'.repeat(40),
      buildId: '12-3',
      instanceId: 'fresh',
      status: 'ok',
    };
    if (url.includes('/api/live')) return jsonResponse(common);
    return jsonResponse({
      ...common,
      db: '/home/data/workshop.db',
      exporter: 'disabled',
    });
  };
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/health',
    profile: 'sqlite-one-worker', expectedSha: 'a'.repeat(40), expectedBuildId: '12-3',
    attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl }), /SQLite readiness mismatch/);
  const result = await verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/health',
    profile: 'sqlite-one-worker', expectedSha: 'a'.repeat(40), expectedBuildId: '12-3',
    allowHealthReadiness: true,
    attempts: 1, confirmations: 1, intervalMs: 0, requestTimeoutMs: 100,
  }, { fetchImpl });
  assert.equal(result.instanceId, 'fresh');
});

test('monitor checker rejects unreadable inventory and the wrong app', () => {
  const target = { resourceGroup: 'example-rg', webapp: 'app-workshop-prod-lwxhu7jxlrbtu' };
  assert.throws(
    () => inspectMonitor(target, () => null),
    /not an array/,
  );
  assert.throws(
    () => inspectMonitor(target, () => { throw new Error('Azure authentication failed'); }),
    /Azure authentication failed/,
  );
  assert.throws(
    () => validateMonitor({
      alert: null,
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
  assert.equal(
    parseVerifierArgs([...required, '--allow-health-readiness']).allowHealthReadiness,
    true,
  );
  assert.throws(() => parseVerifierArgs([...required, '--confirmations', '2']), /at least 3/);
  assert.equal(parseVerifierArgs(required).maxDurationMs, 600_000);
  assert.throws(() => parseVerifierArgs([...required, '--max-duration-ms', '0']), /positive integer/);
  assert.throws(() => parseVerifierArgs([...required, '--max-duration-ms', 'NaN']), /positive integer/);
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

test('verifier shares one wall-clock budget across both probes and retry sleeps', async () => {
  let clock = 0;
  const sleeps = [];
  const fetchImpl = async url => {
    clock += 40;
    return jsonResponse(url.includes('/api/live')
      ? { status: 'ok', sha: 'a'.repeat(40), buildId: '12-3', instanceId: 'fresh' }
      : { status: 'ok', sha: 'a'.repeat(40), buildId: '12-3', instanceId: 'fresh',
          db: '/home/data/workshop.db', dbRoot: '/home/data/users', database: { status: 'ready' } });
  };
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    expectedSha: 'a'.repeat(40), expectedBuildId: '12-3', profile: 'sqlite-one-worker',
    attempts: 120, confirmations: 3, requestTimeoutMs: 8_000, intervalMs: 5_000, maxDurationMs: 100,
  }, {
    fetchImpl, now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
  }), /after 1 attempts \(wall-clock limit 100ms\)/);
  assert.equal(clock, 100);
  assert.deepEqual(sleeps, [20]);
});

test('verifier aborts a real stalled request at the total deadline', async t => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const started = performance.now();
  await assert.rejects(() => verifyDeployment({
    baseUrl: `http://127.0.0.1:${server.address().port}`, livePath: '/api/live', readyPath: '/api/ready',
    expectedSha: 'a'.repeat(40), expectedBuildId: '12-3', profile: 'sqlite-one-worker',
    attempts: 120, confirmations: 3, requestTimeoutMs: 8_000, intervalMs: 5_000, maxDurationMs: 80,
  }), /wall-clock limit 80ms/);
  assert.ok(performance.now() - started < 1_000, 'an 8-second request must not outlive the 80ms total budget');
});

test('verifier does not hide a real SQLite failure when its deadline expires', async () => {
  let clock = 0;
  await assert.rejects(() => verifyDeployment({
    baseUrl: 'https://example.test', livePath: '/api/live', readyPath: '/api/ready',
    expectedSha: 'a'.repeat(40), expectedBuildId: '12-3', profile: 'sqlite-one-worker',
    attempts: 120, confirmations: 3, intervalMs: 500, maxDurationMs: 100,
  }, {
    now: () => clock, sleep: async ms => { clock += ms; },
    fetchImpl: async url => jsonResponse(url.includes('/api/live')
      ? { status: 'ok', sha: 'a'.repeat(40), buildId: '12-3', instanceId: 'fresh' }
      : { status: 'ok', sha: 'a'.repeat(40), buildId: '12-3', instanceId: 'fresh',
          db: '/home/data/workshop.db', dbRoot: '/home/data/users', database: { status: 'unavailable' } }),
  }), /wall-clock limit 100ms.*SQLite readiness mismatch/);
});

function shellFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'workshop-workflow-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, 'evidence'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    COMMAND_LOG: join(root, 'commands.jsonl'),
    PIN_FILE: join(root, 'pin'),
    LATEST_FILE: join(root, 'latest'),
    GITHUB_ENV: join(root, 'github-env'),
    GITHUB_OUTPUT: join(root, 'github-output'),
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    GITHUB_SHA: 'a'.repeat(40), CURRENT_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2',
    RG: 'test-rg', WEBAPP: 'test-app',
    ACR: 'test-acr', ACR_LOGIN_SERVER: 'test.azurecr.io', IMAGE_REPOSITORY: 'workshop',
    IMAGE_REFERENCE: `test.azurecr.io/workshop@sha256:${'a'.repeat(64)}`,
    PREVIOUS_REF: `test.azurecr.io/workshop@sha256:${'b'.repeat(64)}`,
    PREVIOUS_LATEST_DIGEST: `sha256:${'b'.repeat(64)}`,
    PREVIOUS_SHA: 'b'.repeat(40), PREVIOUS_BUILD_ID: '41-1',
    PLATFORM_HEALTH_PATH: '/api/health', LIVE_PATH: '/api/live', READY_PATH: '/api/ready',
    PRODUCTION_URL: 'https://example.invalid', DEPLOYMENT_PROFILE: 'sqlite-one-worker',
    REQUIRED_CONFIRMATIONS: '3', ROLLBACK_MAX_ATTEMPTS: '120',
    POLL_INTERVAL_SECONDS: '5', HTTP_TIMEOUT_SECONDS: '8',
    APP_SETTINGS_FINGERPRINT: 'protected', SITE_INVARIANTS_FINGERPRINT: 'protected',
    ...overrides,
  };
  for (const path of [env.GITHUB_ENV, env.GITHUB_OUTPUT, env.COMMAND_LOG]) writeFileSync(path, '');
  writeFileSync(env.PIN_FILE, env.IMAGE_REFERENCE);
  writeFileSync(env.LATEST_FILE, env.IMAGE_REFERENCE.split('@')[1]);
  const shim = `#!${process.execPath}
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');
const { spawnSync } = require('node:child_process');
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
const text = args.join(' ');
const env = process.env;
appendFileSync(env.COMMAND_LOG, JSON.stringify({ tool, args }) + '\\n');
if (tool === 'sleep') process.exit(0);
if (tool === 'timeout') {
  if (!/^[1-9][0-9]*s$/.test(args[2]) || parseInt(args[2]) > 235) process.exit(91);
  if (env.TIMEOUT_EXIT) process.exit(Number(env.TIMEOUT_EXIT));
  const result = spawnSync(args[3], args.slice(4), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
if (tool === 'git') {
  if (env.GIT_EXIT) process.exit(Number(env.GIT_EXIT));
  if (args[0] === 'fetch') process.exit(0);
  else if (args[0] === 'rev-parse') console.log(env.CURRENT_SHA);
  else if (args[0] === 'merge-base') process.exit(Number(env.ANCESTRY_EXIT || '0'));
  else if (args[0] === 'diff') process.exit(Number(env.DIFF_EXIT || '0'));
  else { console.error('Unexpected Git command: ' + text); process.exit(90); }
} else if (tool === 'curl') {
  process.stdout.write(env.PROBE_STATUS || '503');
} else if (tool === 'node') {
  process.exit(Number(env.VERIFIER_EXIT || '0'));
} else if (tool === 'sha256sum') {
  process.stdin.resume();
  process.stdin.on('end', () => console.log('protected  -'));
} else if (tool === 'az') {
  if (env.FAIL_AZ_PREFIX && text.startsWith(env.FAIL_AZ_PREFIX)) process.exit(41);
  if (text.startsWith('webapp stop ') || text.startsWith('webapp start ')) process.exit(0);
  else if (text.startsWith('webapp config container set ')) {
    if (!env.IGNORE_PIN) writeFileSync(env.PIN_FILE, args[args.indexOf('--container-image-name') + 1]);
  } else if (text.startsWith('webapp config show ')) console.log('DOCKER|' + readFileSync(env.PIN_FILE, 'utf8'));
  else if (text.startsWith('webapp config appsettings list ')) console.log('[]');
  else if (text.startsWith('webapp show ')) console.log(args.includes('--query') ? (env.SITE_STATE || 'Stopped') : '{"siteConfig":{}}');
  else if (text.startsWith('acr import ')) writeFileSync(env.LATEST_FILE, args[args.indexOf('--source') + 1].split('@')[1]);
  else if (text.startsWith('acr repository show ')) console.log(readFileSync(env.LATEST_FILE, 'utf8'));
  else { console.error('Unexpected Azure command: ' + text); process.exit(90); }
} else { console.error('Unexpected tool: ' + tool); process.exit(90); }
`;
  for (const name of ['az', 'curl', 'git', 'sleep', 'timeout', 'node', 'sha256sum']) {
    writeFileSync(join(bin, name), shim, { mode: 0o755 });
  }
  return {
    root, env,
    run: (name, job = 'deploy') => spawnSync('bash', ['--noprofile', '--norc', '-c', stepScript(job, name)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    }),
    commands: () => readFileSync(env.COMMAND_LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

test('superseded code is rejected only inside the retained production queue', t => {
  const fixture = shellFixture(t, { CURRENT_SHA: 'c'.repeat(40), DIFF_EXIT: '1' });
  assert.equal(fixture.run('Reject superseded source and arm rollback').status, 0);
  assert.equal(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), '');
  assert.equal(JSON.parse(readFileSync(join(fixture.root, 'evidence/deployment.json'), 'utf8')).productionMutated, false);
  assert.ok(fixture.commands().every(command => command.tool === 'git'));
});

for (const [reason, override] of [
  ['source lookup', { GIT_EXIT: '128' }],
  ['ancestry query', { CURRENT_SHA: 'c'.repeat(40), ANCESTRY_EXIT: '128' }],
  ['diff query', { CURRENT_SHA: 'c'.repeat(40), DIFF_EXIT: '128' }],
]) {
  test(`${reason} failure is not a successful deployment or an armed rollback`, t => {
    const fixture = shellFixture(t, override);
    assert.equal(fixture.run('Reject superseded source and arm rollback').status, 128);
    assert.equal(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), '');
    assert.equal(existsSync(join(fixture.root, 'evidence/deployment.json')), false);
  });
}

function gitHistoryFixture(t) {
  const fixture = shellFixture(t);
  rmSync(join(fixture.root, 'bin/git'));
  Object.assign(fixture.env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Workshop fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Workshop fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  });
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: fixture.root, env: fixture.env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet', '--initial-branch=main');
  writeFileSync(join(fixture.root, 'runtime.js'), 'export const release = 1;\n');
  git('add', 'runtime.js');
  git('commit', '--quiet', '-m', 'Candidate fixture');
  fixture.env.GITHUB_SHA = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', '.');
  return { ...fixture, git };
}

test('real Git keeps later commits eligible only for the exact workflow ignored paths', t => {
  const fixture = gitHistoryFixture(t);
  mkdirSync(join(fixture.root, 'docs'));
  mkdirSync(join(fixture.root, 'azure-infra'));
  const ignored = ['README.md', 'docs/notes.md', 'azure-infra/config.bicep', '.gitignore'];
  for (const path of ignored) writeFileSync(join(fixture.root, path), 'fixture\n');
  fixture.git('add', '--', ...ignored);
  fixture.git('commit', '--quiet', '-m', 'Ignored files only');
  const result = fixture.run('Reject superseded source and arm rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), /DEPLOYMENT_MUTATED=true/);
  assert.match(result.stdout, /only affect ignored paths/);
  assert.equal(existsSync(join(fixture.root, 'evidence/deployment.json')), false);
  assert.match(workflow, /paths-ignore: \['\*\*\/\*\.md', 'azure-infra\/\*\*', '\.gitignore'\]/);
  const script = stepScript('deploy', 'Reject superseded source and arm rollback');
  for (const pathspec of [
    ':(top,glob,exclude)**/*.md',
    ':(top,glob,exclude)azure-infra/**',
    ':(top,literal,exclude).gitignore',
  ]) assert.ok(script.includes(pathspec));
});

for (const path of ['runtime.js', 'docs/.gitignore', 'README.MD', 'azure-infrastructure/config.bicep']) {
  test(`real Git rejects a later non-ignored change to ${path}`, t => {
    const fixture = gitHistoryFixture(t);
    for (const folder of ['docs', 'azure-infrastructure']) mkdirSync(join(fixture.root, folder));
    writeFileSync(join(fixture.root, path), 'later content\n');
    fixture.git('add', '--', path);
    fixture.git('commit', '--quiet', '-m', 'Later deployable change');
    const result = fixture.run('Reject superseded source and arm rollback');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), '');
    assert.equal(JSON.parse(readFileSync(join(fixture.root, 'evidence/deployment.json'), 'utf8')).status, 'superseded');
  });
}

test('real Git notices a code deletion when it is renamed into an ignored Markdown path', t => {
  const fixture = gitHistoryFixture(t);
  fixture.git('mv', 'runtime.js', 'runtime.md');
  fixture.git('commit', '--quiet', '-m', 'Move source into ignored path');
  const result = fixture.run('Reject superseded source and arm rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), '');
  assert.equal(JSON.parse(readFileSync(join(fixture.root, 'evidence/deployment.json'), 'utf8')).status, 'superseded');
  assert.match(stepScript('deploy', 'Reject superseded source and arm rollback'), /git diff --quiet --no-renames/);
});

test('real Git rejects non-ancestor source even when its deployable tree matches main', t => {
  const fixture = gitHistoryFixture(t);
  fixture.git('checkout', '--quiet', '-b', 'other-candidate');
  fixture.git('commit', '--quiet', '--allow-empty', '-m', 'Non-ancestor candidate');
  fixture.env.GITHUB_SHA = fixture.git('rev-parse', 'HEAD');
  const result = fixture.run('Reject superseded source and arm rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), '');
  assert.equal(JSON.parse(readFileSync(join(fixture.root, 'evidence/deployment.json'), 'utf8')).status, 'superseded');
});

test('current source arms rollback before stop/prove/pin/start', t => {
  const fixture = shellFixture(t);
  assert.equal(fixture.run('Reject superseded source and arm rollback').status, 0);
  assert.match(readFileSync(fixture.env.GITHUB_ENV, 'utf8'), /DEPLOYMENT_MUTATED=true/);
  const result = fixture.run('Stop, prove absence, pin, and start SQLite candidate');
  assert.equal(result.status, 0, result.stderr);
  const commands = fixture.commands();
  const pin = commands.findIndex(command => command.args.join(' ').startsWith('webapp config container set'));
  const start = commands.findIndex(command => command.args.join(' ').startsWith('webapp start'));
  assert.equal(commands.slice(0, pin).filter(command => command.tool === 'curl').length, 3);
  assert.ok(start > pin);
  assert.equal(readFileSync(fixture.env.PIN_FILE, 'utf8'), fixture.env.IMAGE_REFERENCE);
  assert.match(stepSource('deploy', 'Roll back failed candidate'), /always\(\) && \(failure\(\) \|\| cancelled\(\)\)/);
});

for (const [reason, override] of [
  ['Azure still reports a running writer', { SITE_STATE: 'Running' }],
  ['the old process still answers liveness', { PROBE_STATUS: '200' }],
  ['the pin operation fails', { FAIL_AZ_PREFIX: 'webapp config container set' }],
]) {
  test(`activation fails safely when ${reason}`, t => {
    const fixture = shellFixture(t, override);
    const result = fixture.run('Stop, prove absence, pin, and start SQLite candidate');
    assert.notEqual(result.status, 0);
    assert.ok(!fixture.commands().some(command => command.args.join(' ').startsWith('webapp start')));
  });
}

test('rollback restores both prior digests with bounded operations and compatibility verification', t => {
  const fixture = shellFixture(t);
  const result = fixture.run('Roll back failed candidate');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(fixture.env.PIN_FILE, 'utf8'), fixture.env.PREVIOUS_REF);
  assert.equal(readFileSync(fixture.env.LATEST_FILE, 'utf8'), fixture.env.PREVIOUS_LATEST_DIGEST);
  const commands = fixture.commands();
  const verifier = commands.find(command => command.tool === 'node');
  assert.ok(verifier.args.includes('--allow-health-readiness'));
  assert.ok(verifier.args.includes('--max-duration-ms'));
  assert.equal(verifier.args[verifier.args.indexOf('--confirmations') + 1], '3');
  assert.equal(commands.filter(command => command.tool === 'curl').length, 3);
  assert.ok(commands.filter(command => command.tool === 'az').every(command =>
    commands.some(wrapper => wrapper.tool === 'timeout' && wrapper.args.slice(3).join(' ') === ['az', ...command.args].join(' '))));
  const evidence = JSON.parse(readFileSync(join(fixture.root, 'evidence/rollback.json'), 'utf8'));
  assert.equal(evidence.rollbackPerformed, true);
  assert.equal(evidence.restoredImage, fixture.env.PREVIOUS_REF);
});

for (const [reason, override] of [
  ['Azure fails', { FAIL_AZ_PREFIX: 'webapp stop' }],
  ['the whole-operation deadline expires', { TIMEOUT_EXIT: '124' }],
  ['readiness fails', { VERIFIER_EXIT: '1' }],
  ['protected settings change', { APP_SETTINGS_FINGERPRINT: 'different' }],
  ['the prior digest was not pinned', { IGNORE_PIN: '1' }],
]) {
  test(`rollback never reports success when ${reason}`, t => {
    const fixture = shellFixture(t, override);
    const result = fixture.run('Roll back failed candidate');
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(fixture.root, 'evidence/rollback.json')), false);
  });
}
