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

## Disaster-recovery requirement

`/home/data/backups` shares the same App Service storage failure domain as the
live databases and uploads. It is useful for operator rollback, but **it is not
a disaster-recovery backup**.

Production still requires a separate Azure operation that regularly exports each
newly verified whole bundle to off-host object storage in another failure domain,
encrypts it before or during transfer with a key held outside the App Service
filesystem, enforces its own immutable retention policy, and periodically runs
the verification/drill commands against a downloaded and decrypted copy. Never
export a DB without its matching uploads or individual files without the bundle
manifest. Do not place encryption keys in the bundle, App Service filesystem, or
repository.

The GitHub deploy workflow only builds and restarts the application; it cannot
reach the mounted data plane and is not a backup job. Provisioning the off-host
destination, key access, alerting, and scheduled export is live Azure work.
Rollout must also confirm one App Service worker, Always On, available storage
for the configured retention, and a successful production bundle plus
downloaded off-host restore drill.

Account deletion waits behind or completes before a capture, so no bundle can
contain a half-deleted DB/upload set. Historical bundles can legitimately retain
an account until both local and off-host retention expire. Restoring a bundle
from before deletion can resurrect that account, so incident recovery must
reconcile deletions performed after the selected recovery point before reopening
the service.
