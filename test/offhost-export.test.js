import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  assertOffhostCapabilities,
  createOffhostExporter,
  isPrivateAddress,
  resolveOffhostConfig,
} from '../offhost-export.js';
import { createBackupBundle, verifyBackupBundle } from '../recovery.js';

function blobError(statusCode, code = `HTTP_${statusCode}`) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

class FakeContainerClient {
  constructor() {
    this.blobs = new Map();
    this.operations = [];
    this.collideFirstFileUpload = false;
    this.loseFirstCommitResponse = false;
    this.mutateUploadSource = null;
  }

  async getProperties() {
    return { etag: '"container"' };
  }

  async put(name, contents, options, kind, sourcePath = null) {
    const body = Buffer.from(contents);
    this.operations.push({ kind, name, options });
    if (this.collideFirstFileUpload && kind === 'uploadFile') {
      this.collideFirstFileUpload = false;
      this.blobs.set(name, {
        body: Buffer.from('existing partial'),
        tags: { ...options.tags },
      });
      throw blobError(412, 'ConditionNotMet');
    }
    if (options?.conditions?.ifNoneMatch === '*' && this.blobs.has(name)) {
      throw blobError(412, 'ConditionNotMet');
    }
    this.blobs.set(name, { body, tags: { ...options.tags } });
    if (sourcePath && this.mutateUploadSource) {
      await this.mutateUploadSource(sourcePath, name);
    }
    if (this.loseFirstCommitResponse && name.endsWith('/_COMMITTED.json')) {
      this.loseFirstCommitResponse = false;
      throw blobError(503, 'ResponseLost');
    }
    return { etag: `"${name}"` };
  }

  getBlockBlobClient(name) {
    return {
      getProperties: async () => {
        const blob = this.blobs.get(name);
        if (!blob) throw blobError(404, 'BlobNotFound');
        return { contentLength: blob.body.length };
      },
      downloadToBuffer: async (_offset, _count, options) => {
        const blob = this.blobs.get(name);
        if (!blob) throw blobError(404, 'BlobNotFound');
        this.operations.push({ kind: 'downloadToBuffer', name, options });
        return Buffer.from(blob.body);
      },
      downloadToFile: async (destination, _offset, _count, options) => {
        const blob = this.blobs.get(name);
        if (!blob) throw blobError(404, 'BlobNotFound');
        this.operations.push({ kind: 'downloadToFile', name, options });
        await writeFile(destination, blob.body, { flag: 'wx' });
        return { contentLength: blob.body.length };
      },
      getTags: async () => {
        const blob = this.blobs.get(name);
        if (!blob) throw blobError(404, 'BlobNotFound');
        return { tags: { ...blob.tags } };
      },
      uploadFile: async (sourcePath, options) => {
        const contents = await readFile(sourcePath);
        return this.put(name, contents, options, 'uploadFile', sourcePath);
      },
      upload: async (contents, length, options) => {
        assert.equal(Buffer.byteLength(contents), length);
        return this.put(name, contents, options, 'upload');
      },
    };
  }

  async *listBlobsFlat({ prefix = '' } = {}) {
    this.operations.push({ kind: 'list', prefix });
    for (const name of [...this.blobs.keys()].sort()) {
      if (name.startsWith(prefix)) yield { name };
    }
  }

  json(name) {
    const blob = this.blobs.get(name);
    assert.ok(blob, `missing blob ${name}`);
    return JSON.parse(blob.body.toString('utf8'));
  }

  names(pattern = null) {
    const names = [...this.blobs.keys()].sort();
    return pattern ? names.filter(name => pattern.test(name)) : names;
  }
}

function makeStorageRoot(prefix = 'workshop-offhost-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const usersDir = join(root, 'users');
  const uploadsPath = join(root, 'uploads');
  const backupRoot = join(root, 'backups');
  mkdirSync(usersDir);
  mkdirSync(uploadsPath);
  return {
    root,
    dbPath: join(root, 'workshop.db'),
    seedDbPath: join(root, 'workshop-seed.db'),
    usersDir,
    uploadsPath,
    backupRoot,
  };
}

async function createBundle(sourceCreatedUtc = '2026-08-21T12:00:00.000Z') {
  const storage = makeStorageRoot();
  const userDbPath = join(storage.usersDir, '11111111-1111-4111-8111-111111111111.db');
  const db = new Database(userDbPath);
  db.exec(`
    CREATE TABLE project_images (
      id INTEGER PRIMARY KEY,
      file_path TEXT
    );
    CREATE TABLE build_log_entries (
      id INTEGER PRIMARY KEY,
      file_path TEXT
    );
    INSERT INTO project_images (file_path) VALUES ('referenced.jpg');
  `);
  db.close();
  writeFileSync(join(storage.uploadsPath, 'referenced.jpg'), 'referenced bytes');
  mkdirSync(join(storage.uploadsPath, 'orphans'));
  writeFileSync(join(storage.uploadsPath, 'orphans', 'retained.bin'), 'orphan bytes');
  const created = await createBackupBundle({
    ...storage,
    retentionCount: 7,
    now: () => new Date(sourceCreatedUtc),
    idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  return { storage, created };
}

function configFor(backupRoot, overrides = {}) {
  return resolveOffhostConfig({
    NODE_ENV: 'production',
    OFFHOST_BACKUP_ENABLED: 'true',
    OFFHOST_BACKUP_ACCOUNT: 'recoveryaccount',
    OFFHOST_BACKUP_CONTAINER: 'workshop',
    ...overrides,
  }, { backupRoot });
}

function randomSequence(start = 1n) {
  let current = start;
  return () => {
    const value = current.toString(16).padStart(32, '0');
    current += 1n;
    return value;
  };
}

function makeExporter({
  backupRoot,
  container = new FakeContainerClient(),
  checkedAt = '2026-08-21T14:00:00.000Z',
  randomHex = randomSequence(),
  downloadedVerifier = verifyBackupBundle,
  logger = { log() {}, info() {}, warn() {}, error() {} },
} = {}) {
  const exporter = createOffhostExporter({
    config: configFor(backupRoot),
    containerClient: container,
    appDir: join(import.meta.dirname, '..'),
    now: () => new Date(checkedAt),
    randomHex,
    localVerifier: verifyBackupBundle,
    downloadedVerifier,
    logger,
  });
  return { exporter, container };
}

test('off-host configuration is explicit, production-only, and fixed to workshop', () => {
  const disabled = resolveOffhostConfig({ OFFHOST_BACKUP_ENABLED: 'false' });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.active, false);
  assert.equal(disabled.scanIntervalMinutes, 60);
  assert.equal(disabled.dailyHealthMaxSourceAgeHours, 23);

  assert.throws(
    () => resolveOffhostConfig({
      NODE_ENV: 'development',
      OFFHOST_BACKUP_ENABLED: 'true',
      OFFHOST_BACKUP_ACCOUNT: 'recoveryaccount',
      OFFHOST_BACKUP_CONTAINER: 'workshop',
    }, { backupRoot: '/backups' }),
    error => error.code === 'OFFHOST_PRODUCTION_ONLY',
  );
  assert.throws(
    () => resolveOffhostConfig({
      NODE_ENV: 'production',
      OFFHOST_BACKUP_ENABLED: 'true',
      OFFHOST_BACKUP_ACCOUNT: 'recoveryaccount',
      OFFHOST_BACKUP_CONTAINER: 'tabloom',
    }, { backupRoot: '/backups' }),
    error => error.code === 'OFFHOST_CONTAINER_MISMATCH',
  );
  assert.throws(
    () => configFor('/backups', {
      OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES: '180',
    }),
    error => error.code === 'OFFHOST_CONFIG_INVALID',
  );
  assert.throws(
    () => configFor('/backups', {
      OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS: '48',
      OFFHOST_BACKUP_STALE_HOURS: '51',
    }),
    error => error.code === 'OFFHOST_CONFIG_INVALID',
  );
  assert.throws(
    () => configFor('/backups', {
      OFFHOST_BACKUP_MONTHLY_STALE_DAYS: '70',
      OFFHOST_BACKUP_CLOCK_SKEW_MINUTES: '30',
    }),
    error => error.code === 'OFFHOST_CONFIG_INVALID',
  );
  assert.equal(
    resolveOffhostConfig({
      NODE_ENV: 'production',
      OFFHOST_BACKUP_ENABLED: 'false',
      OFFHOST_BACKUP_ACCOUNT: 'recoveryaccount',
      OFFHOST_BACKUP_CONTAINER: 'workshop',
    }, { backupRoot: '/backups', manual: true }).active,
    true,
  );
});

test('capability check requires private DNS, own access, and exact cross-container denial', async () => {
  assert.equal(isPrivateAddress('10.20.30.40'), true);
  assert.equal(isPrivateAddress('172.31.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('20.30.40.50'), false);
  assert.equal(isPrivateAddress('127.0.0.1'), false);

  let ownReads = 0;
  let deniedReads = 0;
  const result = await assertOffhostCapabilities({
    hostname: 'recoveryaccount.blob.core.windows.net',
    dnsLookup: async () => [{ address: '10.10.1.4', family: 4 }],
    ownContainerClient: {
      async getProperties() {
        ownReads += 1;
      },
    },
    deniedContainerClient: {
      async getProperties() {
        deniedReads += 1;
        throw blobError(403, 'AuthorizationPermissionMismatch');
      },
    },
  });
  assert.deepEqual(result.addresses, ['10.10.1.4']);
  assert.equal(ownReads, 1);
  assert.equal(deniedReads, 1);

  await assert.rejects(
    assertOffhostCapabilities({
      hostname: 'recoveryaccount.blob.core.windows.net',
      dnsLookup: async () => [
        { address: '10.10.1.4', family: 4 },
        { address: '20.30.40.50', family: 4 },
      ],
      ownContainerClient: { getProperties: async () => {} },
      deniedContainerClient: { getProperties: async () => { throw blobError(403); } },
    }),
    error => error.code === 'OFFHOST_PUBLIC_DNS',
  );
  await assert.rejects(
    assertOffhostCapabilities({
      hostname: 'recoveryaccount.blob.core.windows.net',
      dnsLookup: async () => [{ address: '10.10.1.4', family: 4 }],
      ownContainerClient: { getProperties: async () => {} },
      deniedContainerClient: { getProperties: async () => {} },
    }),
    error => error.code === 'OFFHOST_CROSS_CONTAINER_ACCESSIBLE',
  );
});

test('scan uploads the whole bundle, verifies read-back, commits daily/monthly, and emits health', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  let downloadedVerifications = 0;
  const { exporter } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
    downloadedVerifier: async (bundlePath) => {
      downloadedVerifications += 1;
      await verifyBackupBundle(bundlePath);
    },
  });

  try {
    const result = await exporter.scan();
    assert.deepEqual(result, {
      status: 'completed',
      checkedUtc: '2026-08-21T14:00:00.000Z',
      localBundleCount: 1,
      dailyCreated: 1,
      monthlyCreated: 1,
      dailyHealth: true,
      monthlyHealth: true,
    });
    assert.equal(downloadedVerifications, 2);

    const dailyCommittedName = 'v1/daily/2026/08/21/_COMMITTED.json';
    const monthlyCommittedName = 'v1/monthly/2026/08/_COMMITTED.json';
    const dailyMarker = container.json(dailyCommittedName);
    const monthlyMarker = container.json(monthlyCommittedName);
    assert.deepEqual(Object.keys(dailyMarker), [
      'contract',
      'app',
      'tier',
      'artifactId',
      'attemptId',
      'sourceCreatedUtc',
      'verifiedUtc',
      'format',
      'manifestSha256',
      'fileCount',
      'totalBytes',
      'attemptPrefix',
    ]);
    assert.equal(dailyMarker.contract, 'personal-apps.offhost-backup.v1');
    assert.equal(dailyMarker.app, 'workshop');
    assert.equal(dailyMarker.format, 'workshop-backup-v1');
    assert.equal(dailyMarker.fileCount, 5);
    assert.equal(monthlyMarker.artifactId, dailyMarker.artifactId);
    assert.notEqual(monthlyMarker.attemptId, dailyMarker.attemptId);

    for (const marker of [dailyMarker, monthlyMarker]) {
      const names = container.names()
        .filter(name => name.startsWith(`${marker.attemptPrefix}/`));
      assert.equal(names.length, marker.fileCount + 1);
      assert.ok(names.includes(`${marker.attemptPrefix}/manifest.json`));
      assert.ok(names.includes(`${marker.attemptPrefix}/manifest.sha256`));
      assert.ok(names.includes(`${marker.attemptPrefix}/databases/users/11111111-1111-4111-8111-111111111111.db`));
      assert.ok(names.includes(`${marker.attemptPrefix}/uploads/referenced.jpg`));
      assert.ok(names.includes(`${marker.attemptPrefix}/uploads/orphans/retained.bin`));
      assert.ok(names.includes(`${marker.attemptPrefix}/_COMPLETE.json`));
    }

    const healthNames = container.names(/\/_HEALTH\.json$/);
    assert.equal(healthNames.length, 2);
    assert.match(healthNames[0], /^v1\/monitoring\/daily\/2026\/08\/21\/14\/[0-9a-f]{32}\/_HEALTH\.json$/);
    assert.match(healthNames[1], /^v1\/monitoring\/monthly\/2026\/08\/21\/14\/[0-9a-f]{32}\/_HEALTH\.json$/);
    assert.deepEqual(Object.keys(container.json(healthNames[0])), [
      'contract',
      'app',
      'tier',
      'checkedUtc',
      'sourceCreatedUtc',
      'sourceAgeHours',
      'slot',
      'artifactId',
      'manifestSha256',
      'committedMarker',
    ]);

    for (const operation of container.operations.filter(operation =>
      operation.kind === 'upload' || operation.kind === 'uploadFile')) {
      assert.equal(operation.options.conditions.ifNoneMatch, '*');
      assert.equal(operation.options.contentChecksumAlgorithm, 'StorageCrc64');
      assert.deepEqual(Object.keys(operation.options.tags).sort(), [
        'app',
        'artifactId',
        'backupDate',
        'format',
        'manifestSha',
        'state',
        'tier',
      ]);
    }
    for (const operation of container.operations.filter(operation =>
      operation.kind.startsWith('download'))) {
      assert.equal(operation.options.contentChecksumAlgorithm, 'StorageCrc64');
    }
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('repeat scan validates committed artifacts without duplicating recovery slots', async () => {
  const fixture = await createBundle();
  const { exporter, container } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
  });
  try {
    await exporter.scan();
    const firstAttemptCount = container.names(/\/_COMPLETE\.json$/).length;
    const firstCommittedCount = container.names(/\/_COMMITTED\.json$/).length;
    const firstHealthCount = container.names(/\/_HEALTH\.json$/).length;

    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 0);
    assert.equal(result.monthlyCreated, 0);
    assert.equal(container.names(/\/_COMPLETE\.json$/).length, firstAttemptCount);
    assert.equal(container.names(/\/_COMMITTED\.json$/).length, firstCommittedCount);
    assert.equal(container.names(/\/_HEALTH\.json$/).length, firstHealthCount + 2);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('immutable collisions leave partials and retry under a unique attempt prefix', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  container.collideFirstFileUpload = true;
  const { exporter } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    const dailyMarker = container.json('v1/daily/2026/08/21/_COMMITTED.json');
    assert.match(dailyMarker.attemptId, /-0{31}2$/);
    const partialNames = container.names()
      .filter(name => /-0{31}1\//.test(name));
    assert.equal(partialNames.length, 1);
    assert.equal(container.blobs.get(partialNames[0]).body.toString(), 'existing partial');
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('lost conditional commit response is recovered by validating the winning marker', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  container.loseFirstCommitResponse = true;
  const { exporter } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    assert.ok(container.blobs.has('v1/daily/2026/08/21/_COMMITTED.json'));
    assert.ok(container.blobs.has('v1/monthly/2026/08/_COMMITTED.json'));
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('tampering, extra remote files, and incorrect tags invalidate a committed slot', async () => {
  const fixture = await createBundle();
  const { exporter, container } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
  });
  try {
    await exporter.scan();
    const marker = container.json('v1/daily/2026/08/21/_COMMITTED.json');
    const manifestName = `${marker.attemptPrefix}/manifest.json`;
    const originalManifest = Buffer.from(container.blobs.get(manifestName).body);

    container.blobs.get(manifestName).body = Buffer.from('tampered');
    await assert.rejects(
      exporter.scan(),
      error => error.code === 'OFFHOST_READBACK_HASH_MISMATCH',
    );
    container.blobs.get(manifestName).body = originalManifest;

    const extraName = `${marker.attemptPrefix}/unexpected.env`;
    container.blobs.set(extraName, {
      body: Buffer.from('not allowed'),
      tags: { ...container.blobs.get(manifestName).tags },
    });
    await assert.rejects(
      exporter.scan(),
      error => error.code === 'OFFHOST_ATTEMPT_CONTENTS_INVALID',
    );
    container.blobs.delete(extraName);

    container.blobs.get(manifestName).tags.state = 'verified';
    await assert.rejects(
      exporter.scan(),
      error => error.code === 'OFFHOST_TAGS_INVALID',
    );
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('old backfills commit daily without health and cannot claim a later monthly slot', async () => {
  const fixture = await createBundle('2026-07-10T12:00:00.000Z');
  const { exporter, container } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    checkedAt: '2026-08-21T14:00:00.000Z',
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    assert.equal(result.monthlyCreated, 0);
    assert.equal(result.dailyHealth, false);
    assert.equal(result.monthlyHealth, false);
    assert.ok(container.blobs.has('v1/daily/2026/07/10/_COMMITTED.json'));
    assert.equal(container.blobs.has('v1/monthly/2026/08/_COMMITTED.json'), false);
    assert.equal(container.names(/\/_HEALTH\.json$/).length, 0);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('month rollover keeps the prior monthly point healthy without mis-committing it', async () => {
  const fixture = await createBundle('2026-08-31T23:00:00.000Z');
  const container = new FakeContainerClient();
  const august = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
    checkedAt: '2026-08-31T23:30:00.000Z',
    randomHex: randomSequence(1n),
  });
  try {
    await august.exporter.scan();
    const september = makeExporter({
      backupRoot: fixture.storage.backupRoot,
      container,
      checkedAt: '2026-09-01T00:30:00.000Z',
      randomHex: randomSequence(100n),
    });
    const result = await september.exporter.scan();
    assert.equal(result.monthlyCreated, 0);
    assert.equal(result.dailyHealth, true);
    assert.equal(result.monthlyHealth, true);
    assert.equal(container.blobs.has('v1/monthly/2026/09/_COMMITTED.json'), false);
    const latestMonthlyHealthName = container.names(
      /^v1\/monitoring\/monthly\/2026\/09\/01\/00\//,
    ).at(-1);
    assert.equal(container.json(latestMonthlyHealthName).slot, 'monthly:2026-08');
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('a scan crossing UTC month-end still commits the scan-start monthly slot', async () => {
  const fixture = await createBundle('2026-08-31T23:59:00.000Z');
  const container = new FakeContainerClient();
  let currentTime = new Date('2026-08-31T23:59:30.000Z');
  let readbackCount = 0;
  const exporter = createOffhostExporter({
    config: configFor(fixture.storage.backupRoot),
    containerClient: container,
    appDir: join(import.meta.dirname, '..'),
    localVerifier: verifyBackupBundle,
    downloadedVerifier: async (bundlePath) => {
      await verifyBackupBundle(bundlePath);
      readbackCount += 1;
      if (readbackCount === 1) {
        currentTime = new Date('2026-09-01T00:01:00.000Z');
      }
    },
    now: () => new Date(currentTime),
    randomHex: randomSequence(),
    logger: { log() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    assert.equal(result.monthlyCreated, 1);
    assert.ok(container.blobs.has('v1/monthly/2026/08/_COMMITTED.json'));
    assert.equal(container.blobs.has('v1/monthly/2026/09/_COMMITTED.json'), false);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('a committed daily artifact can populate monthly after its local bundle is pruned', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  const initial = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
    randomHex: randomSequence(1n),
  });
  try {
    await initial.exporter.scan();
    for (const name of container.names(/^v1\/monthly\//)) {
      container.blobs.delete(name);
    }
    rmSync(fixture.created.bundlePath, { recursive: true, force: true });

    const fallback = makeExporter({
      backupRoot: fixture.storage.backupRoot,
      container,
      randomHex: randomSequence(100n),
    });
    const result = await fallback.exporter.scan();
    assert.equal(result.localBundleCount, 0);
    assert.equal(result.monthlyCreated, 1);
    const monthly = container.json('v1/monthly/2026/08/_COMMITTED.json');
    const daily = container.json('v1/daily/2026/08/21/_COMMITTED.json');
    assert.equal(monthly.artifactId, daily.artifactId);
    assert.notEqual(monthly.attemptId, daily.attemptId);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('future sources and source mutations never create a committed marker', async () => {
  const futureFixture = await createBundle('2026-08-21T14:06:00.000Z');
  const future = makeExporter({
    backupRoot: futureFixture.storage.backupRoot,
    checkedAt: '2026-08-21T14:00:00.000Z',
  });
  try {
    const result = await future.exporter.scan();
    assert.equal(result.localBundleCount, 0);
    assert.equal(future.container.names().length, 0);
  } finally {
    rmSync(futureFixture.storage.root, { recursive: true, force: true });
  }

  const mutationFixture = await createBundle();
  const container = new FakeContainerClient();
  let mutated = false;
  container.mutateUploadSource = async (sourcePath) => {
    if (mutated) return;
    mutated = true;
    await writeFile(sourcePath, 'mutated during upload');
  };
  const mutation = makeExporter({
    backupRoot: mutationFixture.storage.backupRoot,
    container,
  });
  try {
    await assert.rejects(
      mutation.exporter.scan(),
      error => error.code === 'OFFHOST_SOURCE_MUTATED',
    );
    assert.equal(container.names(/\/_COMMITTED\.json$/).length, 0);
  } finally {
    rmSync(mutationFixture.storage.root, { recursive: true, force: true });
  }
});

test('whole-bundle re-verification rejects files added after upload starts', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  let added = false;
  container.mutateUploadSource = async () => {
    if (added) return;
    added = true;
    await writeFile(join(fixture.created.bundlePath, 'unexpected.env'), 'not in manifest');
  };
  const mutation = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    container,
  });
  try {
    await assert.rejects(
      mutation.exporter.scan(),
      error => error.code === 'OFFHOST_SOURCE_MUTATED',
    );
    assert.equal(container.names(/\/_COMPLETE\.json$/).length, 0);
    assert.equal(container.names(/\/_COMMITTED\.json$/).length, 0);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('health freshness is recalculated after artifact verification finishes', async () => {
  const fixture = await createBundle('2026-08-20T15:00:00.000Z');
  const container = new FakeContainerClient();
  let currentTime = new Date('2026-08-21T13:59:00.000Z');
  let readbackCount = 0;
  const exporter = createOffhostExporter({
    config: configFor(fixture.storage.backupRoot),
    containerClient: container,
    appDir: join(import.meta.dirname, '..'),
    localVerifier: verifyBackupBundle,
    downloadedVerifier: async (bundlePath) => {
      await verifyBackupBundle(bundlePath);
      readbackCount += 1;
      if (readbackCount === 2) {
        currentTime = new Date('2026-08-21T14:01:00.000Z');
      }
    },
    now: () => new Date(currentTime),
    randomHex: randomSequence(),
    logger: { log() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    assert.equal(result.monthlyCreated, 1);
    assert.equal(result.dailyHealth, false);
    assert.equal(result.monthlyHealth, true);
    assert.equal(
      container.names(/^v1\/monitoring\/daily\//).length,
      0,
    );
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('scan concurrency guard skips overlap without starting a duplicate job', async () => {
  const fixture = await createBundle();
  let releaseVerifier;
  let verifierCalls = 0;
  const verifierGate = new Promise(resolve => {
    releaseVerifier = resolve;
  });
  const { exporter } = makeExporter({
    backupRoot: fixture.storage.backupRoot,
    downloadedVerifier: async (bundlePath) => {
      verifierCalls += 1;
      if (verifierCalls === 1) await verifierGate;
      await verifyBackupBundle(bundlePath);
    },
  });
  try {
    const first = exporter.scan();
    const second = await exporter.scan();
    assert.deepEqual(second, { status: 'already_running' });
    releaseVerifier();
    const result = await first;
    assert.equal(result.status, 'completed');
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});

test('production read-back path invokes the recovery CLI verifier', async () => {
  const fixture = await createBundle();
  const container = new FakeContainerClient();
  const exporter = createOffhostExporter({
    config: configFor(fixture.storage.backupRoot),
    containerClient: container,
    appDir: join(import.meta.dirname, '..'),
    now: () => new Date('2026-08-21T14:00:00.000Z'),
    randomHex: randomSequence(),
    logger: { log() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const result = await exporter.scan();
    assert.equal(result.dailyCreated, 1);
    assert.equal(result.monthlyCreated, 1);
  } finally {
    rmSync(fixture.storage.root, { recursive: true, force: true });
  }
});
