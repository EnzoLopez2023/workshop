import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadDeploymentInfo } from '../deployment-info.js';

const readSource = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = readSource('.github/workflows/deploy.yml');
const dockerfile = readSource('Dockerfile');
const compose = readSource('docker-compose.yml');
const localDeploy = readSource('deploy.ps1');
const server = readSource('server.js');

function indexOfOrFail(source, value) {
  const index = source.indexOf(value);
  assert.notEqual(index, -1, `missing deployment gate: ${value}`);
  return index;
}

test('workflow builds one immutable SHA tag with source-derived version metadata', () => {
  assert.match(workflow, /--image "\$IMAGE_REPOSITORY:\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /az acr build[\s\S]{0,400}--image "[^"]*:latest"/);
  assert.match(workflow, /--build-arg "BUILD_SHA=\$GITHUB_SHA"/);
  assert.match(workflow, /--build-arg "APP_VERSION=\$APP_VERSION"/);
  assert.match(workflow, /steps\.image_tag\.outputs\.build_required == 'true'/);
  assert.match(workflow, /--write-enabled false/);
  assert.match(workflow, /--delete-enabled false/);
  assert.match(workflow, /version\.json/);
  assert.doesNotMatch(workflow, /git (?:commit|push)|scripts\/version\.mjs/);
});

test('workflow resolves, pulls, and inspects the exact digest before promotion', () => {
  const resolveDigest = indexOfOrFail(workflow, 'DIGEST=$(az acr repository show');
  const digestReference = indexOfOrFail(
    workflow,
    'IMAGE_REF="$ACR_LOGIN_SERVER/$IMAGE_REPOSITORY@$DIGEST"',
  );
  const login = indexOfOrFail(workflow, 'az acr login --name "$ACR"');
  const pull = indexOfOrFail(workflow, 'docker pull "$IMAGE_REF"');
  const inspect = indexOfOrFail(workflow, 'docker image inspect "$IMAGE_REF"');
  const revisionCheck = indexOfOrFail(workflow, 'if [ "$REVISION" != "$GITHUB_SHA" ]');
  const versionCheck = indexOfOrFail(workflow, 'if [ "$VERSION" != "$APP_VERSION" ]');
  const promote = indexOfOrFail(workflow, 'az acr import');
  assert.ok(resolveDigest < digestReference);
  assert.ok(digestReference < login);
  assert.ok(login < pull);
  assert.ok(pull < inspect);
  assert.ok(inspect < revisionCheck);
  assert.ok(revisionCheck < versionCheck);
  assert.ok(versionCheck < promote);
});

test('workflow rejects every /home image volume and verifies OCI provenance', () => {
  assert.match(workflow, /\.Config\.Volumes/);
  assert.match(workflow, /\. == "\/home" or startswith\("\/home\/"\)/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /org\.opencontainers\.image\.version/);
});

test('workflow promotes and pins only the inspected digest', () => {
  assert.match(workflow, /--source "\$INSPECTED_REF"/);
  assert.match(workflow, /"\$PROMOTED_DIGEST" != "\$INSPECTED_DIGEST"/);
  assert.match(workflow, /--container-image-name "\$INSPECTED_REF"/);
  assert.match(workflow, /"DOCKER\|\$INSPECTED_REF"/);
  assert.match(workflow, /"\$SHA_DIGEST" != "\$INSPECTED_DIGEST"/);
  assert.match(workflow, /"\$PROMOTED_DIGEST" != "\$INSPECTED_DIGEST"/);
  assert.ok(
    indexOfOrFail(workflow, '- name: Verify candidate runtime invariants')
      < indexOfOrFail(workflow, '- name: Promote verified digest'),
  );
});

test('workflow preserves live storage, auth, exporter, and App Service settings', () => {
  assert.match(workflow, /\.alwaysOn == true and \.numberOfWorkers == 1/);
  assert.match(workflow, /WEBSITES_ENABLE_APP_SERVICE_STORAGE == "true"/);
  for (const path of [
    '/home/data',
    '/home/data/workshop.db',
    '/home/data/workshop-seed.db',
    '/home/data/users',
    '/home/data/uploads',
    '/home/data/backups',
  ]) {
    assert.ok(workflow.includes(path), `missing preserved path: ${path}`);
  }
  assert.match(workflow, /OFFHOST_BACKUP_ENABLED == "true"/);
  assert.doesNotMatch(workflow, /"ALLOWED_OID",/);
  assert.match(workflow, /APP_SETTINGS_HASH/);
  assert.match(workflow, /"\$APP_SETTINGS_HASH" != "\$EXPECTED_SETTINGS_HASH"/);
  assert.doesNotMatch(workflow, /az webapp config appsettings set/);
});

test('workflow waits for a replacement and requires three consecutive exact checks', () => {
  assert.match(workflow, /PREVIOUS_INSTANCE/);
  assert.match(workflow, /"\$instance" = "\$PREVIOUS_INSTANCE"/);
  assert.match(workflow, /"\$sha" = "\$GITHUB_SHA"/);
  assert.match(workflow, /"\$version" = "\$APP_VERSION"/);
  assert.match(workflow, /"\$exporter" = "healthy"/);
  assert.match(workflow, /consecutive=\$\(\(consecutive \+ 1\)\)/);
  assert.match(workflow, /"\$consecutive" -eq 3/);
  assert.match(workflow, /"\$instance" != "\$candidate_instance"/);
  assert.match(workflow, /consecutive=0/);
});

test('workflow restores the prior exact digest after any failed candidate', () => {
  assert.match(workflow, /previous_ref=\$PREVIOUS_REF/);
  assert.match(workflow, /previous_latest_digest=\$PREVIOUS_LATEST_DIGEST/);
  assert.match(
    workflow,
    /\(failure\(\) \|\| cancelled\(\)\) && steps\.deploy\.outputs\.started == 'true'/,
  );
  assert.match(workflow, /--container-image-name "\$PREVIOUS_REF"/);
  assert.match(workflow, /"\$RESTORED_LATEST" != "\$PREVIOUS_LATEST_DIGEST"/);
  assert.match(workflow, /\[ -z "\$PREVIOUS_SHA" \] && \[ -z "\$sha" \]/);
  assert.match(workflow, /"\$instance" != "\$FAILED_INSTANCE"/);
  assert.match(workflow, /rollback_errors=\$\(\(rollback_errors \+ 1\)\)/);
  const rollback = workflow.slice(indexOfOrFail(workflow, '- name: Roll back failed candidate'));
  assert.ok(
    indexOfOrFail(rollback, '--container-image-name "$PREVIOUS_REF"')
      < indexOfOrFail(rollback, 'az acr import'),
  );
});

test('workflow smoke-checks demo and auth without mutating application data', () => {
  assert.match(workflow, /-H 'X-Demo: 1'/);
  assert.match(workflow, /"\$DEMO_STATUS" != "200"/);
  assert.match(workflow, /"\$AUTH_STATUS" != "401"/);
  assert.match(workflow, /\.error == "missing token"/);
  assert.doesNotMatch(workflow, /curl[\s\S]{0,100}(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)/);
});

test('image embeds immutable metadata without shadowing App Service storage', () => {
  assert.match(dockerfile, /ARG BUILD_SHA/);
  assert.match(dockerfile, /ARG APP_VERSION/);
  assert.match(dockerfile, /> \/app\/build-info\.json/);
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision=\$BUILD_SHA/);
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.version=\$APP_VERSION/);
  assert.match(dockerfile, /COPY offhost-export\.js/);
  assert.match(dockerfile, /ENV DATA_ROOT=\/home\/data/);
  assert.match(dockerfile, /ENV DB_PATH=\/home\/data\/workshop\.db/);
  assert.match(dockerfile, /ENV UPLOADS_PATH=\/home\/data\/uploads/);
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\s+.*\/home/m);
  assert.doesNotMatch(dockerfile, /ENV (?:BUILD_SHA|APP_VERSION)=/);
});

test('local Docker builds receive explicit non-production metadata', () => {
  assert.match(compose, /BUILD_SHA: \$\{BUILD_SHA:-[0]{40}\}/);
  assert.match(compose, /APP_VERSION: \$\{APP_VERSION:-0\.0\.0\+build\.0\}/);
  assert.match(localDeploy, /git rev-parse HEAD/);
  assert.match(localDeploy, /git status --porcelain/);
  assert.match(localDeploy, /\$env:BUILD_SHA = \$buildSha/);
  assert.match(localDeploy, /\$env:APP_VERSION = \$appVersion/);
});

test('runtime health exposes immutable identity and exporter readiness', () => {
  assert.match(server, /loadDeploymentInfo/);
  assert.match(server, /deploymentInstance = randomUUID\(\)/);
  assert.match(server, /offhostExportSchedule\?\.health\(\)\.status/);
  assert.match(server, /sha: deploymentInfo\.sha/);
  assert.match(server, /version: deploymentInfo\.version/);
  assert.match(server, /instance: deploymentInstance/);
  assert.match(server, /exporter: offhostExportSchedule\?\.health\(\)\.status/);
  assert.match(server, /Cache-Control', 'no-store'/);
});

test('deployment info loads image metadata and rejects invalid production images', t => {
  const root = mkdtempSync(join(tmpdir(), 'workshop-deployment-info-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(
    join(root, 'build-info.json'),
    JSON.stringify({
      sha: 'a'.repeat(40),
      version: '1.2.3+build.45',
    }),
  );
  assert.deepEqual(loadDeploymentInfo({ appDir: root, nodeEnv: 'production' }), {
    sha: 'a'.repeat(40),
    version: '1.2.3+build.45',
  });

  writeFileSync(
    join(root, 'build-info.json'),
    JSON.stringify({ sha: 'short', version: '1.2.3+build.45' }),
  );
  assert.throws(
    () => loadDeploymentInfo({ appDir: root, nodeEnv: 'production' }),
    /full lowercase git SHA/,
  );
  rmSync(join(root, 'build-info.json'));
  assert.throws(
    () => loadDeploymentInfo({ appDir: root, nodeEnv: 'production' }),
    /missing immutable build-info\.json/,
  );
});

test('development deployment info uses the tracked version without inventing a SHA', t => {
  const root = mkdtempSync(join(tmpdir(), 'workshop-development-info-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'version.json'),
    JSON.stringify({ major: 2, minor: 4, patch: 6, build: 8 }),
  );
  assert.deepEqual(loadDeploymentInfo({ appDir: root, nodeEnv: 'test' }), {
    sha: null,
    version: '2.4.6+build.8',
  });
});
