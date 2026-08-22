import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_SHA_RE = /^[0-9a-f]{40}$/;
const APP_VERSION_RE = /^\d+\.\d+\.\d+\+build\.\d+$/;

function readJson(path, label) {
  const source = readFileSync(path, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function formatVersion(manifest) {
  const parts = ['major', 'minor', 'patch', 'build'];
  if (
    !manifest
    || typeof manifest !== 'object'
    || !parts.every(part => Number.isInteger(manifest[part]) && manifest[part] >= 0)
  ) {
    throw new Error('version.json must contain non-negative integer version fields');
  }
  return `${manifest.major}.${manifest.minor}.${manifest.patch}+build.${manifest.build}`;
}

function validateImageBuildInfo(info) {
  if (!info || typeof info !== 'object') {
    throw new Error('build-info.json must contain an object');
  }
  if (!BUILD_SHA_RE.test(info.sha)) {
    throw new Error('build-info.json must contain a full lowercase git SHA');
  }
  if (!APP_VERSION_RE.test(info.version)) {
    throw new Error('build-info.json must contain an immutable application version');
  }
  return Object.freeze({ sha: info.sha, version: info.version });
}

export function loadDeploymentInfo({
  appDir = process.cwd(),
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const buildInfoPath = join(appDir, 'build-info.json');
  try {
    return validateImageBuildInfo(readJson(buildInfoPath, 'build-info.json'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (nodeEnv === 'production') {
    throw new Error('production image is missing immutable build-info.json');
  }

  const manifest = readJson(join(appDir, 'version.json'), 'version.json');
  return Object.freeze({ sha: null, version: formatVersion(manifest) });
}
