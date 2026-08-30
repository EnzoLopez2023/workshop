# Workshop backup and recovery

Workshop's authoritative shared web/iOS state is the complete set of per-user
SQLite databases under `USERS_DIR` plus every file under `UPLOADS_PATH`. The
legacy `DB_PATH` is authoritative until its one-time user migration completes.
`SEED_DB_PATH` is demo data, not user-authoritative, but it is included so a
whole service restore preserves the deployed experience.

The Settings screen's JSON download is only a project-list summary. It omits
project detail tables, account/auth state, and uploads, has no import path, and
is **not** a backup or restore mechanism.

## Production behavior

The production container defaults all durable storage to `/home/data`:

| Setting | Default |
|---|---|
| `DATA_ROOT` | `/home/data` |
| `DB_PATH` | `/home/data/workshop.db` |
| `USERS_DIR` | `/home/data/users` |
| `SEED_DB_PATH` | `/home/data/workshop-seed.db` |
| `UPLOADS_PATH` | `/home/data/uploads` |
| `BACKUP_PATH` | `/home/data/backups` |
| `BACKUP_INTERVAL_HOURS` | `24` (`0` disables scheduling) |
| `BACKUP_INITIAL_DELAY_MINUTES` | `5` |
| `BACKUP_RETENTION_COUNT` | `7` complete bundles |

Every explicit environment path overrides its default. Recovery configuration
rejects overlapping backup, user-DB, and upload directories so a backup cannot
recursively capture or prune live data.

When `BACKUP_INTERVAL_HOURS` is greater than zero (the production default), the
Express process performs the first backup shortly after startup and then at the
configured interval. During capture it:

1. Returns `503 recovery_backup_in_progress` for new `/api` traffic while
   keeping `/api/health` available.
2. Waits for all already-active API requests, including account deletion and
   file uploads, to finish.
3. Uses SQLite's online backup API for every legacy, seed, and per-user DB.
   This includes committed WAL content; copied `-wal`/`-shm` files are neither
   needed nor retained.
4. Copies every upload without following symbolic links and fails if a source
   file changes during the copy.
5. Runs `PRAGMA quick_check` and `PRAGMA foreign_key_check` on every snapshot,
   verifies that every DB file reference exists in the copied uploads, hashes
   every file with SHA-256, and writes a checksummed manifest.
6. Publishes the staging directory with one same-filesystem rename only after
   full verification. A failed attempt removes its staging directory.
7. Removes only entire oldest verified bundle directories after the new bundle
   is durable. It never rotates databases and uploads independently.

An exclusive lock under `BACKUP_PATH` prevents overlapping jobs. A lock older
than `BACKUP_LOCK_STALE_MINUTES` (default six hours) can be reclaimed after a
crashed process.

Capture quiescence is process-local. Production must remain at one App Service
worker; verify that setting during rollout. Do not scale Workshop out until the
request drain is replaced by a distributed lease that every writer honors.

## Bundle format

Each `workshop-backup-<UTC timestamp>-<id>/` directory contains:

```text
manifest.json
manifest.sha256
databases/workshop.db                 # when legacy DB still exists
databases/workshop-seed.db            # when the demo seed exists
databases/users/<storage-key>.db       # every isolated user DB
uploads/**                             # all uploaded files, including orphans
```

The manifest identifies DB roles, records integrity results and upload-reference
counts, and includes the size and SHA-256 checksum of every data file. Verification
rejects absolute paths, `..`, backslashes, symlinks, unknown extra files, missing
files, checksum drift, SQLite corruption, foreign-key failures, and missing
referenced uploads.

## Verification and restore drill

Run these commands from the checked-out version that created the bundle:

```bash
npm run recovery -- verify /path/to/workshop-backup-...
npm run recovery -- drill /path/to/workshop-backup-...
```

`verify` is read-only. `drill` verifies the bundle, materializes its normalized
`workshop.db` / `workshop-seed.db` / `users/` / `uploads/` layout in a temporary
directory, rechecks all restored hashes and databases, then removes the drill
directory.

To prepare a real restore without touching the live root:

```bash
npm run recovery -- stage /path/to/workshop-backup-... /home/workshop-restore-<id>
```

Staging refuses an existing target and refuses the configured live `DATA_ROOT`.
For an actual incident:

1. Stop the App Service and preserve the current `/home/data` directory.
2. Download and decrypt the selected off-host bundle.
3. Run `verify`, `drill`, then `stage` outside `/home/data`.
4. Rename `/home/data` to a rollback path and rename the staged root to
   `/home/data` while the app remains stopped. Explicit `DB_PATH`,
   `USERS_DIR`, `SEED_DB_PATH`, and `UPLOADS_PATH` overrides must match that
   normalized layout or be updated before restart.
5. Start the app, exercise authenticated web and iOS reads/writes plus uploaded
   media, and retain the rollback root until acceptance.

Manual bundle creation is intentionally guarded because a second process cannot
quiesce the running Express process:

```bash
# Only after the API process is stopped:
npm run recovery -- backup --offline-confirmed
```

## Managed-identity off-host export

`/home/data/backups` shares the App Service storage failure domain with the live
databases and uploads. It remains useful for rollback, but it is not disaster
recovery. Workshop's exporter implements the pinned
[personal-apps off-host export contract](https://github.com/EnzoLopez2023/azure-infra/blob/78f28d46cfcf04315ad53fb0360bc855fa0a1eb4/recovery/OFFHOST_EXPORT_CONTRACT.md)
from canonical commit `78f28d46cfcf04315ad53fb0360bc855fa0a1eb4`.

The exporter is discovery-only: it never creates a second backup, opens a live
database, reads `UPLOADS_PATH`, or quiesces APIs. When explicitly enabled it
first completes the private-DNS/identity capability check, immediately runs one
startup scan, and then scans hourly. Every newly finalized local bundle also
requests an immediate scan. If another scan is active, one coalesced follow-up is
queued so the new bundle cannot be missed; other concurrent triggers join the
active work. No scans overlap, and each completion is logged as a structured
result. Each scan verifies complete
`workshop-backup-*` directories already finalized by the in-process recovery
scheduler, then uploads the manifest, all normalized databases, and every upload
including orphans as one artifact. It uses `ManagedIdentityCredential` directly
in production. Account keys, SAS tokens, connection strings, encryption keys,
environment files, WAL sidecars, partial staging directories, and live files are
never exported.

Each source UTC date gets one conditional daily commit and each UTC month gets
one conditional monthly commit. Upload retries use a new immutable 128-bit
suffix. `_COMPLETE.json` is written only after a full download, SHA-256
recalculation, and `recovery -- verify`; `_COMMITTED.json` is then created with
`If-None-Match: *`. Only that deterministic committed marker defines a recovery
point. Successful scans re-download and verify fresh daily/monthly recovery
points before writing new health heartbeats. Azure lifecycle, versioning, soft
delete, GRS, diagnostics, alerts, and no-delete RBAC are provisioned in
`azure-infra`; the app never deletes off-host blobs.

Required nonsecret App Service settings:

```text
OFFHOST_BACKUP_ENABLED=false
OFFHOST_BACKUP_ACCOUNT=<offhost-backup-storage deployment output>
OFFHOST_BACKUP_CONTAINER=workshop
OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES=60
OFFHOST_BACKUP_STALE_HOURS=26
OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS=2
OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS=23
OFFHOST_BACKUP_MONTHLY_STALE_DAYS=35
OFFHOST_BACKUP_CLOCK_SKEW_MINUTES=5
```

Activation is deliberately fail-closed. Leave `OFFHOST_BACKUP_ENABLED=false`
until all rollout checks pass:

1. Confirm the App Service still has exactly one worker and Always On.
2. Review the required Workshop network change with `appSlug=workshop`:

   ```bash
   az deployment group what-if \
     --resource-group rg-personal-apps-prod \
     --name offhost-exporter-network-workshop \
     --template-file recovery/offhost-backup-app-network.bicep \
     --parameters appSlug=workshop \
     --result-format FullResourcePayloads
   ```

3. Apply that `azure-infra` network deployment separately. Integrate only with
   `vnet-recovery-prod/snet-appservice-recovery`; do not enable route-all.
4. Re-probe the application. Inside the production container, the canonical Blob
   hostname must resolve only to private addresses. Workshop's identity must read
   the `workshop` container properties and receive `403` for the `cairn`
   cross-container probe.
5. With the API still on one worker and a complete local bundle present, run the
   guarded manual scan inside the production container:

   ```bash
   npm run recovery -- export-offhost --manual-confirmed
   ```

   The command works while scheduled export is disabled, but still requires
   `NODE_ENV=production`, the account/container settings, private DNS, and the
   system-assigned managed identity. It must complete upload, download, hash, and
   verifier read-back successfully.
6. Confirm valid daily `_COMMITTED.json`, daily `_HEALTH.json`, and monthly
   `_HEALTH.json` paths in Blob storage and `StorageBlobLogs`. Then set
   `OFFHOST_BACKUP_ENABLED=true`, restart, observe the first scan, and only after
   that add `workshop` to `enabledFreshnessApps` in the infrastructure deployment
   and test the action group.

The GitHub deploy workflow only builds and restarts the application; it cannot
reach `/home/data` and is not a backup job. Network integration, RBAC, monitoring
activation, and the first production read-back are separate live Azure work.

Account deletion waits behind or completes before a capture, so no bundle can
contain a half-deleted DB/upload set. Historical bundles can legitimately retain
an account until both local and off-host retention expire. Restoring a bundle
from before deletion can resurrect that account, so incident recovery must
reconcile deletions performed after the selected recovery point before reopening
the service.
