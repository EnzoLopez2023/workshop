import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

const BUNDLE_FORMAT = 'workshop-recovery-bundle';
const BUNDLE_VERSION = 1;
const BUNDLE_NAME_RE = /^workshop-backup-\d{8}T\d{9}Z-[0-9a-f]{8}$/;
const STAGING_NAME_RE = /^\.workshop-backup-\d{8}T\d{9}Z-[0-9a-f]{8}\.tmp-[0-9a-f-]{36}$/;
const MANIFEST_PATH = 'manifest.json';
const MANIFEST_CHECKSUM_PATH = 'manifest.sha256';
const SQLITE_KINDS = new Set(['sqlite']);
const FILE_KINDS = new Set(['sqlite', 'upload']);

function resolveFrom(basePath, value) {
  return isAbsolute(value) ? resolve(value) : resolve(basePath, value);
}

function parseNumber(env, name, fallback, { integer = false, min = 0 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} >= ${min}`);
  }
  return value;
}

function isPathWithin(parentPath, candidatePath) {
  const pathFromParent = relative(resolve(parentPath), resolve(candidatePath));
  return pathFromParent === ''
    || (!pathFromParent.startsWith(`..${sep}`)
      && pathFromParent !== '..'
      && !isAbsolute(pathFromParent));
}

function assertDistinctPaths(labelA, pathA, labelB, pathB) {
  if (resolve(pathA) === resolve(pathB)) {
    throw new Error(`${labelA} and ${labelB} must use different paths`);
  }
}

function assertDirectoriesDoNotOverlap(labelA, pathA, labelB, pathB) {
  if (isPathWithin(pathA, pathB) || isPathWithin(pathB, pathA)) {
    throw new Error(`${labelA} and ${labelB} must not overlap`);
  }
}

function assertFileOutsideDirectory(fileLabel, filePath, directoryLabel, directoryPath) {
  if (isPathWithin(directoryPath, filePath)) {
    throw new Error(`${fileLabel} must not be stored inside ${directoryLabel}`);
  }
}

export function resolveStorageConfig(env = process.env, { appDir = process.cwd() } = {}) {
  const productionRoot = env.NODE_ENV === 'production' ? '/home/data' : appDir;
  const configuredRoot = env.DATA_ROOT
    ? resolveFrom(appDir, env.DATA_ROOT)
    : null;
  const provisionalDbPath = resolveFrom(
    appDir,
    env.DB_PATH ?? join(configuredRoot ?? productionRoot, 'workshop.db'),
  );
  const dataRoot = configuredRoot ?? dirname(provisionalDbPath);
  const dbPath = provisionalDbPath;
  const seedDbPath = resolveFrom(
    appDir,
    env.SEED_DB_PATH ?? join(dataRoot, 'workshop-seed.db'),
  );
  const usersDir = resolveFrom(appDir, env.USERS_DIR ?? join(dataRoot, 'users'));
  const uploadsPath = resolveFrom(appDir, env.UPLOADS_PATH ?? join(dataRoot, 'uploads'));
  const backupRoot = resolveFrom(appDir, env.BACKUP_PATH ?? join(dataRoot, 'backups'));

  assertDistinctPaths('DB_PATH', dbPath, 'SEED_DB_PATH', seedDbPath);
  assertDirectoriesDoNotOverlap('USERS_DIR', usersDir, 'UPLOADS_PATH', uploadsPath);
  assertDirectoriesDoNotOverlap('BACKUP_PATH', backupRoot, 'USERS_DIR', usersDir);
  assertDirectoriesDoNotOverlap('BACKUP_PATH', backupRoot, 'UPLOADS_PATH', uploadsPath);
  for (const [fileLabel, filePath] of [
    ['DB_PATH', dbPath],
    ['SEED_DB_PATH', seedDbPath],
  ]) {
    assertFileOutsideDirectory(fileLabel, filePath, 'BACKUP_PATH', backupRoot);
    assertFileOutsideDirectory(fileLabel, filePath, 'USERS_DIR', usersDir);
    assertFileOutsideDirectory(fileLabel, filePath, 'UPLOADS_PATH', uploadsPath);
  }

  return {
    dataRoot,
    dbPath,
    seedDbPath,
    usersDir,
    uploadsPath,
    backupRoot,
    backupIntervalHours: parseNumber(
      env,
      'BACKUP_INTERVAL_HOURS',
      env.NODE_ENV === 'production' ? 24 : 0,
    ),
    backupInitialDelayMinutes: parseNumber(
      env,
      'BACKUP_INITIAL_DELAY_MINUTES',
      env.NODE_ENV === 'production' ? 5 : 0,
    ),
    backupRetentionCount: parseNumber(
      env,
      'BACKUP_RETENTION_COUNT',
      7,
      { integer: true, min: 1 },
    ),
    backupQuiesceTimeoutMs: parseNumber(
      env,
      'BACKUP_QUIESCE_TIMEOUT_MS',
      30_000,
      { integer: true, min: 1_000 },
    ),
    backupLockStaleMs: parseNumber(
      env,
      'BACKUP_LOCK_STALE_MINUTES',
      360,
      { min: 1 },
    ) * 60_000,
  };
}

function assertSafeRelativePath(filePath) {
  if (
    typeof filePath !== 'string'
    || !filePath
    || filePath.includes('\0')
    || filePath.includes('\\')
    || filePath.startsWith('/')
  ) {
    throw new Error(`unsafe bundle path: ${String(filePath)}`);
  }
  const segments = filePath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`unsafe bundle path: ${filePath}`);
  }
  return filePath;
}

function safeJoin(rootPath, filePath) {
  const safePath = assertSafeRelativePath(filePath);
  const joined = resolve(rootPath, ...safePath.split('/'));
  if (!isPathWithin(rootPath, joined) || joined === resolve(rootPath)) {
    throw new Error(`bundle path escapes its root: ${filePath}`);
  }
  return joined;
}

async function optionalLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertDirectory(path, { allowMissing = false } = {}) {
  const info = await optionalLstat(path);
  if (!info && allowMissing) return false;
  if (!info) throw new Error(`required directory does not exist: ${path}`);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`expected a non-symlink directory: ${path}`);
  }
  return true;
}

async function assertRegularFile(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`expected a non-symlink regular file: ${path}`);
  }
  return info;
}

async function walkRegularFiles(rootPath, relativeDir = '') {
  const currentPath = relativeDir ? safeJoin(rootPath, relativeDir) : rootPath;
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    assertSafeRelativePath(relativePath);
    const fullPath = safeJoin(rootPath, relativePath);
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in recovery data: ${fullPath}`);
    }
    if (info.isDirectory()) {
      files.push(...await walkRegularFiles(rootPath, relativePath));
      continue;
    }
    if (!info.isFile()) {
      throw new Error(`unsupported recovery-data entry: ${fullPath}`);
    }
    files.push({ fullPath, relativePath, info });
  }
  return files;
}

async function syncFile(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryTree(rootPath, relativeDir = '') {
  const currentPath = relativeDir ? safeJoin(rootPath, relativeDir) : rootPath;
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    const fullPath = safeJoin(rootPath, relativePath);
    const info = await lstat(fullPath);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`expected a non-symlink directory: ${fullPath}`);
    }
    await syncDirectoryTree(rootPath, relativePath);
  }
  await syncDirectory(currentPath);
}

async function writeDurableFile(path, contents) {
  await writeFile(path, contents, { flag: 'wx' });
  await syncFile(path);
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileRecord(kind, relativePath, fullPath) {
  if (!FILE_KINDS.has(kind)) throw new Error(`unsupported recovery file kind: ${kind}`);
  const info = await assertRegularFile(fullPath);
  return {
    path: assertSafeRelativePath(relativePath),
    kind,
    size: info.size,
    sha256: await hashFile(fullPath),
  };
}

async function copyStableFile(sourcePath, destinationPath) {
  const before = await stat(sourcePath, { bigint: true });
  if (!before.isFile()) throw new Error(`source is not a regular file: ${sourcePath}`);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
  const after = await stat(sourcePath, { bigint: true });
  const copied = await stat(destinationPath, { bigint: true });
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || copied.size !== after.size
  ) {
    throw new Error(`source changed while it was copied: ${sourcePath}`);
  }
  await syncFile(destinationPath);
}

function readPragmaScalar(db, pragma) {
  return db.pragma(pragma, { simple: true });
}

function inspectDatabase(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheckRows = db.pragma('quick_check');
    const quickCheck = quickCheckRows.flatMap(row => Object.values(row));
    if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') {
      throw new Error(`SQLite quick_check failed for ${databasePath}: ${quickCheck.join('; ')}`);
    }
    const foreignKeyFailures = db.pragma('foreign_key_check');
    if (foreignKeyFailures.length > 0) {
      throw new Error(`SQLite foreign_key_check failed for ${databasePath}`);
    }

    const tables = new Set(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()
        .map(row => row.name),
    );
    const uploadReferences = [];
    for (const table of ['project_images', 'build_log_entries']) {
      if (!tables.has(table)) continue;
      const columns = new Set(db.pragma(`table_info(${table})`).map(column => column.name));
      if (!columns.has('file_path')) continue;
      for (const row of db.prepare(
        `SELECT file_path FROM ${table} WHERE file_path IS NOT NULL ORDER BY file_path`,
      ).all()) {
        if (typeof row.file_path !== 'string' || !row.file_path) continue;
        const filename = basename(row.file_path);
        assertSafeRelativePath(filename);
        uploadReferences.push({ table, filename });
      }
    }

    return {
      quickCheck: 'ok',
      foreignKeyCheck: 'ok',
      pageCount: readPragmaScalar(db, 'page_count'),
      userVersion: readPragmaScalar(db, 'user_version'),
      uploadReferences,
    };
  } finally {
    db.close();
  }
}

async function collectDatabaseSources({ dbPath, seedDbPath, usersDir }) {
  const sources = [];
  const sourcePaths = new Set();

  const addSource = async (source) => {
    const resolvedSource = resolve(source.sourcePath);
    if (sourcePaths.has(resolvedSource)) {
      throw new Error(`database path is configured more than once: ${resolvedSource}`);
    }
    await assertRegularFile(resolvedSource);
    sourcePaths.add(resolvedSource);
    sources.push({ ...source, sourcePath: resolvedSource });
  };

  if (await optionalLstat(dbPath)) {
    await addSource({
      role: 'legacy',
      sourcePath: dbPath,
      bundlePath: 'databases/workshop.db',
    });
  }
  if (await optionalLstat(seedDbPath)) {
    await addSource({
      role: 'seed',
      sourcePath: seedDbPath,
      bundlePath: 'databases/workshop-seed.db',
    });
  }

  if (await assertDirectory(usersDir, { allowMissing: true })) {
    const entries = await readdir(usersDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.name.endsWith('.db')) continue;
      const sourcePath = join(usersDir, entry.name);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`user database is not a regular file: ${sourcePath}`);
      }
      assertSafeRelativePath(entry.name);
      await addSource({
        role: 'user',
        sourceName: entry.name,
        sourcePath,
        bundlePath: `databases/users/${entry.name}`,
      });
    }
  }

  return sources;
}

async function backupDatabase(sourcePath, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
  const snapshot = new Database(destinationPath);
  try {
    snapshot.pragma('wal_checkpoint(TRUNCATE)');
    snapshot.pragma('journal_mode = DELETE');
  } finally {
    snapshot.close();
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await rm(`${destinationPath}${suffix}`, { force: true });
  }
  await syncFile(destinationPath);
}

function validateUploadReferences(databaseInspections, availableUploadPaths) {
  const referencedUploadPaths = new Set();
  for (const database of databaseInspections) {
    for (const reference of database.uploadReferences) {
      const uploadPath = `uploads/${reference.filename}`;
      referencedUploadPaths.add(uploadPath);
      if (!availableUploadPaths.has(uploadPath)) {
        throw new Error(
          `${database.path} references missing upload ${reference.filename} in ${reference.table}`,
        );
      }
    }
  }
  return referencedUploadPaths;
}

function bundleTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new Error('backup timestamp must be a valid Date');
  }
  return date.toISOString().replace(/[-:.]/g, '');
}

async function acquireBackupLock(backupRoot, staleMs) {
  const lockPath = join(backupRoot, '.backup.lock');
  const token = randomUUID();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(lockPath);
      try {
        await writeDurableFile(
          join(lockPath, 'owner.json'),
          `${JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        try {
          const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
          if (owner.token === token) {
            await rm(lockPath, { recursive: true, force: true });
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const lockInfo = await optionalLstat(lockPath);
      if (!lockInfo) continue;
      if (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()) {
        throw new Error(`invalid backup lock: ${lockPath}`);
      }
      if (Date.now() - lockInfo.mtimeMs <= staleMs) {
        const locked = new Error(`another backup is already running: ${lockPath}`);
        locked.code = 'BACKUP_LOCKED';
        throw locked;
      }
      const stalePath = join(backupRoot, `.backup.lock.stale-${randomUUID()}`);
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
      } catch (renameError) {
        if (renameError?.code !== 'ENOENT') throw renameError;
      }
    }
  }
  throw new Error('could not acquire the backup lock');
}

async function listCompleteBundles(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const bundleNames = [];
  for (const entry of entries) {
    if (!BUNDLE_NAME_RE.test(entry.name)) continue;
    const bundlePath = join(backupRoot, entry.name);
    const info = await lstat(bundlePath);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`invalid retained backup entry: ${bundlePath}`);
    }
    bundleNames.push(entry.name);
  }
  return bundleNames.sort();
}

async function cleanupStagingDirectories(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!STAGING_NAME_RE.test(entry.name)) continue;
    const stagingPath = join(backupRoot, entry.name);
    const info = await lstat(stagingPath);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`invalid backup staging entry: ${stagingPath}`);
    }
    await rm(stagingPath, { recursive: true, force: false });
  }
}

async function pruneBackupBundles(backupRoot, retentionCount) {
  if (!Number.isInteger(retentionCount) || retentionCount < 1) {
    throw new Error('retentionCount must be an integer >= 1');
  }
  const bundleNames = await listCompleteBundles(backupRoot);
  const removeNames = bundleNames.slice(0, Math.max(0, bundleNames.length - retentionCount));
  for (const name of removeNames) {
    await rm(join(backupRoot, name), { recursive: true, force: false });
  }
  if (removeNames.length > 0) await syncDirectory(backupRoot);
  return removeNames;
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest must be an object');
  }
  if (manifest.format !== BUNDLE_FORMAT || manifest.version !== BUNDLE_VERSION) {
    throw new Error('unsupported recovery bundle format');
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.databases)) {
    throw new Error('manifest files and databases must be arrays');
  }
  return manifest;
}

export async function verifyBackupBundle(bundlePath) {
  const resolvedBundlePath = resolve(bundlePath);
  await assertDirectory(resolvedBundlePath);

  const manifestPath = safeJoin(resolvedBundlePath, MANIFEST_PATH);
  const checksumPath = safeJoin(resolvedBundlePath, MANIFEST_CHECKSUM_PATH);
  await assertRegularFile(manifestPath);
  await assertRegularFile(checksumPath);

  const manifestContents = await readFile(manifestPath, 'utf8');
  const checksumContents = await readFile(checksumPath, 'utf8');
  const checksumMatch = /^([0-9a-f]{64})  manifest\.json\n?$/.exec(checksumContents);
  if (!checksumMatch) throw new Error('manifest.sha256 has an invalid format');
  const actualManifestChecksum = createHash('sha256').update(manifestContents).digest('hex');
  if (checksumMatch[1] !== actualManifestChecksum) {
    throw new Error('manifest checksum mismatch');
  }

  let manifest;
  try {
    manifest = validateManifestShape(JSON.parse(manifestContents));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('manifest.json is not valid JSON');
    throw error;
  }

  const recordsByPath = new Map();
  for (const record of manifest.files) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('manifest contains an invalid file record');
    }
    const filePath = assertSafeRelativePath(record.path);
    if (
      !FILE_KINDS.has(record.kind)
      || !Number.isInteger(record.size)
      || record.size < 0
      || !/^[0-9a-f]{64}$/.test(record.sha256)
    ) {
      throw new Error(`manifest contains an invalid file record: ${filePath}`);
    }
    if (
      (record.kind === 'sqlite' && !filePath.startsWith('databases/'))
      || (record.kind === 'upload' && !filePath.startsWith('uploads/'))
    ) {
      throw new Error(`manifest file kind does not match its path: ${filePath}`);
    }
    if (recordsByPath.has(filePath)) throw new Error(`duplicate manifest path: ${filePath}`);
    recordsByPath.set(filePath, record);
  }

  const actualFiles = await walkRegularFiles(resolvedBundlePath);
  const actualDataPaths = new Set(
    actualFiles
      .map(file => file.relativePath)
      .filter(filePath => filePath !== MANIFEST_PATH && filePath !== MANIFEST_CHECKSUM_PATH),
  );
  if (
    actualDataPaths.size !== recordsByPath.size
    || [...actualDataPaths].some(filePath => !recordsByPath.has(filePath))
  ) {
    throw new Error('bundle contents do not match the manifest');
  }

  for (const [filePath, record] of recordsByPath) {
    const fullPath = safeJoin(resolvedBundlePath, filePath);
    const info = await assertRegularFile(fullPath);
    if (info.size !== record.size) throw new Error(`size mismatch for ${filePath}`);
    if (await hashFile(fullPath) !== record.sha256) {
      throw new Error(`checksum mismatch for ${filePath}`);
    }
  }

  const databasePaths = new Set();
  const databaseDestinations = new Set();
  const databaseInspections = [];
  for (const database of manifest.databases) {
    if (!database || typeof database !== 'object' || Array.isArray(database)) {
      throw new Error('manifest contains an invalid database record');
    }
    const databasePath = assertSafeRelativePath(database.path);
    const fileRecordForDatabase = recordsByPath.get(databasePath);
    if (!fileRecordForDatabase || !SQLITE_KINDS.has(fileRecordForDatabase.kind)) {
      throw new Error(`database is missing from file records: ${databasePath}`);
    }
    if (!['legacy', 'seed', 'user'].includes(database.role)) {
      throw new Error(`invalid database role: ${database.role}`);
    }
    let destinationKey;
    if (database.role === 'legacy') {
      if (databasePath !== 'databases/workshop.db') {
        throw new Error(`invalid legacy database path: ${databasePath}`);
      }
      destinationKey = 'workshop.db';
    } else if (database.role === 'seed') {
      if (databasePath !== 'databases/workshop-seed.db') {
        throw new Error(`invalid seed database path: ${databasePath}`);
      }
      destinationKey = 'workshop-seed.db';
    }
    if (database.role === 'user') {
      assertSafeRelativePath(database.sourceName);
      if (database.sourceName.includes('/') || !database.sourceName.endsWith('.db')) {
        throw new Error(`invalid user database name: ${database.sourceName}`);
      }
      if (databasePath !== `databases/users/${database.sourceName}`) {
        throw new Error(`invalid user database path: ${databasePath}`);
      }
      destinationKey = `users/${database.sourceName}`;
    }
    if (databasePaths.has(databasePath)) throw new Error(`duplicate database path: ${databasePath}`);
    if (databaseDestinations.has(destinationKey)) {
      throw new Error(`duplicate database destination: ${destinationKey}`);
    }
    databasePaths.add(databasePath);
    databaseDestinations.add(destinationKey);
    const inspection = inspectDatabase(safeJoin(resolvedBundlePath, databasePath));
    if (
      database.quickCheck !== inspection.quickCheck
      || database.foreignKeyCheck !== inspection.foreignKeyCheck
      || database.pageCount !== inspection.pageCount
      || database.userVersion !== inspection.userVersion
      || database.uploadReferenceCount !== inspection.uploadReferences.length
    ) {
      throw new Error(`database summary does not match snapshot: ${databasePath}`);
    }
    databaseInspections.push({ ...inspection, path: databasePath });
  }
  const sqlitePaths = new Set(
    [...recordsByPath.values()]
      .filter(record => record.kind === 'sqlite')
      .map(record => record.path),
  );
  if (
    sqlitePaths.size !== databasePaths.size
    || [...sqlitePaths].some(filePath => !databasePaths.has(filePath))
  ) {
    throw new Error('database records do not match SQLite files');
  }

  const uploadPaths = new Set(
    [...recordsByPath.values()]
      .filter(record => record.kind === 'upload')
      .map(record => record.path),
  );
  const referencedUploadPaths = validateUploadReferences(databaseInspections, uploadPaths);
  const uploadBytes = [...recordsByPath.values()]
    .filter(record => record.kind === 'upload')
    .reduce((total, record) => total + record.size, 0);
  if (
    manifest.uploads?.fileCount !== uploadPaths.size
    || manifest.uploads?.totalBytes !== uploadBytes
    || manifest.uploads?.referencedFileCount !== referencedUploadPaths.size
    || manifest.uploads?.orphanFileCount !== uploadPaths.size - referencedUploadPaths.size
  ) {
    throw new Error('upload summary does not match bundle contents');
  }

  return {
    bundlePath: resolvedBundlePath,
    manifest,
    manifestSha256: actualManifestChecksum,
    databaseCount: databasePaths.size,
    uploadCount: uploadPaths.size,
    uploadBytes,
    referencedUploadCount: referencedUploadPaths.size,
  };
}

export async function createBackupBundle(options) {
  const {
    dbPath,
    seedDbPath,
    usersDir,
    uploadsPath,
    backupRoot,
    retentionCount = 7,
    lockStaleMs = 6 * 60 * 60 * 1_000,
    now = () => new Date(),
    idFactory = () => randomUUID(),
  } = options;
  if (![dbPath, seedDbPath, usersDir, uploadsPath, backupRoot].every(Boolean)) {
    throw new Error('all recovery storage paths are required');
  }
  if (!Number.isInteger(retentionCount) || retentionCount < 1) {
    throw new Error('retentionCount must be an integer >= 1');
  }

  const resolvedBackupRoot = resolve(backupRoot);
  assertDistinctPaths('DB_PATH', dbPath, 'SEED_DB_PATH', seedDbPath);
  assertDirectoriesDoNotOverlap('USERS_DIR', usersDir, 'UPLOADS_PATH', uploadsPath);
  assertDirectoriesDoNotOverlap('BACKUP_PATH', resolvedBackupRoot, 'USERS_DIR', usersDir);
  assertDirectoriesDoNotOverlap('BACKUP_PATH', resolvedBackupRoot, 'UPLOADS_PATH', uploadsPath);
  for (const [fileLabel, filePath] of [
    ['DB_PATH', dbPath],
    ['SEED_DB_PATH', seedDbPath],
  ]) {
    assertFileOutsideDirectory(fileLabel, filePath, 'BACKUP_PATH', resolvedBackupRoot);
    assertFileOutsideDirectory(fileLabel, filePath, 'USERS_DIR', usersDir);
    assertFileOutsideDirectory(fileLabel, filePath, 'UPLOADS_PATH', uploadsPath);
  }

  await mkdir(resolvedBackupRoot, { recursive: true });
  await assertDirectory(resolvedBackupRoot);
  const releaseLock = await acquireBackupLock(resolvedBackupRoot, lockStaleMs);
  const createdAt = now();
  const bundleId = `workshop-backup-${bundleTimestamp(createdAt)}-${idFactory().replaceAll('-', '').slice(0, 8)}`;
  if (!BUNDLE_NAME_RE.test(bundleId)) throw new Error('backup ID factory returned an invalid value');
  const stagingPath = join(resolvedBackupRoot, `.${bundleId}.tmp-${randomUUID()}`);
  const finalPath = join(resolvedBackupRoot, bundleId);
  let finalized = false;

  try {
    await cleanupStagingDirectories(resolvedBackupRoot);
    await mkdir(stagingPath);
    const databaseSources = await collectDatabaseSources({ dbPath, seedDbPath, usersDir });
    const fileRecords = [];
    const databaseRecords = [];
    const databaseInspections = [];

    for (const database of databaseSources) {
      const destinationPath = safeJoin(stagingPath, database.bundlePath);
      await backupDatabase(database.sourcePath, destinationPath);
      const inspection = inspectDatabase(destinationPath);
      fileRecords.push(await fileRecord('sqlite', database.bundlePath, destinationPath));
      databaseRecords.push({
        path: database.bundlePath,
        role: database.role,
        ...(database.sourceName ? { sourceName: database.sourceName } : {}),
        quickCheck: inspection.quickCheck,
        foreignKeyCheck: inspection.foreignKeyCheck,
        pageCount: inspection.pageCount,
        userVersion: inspection.userVersion,
        uploadReferenceCount: inspection.uploadReferences.length,
      });
      databaseInspections.push({ ...inspection, path: database.bundlePath });
    }

    const uploadFiles = await assertDirectory(uploadsPath, { allowMissing: true })
      ? await walkRegularFiles(uploadsPath)
      : [];
    for (const upload of uploadFiles) {
      const bundlePath = `uploads/${upload.relativePath}`;
      const destinationPath = safeJoin(stagingPath, bundlePath);
      await copyStableFile(upload.fullPath, destinationPath);
      fileRecords.push(await fileRecord('upload', bundlePath, destinationPath));
    }

    fileRecords.sort((a, b) => a.path.localeCompare(b.path));
    databaseRecords.sort((a, b) => a.path.localeCompare(b.path));
    const uploadPaths = new Set(
      fileRecords.filter(record => record.kind === 'upload').map(record => record.path),
    );
    const referencedUploadPaths = validateUploadReferences(databaseInspections, uploadPaths);
    const uploadBytes = fileRecords
      .filter(record => record.kind === 'upload')
      .reduce((total, record) => total + record.size, 0);
    const completedAt = now();
    const manifest = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      bundleId,
      createdAt: createdAt.toISOString(),
      completedAt: completedAt.toISOString(),
      capture: {
        sqlite: 'online-backup-api',
        walSidecarsRequired: false,
        uploads: 'stable-file-copy',
      },
      databases: databaseRecords,
      uploads: {
        fileCount: uploadPaths.size,
        totalBytes: uploadBytes,
        referencedFileCount: referencedUploadPaths.size,
        orphanFileCount: uploadPaths.size - referencedUploadPaths.size,
      },
      files: fileRecords,
    };
    const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestChecksum = createHash('sha256').update(manifestContents).digest('hex');
    await writeDurableFile(safeJoin(stagingPath, MANIFEST_PATH), manifestContents);
    await writeDurableFile(
      safeJoin(stagingPath, MANIFEST_CHECKSUM_PATH),
      `${manifestChecksum}  manifest.json\n`,
    );
    await verifyBackupBundle(stagingPath);
    await syncDirectoryTree(stagingPath);

    await rename(stagingPath, finalPath);
    finalized = true;
    await syncDirectory(resolvedBackupRoot);
    const removedBundles = await pruneBackupBundles(resolvedBackupRoot, retentionCount);
    return {
      bundlePath: finalPath,
      manifest,
      manifestSha256: manifestChecksum,
      removedBundles,
    };
  } finally {
    if (!finalized) await rm(stagingPath, { recursive: true, force: true });
    await releaseLock();
  }
}

function restoredDatabasePath(targetRoot, database) {
  if (database.role === 'legacy') return join(targetRoot, 'workshop.db');
  if (database.role === 'seed') return join(targetRoot, 'workshop-seed.db');
  if (database.role === 'user') {
    assertSafeRelativePath(database.sourceName);
    if (database.sourceName.includes('/')) {
      throw new Error(`invalid user database name: ${database.sourceName}`);
    }
    return join(targetRoot, 'users', database.sourceName);
  }
  throw new Error(`unsupported database role: ${database.role}`);
}

async function validateMaterializedRestore(targetRoot, verification) {
  const databaseByBundlePath = new Map(
    verification.manifest.databases.map(database => [database.path, database]),
  );
  const uploadPaths = new Set();
  const inspections = [];

  for (const record of verification.manifest.files) {
    let restoredPath;
    if (record.kind === 'upload') {
      restoredPath = safeJoin(targetRoot, record.path);
      uploadPaths.add(record.path);
    } else {
      const database = databaseByBundlePath.get(record.path);
      if (!database) throw new Error(`database mapping is missing for ${record.path}`);
      restoredPath = restoredDatabasePath(targetRoot, database);
      inspections.push({ ...inspectDatabase(restoredPath), path: record.path });
    }
    const restoredInfo = await assertRegularFile(restoredPath);
    if (restoredInfo.size !== record.size || await hashFile(restoredPath) !== record.sha256) {
      throw new Error(`restored checksum mismatch for ${record.path}`);
    }
  }
  validateUploadReferences(inspections, uploadPaths);
}

export async function materializeBackupBundle(
  bundlePath,
  targetRoot,
  { forbiddenRoots = [] } = {},
) {
  const verification = await verifyBackupBundle(bundlePath);
  const resolvedTargetRoot = resolve(targetRoot);
  assertDirectoriesDoNotOverlap(
    'restore target',
    resolvedTargetRoot,
    'backup bundle',
    verification.bundlePath,
  );
  for (const forbiddenRoot of forbiddenRoots) {
    if (
      isPathWithin(forbiddenRoot, resolvedTargetRoot)
      || isPathWithin(resolvedTargetRoot, forbiddenRoot)
    ) {
      throw new Error(`restore target must not overlap protected root: ${resolve(forbiddenRoot)}`);
    }
  }
  if (await optionalLstat(resolvedTargetRoot)) {
    throw new Error(`restore target already exists: ${resolvedTargetRoot}`);
  }

  const parentPath = dirname(resolvedTargetRoot);
  await mkdir(parentPath, { recursive: true });
  await assertDirectory(parentPath);
  const stagingPath = join(
    parentPath,
    `.${basename(resolvedTargetRoot)}.restore-tmp-${randomUUID()}`,
  );
  const databaseByBundlePath = new Map(
    verification.manifest.databases.map(database => [database.path, database]),
  );
  let finalized = false;

  try {
    await mkdir(stagingPath);
    const restoredDestinations = new Set();
    for (const record of verification.manifest.files) {
      let destinationPath;
      if (record.kind === 'upload') {
        destinationPath = safeJoin(stagingPath, record.path);
      } else {
        const database = databaseByBundlePath.get(record.path);
        if (!database) throw new Error(`database mapping is missing for ${record.path}`);
        destinationPath = restoredDatabasePath(stagingPath, database);
      }
      const resolvedDestination = resolve(destinationPath);
      if (restoredDestinations.has(resolvedDestination)) {
        throw new Error(`restore destination is duplicated: ${resolvedDestination}`);
      }
      restoredDestinations.add(resolvedDestination);
      await copyStableFile(safeJoin(verification.bundlePath, record.path), destinationPath);
    }

    await writeDurableFile(
      join(stagingPath, '.workshop-restore.json'),
      `${JSON.stringify({
        bundleId: verification.manifest.bundleId,
        manifestSha256: verification.manifestSha256,
        materializedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );
    await validateMaterializedRestore(stagingPath, verification);
    await syncDirectoryTree(stagingPath);
    await rename(stagingPath, resolvedTargetRoot);
    finalized = true;
    await syncDirectory(parentPath);
    return {
      targetRoot: resolvedTargetRoot,
      bundleId: verification.manifest.bundleId,
      databaseCount: verification.databaseCount,
      uploadCount: verification.uploadCount,
      manifestSha256: verification.manifestSha256,
    };
  } finally {
    if (!finalized) await rm(stagingPath, { recursive: true, force: true });
  }
}

export async function runRestoreDrill(bundlePath) {
  const drillParent = await mkdtemp(join(tmpdir(), 'workshop-restore-drill-'));
  const targetRoot = join(drillParent, 'data');
  try {
    const result = await materializeBackupBundle(bundlePath, targetRoot);
    return { ...result, drill: 'passed' };
  } finally {
    await rm(drillParent, { recursive: true, force: true });
  }
}
