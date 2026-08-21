#!/usr/bin/env node

import { resolve } from 'node:path';
import {
  createBackupBundle,
  materializeBackupBundle,
  resolveStorageConfig,
  runRestoreDrill,
  verifyBackupBundle,
} from '../recovery.js';
import { runManualOffhostExport } from '../offhost-export.js';

function usage() {
  console.error(`Usage:
  npm run recovery -- backup --offline-confirmed
  npm run recovery -- verify <bundle-path>
  npm run recovery -- drill <bundle-path>
  npm run recovery -- stage <bundle-path> <new-target-root>
  npm run recovery -- export-offhost --manual-confirmed`);
}

function printableResult(result) {
  return JSON.stringify(result, (_key, value) => {
    if (value && typeof value === 'object' && value.files && value.databases) {
      return {
        bundleId: value.bundleId,
        createdAt: value.createdAt,
        completedAt: value.completedAt,
        databases: value.databases.length,
        uploads: value.uploads,
      };
    }
    return value;
  }, 2);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const storage = resolveStorageConfig(process.env, {
    appDir: resolve(import.meta.dirname, '..'),
  });

  let result;
  if (command === 'backup') {
    if (!args.includes('--offline-confirmed')) {
      throw new Error(
        'manual backup requires --offline-confirmed; use the in-process production scheduler for live data',
      );
    }
    result = await createBackupBundle({
      dbPath: storage.dbPath,
      seedDbPath: storage.seedDbPath,
      usersDir: storage.usersDir,
      uploadsPath: storage.uploadsPath,
      backupRoot: storage.backupRoot,
      retentionCount: storage.backupRetentionCount,
      lockStaleMs: storage.backupLockStaleMs,
    });
  } else if (command === 'verify' && args.length === 1) {
    result = await verifyBackupBundle(args[0]);
  } else if (command === 'drill' && args.length === 1) {
    result = await runRestoreDrill(args[0]);
  } else if (command === 'stage' && args.length === 2) {
    result = await materializeBackupBundle(args[0], args[1], {
      forbiddenRoots: [storage.dataRoot],
    });
  } else if (
    command === 'export-offhost'
    && args.length === 1
    && args[0] === '--manual-confirmed'
  ) {
    result = await runManualOffhostExport({
      backupRoot: storage.backupRoot,
      appDir: resolve(import.meta.dirname, '..'),
    });
  } else {
    usage();
    process.exitCode = 2;
    return;
  }

  console.log(printableResult(result));
}

main().catch((error) => {
  console.error(`[recovery] ${error.message}`);
  process.exitCode = 1;
});
