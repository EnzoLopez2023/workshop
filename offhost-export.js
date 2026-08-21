import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lookup as nodeDnsLookup } from 'node:dns/promises';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const APP_SLUG = 'workshop';
const DENIED_CONTAINER_PROBE = 'cairn';
const CONTRACT = 'personal-apps.offhost-backup.v1';
const HEALTH_CONTRACT = 'personal-apps.offhost-health.v1';
const EXPORT_FORMAT = 'workshop-backup-v1';
const BUNDLE_FORMAT = 'workshop-recovery-bundle';
const BUNDLE_VERSION = 1;
const MANIFEST_PATH = 'manifest.json';
const MANIFEST_CHECKSUM_PATH = 'manifest.sha256';
const COMPLETE_PATH = '_COMPLETE.json';
const COMMITTED_PATH = '_COMMITTED.json';
const HEALTH_PATH = '_HEALTH.json';
const CHECKSUM_ALGORITHM = 'StorageCrc64';
const BUNDLE_NAME_RE = /^workshop-backup-\d{8}T\d{9}Z-[0-9a-f]{8}$/;
const ARTIFACT_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{16}$/;
const RANDOM_HEX_RE = /^[0-9a-f]{32}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const STORAGE_ACCOUNT_RE = /^[a-z0-9]{3,24}$/;
const CONTAINER_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const DAILY_COMMITTED_RE =
  /^v1\/daily\/(\d{4})\/(\d{2})\/(\d{2})\/_COMMITTED\.json$/;
const MONTHLY_COMMITTED_RE =
  /^v1\/monthly\/(\d{4})\/(\d{2})\/_COMMITTED\.json$/;
const MAX_JSON_BLOB_BYTES = 64 * 1024;
const MAX_UPLOAD_ATTEMPTS = 5;

const COMPLETE_KEYS = [
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
];
const COMMITTED_KEYS = [...COMPLETE_KEYS, 'attemptPrefix'];
const HEALTH_KEYS = [
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
];
const TAG_KEYS = [
  'app',
  'tier',
  'state',
  'backupDate',
  'format',
  'manifestSha',
  'artifactId',
];

function offhostError(code, message, options = {}) {
  const error = new Error(message, options);
  error.code = code;
  return error;
}

function errorCode(error) {
  if (typeof error?.code === 'string' && error.code) return error.code;
  if (Number.isInteger(error?.statusCode)) return `HTTP_${error.statusCode}`;
  return 'OFFHOST_EXPORT_FAILED';
}

function logEvent(logger, level, event, fields = {}) {
  const sink = typeof logger?.[level] === 'function' ? logger[level] : logger?.log;
  if (typeof sink !== 'function') return;
  sink.call(logger, JSON.stringify({
    component: 'offhost-backup',
    event,
    ...fields,
  }));
}

function parseBoolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw offhostError('OFFHOST_CONFIG_INVALID', `${name} must be exactly true or false`);
}

function parsePositiveNumber(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw offhostError('OFFHOST_CONFIG_INVALID', `${name} must be a number greater than zero`);
  }
  return value;
}

function requireSetting(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value) {
    throw offhostError('OFFHOST_CONFIG_MISSING', `${name} is required`);
  }
  return value;
}

export function resolveOffhostConfig(
  env = process.env,
  { backupRoot, manual = false } = {},
) {
  const enabled = parseBoolean(env, 'OFFHOST_BACKUP_ENABLED', false);
  const active = enabled || manual;
  const scanIntervalMinutes = parsePositiveNumber(
    env,
    'OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES',
    60,
  );
  const staleHours = parsePositiveNumber(env, 'OFFHOST_BACKUP_STALE_HOURS', 26);
  const healthLookbackHours = parsePositiveNumber(
    env,
    'OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS',
    2,
  );
  const dailyHealthMaxSourceAgeHours = parsePositiveNumber(
    env,
    'OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS',
    23,
  );
  const monthlyStaleDays = parsePositiveNumber(
    env,
    'OFFHOST_BACKUP_MONTHLY_STALE_DAYS',
    35,
  );
  const clockSkewMinutes = parsePositiveNumber(
    env,
    'OFFHOST_BACKUP_CLOCK_SKEW_MINUTES',
    5,
  );

  for (const [name, value, requiredValue] of [
    ['OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES', scanIntervalMinutes, 60],
    ['OFFHOST_BACKUP_STALE_HOURS', staleHours, 26],
    ['OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS', healthLookbackHours, 2],
    [
      'OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS',
      dailyHealthMaxSourceAgeHours,
      23,
    ],
    ['OFFHOST_BACKUP_MONTHLY_STALE_DAYS', monthlyStaleDays, 35],
    ['OFFHOST_BACKUP_CLOCK_SKEW_MINUTES', clockSkewMinutes, 5],
  ]) {
    if (value !== requiredValue) {
      throw offhostError(
        'OFFHOST_CONFIG_INVALID',
        `${name} must use the canonical value ${requiredValue}`,
      );
    }
  }

  let account = env.OFFHOST_BACKUP_ACCOUNT ?? '';
  let container = env.OFFHOST_BACKUP_CONTAINER ?? '';
  if (active) {
    if (env.NODE_ENV !== 'production') {
      throw offhostError(
        'OFFHOST_PRODUCTION_ONLY',
        'off-host export requires NODE_ENV=production',
      );
    }
    account = requireSetting(env, 'OFFHOST_BACKUP_ACCOUNT');
    container = requireSetting(env, 'OFFHOST_BACKUP_CONTAINER');
  }
  if (account && !STORAGE_ACCOUNT_RE.test(account)) {
    throw offhostError('OFFHOST_CONFIG_INVALID', 'OFFHOST_BACKUP_ACCOUNT is invalid');
  }
  if (container && !CONTAINER_RE.test(container)) {
    throw offhostError('OFFHOST_CONFIG_INVALID', 'OFFHOST_BACKUP_CONTAINER is invalid');
  }
  if (container && container !== APP_SLUG) {
    throw offhostError(
      'OFFHOST_CONTAINER_MISMATCH',
      `OFFHOST_BACKUP_CONTAINER must be ${APP_SLUG}`,
    );
  }
  if (active && (!backupRoot || typeof backupRoot !== 'string')) {
    throw offhostError('OFFHOST_CONFIG_MISSING', 'BACKUP_PATH is required');
  }

  return {
    enabled,
    active,
    account,
    container,
    endpoint: account ? `https://${account}.blob.core.windows.net` : '',
    hostname: account ? `${account}.blob.core.windows.net` : '',
    backupRoot: backupRoot ? resolve(backupRoot) : '',
    scanIntervalMinutes,
    staleHours,
    healthLookbackHours,
    dailyHealthMaxSourceAgeHours,
    monthlyStaleDays,
    clockSkewMinutes,
  };
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  return false;
}

export async function assertOffhostCapabilities({
  hostname,
  ownContainerClient,
  deniedContainerClient,
  dnsLookup = nodeDnsLookup,
}) {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  const addresses = Array.isArray(answers) ? answers : [answers];
  if (
    addresses.length === 0
    || addresses.some(answer => !isPrivateAddress(answer?.address ?? answer))
  ) {
    throw offhostError(
      'OFFHOST_PUBLIC_DNS',
      'the recovery Blob hostname did not resolve exclusively to private addresses',
    );
  }

  await ownContainerClient.getProperties();
  try {
    await deniedContainerClient.getProperties();
  } catch (error) {
    if (error?.statusCode === 403) {
      return { addresses: addresses.map(answer => answer?.address ?? answer) };
    }
    throw offhostError(
      'OFFHOST_CROSS_CONTAINER_PROBE_FAILED',
      'the cross-container access probe did not return the required denial',
      { cause: error },
    );
  }
  throw offhostError(
    'OFFHOST_CROSS_CONTAINER_ACCESSIBLE',
    'the managed identity can access another application container',
  );
}

function isPathWithin(parentPath, candidatePath) {
  const pathFromParent = relative(resolve(parentPath), resolve(candidatePath));
  return pathFromParent === ''
    || (
      !pathFromParent.startsWith(`..${sep}`)
      && pathFromParent !== '..'
      && !pathFromParent.startsWith(sep)
    );
}

function assertSafeRelativePath(filePath) {
  if (
    typeof filePath !== 'string'
    || !filePath
    || filePath.includes('\0')
    || filePath.includes('\\')
    || filePath.startsWith('/')
  ) {
    throw offhostError('OFFHOST_UNSAFE_PATH', 'the artifact contains an unsafe path');
  }
  const segments = filePath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw offhostError('OFFHOST_UNSAFE_PATH', 'the artifact contains an unsafe path');
  }
  return filePath;
}

function safeJoin(rootPath, relativePath) {
  const safePath = assertSafeRelativePath(relativePath);
  const joined = resolve(rootPath, ...safePath.split('/'));
  if (!isPathWithin(rootPath, joined) || joined === resolve(rootPath)) {
    throw offhostError('OFFHOST_UNSAFE_PATH', 'the artifact path escapes its root');
  }
  return joined;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw offhostError('OFFHOST_MARKER_INVALID', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw offhostError('OFFHOST_MARKER_INVALID', `${label} has unexpected fields`);
  }
}

function parseUtc(value, label) {
  if (typeof value !== 'string') {
    throw offhostError('OFFHOST_TIME_INVALID', `${label} must be an ISO-8601 string`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw offhostError('OFFHOST_TIME_INVALID', `${label} must be canonical UTC`);
  }
  return parsed;
}

function compactUtc(date) {
  return date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}

function dateParts(date) {
  const iso = date.toISOString();
  return {
    year: iso.slice(0, 4),
    month: iso.slice(5, 7),
    day: iso.slice(8, 10),
    hour: iso.slice(11, 13),
    date: iso.slice(0, 10),
  };
}

function dailySlotFromDate(date) {
  const { year, month, day } = dateParts(date);
  return `${year}/${month}/${day}`;
}

function monthlySlotFromDate(date) {
  const { year, month } = dateParts(date);
  return `${year}/${month}`;
}

function slotLabel(tier, slot) {
  return tier === 'daily'
    ? `daily:${slot.replaceAll('/', '-')}`
    : `monthly:${slot.replace('/', '-')}`;
}

function committedMarkerName(tier, slot) {
  return `v1/${tier}/${slot}/${COMMITTED_PATH}`;
}

function attemptPrefix(tier, slot, attemptId) {
  return `v1/${tier}/${slot}/${attemptId}`;
}

function artifactIdFor(sourceDate, manifestSha256) {
  return `${compactUtc(sourceDate)}-${manifestSha256.slice(0, 16)}`;
}

function expectedTags({ tier, state, backupDate, manifestSha256, artifactId }) {
  return {
    app: APP_SLUG,
    tier,
    state,
    backupDate,
    format: EXPORT_FORMAT,
    manifestSha: manifestSha256,
    artifactId,
  };
}

function assertTags(actualTags, expected, label) {
  assertExactKeys(actualTags, TAG_KEYS, `${label} tags`);
  for (const [key, value] of Object.entries(expected)) {
    if (actualTags[key] !== value) {
      throw offhostError('OFFHOST_TAGS_INVALID', `${label} tags do not match`);
    }
  }
}

function validateSourceClock(sourceDate, checkedAt, clockSkewMinutes) {
  if (sourceDate.valueOf() > checkedAt.valueOf() + clockSkewMinutes * 60_000) {
    throw offhostError(
      'OFFHOST_SOURCE_IN_FUTURE',
      'the source creation time exceeds the approved clock skew',
    );
  }
}

function validateSlotSource(tier, slot, sourceDate) {
  const expected = tier === 'daily'
    ? dailySlotFromDate(sourceDate)
    : monthlySlotFromDate(sourceDate);
  if (slot !== expected) {
    throw offhostError(
      'OFFHOST_SLOT_MISMATCH',
      'the source creation time does not match the recovery slot',
    );
  }
}

function validateBaseMarker(marker, tier, slot, checkedAt, clockSkewMinutes, complete) {
  assertExactKeys(marker, complete ? COMPLETE_KEYS : COMMITTED_KEYS, 'off-host marker');
  if (
    marker.contract !== CONTRACT
    || marker.app !== APP_SLUG
    || marker.tier !== tier
    || marker.format !== EXPORT_FORMAT
    || !ARTIFACT_ID_RE.test(marker.artifactId)
    || !SHA256_RE.test(marker.manifestSha256)
    || !Number.isInteger(marker.fileCount)
    || marker.fileCount < 2
    || !Number.isInteger(marker.totalBytes)
    || marker.totalBytes < 0
  ) {
    throw offhostError('OFFHOST_MARKER_INVALID', 'off-host marker fields are invalid');
  }
  const sourceDate = parseUtc(marker.sourceCreatedUtc, 'sourceCreatedUtc');
  parseUtc(marker.verifiedUtc, 'verifiedUtc');
  validateSourceClock(sourceDate, checkedAt, clockSkewMinutes);
  validateSlotSource(tier, slot, sourceDate);
  if (marker.artifactId !== artifactIdFor(sourceDate, marker.manifestSha256)) {
    throw offhostError('OFFHOST_MARKER_INVALID', 'artifactId is not deterministic');
  }
  if (
    typeof marker.attemptId !== 'string'
    || !marker.attemptId.startsWith(`${marker.artifactId}-`)
    || !RANDOM_HEX_RE.test(marker.attemptId.slice(marker.artifactId.length + 1))
  ) {
    throw offhostError('OFFHOST_MARKER_INVALID', 'attemptId is invalid');
  }
  const expectedPrefix = attemptPrefix(tier, slot, marker.attemptId);
  if (!complete && marker.attemptPrefix !== expectedPrefix) {
    throw offhostError('OFFHOST_MARKER_INVALID', 'attemptPrefix is invalid');
  }
  return { sourceDate, expectedPrefix };
}

function validateCompleteAgainstCommitted(complete, committed) {
  for (const key of COMPLETE_KEYS) {
    if (complete[key] !== committed[key]) {
      throw offhostError(
        'OFFHOST_COMPLETE_MISMATCH',
        'the attempt marker does not match the committed marker',
      );
    }
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function regularFileInfo(filePath) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw offhostError('OFFHOST_SOURCE_NOT_REGULAR', 'an artifact file is not a regular file');
  }
  return info;
}

async function fileDescriptor(bundlePath, relativePath, expected = {}) {
  const fullPath = safeJoin(bundlePath, relativePath);
  const info = await regularFileInfo(fullPath);
  const sha256 = await hashFile(fullPath);
  if (
    (expected.size !== undefined && info.size !== expected.size)
    || (expected.sha256 !== undefined && sha256 !== expected.sha256)
  ) {
    throw offhostError('OFFHOST_SOURCE_HASH_MISMATCH', 'an artifact file failed hashing');
  }
  return {
    relativePath,
    fullPath,
    size: info.size,
    sha256,
  };
}

function validateManifestForDiscovery(manifest) {
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.format !== BUNDLE_FORMAT
    || manifest.version !== BUNDLE_VERSION
    || !BUNDLE_NAME_RE.test(manifest.bundleId)
    || !Array.isArray(manifest.files)
  ) {
    throw offhostError('OFFHOST_MANIFEST_INVALID', 'the bundle manifest is invalid');
  }
  const seen = new Set();
  for (const record of manifest.files) {
    if (
      !record
      || typeof record !== 'object'
      || Array.isArray(record)
      || !['sqlite', 'upload'].includes(record.kind)
      || !Number.isInteger(record.size)
      || record.size < 0
      || !SHA256_RE.test(record.sha256)
    ) {
      throw offhostError('OFFHOST_MANIFEST_INVALID', 'the manifest has an invalid file');
    }
    const relativePath = assertSafeRelativePath(record.path);
    if (
      (record.kind === 'sqlite' && !relativePath.startsWith('databases/'))
      || (record.kind === 'upload' && !relativePath.startsWith('uploads/'))
      || seen.has(relativePath)
    ) {
      throw offhostError('OFFHOST_MANIFEST_INVALID', 'the manifest file set is invalid');
    }
    seen.add(relativePath);
  }
  return manifest;
}

async function describeLocalBundle(bundlePath, localVerifier, appDir) {
  const bundleInfo = await lstat(bundlePath);
  if (bundleInfo.isSymbolicLink() || !bundleInfo.isDirectory()) {
    throw offhostError(
      'OFFHOST_BUNDLE_NOT_DIRECTORY',
      'the retained bundle is not a regular directory',
    );
  }
  await localVerifier(bundlePath, { appDir });
  const manifestContents = await readFile(safeJoin(bundlePath, MANIFEST_PATH));
  const manifestSha256 = createHash('sha256').update(manifestContents).digest('hex');
  const checksumContents = await readFile(
    safeJoin(bundlePath, MANIFEST_CHECKSUM_PATH),
    'utf8',
  );
  if (checksumContents !== `${manifestSha256}  manifest.json\n`) {
    throw offhostError('OFFHOST_MANIFEST_INVALID', 'the manifest sidecar is invalid');
  }
  let manifest;
  try {
    manifest = validateManifestForDiscovery(JSON.parse(manifestContents.toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw offhostError('OFFHOST_MANIFEST_INVALID', 'the bundle manifest is not JSON');
    }
    throw error;
  }
  if (manifest.bundleId !== basename(resolve(bundlePath))) {
    throw offhostError('OFFHOST_BUNDLE_ID_MISMATCH', 'the bundle directory and manifest differ');
  }
  const sourceDate = parseUtc(manifest.createdAt, 'manifest.createdAt');

  const files = [
    await fileDescriptor(bundlePath, MANIFEST_PATH, {
      sha256: manifestSha256,
    }),
    await fileDescriptor(bundlePath, MANIFEST_CHECKSUM_PATH),
  ];
  for (const record of manifest.files) {
    files.push(await fileDescriptor(bundlePath, record.path, record));
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    bundlePath: resolve(bundlePath),
    bundleId: manifest.bundleId,
    sourceDate,
    sourceCreatedUtc: sourceDate.toISOString(),
    backupDate: dateParts(sourceDate).date,
    manifestSha256,
    artifactId: artifactIdFor(sourceDate, manifestSha256),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    files,
  };
}

async function discoverLocalArtifacts({
  backupRoot,
  localVerifier,
  checkedAt,
  clockSkewMinutes,
  logger,
  appDir,
}) {
  let entries;
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const artifacts = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!BUNDLE_NAME_RE.test(entry.name)) continue;
    const bundlePath = join(backupRoot, entry.name);
    try {
      const info = await lstat(bundlePath);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw offhostError(
          'OFFHOST_BUNDLE_NOT_DIRECTORY',
          'the retained bundle is not a regular directory',
        );
      }
      const artifact = await describeLocalBundle(bundlePath, localVerifier, appDir);
      validateSourceClock(artifact.sourceDate, checkedAt, clockSkewMinutes);
      artifacts.push(artifact);
    } catch (error) {
      logEvent(logger, 'warn', 'local_bundle_rejected', {
        bundleId: entry.name,
        code: errorCode(error),
      });
    }
  }

  return artifacts.sort((a, b) => {
    const timeOrder = a.sourceDate.valueOf() - b.sourceDate.valueOf();
    return timeOrder || a.artifactId.localeCompare(b.artifactId);
  });
}

function newestArtifactByDate(artifacts) {
  const selected = new Map();
  for (const artifact of artifacts) selected.set(artifact.backupDate, artifact);
  return [...selected.values()];
}

function isBlobMissing(error) {
  return error?.statusCode === 404;
}

function isBlobCollision(error) {
  return error?.statusCode === 409 || error?.statusCode === 412;
}

async function readBlobJson(containerClient, blobName, { optional = false } = {}) {
  const client = containerClient.getBlockBlobClient(blobName);
  try {
    const properties = await client.getProperties();
    if (
      !Number.isInteger(properties.contentLength)
      || properties.contentLength < 2
      || properties.contentLength > MAX_JSON_BLOB_BYTES
    ) {
      throw offhostError('OFFHOST_JSON_INVALID', 'the marker blob size is invalid');
    }
    const contents = await client.downloadToBuffer(
      0,
      undefined,
      { contentChecksumAlgorithm: CHECKSUM_ALGORITHM },
    );
    if (contents.length !== properties.contentLength) {
      throw offhostError('OFFHOST_JSON_INVALID', 'the marker blob length changed');
    }
    let value;
    try {
      value = JSON.parse(contents.toString('utf8'));
    } catch (error) {
      throw offhostError('OFFHOST_JSON_INVALID', 'the marker is not valid JSON', {
        cause: error,
      });
    }
    const tagsResponse = await client.getTags();
    return { value, tags: tagsResponse.tags ?? {}, client };
  } catch (error) {
    if (optional && isBlobMissing(error)) return null;
    throw error;
  }
}

async function uploadJsonIfAbsent(containerClient, blobName, value, tags) {
  const contents = Buffer.from(`${JSON.stringify(value)}\n`);
  const client = containerClient.getBlockBlobClient(blobName);
  await client.upload(contents, contents.length, {
    conditions: { ifNoneMatch: '*' },
    tags,
    blobHTTPHeaders: { blobContentType: 'application/json' },
    contentChecksumAlgorithm: CHECKSUM_ALGORITHM,
  });
}

async function assertStableUploadSource(file, upload) {
  const before = await lstat(file.fullPath, { bigint: true });
  const beforeHash = await hashFile(file.fullPath);
  if (
    !before.isFile()
    || before.size !== BigInt(file.size)
    || beforeHash !== file.sha256
  ) {
    throw offhostError('OFFHOST_SOURCE_MUTATED', 'an artifact changed before upload');
  }

  await upload();

  const after = await lstat(file.fullPath, { bigint: true });
  const afterHash = await hashFile(file.fullPath);
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || after.size !== BigInt(file.size)
    || afterHash !== file.sha256
  ) {
    throw offhostError('OFFHOST_SOURCE_MUTATED', 'an artifact changed during upload');
  }
}

async function uploadArtifactFiles(containerClient, prefix, artifact, tags) {
  for (const file of artifact.files) {
    const blobName = `${prefix}/${file.relativePath}`;
    const client = containerClient.getBlockBlobClient(blobName);
    await assertStableUploadSource(file, () => client.uploadFile(file.fullPath, {
      conditions: { ifNoneMatch: '*' },
      tags,
      contentChecksumAlgorithm: CHECKSUM_ALGORITHM,
    }));
  }
}

async function downloadBlobToFile(containerClient, blobName, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  const client = containerClient.getBlockBlobClient(blobName);
  await client.downloadToFile(
    destinationPath,
    0,
    undefined,
    { contentChecksumAlgorithm: CHECKSUM_ALGORITHM },
  );
  await chmod(destinationPath, 0o600);
  await regularFileInfo(destinationPath);
  return client;
}

async function listBlobNames(containerClient, prefix) {
  const names = [];
  for await (const item of containerClient.listBlobsFlat({ prefix })) {
    names.push(item.name);
  }
  return names.sort();
}

async function invokeRecoveryVerifier(bundlePath, { appDir }) {
  await execFileAsync(
    process.execPath,
    [join(appDir, 'scripts', 'recovery.mjs'), 'verify', bundlePath],
    {
      cwd: appDir,
      env: {
        NODE_ENV: 'production',
        PATH: process.env.PATH ?? '',
      },
      timeout: 10 * 60 * 1_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function assertSameArtifact(before, after) {
  if (
    before.artifactId !== after.artifactId
    || before.sourceCreatedUtc !== after.sourceCreatedUtc
    || before.manifestSha256 !== after.manifestSha256
    || before.fileCount !== after.fileCount
    || before.totalBytes !== after.totalBytes
    || before.files.length !== after.files.length
  ) {
    throw offhostError('OFFHOST_SOURCE_MUTATED', 'the source artifact changed during export');
  }
  for (let index = 0; index < before.files.length; index += 1) {
    const original = before.files[index];
    const current = after.files[index];
    if (
      original.relativePath !== current.relativePath
      || original.size !== current.size
      || original.sha256 !== current.sha256
    ) {
      throw offhostError('OFFHOST_SOURCE_MUTATED', 'the source artifact changed during export');
    }
  }
}

async function downloadAndVerifyAttempt({
  containerClient,
  prefix,
  tier,
  marker,
  expectComplete,
  downloadedVerifier,
  appDir,
}) {
  const tempParent = await mkdtemp(join(tmpdir(), 'workshop-offhost-readback-'));
  await chmod(tempParent, 0o700);
  const expectedContentTags = expectedTags({
    tier,
    state: 'content',
    backupDate: marker.sourceCreatedUtc.slice(0, 10),
    manifestSha256: marker.manifestSha256,
    artifactId: marker.artifactId,
  });

  try {
    let manifestDestination = safeJoin(tempParent, MANIFEST_PATH);
    const manifestClient = await downloadBlobToFile(
      containerClient,
      `${prefix}/${MANIFEST_PATH}`,
      manifestDestination,
    );
    const manifestContents = await readFile(manifestDestination);
    if (
      createHash('sha256').update(manifestContents).digest('hex')
      !== marker.manifestSha256
    ) {
      throw offhostError('OFFHOST_READBACK_HASH_MISMATCH', 'manifest read-back failed');
    }
    assertTags((await manifestClient.getTags()).tags ?? {}, expectedContentTags, 'content');

    let manifest;
    try {
      manifest = validateManifestForDiscovery(JSON.parse(manifestContents.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw offhostError('OFFHOST_MANIFEST_INVALID', 'downloaded manifest is not JSON');
      }
      throw error;
    }
    if (
      parseUtc(manifest.createdAt, 'manifest.createdAt').toISOString()
      !== marker.sourceCreatedUtc
    ) {
      throw offhostError('OFFHOST_MARKER_MISMATCH', 'manifest creation time differs');
    }

    const bundlePath = join(tempParent, manifest.bundleId);
    await mkdir(bundlePath, { mode: 0o700 });
    const finalManifestDestination = safeJoin(bundlePath, MANIFEST_PATH);
    await rename(manifestDestination, finalManifestDestination);
    manifestDestination = finalManifestDestination;

    const checksumDestination = safeJoin(bundlePath, MANIFEST_CHECKSUM_PATH);
    const checksumClient = await downloadBlobToFile(
      containerClient,
      `${prefix}/${MANIFEST_CHECKSUM_PATH}`,
      checksumDestination,
    );
    const checksumContents = await readFile(checksumDestination, 'utf8');
    if (checksumContents !== `${marker.manifestSha256}  manifest.json\n`) {
      throw offhostError('OFFHOST_READBACK_HASH_MISMATCH', 'manifest sidecar differs');
    }
    assertTags((await checksumClient.getTags()).tags ?? {}, expectedContentTags, 'content');

    const files = [
      {
        relativePath: MANIFEST_PATH,
        fullPath: manifestDestination,
        size: manifestContents.length,
        sha256: marker.manifestSha256,
      },
      await fileDescriptor(bundlePath, MANIFEST_CHECKSUM_PATH),
    ];
    for (const record of manifest.files) {
      const destination = safeJoin(bundlePath, record.path);
      const client = await downloadBlobToFile(
        containerClient,
        `${prefix}/${record.path}`,
        destination,
      );
      files.push(await fileDescriptor(bundlePath, record.path, record));
      assertTags((await client.getTags()).tags ?? {}, expectedContentTags, 'content');
    }
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const expectedNames = files.map(file => `${prefix}/${file.relativePath}`);
    if (expectComplete) expectedNames.push(`${prefix}/${COMPLETE_PATH}`);
    expectedNames.sort();
    const actualNames = await listBlobNames(containerClient, `${prefix}/`);
    if (
      actualNames.length !== expectedNames.length
      || actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw offhostError('OFFHOST_ATTEMPT_CONTENTS_INVALID', 'attempt blobs are not exact');
    }

    const artifact = {
      bundlePath,
      bundleId: manifest.bundleId,
      sourceDate: parseUtc(manifest.createdAt, 'manifest.createdAt'),
      sourceCreatedUtc: marker.sourceCreatedUtc,
      backupDate: marker.sourceCreatedUtc.slice(0, 10),
      manifestSha256: marker.manifestSha256,
      artifactId: marker.artifactId,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      files,
    };
    if (
      artifact.fileCount !== marker.fileCount
      || artifact.totalBytes !== marker.totalBytes
    ) {
      throw offhostError('OFFHOST_MARKER_MISMATCH', 'marker totals differ from the artifact');
    }
    await downloadedVerifier(bundlePath, { appDir });
    return {
      artifact,
      cleanup: () => rm(tempParent, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempParent, { recursive: true, force: true });
    throw error;
  }
}

function markerBase({ tier, artifact, attemptId, verifiedUtc }) {
  return {
    contract: CONTRACT,
    app: APP_SLUG,
    tier,
    artifactId: artifact.artifactId,
    attemptId,
    sourceCreatedUtc: artifact.sourceCreatedUtc,
    verifiedUtc,
    format: EXPORT_FORMAT,
    manifestSha256: artifact.manifestSha256,
    fileCount: artifact.fileCount,
    totalBytes: artifact.totalBytes,
  };
}

async function readAndValidateCommitted({
  containerClient,
  tier,
  slot,
  checkedAt,
  config,
  downloadedVerifier,
  appDir,
}) {
  const markerName = committedMarkerName(tier, slot);
  const response = await readBlobJson(containerClient, markerName, { optional: true });
  if (!response) return null;

  const marker = response.value;
  const { expectedPrefix } = validateBaseMarker(
    marker,
    tier,
    slot,
    checkedAt,
    config.clockSkewMinutes,
    false,
  );
  assertTags(response.tags, expectedTags({
    tier,
    state: 'committed',
    backupDate: marker.sourceCreatedUtc.slice(0, 10),
    manifestSha256: marker.manifestSha256,
    artifactId: marker.artifactId,
  }), 'committed');

  const completeName = `${expectedPrefix}/${COMPLETE_PATH}`;
  const completeResponse = await readBlobJson(containerClient, completeName);
  validateBaseMarker(
    completeResponse.value,
    tier,
    slot,
    checkedAt,
    config.clockSkewMinutes,
    true,
  );
  validateCompleteAgainstCommitted(completeResponse.value, marker);
  assertTags(completeResponse.tags, expectedTags({
    tier,
    state: 'verified',
    backupDate: marker.sourceCreatedUtc.slice(0, 10),
    manifestSha256: marker.manifestSha256,
    artifactId: marker.artifactId,
  }), 'complete');

  const downloaded = await downloadAndVerifyAttempt({
    containerClient,
    prefix: expectedPrefix,
    tier,
    marker,
    expectComplete: true,
    downloadedVerifier,
    appDir,
  });
  await downloaded.cleanup();
  return { marker, markerName, slot, tier };
}

async function materializeCommittedArtifact({
  containerClient,
  committed,
  downloadedVerifier,
  appDir,
}) {
  return downloadAndVerifyAttempt({
    containerClient,
    prefix: committed.marker.attemptPrefix,
    tier: committed.tier,
    marker: committed.marker,
    expectComplete: true,
    downloadedVerifier,
    appDir,
  });
}

async function uploadAttempt({
  containerClient,
  tier,
  slot,
  artifact,
  checkedAt,
  config,
  downloadedVerifier,
  localVerifier,
  appDir,
  randomHex,
  now,
  logger,
}) {
  validateSourceClock(artifact.sourceDate, checkedAt, config.clockSkewMinutes);
  validateSlotSource(tier, slot, artifact.sourceDate);
  const contentTags = expectedTags({
    tier,
    state: 'content',
    backupDate: artifact.backupDate,
    manifestSha256: artifact.manifestSha256,
    artifactId: artifact.artifactId,
  });

  for (let retry = 0; retry < MAX_UPLOAD_ATTEMPTS; retry += 1) {
    const randomSuffix = randomHex();
    if (!RANDOM_HEX_RE.test(randomSuffix)) {
      throw offhostError('OFFHOST_RANDOM_INVALID', 'the attempt random source is invalid');
    }
    const attemptId = `${artifact.artifactId}-${randomSuffix}`;
    const prefix = attemptPrefix(tier, slot, attemptId);
    try {
      await uploadArtifactFiles(containerClient, prefix, artifact, contentTags);
      const provisionalMarker = markerBase({
        tier,
        artifact,
        attemptId,
        verifiedUtc: checkedAt.toISOString(),
      });
      const downloaded = await downloadAndVerifyAttempt({
        containerClient,
        prefix,
        tier,
        marker: provisionalMarker,
        expectComplete: false,
        downloadedVerifier,
        appDir,
      });
      await downloaded.cleanup();
      let finalArtifact;
      try {
        finalArtifact = await describeLocalBundle(
          artifact.bundlePath,
          localVerifier,
          appDir,
        );
      } catch (error) {
        throw offhostError(
          'OFFHOST_SOURCE_MUTATED',
          'the source artifact failed final verification',
          { cause: error },
        );
      }
      assertSameArtifact(artifact, finalArtifact);

      const verifiedAt = now();
      validateSourceClock(artifact.sourceDate, verifiedAt, config.clockSkewMinutes);
      const complete = markerBase({
        tier,
        artifact,
        attemptId,
        verifiedUtc: verifiedAt.toISOString(),
      });
      await uploadJsonIfAbsent(
        containerClient,
        `${prefix}/${COMPLETE_PATH}`,
        complete,
        expectedTags({
          tier,
          state: 'verified',
          backupDate: artifact.backupDate,
          manifestSha256: artifact.manifestSha256,
          artifactId: artifact.artifactId,
        }),
      );
      return {
        marker: { ...complete, attemptPrefix: prefix },
        markerName: committedMarkerName(tier, slot),
        slot,
        tier,
      };
    } catch (error) {
      if (!isBlobCollision(error)) throw error;
      logEvent(logger, 'warn', 'attempt_collision', {
        tier,
        slot: slotLabel(tier, slot),
        retry: retry + 1,
      });
    }
  }
  throw offhostError('OFFHOST_ATTEMPTS_EXHAUSTED', 'immutable upload retries were exhausted');
}

async function commitAttempt({
  containerClient,
  uploaded,
  checkedAt,
  config,
  downloadedVerifier,
  appDir,
}) {
  try {
    await uploadJsonIfAbsent(
      containerClient,
      uploaded.markerName,
      uploaded.marker,
      expectedTags({
        tier: uploaded.tier,
        state: 'committed',
        backupDate: uploaded.marker.sourceCreatedUtc.slice(0, 10),
        manifestSha256: uploaded.marker.manifestSha256,
        artifactId: uploaded.marker.artifactId,
      }),
    );
    return uploaded;
  } catch (error) {
    const existing = await readAndValidateCommitted({
      containerClient,
      tier: uploaded.tier,
      slot: uploaded.slot,
      checkedAt,
      config,
      downloadedVerifier,
      appDir,
    }).catch((readError) => {
      if (isBlobMissing(readError)) return null;
      throw readError;
    });
    if (existing) return existing;
    throw error;
  }
}

async function ensureCommittedSlot({
  containerClient,
  tier,
  slot,
  artifact,
  checkedAt,
  config,
  downloadedVerifier,
  localVerifier,
  appDir,
  randomHex,
  now,
  logger,
}) {
  const existing = await readAndValidateCommitted({
    containerClient,
    tier,
    slot,
    checkedAt,
    config,
    downloadedVerifier,
    appDir,
  });
  if (existing) return { ...existing, created: false };

  const uploaded = await uploadAttempt({
    containerClient,
    tier,
    slot,
    artifact,
    checkedAt,
    config,
    downloadedVerifier,
    localVerifier,
    appDir,
    randomHex,
    now,
    logger,
  });
  const committed = await commitAttempt({
    containerClient,
    uploaded,
    checkedAt,
    config,
    downloadedVerifier,
    appDir,
  });
  return { ...committed, created: committed.marker.attemptId === uploaded.marker.attemptId };
}

async function listCommittedSlots(containerClient, tier) {
  const matcher = tier === 'daily' ? DAILY_COMMITTED_RE : MONTHLY_COMMITTED_RE;
  const slots = [];
  for await (const item of containerClient.listBlobsFlat({ prefix: `v1/${tier}/` })) {
    const match = matcher.exec(item.name);
    if (!match) continue;
    const slot = tier === 'daily'
      ? `${match[1]}/${match[2]}/${match[3]}`
      : `${match[1]}/${match[2]}`;
    slots.push({ markerName: item.name, slot });
  }
  return slots.sort((a, b) => a.slot.localeCompare(b.slot));
}

async function emitHealth({
  containerClient,
  tier,
  committed,
  checkedAt,
  randomHex,
}) {
  const sourceDate = parseUtc(committed.marker.sourceCreatedUtc, 'sourceCreatedUtc');
  const ageHours = Number(
    ((checkedAt.valueOf() - sourceDate.valueOf()) / (60 * 60 * 1_000)).toFixed(6),
  );
  const { year, month, day, hour } = dateParts(checkedAt);
  const health = {
    contract: HEALTH_CONTRACT,
    app: APP_SLUG,
    tier,
    checkedUtc: checkedAt.toISOString(),
    sourceCreatedUtc: committed.marker.sourceCreatedUtc,
    sourceAgeHours: ageHours,
    slot: slotLabel(tier, committed.slot),
    artifactId: committed.marker.artifactId,
    manifestSha256: committed.marker.manifestSha256,
    committedMarker: committed.markerName,
  };
  assertExactKeys(health, HEALTH_KEYS, 'health marker');

  for (let retry = 0; retry < MAX_UPLOAD_ATTEMPTS; retry += 1) {
    const healthAttemptId = randomHex();
    if (!RANDOM_HEX_RE.test(healthAttemptId)) {
      throw offhostError('OFFHOST_RANDOM_INVALID', 'the health random source is invalid');
    }
    const blobName =
      `v1/monitoring/${tier}/${year}/${month}/${day}/${hour}/${healthAttemptId}/${HEALTH_PATH}`;
    try {
      await uploadJsonIfAbsent(
        containerClient,
        blobName,
        health,
        expectedTags({
          tier: 'monitoring',
          state: 'healthy',
          backupDate: committed.marker.sourceCreatedUtc.slice(0, 10),
          manifestSha256: committed.marker.manifestSha256,
          artifactId: committed.marker.artifactId,
        }),
      );
      return blobName;
    } catch (error) {
      if (!isBlobCollision(error)) throw error;
    }
  }
  throw offhostError('OFFHOST_HEALTH_ATTEMPTS_EXHAUSTED', 'health retries were exhausted');
}

function randomHex128() {
  return randomBytes(16).toString('hex');
}

export function createOffhostExporter({
  config,
  containerClient,
  appDir = process.cwd(),
  localVerifier = invokeRecoveryVerifier,
  downloadedVerifier = invokeRecoveryVerifier,
  now = () => new Date(),
  randomHex = randomHex128,
  logger = console,
}) {
  if (!config?.active) {
    throw offhostError('OFFHOST_NOT_ACTIVE', 'the exporter requires active configuration');
  }
  let scanPromise = null;

  async function validateCachedOrRead(cache, tier, slot, checkedAt) {
    const markerName = committedMarkerName(tier, slot);
    if (cache.has(markerName)) return cache.get(markerName);
    const committed = await readAndValidateCommitted({
      containerClient,
      tier,
      slot,
      checkedAt,
      config,
      downloadedVerifier,
      appDir,
    });
    if (committed) cache.set(markerName, committed);
    return committed;
  }

  async function performScan() {
    const checkedAt = now();
    if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.valueOf())) {
      throw offhostError('OFFHOST_TIME_INVALID', 'the scan clock returned an invalid date');
    }
    const cache = new Map();
    const localArtifacts = await discoverLocalArtifacts({
      backupRoot: config.backupRoot,
      localVerifier,
      checkedAt,
      clockSkewMinutes: config.clockSkewMinutes,
      logger,
      appDir,
    });
    const dailyArtifacts = newestArtifactByDate(localArtifacts);
    let dailyCreated = 0;
    let monthlyCreated = 0;

    for (const artifact of dailyArtifacts) {
      const slot = dailySlotFromDate(artifact.sourceDate);
      const committed = await ensureCommittedSlot({
        containerClient,
        tier: 'daily',
        slot,
        artifact,
        checkedAt,
        config,
        downloadedVerifier,
        localVerifier,
        appDir,
        randomHex,
        now,
        logger,
      });
      cache.set(committed.markerName, committed);
      if (committed.created) dailyCreated += 1;
    }

    let dailySlots = await listCommittedSlots(containerClient, 'daily');
    const observedAt = now();
    const monthlyTargets = new Map([
      [monthlySlotFromDate(checkedAt), checkedAt],
      [monthlySlotFromDate(observedAt), observedAt],
    ]);
    for (const [targetMonth, monthlyCheckedAt] of monthlyTargets) {
      let monthly = await validateCachedOrRead(
        cache,
        'monthly',
        targetMonth,
        monthlyCheckedAt,
      );
      if (monthly) continue;

      const currentMonthDaily = dailySlots
        .filter(entry => entry.slot.startsWith(`${targetMonth}/`))
        .at(-1);
      if (!currentMonthDaily) continue;

      const daily = await validateCachedOrRead(
        cache,
        'daily',
        currentMonthDaily.slot,
        monthlyCheckedAt,
      );
      if (!daily) continue;

      let artifact = localArtifacts.find(
        candidate => candidate.artifactId === daily.marker.artifactId,
      );
      let downloaded = null;
      if (!artifact) {
        downloaded = await materializeCommittedArtifact({
          containerClient,
          committed: daily,
          downloadedVerifier,
          appDir,
        });
        artifact = downloaded.artifact;
      }
      try {
        monthly = await ensureCommittedSlot({
          containerClient,
          tier: 'monthly',
          slot: targetMonth,
          artifact,
          checkedAt: monthlyCheckedAt,
          config,
          downloadedVerifier,
          localVerifier,
          appDir,
          randomHex,
          now,
          logger,
        });
        cache.set(monthly.markerName, monthly);
        if (monthly.created) monthlyCreated += 1;
      } finally {
        if (downloaded) await downloaded.cleanup();
      }
    }

    dailySlots = await listCommittedSlots(containerClient, 'daily');
    const latestDailySlot = dailySlots.at(-1);
    let dailyHealth = null;
    if (latestDailySlot) {
      const dailyCheckedAt = now();
      const daily = await validateCachedOrRead(
        cache,
        'daily',
        latestDailySlot.slot,
        dailyCheckedAt,
      );
      const dailyHealthCheckedAt = now();
      const sourceDate = parseUtc(daily.marker.sourceCreatedUtc, 'sourceCreatedUtc');
      const sourceAgeMs = dailyHealthCheckedAt.valueOf() - sourceDate.valueOf();
      if (
        sourceAgeMs >= -config.clockSkewMinutes * 60_000
        && sourceAgeMs <= config.dailyHealthMaxSourceAgeHours * 60 * 60 * 1_000
      ) {
        dailyHealth = await emitHealth({
          containerClient,
          tier: 'daily',
          committed: daily,
          checkedAt: dailyHealthCheckedAt,
          randomHex,
        });
      } else {
        logEvent(logger, 'warn', 'daily_health_suppressed', {
          code: 'OFFHOST_DAILY_SOURCE_STALE',
        });
      }
    }

    const monthlySlots = await listCommittedSlots(containerClient, 'monthly');
    const latestMonthlySlot = monthlySlots.at(-1);
    let monthlyHealth = null;
    if (latestMonthlySlot) {
      const monthlyHealthCheckedAt = now();
      const latestMonthly = await validateCachedOrRead(
        cache,
        'monthly',
        latestMonthlySlot.slot,
        monthlyHealthCheckedAt,
      );
      const monthlyHeartbeatAt = now();
      const sourceDate = parseUtc(
        latestMonthly.marker.sourceCreatedUtc,
        'sourceCreatedUtc',
      );
      const sourceAgeMs = monthlyHeartbeatAt.valueOf() - sourceDate.valueOf();
      if (
        sourceAgeMs >= -config.clockSkewMinutes * 60_000
        && sourceAgeMs <= config.monthlyStaleDays * 24 * 60 * 60 * 1_000
      ) {
        monthlyHealth = await emitHealth({
          containerClient,
          tier: 'monthly',
          committed: latestMonthly,
          checkedAt: monthlyHeartbeatAt,
          randomHex,
        });
      } else {
        logEvent(logger, 'warn', 'monthly_health_suppressed', {
          code: 'OFFHOST_MONTHLY_SOURCE_STALE',
        });
      }
    }

    const result = {
      status: 'completed',
      checkedUtc: checkedAt.toISOString(),
      localBundleCount: localArtifacts.length,
      dailyCreated,
      monthlyCreated,
      dailyHealth: Boolean(dailyHealth),
      monthlyHealth: Boolean(monthlyHealth),
    };
    logEvent(logger, 'info', 'scan_completed', result);
    return result;
  }

  function scan() {
    if (scanPromise) {
      logEvent(logger, 'info', 'scan_joined', { code: 'OFFHOST_SCAN_RUNNING' });
      return scanPromise;
    }
    const run = performScan();
    scanPromise = run;
    void run.finally(() => {
      if (scanPromise === run) scanPromise = null;
    }).catch(() => {});
    return run;
  }

  return { scan };
}

function createAzureClients(config) {
  const credential = new ManagedIdentityCredential();
  const serviceClient = new BlobServiceClient(config.endpoint, credential, {
    retryOptions: {
      maxTries: 5,
      retryDelayInMs: 1_000,
      maxRetryDelayInMs: 15_000,
    },
  });
  return {
    ownContainerClient: serviceClient.getContainerClient(config.container),
    deniedContainerClient: serviceClient.getContainerClient(DENIED_CONTAINER_PROBE),
  };
}

async function createProductionExporter({
  env,
  backupRoot,
  appDir,
  manual,
  logger,
  dnsLookup,
}) {
  const config = resolveOffhostConfig(env, { backupRoot, manual });
  if (!config.active) return null;
  const { ownContainerClient, deniedContainerClient } = createAzureClients(config);
  await assertOffhostCapabilities({
    hostname: config.hostname,
    ownContainerClient,
    deniedContainerClient,
    dnsLookup,
  });
  logEvent(logger, 'info', 'capability_check_passed', {
    app: APP_SLUG,
    container: config.container,
  });
  return {
    config,
    exporter: createOffhostExporter({
      config,
      containerClient: ownContainerClient,
      appDir,
      logger,
    }),
  };
}

export async function runManualOffhostExport({
  env = process.env,
  backupRoot,
  appDir = process.cwd(),
  logger = console,
  dnsLookup = nodeDnsLookup,
} = {}) {
  const production = await createProductionExporter({
    env,
    backupRoot,
    appDir,
    manual: true,
    logger,
    dnsLookup,
  });
  return production.exporter.scan();
}

export function startOffhostExportSchedule({
  env = process.env,
  backupRoot,
  appDir = process.cwd(),
  logger = console,
  dnsLookup = nodeDnsLookup,
  productionFactory = createProductionExporter,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const config = resolveOffhostConfig(env, { backupRoot });
  if (!config.enabled) {
    logEvent(logger, 'info', 'schedule_disabled', { app: APP_SLUG });
    const startup = Promise.resolve({ status: 'disabled', trigger: 'startup' });
    return {
      startup,
      stop() {},
      runNow: async () => ({ status: 'disabled', trigger: 'manual' }),
      runAfterBackup: async () => ({ status: 'disabled', trigger: 'backup' }),
    };
  }

  let stopped = false;
  let productionPromise = null;
  let activeRun = null;
  let activeTrigger = null;
  let pendingBackupRun = null;
  let interval = null;

  const getProduction = async () => {
    if (!productionPromise) {
      productionPromise = productionFactory({
        env,
        backupRoot,
        appDir,
        manual: false,
        logger,
        dnsLookup,
      }).catch((error) => {
        productionPromise = null;
        throw error;
      });
    }
    return productionPromise;
  };

  const runForTrigger = (trigger) => {
    if (stopped) return Promise.resolve({ status: 'stopped', trigger });
    if (activeRun) {
      logEvent(logger, 'info', 'schedule_scan_joined', {
        code: 'OFFHOST_SCAN_RUNNING',
        activeTrigger,
        requestedTrigger: trigger,
      });
      return activeRun;
    }
    const run = getProduction()
      .then(production => production.exporter.scan())
      .then(scanResult => {
        const result = { ...scanResult, trigger };
        logEvent(logger, 'info', 'schedule_scan_completed', result);
        return result;
      })
      .catch((error) => {
        logEvent(logger, 'error', 'scan_failed', {
          code: errorCode(error),
          statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
          trigger,
        });
        throw error;
      });
    activeRun = run;
    activeTrigger = trigger;
    void run.finally(() => {
      if (activeRun === run) {
        activeRun = null;
        activeTrigger = null;
      }
    }).catch(() => {});
    return run;
  };

  const runAfterBackup = () => {
    if (stopped) return Promise.resolve({ status: 'stopped', trigger: 'backup' });
    if (!activeRun) return runForTrigger('backup');
    if (pendingBackupRun) {
      logEvent(logger, 'info', 'backup_scan_joined', {
        code: 'OFFHOST_BACKUP_SCAN_PENDING',
      });
      return pendingBackupRun;
    }

    logEvent(logger, 'info', 'backup_scan_queued', {
      code: 'OFFHOST_SCAN_RUNNING',
      activeTrigger,
    });
    const activeAtRequest = activeRun;
    const pending = activeAtRequest
      .catch(() => null)
      .then(() => {
        if (pendingBackupRun === pending) pendingBackupRun = null;
        return runForTrigger('backup');
      });
    pendingBackupRun = pending;
    void pending.finally(() => {
      if (pendingBackupRun === pending) pendingBackupRun = null;
    }).catch(() => {});
    return pending;
  };

  const startup = runForTrigger('startup');
  void startup.catch(() => {});
  interval = setIntervalFn(
    () => void runForTrigger('interval').catch(() => {}),
    config.scanIntervalMinutes * 60 * 1_000,
  );
  interval?.unref?.();

  return {
    startup,
    runNow: () => runForTrigger('manual'),
    runAfterBackup,
    stop() {
      stopped = true;
      if (interval) clearIntervalFn(interval);
      interval = null;
    },
  };
}
