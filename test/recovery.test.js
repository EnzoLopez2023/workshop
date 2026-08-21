import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  createBackupBundle,
  materializeBackupBundle,
  resolveStorageConfig,
  runRestoreDrill,
  verifyBackupBundle,
} from '../recovery.js';

function makeStorageRoot(prefix = 'workshop-recovery-') {
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

function createUserDatabase(path, uploadFilename = null) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec(`
    CREATE TABLE project_images (
      id INTEGER PRIMARY KEY,
      file_path TEXT
    );
    CREATE TABLE build_log_entries (
      id INTEGER PRIMARY KEY,
      file_path TEXT
    );
  `);
  db.pragma('wal_checkpoint(TRUNCATE)');
  if (uploadFilename) {
    db.prepare(`INSERT INTO project_images (file_path) VALUES (?)`).run(uploadFilename);
  }
  return db;
}

function backupOptions(storage, overrides = {}) {
  return {
    ...storage,
    retentionCount: 7,
    now: () => new Date('2026-08-21T12:00:00.000Z'),
    idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ...overrides,
  };
}

test('backup captures WAL data and uploads, then verifies and restores the bundle', async () => {
  const storage = makeStorageRoot();
  const restoredRoot = `${storage.root}-restored`;
  const userDbName = '11111111-1111-4111-8111-111111111111.db';
  const uploadFilename = 'project-photo.jpg';
  const userDbPath = join(storage.usersDir, userDbName);
  const sourceDb = createUserDatabase(userDbPath, uploadFilename);
  writeFileSync(join(storage.uploadsPath, uploadFilename), 'authoritative photo bytes');
  mkdirSync(join(storage.uploadsPath, 'orphaned'));
  writeFileSync(join(storage.uploadsPath, 'orphaned', 'retained.bin'), 'unreferenced but retained');

  try {
    assert.equal(existsSync(`${userDbPath}-wal`), true);
    const created = await createBackupBundle(backupOptions(storage));
    assert.equal(existsSync(created.bundlePath), true);
    assert.equal(created.manifest.databases.length, 1);
    assert.deepEqual(created.manifest.uploads, {
      fileCount: 2,
      totalBytes: 50,
      referencedFileCount: 1,
      orphanFileCount: 1,
    });

    const verification = await verifyBackupBundle(created.bundlePath);
    assert.equal(verification.databaseCount, 1);
    assert.equal(verification.uploadCount, 2);
    assert.equal(
      existsSync(join(created.bundlePath, 'databases', 'users', `${userDbName}-wal`)),
      false,
    );

    const snapshot = new Database(
      join(created.bundlePath, 'databases', 'users', userDbName),
      { readonly: true },
    );
    assert.equal(
      snapshot.prepare(`SELECT file_path FROM project_images`).get().file_path,
      uploadFilename,
    );
    snapshot.close();

    const drill = await runRestoreDrill(created.bundlePath);
    assert.equal(drill.drill, 'passed');

    await assert.rejects(
      materializeBackupBundle(
        created.bundlePath,
        join(storage.root, 'live-data', 'nested-restore'),
        { forbiddenRoots: [join(storage.root, 'live-data')] },
      ),
      /must not overlap protected root/,
    );
    await assert.rejects(
      materializeBackupBundle(created.bundlePath, join(created.bundlePath, 'restore')),
      /restore target and backup bundle must not overlap/,
    );

    const restored = await materializeBackupBundle(created.bundlePath, restoredRoot, {
      forbiddenRoots: [storage.root],
    });
    assert.equal(restored.bundleId, created.manifest.bundleId);
    assert.equal(
      readFileSync(join(restoredRoot, 'uploads', uploadFilename), 'utf8'),
      'authoritative photo bytes',
    );
    const restoredDb = new Database(join(restoredRoot, 'users', userDbName), {
      readonly: true,
    });
    assert.equal(restoredDb.pragma('quick_check', { simple: true }), 'ok');
    restoredDb.close();
  } finally {
    sourceDb.close();
    rmSync(storage.root, { recursive: true, force: true });
    rmSync(restoredRoot, { recursive: true, force: true });
  }
});

test('verification rejects tampering and unsafe manifest paths', async () => {
  const storage = makeStorageRoot();
  writeFileSync(join(storage.uploadsPath, 'file.bin'), 'original');

  try {
    const created = await createBackupBundle(backupOptions(storage));
    writeFileSync(join(created.bundlePath, 'uploads', 'file.bin'), 'tampered');
    await assert.rejects(
      verifyBackupBundle(created.bundlePath),
      /size mismatch|checksum mismatch/,
    );

    writeFileSync(join(created.bundlePath, 'uploads', 'file.bin'), 'original');
    const manifestPath = join(created.bundlePath, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files[0].path = '../escape';
    const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, manifestContents);
    writeFileSync(
      join(created.bundlePath, 'manifest.sha256'),
      `${createHash('sha256').update(manifestContents).digest('hex')}  manifest.json\n`,
    );
    await assert.rejects(verifyBackupBundle(created.bundlePath), /unsafe bundle path/);
  } finally {
    rmSync(storage.root, { recursive: true, force: true });
  }
});

test('failed backups remove staging data and reject missing references or symlinks', async () => {
  const missingStorage = makeStorageRoot('workshop-recovery-missing-');
  const missingDb = createUserDatabase(
    join(missingStorage.usersDir, 'missing.db'),
    'not-on-disk.jpg',
  );
  try {
    await assert.rejects(
      createBackupBundle(backupOptions(missingStorage)),
      /references missing upload/,
    );
    assert.deepEqual(readdirSync(missingStorage.backupRoot), []);
  } finally {
    missingDb.close();
    rmSync(missingStorage.root, { recursive: true, force: true });
  }

  const symlinkStorage = makeStorageRoot('workshop-recovery-symlink-');
  writeFileSync(join(symlinkStorage.root, 'outside.bin'), 'outside');
  symlinkSync(
    join(symlinkStorage.root, 'outside.bin'),
    join(symlinkStorage.uploadsPath, 'linked.bin'),
  );
  try {
    await assert.rejects(
      createBackupBundle(backupOptions(symlinkStorage)),
      /symbolic links are not allowed/,
    );
    assert.deepEqual(readdirSync(symlinkStorage.backupRoot), []);
  } finally {
    rmSync(symlinkStorage.root, { recursive: true, force: true });
  }
});

test('retention removes only complete oldest bundles', async () => {
  const storage = makeStorageRoot('workshop-recovery-retention-');
  mkdirSync(storage.backupRoot);
  const staleStagingName =
    '.workshop-backup-20260818T120000000Z-dddddddd.tmp-11111111-1111-4111-8111-111111111111';
  mkdirSync(join(storage.backupRoot, staleStagingName));
  writeFileSync(join(storage.backupRoot, staleStagingName, 'partial'), 'incomplete');
  const dates = [
    '2026-08-19T12:00:00.000Z',
    '2026-08-20T12:00:00.000Z',
    '2026-08-21T12:00:00.000Z',
  ];
  const ids = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
  const createdPaths = [];

  try {
    for (let index = 0; index < dates.length; index += 1) {
      const created = await createBackupBundle(backupOptions(storage, {
        retentionCount: 2,
        now: () => new Date(dates[index]),
        idFactory: () => ids[index],
      }));
      createdPaths.push(created.bundlePath);
    }

    assert.equal(existsSync(createdPaths[0]), false);
    assert.equal(existsSync(createdPaths[1]), true);
    assert.equal(existsSync(createdPaths[2]), true);
    assert.deepEqual(
      readdirSync(storage.backupRoot).sort(),
      createdPaths.slice(1).map(path => path.split('/').at(-1)).sort(),
    );
  } finally {
    rmSync(storage.root, { recursive: true, force: true });
  }
});

test('production storage defaults use the durable App Service root and allow overrides', () => {
  const defaults = resolveStorageConfig({ NODE_ENV: 'production' }, { appDir: '/app' });
  assert.equal(defaults.dataRoot, '/home/data');
  assert.equal(defaults.dbPath, '/home/data/workshop.db');
  assert.equal(defaults.uploadsPath, '/home/data/uploads');
  assert.equal(defaults.backupRoot, '/home/data/backups');
  assert.equal(defaults.backupIntervalHours, 24);

  const overridden = resolveStorageConfig({
    NODE_ENV: 'production',
    DB_PATH: '/mnt/custom/primary.db',
    UPLOADS_PATH: '/mnt/files',
    BACKUP_PATH: '/mnt/recovery',
    BACKUP_INTERVAL_HOURS: '12',
  }, { appDir: '/app' });
  assert.equal(overridden.dataRoot, '/mnt/custom');
  assert.equal(overridden.usersDir, '/mnt/custom/users');
  assert.equal(overridden.uploadsPath, '/mnt/files');
  assert.equal(overridden.backupRoot, '/mnt/recovery');
  assert.equal(overridden.backupIntervalHours, 12);
});

test('container image does not shadow the App Service persistent home mount', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\s+.*\/home\/data/im);
  assert.match(compose, /workshop-data:\/home\/data/);
});

test('Express recovery capture uses the configured per-user DB and upload roots', async () => {
  const storage = makeStorageRoot('workshop-recovery-server-');
  const userKey = '11111111-1111-4111-8111-111111111111';
  process.env.NODE_ENV = 'test';
  process.env.AZURE_HOME_TENANT_ID = '22222222-2222-4222-8222-222222222222';
  process.env.API_AUDIENCE = '33333333-3333-4333-8333-333333333333';
  process.env.ALLOWED_OID = '';
  process.env.SESSION_SECRET = '';
  process.env.DB_PATH = storage.dbPath;
  process.env.SEED_DB_PATH = storage.seedDbPath;
  process.env.USERS_DIR = storage.usersDir;
  process.env.UPLOADS_PATH = storage.uploadsPath;
  process.env.BACKUP_PATH = storage.backupRoot;
  process.env.BACKUP_INTERVAL_HOURS = '0';

  const api = await import(`../server.js?recovery-integration=${Date.now()}`);
  try {
    const { db } = api.getUserDb(userKey);
    const projectId = db.prepare(`INSERT INTO projects (title) VALUES (?)`).run('Backed up').lastInsertRowid;
    db.prepare(`
      INSERT INTO project_images (project_id, kind, file_path)
      VALUES (?, 'sketch', ?)
    `).run(projectId, 'server-photo.jpg');
    writeFileSync(join(storage.uploadsPath, 'server-photo.jpg'), 'server upload');

    let releaseExport;
    const exportGate = new Promise(resolve => {
      releaseExport = resolve;
    });
    let exportStarted;
    const exportStartedPromise = new Promise(resolve => {
      exportStarted = resolve;
    });
    let exportTriggerCount = 0;
    const backup = api.runRecoveryBackup({
      onVerified: async created => {
        exportTriggerCount += 1;
        assert.equal(existsSync(created.bundlePath), true);
        await verifyBackupBundle(created.bundlePath);
        exportStarted();
        await exportGate;
      },
    });
    const joined = api.runRecoveryBackup({
      onVerified: () => {
        throw new Error('joined backups must not trigger a duplicate export');
      },
    });
    assert.strictEqual(joined, backup);
    const result = await backup;
    await exportStartedPromise;
    assert.equal(exportTriggerCount, 1);
    const verified = await verifyBackupBundle(result.bundlePath);
    assert.equal(verified.databaseCount, 1);
    assert.equal(verified.uploadCount, 1);
    assert.equal(
      existsSync(join(result.bundlePath, 'databases', 'users', `${userKey}.db`)),
      true,
    );
    releaseExport();
  } finally {
    api.closeAllDatabases();
    rmSync(storage.root, { recursive: true, force: true });
  }
});
