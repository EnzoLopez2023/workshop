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
2. Select a verified local bundle under `/home/data/backups`. If the mounted
   storage itself is unavailable, there is no current Workshop-managed off-host
   archive to restore from.
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

## Off-host export retirement

Managed-identity off-host export was permanently retired on 2026-09-09 after
the recurring discovery and read-back loop generated millions of Blob reads and
excessive Log Analytics cost. The live `workshop` container was removed from
`strecoverywkhiw2g4hwik4`, and Workshop's container-scoped role assignment was
removed.

The production invariant is:

```text
OFFHOST_BACKUP_ENABLED=false
```

The deploy workflow rejects any other value. The server does not start the
off-host schedule or enqueue a scan after creating a local bundle, and API
health reports the exporter as `retired`. Readiness depends on the authoritative
SQLite storage only. Do not restore the account/container/scan settings, recreate
the container or role, or set the flag to `true` without a separately approved
recovery design that avoids recurring enumeration, read-back, and logging cost.

`offhost-export.js` and the guarded one-shot CLI remain packaged only to minimize
compatibility risk while the feature is retired. They are not an active
operational recovery path, and the removed Azure target and RBAC make production
export non-operational. Do not run `export-offhost` as a substitute for an
approved replacement design.

Local capture remains enabled on its existing schedule and retention policy.
`/home/data/backups` shares the App Service storage failure domain with the live
databases and uploads, so it is useful for rollback but is not disaster recovery.

Account deletion waits behind or completes before a local capture, so no bundle
can contain a half-deleted DB/upload set. Historical local bundles can retain an
account until retention expires. Restoring a bundle from before deletion can
resurrect that account, so incident recovery must reconcile deletions performed
after the selected recovery point before reopening the service.
