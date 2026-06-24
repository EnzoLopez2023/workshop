#!/usr/bin/env node
// Version bumper. version.json is the single source of truth.
//
//   node scripts/version.mjs build   → build += 1   (run automatically by the pre-commit hook)
//   node scripts/version.mjs patch   → patch += 1
//   node scripts/version.mjs minor   → minor += 1, patch = 0
//   node scripts/version.mjs major   → major += 1, minor = 0, patch = 0
//
// Semver bumps deliberately DO NOT touch `build` — the commit hook owns the
// build counter, so a `bump:minor` + commit increments build exactly once.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'version.json');
const mode = (process.argv[2] || 'build').toLowerCase();

let v;
try {
  v = JSON.parse(readFileSync(FILE, 'utf8'));
} catch {
  v = { major: 0, minor: 0, patch: 0, build: 0 };
}
for (const k of ['major', 'minor', 'patch', 'build']) v[k] = Number(v[k]) || 0;

switch (mode) {
  case 'major': v.major++; v.minor = 0; v.patch = 0; break;
  case 'minor': v.minor++; v.patch = 0; break;
  case 'patch': v.patch++; break;
  case 'build': v.build++; break;
  default:
    console.error(`Unknown mode "${mode}". Use one of: build | patch | minor | major`);
    process.exit(1);
}

writeFileSync(FILE, JSON.stringify(v, null, 2) + '\n');
console.log(`version → v${v.major}.${v.minor}.${v.patch} (build ${v.build})`);
