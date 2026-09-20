import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyProcess, parseReport, summarizeRecords } from '../scripts/deployment-diagnostic.mjs';

const helper = fileURLToPath(new URL('../scripts/deployment-diagnostic.mjs', import.meta.url));
const action = readFileSync(new URL('../.github/actions/deployment-diagnostic/action.yml', import.meta.url), 'utf8');
const composite = action.split('      run: |\n')[1].replace(/^        /gm, '');
const context = ['--check', 'image-vulnerability-scan', '--category', 'image-scan', '--phase', 'pre-activation'];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workshop diagnostics '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GITHUB_REPOSITORY: 'EnzoLopez2023/workshop', GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'image-diagnostics',
    DIAGNOSTIC_CANDIDATE_DIGEST: `sha256:${'b'.repeat(64)}`,
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    GITHUB_OUTPUT: join(root, 'outputs'),
  };
  return {
    root, env,
    run: args => spawnSync(process.execPath, [helper, ...args], { cwd: root, env, encoding: 'utf8', timeout: 5_000 }),
    records: () => readFileSync(join(root, 'deployment-diagnostics/records.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)),
  };
}

test('diagnostics retain HIGH and CRITICAL findings even with a zero scanner exit', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'trivy.json'), JSON.stringify({
    Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }, { Severity: 'CRITICAL' }] }],
  }));
  const result = f.run(['record', ...context, '--exit-code', '0', '--report', 'trivy.json', '--report-format', 'trivy-json']);
  assert.equal(result.status, 0, result.stderr);
  const [record] = f.records();
  assert.equal(record.status, 'finding');
  assert.equal(record.findings.count, 2);
  assert.equal(record.findings.severity.high, 1);
  assert.equal(record.findings.severity.critical, 1);
  assert.equal(record.control_effect, 'observable');
  assert.equal(record.build_id, '42-2');
  assert.equal(record.candidate_digest, f.env.DIAGNOSTIC_CANDIDATE_DIGEST);
  assert.match(result.stdout, /::warning/);
});

test('Marketplace execution failures retain reports without inventing an exit status', t => {
  const f = fixture(t);
  const report = JSON.stringify({ Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }] }] });
  writeFileSync(join(f.root, 'trivy.json'), report);
  const result = f.run([
    'record', ...context, '--execution-error', 'Trivy action failed; see the scanner action logs.',
    '--report', 'trivy.json', '--report-format', 'trivy-json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const [record] = f.records();
  assert.equal(record.status, 'execution-failure');
  assert.equal(record.exit_code, null);
  assert.match(record.execution_error, /Trivy action failed/);
  assert.ok(record.evidence_paths.includes('trivy.json'));
  assert.equal(readFileSync(join(f.root, 'trivy.json'), 'utf8'), report);
  assert.match(result.stdout, /::warning/);
});

test('Marketplace reports with no exposed exit code still preserve detected findings', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'trivy.json'), '{"Results":[{"Vulnerabilities":[{"Severity":"HIGH"}]}]}');
  assert.equal(f.run(['record', ...context, '--report', 'trivy.json', '--report-format', 'trivy-json']).status, 0);
  const [record] = f.records();
  assert.equal(record.status, 'finding');
  assert.equal(record.exit_code, null);
  assert.equal(record.findings.severity.high, 1);
});

for (const [name, report] of [
  ['missing', null],
  ['empty', ''],
  ['malformed JSON', '{'],
  ['wrong scanner shape', '{}'],
]) {
  test(`a ${name} report is an execution failure, never a pass`, t => {
    const f = fixture(t);
    if (report !== null) writeFileSync(join(f.root, 'trivy.json'), report);
    assert.equal(f.run(['record', ...context, '--exit-code', '0', '--report', 'trivy.json', '--report-format', 'trivy-json']).status, 0);
    assert.equal(f.records()[0].status, 'execution-failure');
    assert.ok(f.records()[0].execution_error);
  });
}

test('source audits and SBOMs retain their original report detection', () => {
  const audit = parseReport('npm-audit-json', JSON.stringify({
    metadata: { vulnerabilities: { high: 1, moderate: 1, low: 1, total: 3 } },
  }));
  assert.equal(audit.count, 3);
  assert.equal(audit.severity.medium, 1);
  assert.equal(parseReport('spdx-json', '{"packages":[]}').ok, false);
  assert.equal(parseReport('cyclonedx-json', '{"components":[]}').ok, false);
  assert.equal(parseReport('spdx-json', '{"spdxVersion":"SPDX-2.3","packages":[]}').ok, true);
});

test('checker crashes, missing binaries, and timeouts remain observable failures', t => {
  const f = fixture(t);
  assert.equal(f.run(['run', ...context, '--', 'workshop-intentionally-missing-checker']).status, 0);
  assert.equal(f.run(['run', ...context, '--timeout', '30', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)']).status, 0);
  assert.equal(f.run(['run', ...context, '--', process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")']).status, 0);
  for (const record of f.records()) assert.equal(record.status, 'execution-failure');
  for (const exitCode of [124, 126, 127]) assert.equal(classifyProcess({ exitCode }).ok, false);
  assert.equal(classifyProcess({ exitCode: 1 }).ok, true);
});

test('the actual helper CLI runs from paths containing spaces', t => {
  const f = fixture(t);
  const copied = join(f.root, 'copied helper.mjs');
  copyFileSync(helper, copied);
  const result = spawnSync(process.execPath, [copied, 'run', ...context, '--', process.execPath, '-e', 'process.exit(1)'], {
    cwd: f.root, env: f.env, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.records()[0].status, 'finding');
  assert.match(result.stdout, /::warning/);
});

test('rerun diagnostics bind the reused image build separately from the current workflow attempt', t => {
  const f = fixture(t);
  f.env.DIAGNOSTIC_BUILD_ID = '42-1';
  assert.equal(f.run(['run', ...context, '--', process.execPath, '-e', 'process.exit(0)']).status, 0);
  const [record] = f.records();
  assert.equal(record.build_id, '42-1');
  assert.equal(record.workflow.run_attempt, '2');
  assert.equal(record.candidate_digest, f.env.DIAGNOSTIC_CANDIDATE_DIGEST);
});

test('the vendored composite executes and records the real failing command', t => {
  const f = fixture(t);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', composite], {
    cwd: f.root, encoding: 'utf8', timeout: 5_000,
    env: {
      ...f.env,
      DIAGNOSTIC_CHECK_ID: 'signature-verification',
      DIAGNOSTIC_CATEGORY: 'signature-provenance',
      DIAGNOSTIC_PHASE: 'pre-activation', DIAGNOSTIC_MODE: 'run',
      DIAGNOSTIC_COMMAND: 'exit 127',
      DIAGNOSTIC_EXIT_CODE: '', DIAGNOSTIC_EXECUTION_ERROR: '',
      DIAGNOSTIC_REPORT: '', DIAGNOSTIC_REPORT_FORMAT: 'none',
      DIAGNOSTIC_EVIDENCE: '', DIAGNOSTIC_REASON: '',
      DIAGNOSTIC_RECORDS: 'deployment-diagnostics/records.jsonl',
      DIAGNOSTIC_HELPER: helper, DIAGNOSTIC_TIMEOUT_MS: '1000',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.records()[0].status, 'execution-failure');
  assert.equal(f.records()[0].exit_code, 127);
});

test('the vendored composite forwards known action execution failures with a null exit code', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'sbom.json'), '{"spdxVersion":"SPDX-2.3","packages":[]}');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', composite], {
    cwd: f.root, encoding: 'utf8', timeout: 5_000,
    env: {
      ...f.env,
      DIAGNOSTIC_CHECK_ID: 'image-sbom', DIAGNOSTIC_CATEGORY: 'sbom',
      DIAGNOSTIC_PHASE: 'pre-activation', DIAGNOSTIC_MODE: 'record',
      DIAGNOSTIC_COMMAND: '', DIAGNOSTIC_EXIT_CODE: '',
      DIAGNOSTIC_EXECUTION_ERROR: 'Image SBOM action failed; see the action log.',
      DIAGNOSTIC_REPORT: 'sbom.json', DIAGNOSTIC_REPORT_FORMAT: 'spdx-json',
      DIAGNOSTIC_EVIDENCE: '', DIAGNOSTIC_REASON: '',
      DIAGNOSTIC_RECORDS: 'deployment-diagnostics/records.jsonl',
      DIAGNOSTIC_HELPER: helper, DIAGNOSTIC_TIMEOUT_MS: '1000',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const [record] = f.records();
  assert.equal(record.status, 'execution-failure');
  assert.equal(record.exit_code, null);
  assert.match(record.execution_error, /Image SBOM action failed/);
  assert.ok(record.evidence_paths.includes('sbom.json'));
});

test('redacted findings, malformed records, and failed aggregation stay honest', t => {
  const f = fixture(t);
  f.env.DEPLOY_TEST_SECRET = 'local-fixture-sensitive-value';
  const result = f.run(['run', ...context, '--', process.execPath, '-e', 'console.error(process.env.DEPLOY_TEST_SECRET); process.exit(1)']);
  assert.equal(result.status, 0);
  const [record] = f.records();
  assert.equal(record.status, 'finding');
  assert.match(record.findings.summary, /\[REDACTED\]/);
  assert.ok(!JSON.stringify(record).includes(f.env.DEPLOY_TEST_SECRET));
  const summary = summarizeRecords([JSON.stringify(record), 'not JSON']);
  assert.equal(summary.totals.finding, 1);
  assert.equal(summary.totals.pass, 0);
  assert.equal(summary.malformed, 1);
  assert.equal(f.run(['aggregate']).status, 0);
  assert.match(readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /non-blocking/);
  const absent = f.run(['aggregate', '--records', 'missing.jsonl']);
  assert.equal(absent.status, 0);
  assert.match(absent.stdout, /::warning.*could not be read/);
  assert.equal(f.run(['run', '--check', 'invalid']).status, 2);
});

test('monitor phases share identical predicates and inventory failures never pass', t => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'az'), '#!/bin/sh\nprintf \'%s\\n\' "$AZURE_INVENTORY"\nexit "${AZURE_EXIT:-0}"\n', { mode: 0o755 });
  f.env.PATH = `${bin}:${process.env.PATH}`;
  const monitor = fileURLToPath(new URL('../scripts/check-deployment-monitor.mjs', import.meta.url));
  const command = `"${process.execPath}" "${monitor}" --phase predeploy --resource-group example --webapp app-workshop-prod-lwxhu7jxlrbtu > monitor.json`;
  const args = [
    'run', '--check', 'monitoring-precheck', '--category', 'monitoring-precheck', '--phase', 'pre-activation',
    '--report', 'monitor.json', '--report-format', 'generic-json', '--', 'bash', '-c', command,
  ];
  f.env.AZURE_INVENTORY = '[{"name":"alert-workshop-offhost-backup-stale"}]';
  assert.equal(f.run(args).status, 0);
  assert.equal(f.records().at(-1).status, 'finding');
  f.env.AZURE_INVENTORY = '[]';
  assert.equal(f.run(args).status, 0);
  assert.equal(f.records().at(-1).status, 'pass');
  f.env.AZURE_EXIT = '1';
  assert.equal(f.run(args).status, 0);
  assert.equal(f.records().at(-1).status, 'execution-failure');

  for (const retiredAlertPresent of [false, true]) {
    const inventory = retiredAlertPresent ? '[{"name":"alert-workshop-offhost-backup-stale"}]' : '[]';
    for (const phase of ['predeploy', 'postdeploy', 'rollback', 'initial-predeploy', 'initial-postdeploy']) {
      const result = spawnSync(process.execPath, [
        monitor, '--phase', phase, '--resource-group', 'example', '--webapp', 'app-workshop-prod-lwxhu7jxlrbtu',
      ], {
        cwd: f.root, encoding: 'utf8', timeout: 5_000,
        env: { ...f.env, AZURE_EXIT: '0', AZURE_INVENTORY: inventory },
      });
      assert.equal(result.status, retiredAlertPresent ? 1 : 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        phase, webapp: 'app-workshop-prod-lwxhu7jxlrbtu',
        policy: 'local-only-no-paid-monitoring', retiredAlertPresent,
      });
    }
  }
});
