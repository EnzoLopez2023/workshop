// Library hub: the index of the 3D model files that live on the owner's Mac.
//
// The files themselves never reach this server. The local organizer
// (tools/library-scanner) syncs one row per model folder (model.json id),
// its files' metadata and content-addressed PNG thumbnails, authenticating
// with a per-user device token that is accepted only on /api/library/sync/*.
// Everything else goes through the normal Entra auth + per-user DB path.
//
// Thumbnails are stored as BLOBs in the user's own SQLite file so backups,
// restore drills and account deletion cover them with no extra bookkeeping.

import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const LIBRARY_STATUSES = ['inbox', 'want', 'queued', 'printed', 'failed', 'skip'];
const EDITABLE_TEXT = { title: 200, notes: 20_000, designer: 200, source_url: 2_000, category: 120 };
const DEVICE_TOKEN_RE = /^wl1\.([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{32,128})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_THUMB_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const AUTO_MATCH_SCORE = 0.95;
export const SUGGEST_MATCH_SCORE = 0.6;

// ── Schema ────────────────────────────────────────────────────────────────────

export function initLibrarySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_models (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT '_Inbox',
      folder           TEXT,
      status           TEXT NOT NULL DEFAULT 'inbox'
                       CHECK (status IN ('inbox','want','queued','printed','failed','skip')),
      tags_json        TEXT NOT NULL DEFAULT '[]',
      notes            TEXT NOT NULL DEFAULT '',
      favorite         INTEGER NOT NULL DEFAULT 0,
      designer         TEXT,
      license          TEXT,
      description      TEXT,
      source_site      TEXT,
      source_url       TEXT,
      source_model_id  TEXT,
      thumb_hash       TEXT,
      gallery_json     TEXT NOT NULL DEFAULT '[]',
      formats_json     TEXT NOT NULL DEFAULT '[]',
      file_count       INTEGER NOT NULL DEFAULT 0,
      total_bytes      INTEGER NOT NULL DEFAULT 0,
      plate_count      INTEGER NOT NULL DEFAULT 0,
      printer          TEXT,
      filaments_json   TEXT NOT NULL DEFAULT '[]',
      est_seconds      REAL,
      est_grams        REAL,
      is_sliced        INTEGER NOT NULL DEFAULT 0,
      bbox_json        TEXT,
      bambu_project_id INTEGER REFERENCES bambu_projects(id) ON DELETE SET NULL,
      state            TEXT NOT NULL DEFAULT 'present' CHECK (state IN ('present','missing')),
      edit_version     INTEGER NOT NULL DEFAULT 0,
      disk_version     INTEGER NOT NULL DEFAULT 0,
      disk_created_at  TEXT,
      first_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS library_models_status ON library_models(status, state);
    CREATE INDEX IF NOT EXISTS library_models_category ON library_models(category, state);

    CREATE TABLE IF NOT EXISTS library_files (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id       TEXT NOT NULL REFERENCES library_models(id) ON DELETE CASCADE,
      rel_path       TEXT NOT NULL UNIQUE,
      filename       TEXT NOT NULL,
      kind           TEXT NOT NULL,
      size           INTEGER NOT NULL DEFAULT 0,
      sha256         TEXT NOT NULL,
      geom_hash      TEXT,
      mtime          TEXT,
      triangles      INTEGER,
      bbox_json      TEXT,
      is_sliced      INTEGER NOT NULL DEFAULT 0,
      printer        TEXT,
      seconds        REAL,
      grams          REAL,
      plates_json    TEXT NOT NULL DEFAULT '[]',
      profile_title  TEXT,
      filaments_json TEXT NOT NULL DEFAULT '[]',
      generator      TEXT,
      thumb_hash     TEXT
    );
    CREATE INDEX IF NOT EXISTS library_files_model ON library_files(model_id);
    CREATE INDEX IF NOT EXISTS library_files_sha ON library_files(sha256);
    CREATE INDEX IF NOT EXISTS library_files_geom ON library_files(geom_hash) WHERE geom_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS library_thumbs (
      hash       TEXT PRIMARY KEY,
      png        BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS library_prints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id        TEXT REFERENCES library_models(id) ON DELETE SET NULL,
      source          TEXT NOT NULL CHECK (source IN ('manual','shapepilot')),
      external_job_id TEXT UNIQUE,
      title           TEXT,
      result          TEXT NOT NULL DEFAULT 'completed'
                      CHECK (result IN ('completed','failed','active','unknown')),
      started_at      TEXT,
      ended_at        TEXT,
      seconds         REAL,
      grams           REAL,
      printer         TEXT,
      materials_json  TEXT NOT NULL DEFAULT '[]',
      notes           TEXT NOT NULL DEFAULT '',
      match_state     TEXT NOT NULL DEFAULT 'manual'
                      CHECK (match_state IN ('manual','auto','confirmed','suggested','unmatched','rejected')),
      match_score     REAL,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS library_prints_model ON library_prints(model_id);
    CREATE INDEX IF NOT EXISTS library_prints_match ON library_prints(match_state);

    CREATE TABLE IF NOT EXISTS library_devices (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT,
      revoked_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS library_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  migrateLibrarySchema(db);
}

// Additive migrations for databases created by an earlier Library release.
function migrateLibrarySchema(db) {
  const fileCols = new Set(db.prepare(`PRAGMA table_info(library_files)`).all().map((c) => c.name));
  if (!fileCols.has('profile_title')) db.exec(`ALTER TABLE library_files ADD COLUMN profile_title TEXT`);
}

export function buildLibraryStmts(db) {
  return {
    getModel: db.prepare(`SELECT * FROM library_models WHERE id = ?`),
    insertModel: db.prepare(`
      INSERT INTO library_models (
        id, title, category, folder, status, tags_json, notes, designer, license, description,
        source_site, source_url, source_model_id, disk_version, disk_created_at, last_seen_at
      ) VALUES (
        @id, @title, @category, @folder, @status, @tags_json, @notes, @designer, @license, @description,
        @source_site, @source_url, @source_model_id, @disk_version, @disk_created_at, @seen
      )`),
    updateModelFromDisk: db.prepare(`
      UPDATE library_models SET
        title = @title, status = @status, tags_json = @tags_json, notes = @notes,
        designer = @designer, source_url = @source_url, disk_version = @disk_version
      WHERE id = @id`),
    updateModelLocation: db.prepare(`
      UPDATE library_models SET
        category = @category, folder = @folder, license = @license, description = @description,
        source_site = @source_site, source_model_id = @source_model_id,
        thumb_hash = @thumb_hash, gallery_json = @gallery_json, formats_json = @formats_json,
        file_count = @file_count, total_bytes = @total_bytes, plate_count = @plate_count,
        printer = @printer, filaments_json = @filaments_json, est_seconds = @est_seconds,
        est_grams = @est_grams, is_sliced = @is_sliced, bbox_json = @bbox_json,
        state = 'present', last_seen_at = @seen, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id`),
    markMissing: db.prepare(`
      UPDATE library_models SET state = 'missing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE state = 'present' AND last_seen_at < ?`),
    editModel: db.prepare(`
      UPDATE library_models SET
        title = @title, status = @status, tags_json = @tags_json, notes = @notes, favorite = @favorite,
        designer = @designer, source_url = @source_url, bambu_project_id = @bambu_project_id,
        edit_version = edit_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id`),
    setModelStatus: db.prepare(`
      UPDATE library_models SET status = ?, edit_version = edit_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`),
    pendingEdits: db.prepare(`
      SELECT id, title, status, tags_json, notes, designer, source_url, edit_version
      FROM library_models WHERE edit_version > disk_version AND state = 'present'`),
    deleteModelFiles: db.prepare(`DELETE FROM library_files WHERE model_id = ?`),
    deleteFileByPath: db.prepare(`DELETE FROM library_files WHERE rel_path = ?`),
    insertFile: db.prepare(`
      INSERT INTO library_files (
        model_id, rel_path, filename, kind, size, sha256, geom_hash, mtime, triangles, bbox_json,
        is_sliced, printer, seconds, grams, plates_json, profile_title, filaments_json, generator, thumb_hash
      ) VALUES (
        @model_id, @rel_path, @filename, @kind, @size, @sha256, @geom_hash, @mtime, @triangles, @bbox_json,
        @is_sliced, @printer, @seconds, @grams, @plates_json, @profile_title, @filaments_json, @generator, @thumb_hash
      )`),
    listFiles: db.prepare(`SELECT * FROM library_files WHERE model_id = ? ORDER BY kind, filename`),
    allFilesForMatching: db.prepare(`
      SELECT f.model_id, f.filename, f.grams, f.seconds, f.plates_json, f.profile_title, f.mtime
      FROM library_files f JOIN library_models m ON m.id = f.model_id`),
    allModelsForMatching: db.prepare(`SELECT id, title, status FROM library_models`),
    hasThumb: db.prepare(`SELECT 1 FROM library_thumbs WHERE hash = ?`),
    getThumb: db.prepare(`SELECT png FROM library_thumbs WHERE hash = ?`),
    putThumb: db.prepare(`INSERT OR IGNORE INTO library_thumbs (hash, png) VALUES (?, ?)`),
    pruneThumbs: db.prepare(`
      DELETE FROM library_thumbs WHERE hash NOT IN (
        SELECT thumb_hash FROM library_models WHERE thumb_hash IS NOT NULL
        UNION SELECT thumb_hash FROM library_files WHERE thumb_hash IS NOT NULL
        UNION SELECT value FROM library_models, json_each(library_models.gallery_json)
        UNION SELECT json_extract(m.value, '$.thumb')
          FROM library_state, json_each(library_state.value, '$.models') AS m
          WHERE library_state.key = 'plan' AND json_valid(library_state.value)
      )`),
    listPrints: db.prepare(`
      SELECT * FROM library_prints WHERE model_id = ? AND match_state IN ('manual','auto','confirmed')
      ORDER BY COALESCE(started_at, created_at) DESC`),
    getPrint: db.prepare(`SELECT * FROM library_prints WHERE id = ?`),
    insertManualPrint: db.prepare(`
      INSERT INTO library_prints (model_id, source, title, result, started_at, notes, grams, seconds, match_state)
      VALUES (@model_id, 'manual', @title, @result, @started_at, @notes, @grams, @seconds, 'manual')`),
    deletePrint: db.prepare(`DELETE FROM library_prints WHERE id = ? AND source = 'manual'`),
    upsertJob: db.prepare(`
      INSERT INTO library_prints (
        source, external_job_id, title, result, started_at, ended_at, seconds, grams, printer, materials_json, match_state
      ) VALUES (
        'shapepilot', @external_job_id, @title, @result, @started_at, @ended_at, @seconds, @grams, @printer, @materials_json, 'unmatched'
      )
      ON CONFLICT(external_job_id) DO UPDATE SET
        title = excluded.title, result = excluded.result, started_at = excluded.started_at,
        ended_at = excluded.ended_at, seconds = excluded.seconds, grams = excluded.grams,
        printer = excluded.printer, materials_json = excluded.materials_json`),
    jobsNeedingMatch: db.prepare(`
      SELECT * FROM library_prints WHERE source = 'shapepilot' AND match_state IN ('unmatched','suggested')`),
    setMatch: db.prepare(`UPDATE library_prints SET model_id = ?, match_state = ?, match_score = ? WHERE id = ?`),
    listSuggestions: db.prepare(`
      SELECT p.*, m.title AS model_title, m.thumb_hash AS model_thumb
      FROM library_prints p LEFT JOIN library_models m ON m.id = p.model_id
      WHERE p.match_state IN ('suggested','unmatched') AND p.result IN ('completed','failed')
      ORDER BY COALESCE(p.started_at, p.created_at) DESC LIMIT 200`),
    printStats: db.prepare(`
      SELECT model_id,
        SUM(result = 'completed') AS printed_count,
        SUM(result = 'failed') AS failed_count,
        MAX(COALESCE(started_at, created_at)) AS last_printed_at
      FROM library_prints WHERE model_id IS NOT NULL AND match_state IN ('manual','auto','confirmed')
      GROUP BY model_id`),
    listDevices: db.prepare(`
      SELECT id, name, created_at, last_seen_at, revoked_at FROM library_devices ORDER BY created_at DESC`),
    insertDevice: db.prepare(`INSERT INTO library_devices (name, token_hash) VALUES (?, ?)`),
    deviceByHash: db.prepare(`SELECT * FROM library_devices WHERE token_hash = ? AND revoked_at IS NULL`),
    touchDevice: db.prepare(`UPDATE library_devices SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
    revokeDevice: db.prepare(`
      UPDATE library_devices SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND revoked_at IS NULL`),
    getState: db.prepare(`SELECT value, updated_at FROM library_state WHERE key = ?`),
    setState: db.prepare(`
      INSERT INTO library_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`),
    countsByStatus: db.prepare(`SELECT status, COUNT(*) AS n FROM library_models WHERE state = 'present' GROUP BY status`),
    countsByCategory: db.prepare(`SELECT category, COUNT(*) AS n FROM library_models WHERE state = 'present' GROUP BY category ORDER BY category`),
    countMissing: db.prepare(`SELECT COUNT(*) AS n FROM library_models WHERE state = 'missing'`),
    geomDuplicates: db.prepare(`
      SELECT geom_hash, COUNT(DISTINCT model_id) AS models
      FROM library_files f JOIN library_models m ON m.id = f.model_id AND m.state = 'present'
      WHERE geom_hash IS NOT NULL GROUP BY geom_hash HAVING COUNT(DISTINCT model_id) > 1`),
    filesByGeom: db.prepare(`
      SELECT f.id, f.model_id, f.rel_path, f.filename, f.kind, f.size, f.thumb_hash, m.title, m.category, m.status, m.thumb_hash AS model_thumb
      FROM library_files f JOIN library_models m ON m.id = f.model_id AND m.state = 'present'
      WHERE f.geom_hash = ? ORDER BY m.category, m.title`),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const json = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const text = (value, max) => (value == null ? null : String(value).slice(0, max));
const num = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    const t = String(tag).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

export function hashDeviceSecret(secret) {
  return createHash('sha256').update(`workshop-library-device:${secret}`).digest('hex');
}

export function newDeviceToken(userKey) {
  const secret = randomBytes(32).toString('base64url');
  return { token: `wl1.${userKey}.${secret}`, hash: hashDeviceSecret(secret) };
}

function hydrateModel(row, stats) {
  if (!row) return null;
  const s = stats?.get(row.id);
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    folder: row.folder,
    status: row.status,
    tags: json(row.tags_json, []),
    notes: row.notes,
    favorite: Boolean(row.favorite),
    designer: row.designer,
    license: row.license,
    description: row.description,
    source_site: row.source_site,
    source_url: row.source_url,
    source_model_id: row.source_model_id,
    thumb_hash: row.thumb_hash,
    gallery: json(row.gallery_json, []),
    formats: json(row.formats_json, []),
    file_count: row.file_count,
    total_bytes: row.total_bytes,
    plate_count: row.plate_count,
    printer: row.printer,
    filaments: json(row.filaments_json, []),
    est_seconds: row.est_seconds,
    est_grams: row.est_grams,
    is_sliced: Boolean(row.is_sliced),
    bbox: json(row.bbox_json, null),
    bambu_project_id: row.bambu_project_id,
    state: row.state,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    updated_at: row.updated_at,
    printed_count: s?.printed_count ?? 0,
    failed_count: s?.failed_count ?? 0,
    last_printed_at: s?.last_printed_at ?? null,
  };
}

function hydrateFile(row) {
  return {
    id: row.id,
    rel_path: row.rel_path,
    filename: row.filename,
    kind: row.kind,
    size: row.size,
    sha256: row.sha256,
    geom_hash: row.geom_hash,
    mtime: row.mtime,
    triangles: row.triangles,
    bbox: json(row.bbox_json, null),
    is_sliced: Boolean(row.is_sliced),
    printer: row.printer,
    seconds: row.seconds,
    grams: row.grams,
    plates: json(row.plates_json, []),
    filaments: json(row.filaments_json, []),
    generator: row.generator,
    thumb_hash: row.thumb_hash,
  };
}

function printStatsMap(stmts) {
  return new Map(stmts.printStats.all().map((r) => [r.model_id, r]));
}

// ── Sync (device token) ───────────────────────────────────────────────────────

function aggregateFiles(files) {
  const formats = [...new Set(files.map((f) => (f.isSliced ? 'sliced' : f.kind)))].sort();
  const sliced = files.filter((f) => f.isSliced && f.grams != null);
  const best = sliced.sort((a, b) => (b.grams ?? 0) - (a.grams ?? 0))[0] ?? null;
  const withPrinter = files.find((f) => f.printer);
  const withFilaments = files.find((f) => Array.isArray(f.filaments) && f.filaments.length);
  const plates = files.reduce((n, f) => Math.max(n, Array.isArray(f.plates) ? f.plates.length : 0), 0);
  const bboxFile = files.filter((f) => Array.isArray(f.bbox)).sort((a, b) => (b.triangles ?? 0) - (a.triangles ?? 0))[0];
  return {
    formats,
    file_count: files.length,
    total_bytes: files.reduce((n, f) => n + (num(f.size) ?? 0), 0),
    plate_count: plates,
    printer: withPrinter?.printer ?? null,
    filaments: withFilaments?.filaments ?? [],
    est_seconds: best?.seconds ?? null,
    est_grams: best?.grams ?? null,
    is_sliced: sliced.length > 0 || files.some((f) => f.isSliced),
    bbox: bboxFile?.bbox ?? null,
  };
}

/** Upserts one synced model (from model.json + scan records). Exported for tests. */
export function upsertSyncedModel(stmts, model, seen) {
  if (typeof model?.id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(model.id)) throw new Error('model id is required');
  const files = Array.isArray(model.files) ? model.files.slice(0, 2_000) : [];
  const status = LIBRARY_STATUSES.includes(model.status) ? model.status : 'inbox';
  const diskVersion = Number.isInteger(model.workshopVersion) ? model.workshopVersion : 0;
  const existing = stmts.getModel.get(model.id);
  const editable = {
    id: model.id,
    title: text(model.title, EDITABLE_TEXT.title) || 'Untitled model',
    status,
    tags_json: JSON.stringify(cleanTags(model.tags)),
    notes: text(model.notes, EDITABLE_TEXT.notes) ?? '',
    designer: text(model.designer, EDITABLE_TEXT.designer),
    source_url: text(model.source?.url, EDITABLE_TEXT.source_url),
    disk_version: diskVersion,
  };
  if (!existing) {
    stmts.insertModel.run({
      ...editable,
      category: text(model.category, EDITABLE_TEXT.category) || '_Inbox',
      folder: text(model.folder, 1_000),
      license: text(model.license, 200),
      description: text(model.description, 8_000),
      source_site: text(model.source?.site, 40),
      source_model_id: text(model.source?.modelId, 120),
      disk_created_at: text(model.createdAt, 40),
      seen,
    });
  } else if (diskVersion >= existing.edit_version) {
    // The disk has caught up with (or is ahead of) edits made in Workshop.
    stmts.updateModelFromDisk.run(editable);
  }
  const agg = aggregateFiles(files);
  stmts.updateModelLocation.run({
    id: model.id,
    category: text(model.category, EDITABLE_TEXT.category) || '_Inbox',
    folder: text(model.folder, 1_000),
    license: text(model.license, 200),
    description: text(model.description, 8_000),
    source_site: text(model.source?.site, 40),
    source_model_id: text(model.source?.modelId, 120),
    thumb_hash: SHA256_RE.test(model.thumb ?? '') ? model.thumb : null,
    gallery_json: JSON.stringify((Array.isArray(model.gallery) ? model.gallery : []).filter((h) => SHA256_RE.test(h)).slice(0, 40)),
    formats_json: JSON.stringify(agg.formats),
    file_count: agg.file_count,
    total_bytes: agg.total_bytes,
    plate_count: agg.plate_count,
    printer: text(agg.printer, 120),
    filaments_json: JSON.stringify(agg.filaments.slice(0, 16)),
    est_seconds: num(agg.est_seconds),
    est_grams: num(agg.est_grams),
    is_sliced: agg.is_sliced ? 1 : 0,
    bbox_json: agg.bbox ? JSON.stringify(agg.bbox) : null,
    seen,
  });
  stmts.deleteModelFiles.run(model.id);
  for (const f of files) {
    const relPath = text(f.relPath, 2_000);
    if (!relPath || !SHA256_RE.test(f.sha256 ?? '')) continue;
    stmts.deleteFileByPath.run(relPath);
    stmts.insertFile.run({
      model_id: model.id,
      rel_path: relPath,
      filename: text(f.filename, 500) ?? relPath,
      kind: ['stl', '3mf', 'obj', 'step'].includes(f.kind) ? f.kind : 'other',
      size: num(f.size) ?? 0,
      sha256: f.sha256,
      geom_hash: SHA256_RE.test(f.geomHash ?? '') ? f.geomHash : null,
      mtime: f.mtimeMs ? new Date(f.mtimeMs).toISOString() : null,
      triangles: num(f.triangles),
      bbox_json: Array.isArray(f.bbox) ? JSON.stringify(f.bbox.slice(0, 3)) : null,
      is_sliced: f.isSliced ? 1 : 0,
      printer: text(f.printer, 120),
      seconds: num(f.seconds),
      grams: num(f.grams),
      plates_json: JSON.stringify((Array.isArray(f.plates) ? f.plates : []).slice(0, 64)),
      profile_title: text(f.profileTitle, 300),
      filaments_json: JSON.stringify((Array.isArray(f.filaments) ? f.filaments : []).slice(0, 16)),
      generator: text(f.generator, 40),
      thumb_hash: SHA256_RE.test(f.thumb ?? '') ? f.thumb : null,
    });
  }
}

// ── Print-job matching ────────────────────────────────────────────────────────

export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\.(gcode\.3mf|3mf|stl|gcode|obj|step)$/g, '')
    .replace(/[+_]/g, ' ')
    .replace(/\((?:sliced|\d+)\)/g, ' ')
    .replace(/\bplate[ -]?\d+\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function trigrams(value) {
  const s = `  ${value} `;
  const grams = new Map();
  for (let i = 0; i < s.length - 2; i += 1) {
    const g = s.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient over character trigrams (1 = identical after normalization). */
export function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = trigrams(na);
  const gb = trigrams(nb);
  let shared = 0;
  let total = 0;
  for (const [g, n] of ga) {
    shared += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return (2 * shared) / total;
}

/**
 * Scores every model for a print job. Bambu job titles are usually the
 * project or plate name, so the job title is compared with model titles, file
 * names and plate names; matching sliced weights nudge the score.
 *
 * MakerWorld print profiles often name the job after the profile instead
 * ("0.16mm layer, 2 walls, 15% infill"). Those names are shared by many
 * models, so a profile-name match is only confident when the job's weight
 * agrees with the file's; otherwise it is at most a suggestion.
 */
export function scoreJobAgainstModels(job, models, filesByModel) {
  const scored = [];
  const grams = num(job.grams);
  for (const model of models) {
    const files = filesByModel.get(model.id) ?? [];
    const names = [model.title, ...files.map((f) => f.filename), ...files.flatMap((f) => json(f.plates_json, []).map((p) => p.name).filter(Boolean))];
    let score = Math.max(...names.map((n) => titleSimilarity(job.title, n)));
    // A job may print the whole project or a single plate, so compare with both.
    const weights = files.flatMap((f) => [num(f.grams), ...json(f.plates_json, []).map((p) => num(p.grams))]).filter(Boolean);
    const weightKnown = Boolean(grams && weights.length);
    const weightClose = weightKnown && weights.some((w) => Math.abs(w - grams) / Math.max(w, grams) <= 0.1);
    if (weightKnown) score += weightClose ? 0.1 : -0.05;
    const profiles = files.map((f) => f.profile_title).filter(Boolean);
    const profileSimilarity = profiles.length ? Math.max(...profiles.map((p) => titleSimilarity(job.title, p))) : 0;
    if (profileSimilarity >= 0.9) score = Math.max(score, weightClose ? 0.97 : weightKnown ? 0.5 : 0.75);
    score = Math.max(0, Math.min(1, score));
    scored.push({ modelId: model.id, score, files });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const [best] = scored;
  let tied = scored.filter((s) => best.score - s.score < 0.04);
  // Copies of the same project (e.g. a later revision re-downloaded) tie on
  // name. A copy whose every file was written after the print started cannot
  // be what was printed, so if exactly one tied copy predates the job, it wins.
  const started = Date.parse(job.started_at ?? '');
  if (tied.length > 1 && Number.isFinite(started)) {
    const predates = tied.filter((s) => s.files.some((f) => Date.parse(f.mtime ?? '') <= started));
    if (predates.length === 1) tied = predates;
  }
  // Two models equally close is neither an automatic match nor a useful suggestion.
  return { modelId: tied[0].modelId, score: tied[0].score, ambiguous: tied.length > 1 };
}

/** Re-matches unmatched/suggested ShapePilot jobs; returns counts. */
export function matchPrintJobs(stmts) {
  const models = stmts.allModelsForMatching.all();
  const filesByModel = new Map();
  for (const f of stmts.allFilesForMatching.all()) {
    if (!filesByModel.has(f.model_id)) filesByModel.set(f.model_id, []);
    filesByModel.get(f.model_id).push(f);
  }
  const counts = { auto: 0, suggested: 0, unmatched: 0 };
  for (const job of stmts.jobsNeedingMatch.all()) {
    const match = scoreJobAgainstModels(job, models, filesByModel);
    if (match && match.score >= AUTO_MATCH_SCORE && !match.ambiguous) {
      stmts.setMatch.run(match.modelId, 'auto', match.score, job.id);
      applyPrintResultToStatus(stmts, match.modelId, job.result);
      counts.auto += 1;
    } else if (match && match.score >= SUGGEST_MATCH_SCORE && !match.ambiguous) {
      stmts.setMatch.run(match.modelId, 'suggested', match.score, job.id);
      counts.suggested += 1;
    } else {
      stmts.setMatch.run(null, 'unmatched', match?.score ?? null, job.id);
      counts.unmatched += 1;
    }
  }
  return counts;
}

/** A completed print marks a model printed; a failure only marks it failed if it was never printed. */
export function applyPrintResultToStatus(stmts, modelId, result) {
  const model = stmts.getModel.get(modelId);
  if (!model) return;
  if (result === 'completed' && model.status !== 'printed') stmts.setModelStatus.run('printed', modelId);
  else if (result === 'failed' && ['inbox', 'want', 'queued'].includes(model.status)) stmts.setModelStatus.run('failed', modelId);
}

function normalizeJob(job) {
  const id = text(job?.id ?? job?.jobId, 200);
  if (!id) return null;
  const result = { completed: 'completed', failed_or_aborted: 'failed', failed: 'failed', active: 'active' }[job.result] ?? 'unknown';
  return {
    external_job_id: `shapepilot:${id}`,
    title: text(job.title, 500),
    result,
    started_at: text(job.startedAt, 40),
    ended_at: text(job.endedAt, 40),
    seconds: num(job.seconds ?? job.actualDurationSeconds),
    grams: num(job.grams ?? job.estimatedWeightGrams),
    printer: text(job.printer, 120),
    materials_json: JSON.stringify(Array.isArray(job.materials) ? job.materials.slice(0, 16) : []),
  };
}

/** Pulls print jobs from ShapePilot's integration endpoint into the user's DB. */
export async function importShapePilotJobs(stmts, { url, key, fetchImpl = fetch }) {
  if (!url || !key) throw Object.assign(new Error('ShapePilot print history is not configured'), { status: 503 });
  const since = json(stmts.getState.get('shapepilot_cursor')?.value, null);
  const endpoint = new URL('/api/integrations/print-jobs', url);
  if (since) endpoint.searchParams.set('since', since);
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Integration ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Object.assign(new Error(`ShapePilot returned ${response.status}`), { status: 502 });
  const body = await response.json();
  const jobs = (Array.isArray(body?.jobs) ? body.jobs : []).map(normalizeJob).filter(Boolean);
  for (const job of jobs) stmts.upsertJob.run(job);
  if (body?.cursor) stmts.setState.run('shapepilot_cursor', JSON.stringify(String(body.cursor)));
  stmts.setState.run('shapepilot_last_sync', JSON.stringify(new Date().toISOString()));
  return { imported: jobs.length, ...matchPrintJobs(stmts) };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * Registers the device-token sync routes. These must be mounted BEFORE the
 * general `/api` Entra middleware, like the MakerWorld bridge endpoint.
 */
export function registerLibrarySyncRoutes(app, { getExistingUserDb, beginActiveUserOperation, userKeyRe }) {
  const syncJson = express.json({ limit: '8mb' });

  function deviceAuth(req, res, next) {
    const m = /^Device (.+)$/.exec(req.get('authorization') ?? '');
    const parts = m ? DEVICE_TOKEN_RE.exec(m[1]) : null;
    if (!parts || !userKeyRe.test(parts[1])) return res.status(401).json({ error: 'invalid device token' });
    let entry;
    try {
      entry = getExistingUserDb(parts[1]);
    } catch {
      entry = null;
    }
    if (!entry) return res.status(401).json({ error: 'invalid device token' });
    const expected = hashDeviceSecret(parts[2]);
    const device = entry.stmts.library.deviceByHash.get(expected);
    if (!device || !timingSafeEqual(Buffer.from(device.token_hash), Buffer.from(expected))) {
      return res.status(401).json({ error: 'invalid device token' });
    }
    const release = beginActiveUserOperation(parts[1]);
    if (!release) return res.status(409).json({ error: 'account deletion in progress' });
    res.once('finish', release);
    res.once('close', release);
    entry.stmts.library.touchDevice.run(device.id);
    req.user = { userKey: parts[1] };
    req.db = entry.db;
    req.lib = entry.stmts.library;
    req.device = device;
    next();
  }

  app.post('/api/library/sync/models', deviceAuth, syncJson, (req, res) => {
    const { startedAt, models } = req.body ?? {};
    if (typeof startedAt !== 'string' || !Array.isArray(models)) return res.status(400).json({ error: 'startedAt and models are required' });
    const errors = [];
    req.db.transaction(() => {
      for (const model of models.slice(0, 500)) {
        try {
          upsertSyncedModel(req.lib, model, startedAt);
        } catch (err) {
          errors.push({ id: model?.id ?? null, error: err.message });
        }
      }
    })();
    res.json({ accepted: models.length - errors.length, errors });
  });

  app.post('/api/library/sync/commit', deviceAuth, syncJson, (req, res) => {
    const { startedAt, plan, batches, stats } = req.body ?? {};
    if (typeof startedAt !== 'string') return res.status(400).json({ error: 'startedAt is required' });
    const lib = req.lib;
    const result = req.db.transaction(() => {
      const missing = lib.markMissing.run(startedAt).changes;
      if (plan !== undefined) lib.setState.run('plan', JSON.stringify(plan));
      if (Array.isArray(batches)) lib.setState.run('batches', JSON.stringify(batches.slice(0, 200)));
      lib.setState.run('last_sync', JSON.stringify({ at: new Date().toISOString(), device: req.device.name, stats: stats ?? null }));
      lib.pruneThumbs.run();
      return { missing, matches: matchPrintJobs(lib) };
    })();
    res.json(result);
  });

  app.post('/api/library/sync/thumbs/missing', deviceAuth, syncJson, (req, res) => {
    const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.filter((h) => SHA256_RE.test(h)).slice(0, 5_000) : [];
    res.json({ missing: hashes.filter((h) => !req.lib.hasThumb.get(h)) });
  });

  app.put(
    '/api/library/sync/thumbs/:hash',
    deviceAuth,
    express.raw({ type: 'image/png', limit: MAX_THUMB_BYTES }),
    (req, res) => {
      const { hash } = req.params;
      const body = req.body;
      if (!SHA256_RE.test(hash) || !Buffer.isBuffer(body) || !body.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return res.status(400).json({ error: 'a PNG body is required' });
      }
      if (createHash('sha256').update(body).digest('hex') !== hash) return res.status(400).json({ error: 'hash mismatch' });
      req.lib.putThumb.run(hash, body);
      res.status(204).end();
    },
  );

  app.get('/api/library/sync/edits', deviceAuth, (req, res) => {
    res.json({
      edits: req.lib.pendingEdits.all().map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        tags: json(row.tags_json, []),
        notes: row.notes,
        designer: row.designer,
        sourceUrl: row.source_url,
        workshopVersion: row.edit_version,
      })),
    });
  });
}

/** Registers the signed-in routes (req.db / req.stmts already attached). */
export function registerLibraryRoutes(app, { isPrimaryUser, shapePilot, resolveReadDb }) {
  const lib = (req) => req.stmts.library;

  // Auth-exempt (like /api/bambu-assets/:id/image): <img> tags cannot send a bearer token.
  // Content-addressed and immutable, so it caches forever.
  app.get('/api/library/thumbs/:hash', (req, res) => {
    if (!SHA256_RE.test(req.params.hash)) return res.status(404).end();
    const rdb = resolveReadDb(req);
    const row = rdb?.stmts.library.getThumb.get(req.params.hash);
    if (!row) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.png);
  });

  app.get('/api/library/overview', (req, res) => {
    const l = lib(req);
    const state = (key) => json(l.getState.get(key)?.value, null);
    const plan = state('plan');
    res.json({
      byStatus: Object.fromEntries(l.countsByStatus.all().map((r) => [r.status, r.n])),
      byCategory: l.countsByCategory.all().map((r) => ({ category: r.category, count: r.n })),
      missing: l.countMissing.get().n,
      suggestions: l.listSuggestions.all().filter((p) => p.match_state === 'suggested').length,
      duplicateGroups: l.geomDuplicates.all().length,
      lastSync: state('last_sync'),
      planSummary: plan ? { createdAt: plan.createdAt, summary: plan.summary, pending: Array.isArray(plan.models) ? plan.models.length : 0 } : null,
      batches: state('batches') ?? [],
      devices: l.listDevices.all(),
      printHistory: {
        available: Boolean(shapePilot.url && shapePilot.key) && isPrimaryUser(req),
        lastSync: state('shapepilot_last_sync'),
      },
    });
  });

  /** Applies the Library hub's filters and sort; shared by the grid and model-to-model navigation. */
  function queryModels(req) {
    const l = lib(req);
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const status = String(req.query.status ?? '');
    const category = String(req.query.category ?? '');
    const format = String(req.query.format ?? '');
    const tag = String(req.query.tag ?? '').toLowerCase();
    const state = req.query.state === 'missing' ? 'missing' : 'present';
    const sort = String(req.query.sort ?? 'recent');
    const stats = printStatsMap(l);
    let rows = req.db.prepare(`SELECT * FROM library_models WHERE state = ?`).all(state);
    if (status) rows = rows.filter((r) => status.split(',').includes(r.status));
    if (category) rows = rows.filter((r) => r.category === category);
    if (format) rows = rows.filter((r) => json(r.formats_json, []).includes(format));
    if (tag) rows = rows.filter((r) => json(r.tags_json, []).some((t) => t.toLowerCase() === tag));
    if (req.query.favorite === '1') rows = rows.filter((r) => r.favorite);
    if (q) {
      const fileNames = new Map();
      for (const f of req.db.prepare(`SELECT model_id, filename FROM library_files`).all()) {
        fileNames.set(f.model_id, `${fileNames.get(f.model_id) ?? ''} ${f.filename}`);
      }
      const terms = q.split(/\s+/);
      rows = rows.filter((r) => {
        const hay = [r.title, r.designer, r.category, r.notes, r.tags_json, r.printer, r.filaments_json, fileNames.get(r.id)].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const sorters = {
      recent: (a, b) => b.first_seen_at.localeCompare(a.first_seen_at),
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      printed: (a, b) => (stats.get(b.id)?.last_printed_at ?? '').localeCompare(stats.get(a.id)?.last_printed_at ?? ''),
      size: (a, b) => b.total_bytes - a.total_bytes,
    };
    rows.sort(sorters[sort] ?? sorters.recent);
    return { rows, stats };
  }

  app.get('/api/library/models', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows, stats } = queryModels(req);
    res.json({ total: rows.length, items: rows.slice(offset, offset + limit).map((r) => hydrateModel(r, stats)) });
  });

  // Every matching id in order (unpaged), so a model page can step to its neighbours.
  app.get('/api/library/model-ids', (req, res) => {
    res.json({ ids: queryModels(req).rows.map((r) => r.id) });
  });

  app.get('/api/library/models/:id', (req, res) => {
    const l = lib(req);
    const row = l.getModel.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'model not found' });
    const model = hydrateModel(row, printStatsMap(l));
    res.json({
      ...model,
      files: l.listFiles.all(row.id).map(hydrateFile),
      prints: l.listPrints.all(row.id).map((p) => ({ ...p, materials: json(p.materials_json, []) })),
    });
  });

  app.put('/api/library/models/:id', (req, res) => {
    const l = lib(req);
    const row = l.getModel.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'model not found' });
    const body = req.body ?? {};
    if (body.status !== undefined && !LIBRARY_STATUSES.includes(body.status)) return res.status(400).json({ error: 'invalid status' });
    let bambuProjectId = row.bambu_project_id;
    if (body.bambu_project_id !== undefined) {
      bambuProjectId = body.bambu_project_id === null ? null : Number(body.bambu_project_id);
      if (bambuProjectId !== null && !req.stmts.getBambuProject.get(bambuProjectId)) {
        return res.status(400).json({ error: 'Bambu Hub project not found' });
      }
    }
    const title = body.title !== undefined ? text(body.title, EDITABLE_TEXT.title)?.trim() : row.title;
    if (!title) return res.status(400).json({ error: 'title is required' });
    l.editModel.run({
      id: row.id,
      title,
      status: body.status ?? row.status,
      tags_json: body.tags !== undefined ? JSON.stringify(cleanTags(body.tags)) : row.tags_json,
      notes: body.notes !== undefined ? text(body.notes, EDITABLE_TEXT.notes) ?? '' : row.notes,
      favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : row.favorite,
      designer: body.designer !== undefined ? text(body.designer, EDITABLE_TEXT.designer) : row.designer,
      source_url: body.source_url !== undefined ? text(body.source_url, EDITABLE_TEXT.source_url) : row.source_url,
      bambu_project_id: bambuProjectId,
    });
    res.json(hydrateModel(l.getModel.get(row.id), printStatsMap(l)));
  });

  app.post('/api/library/models/:id/prints', (req, res) => {
    const l = lib(req);
    const row = l.getModel.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'model not found' });
    const result = req.body?.result === 'failed' ? 'failed' : 'completed';
    const info = l.insertManualPrint.run({
      model_id: row.id,
      title: row.title,
      result,
      started_at: text(req.body?.started_at, 40) ?? new Date().toISOString(),
      notes: text(req.body?.notes, 4_000) ?? '',
      grams: num(req.body?.grams),
      seconds: num(req.body?.seconds),
    });
    applyPrintResultToStatus(l, row.id, result);
    res.status(201).json(l.getPrint.get(info.lastInsertRowid));
  });

  app.delete('/api/library/prints/:id', (req, res) => {
    const changes = lib(req).deletePrint.run(Number(req.params.id)).changes;
    if (!changes) return res.status(404).json({ error: 'manual print not found' });
    res.status(204).end();
  });

  app.get('/api/library/matches', (req, res) => {
    res.json(lib(req).listSuggestions.all().map((p) => ({ ...p, materials: json(p.materials_json, []) })));
  });

  app.post('/api/library/matches/:id/confirm', (req, res) => {
    const l = lib(req);
    const job = l.getPrint.get(Number(req.params.id));
    if (!job || job.source !== 'shapepilot') return res.status(404).json({ error: 'print job not found' });
    const modelId = req.body?.model_id ?? job.model_id;
    if (!modelId || !l.getModel.get(modelId)) return res.status(400).json({ error: 'choose a model for this print' });
    l.setMatch.run(modelId, 'confirmed', job.match_score, job.id);
    applyPrintResultToStatus(l, modelId, job.result);
    res.json(l.getPrint.get(job.id));
  });

  app.post('/api/library/matches/:id/reject', (req, res) => {
    const l = lib(req);
    const job = l.getPrint.get(Number(req.params.id));
    if (!job || job.source !== 'shapepilot') return res.status(404).json({ error: 'print job not found' });
    l.setMatch.run(null, 'rejected', job.match_score, job.id);
    res.json(l.getPrint.get(job.id));
  });

  app.post('/api/library/print-history/sync', async (req, res) => {
    if (!isPrimaryUser(req)) return res.status(403).json({ error: 'Print history is only available to the workshop owner' });
    try {
      res.json(await importShapePilotJobs(lib(req), shapePilot));
    } catch (err) {
      res.status(Number.isInteger(err.status) ? err.status : 502).json({ error: err.message });
    }
  });

  app.get('/api/library/duplicates', (req, res) => {
    const l = lib(req);
    const groups = l.geomDuplicates.all().map((g) => ({ geom_hash: g.geom_hash, files: l.filesByGeom.all(g.geom_hash) }));
    res.json(groups);
  });

  app.get('/api/library/plan', (req, res) => {
    res.json(json(lib(req).getState.get('plan')?.value, null));
  });

  app.get('/api/library/devices', (req, res) => res.json(lib(req).listDevices.all()));

  app.post('/api/library/devices', (req, res) => {
    const name = text(req.body?.name, 80)?.trim() || 'Mac';
    const { token, hash } = newDeviceToken(req.user.userKey);
    const info = lib(req).insertDevice.run(name, hash);
    res.status(201).json({ id: info.lastInsertRowid, name, token });
  });

  app.delete('/api/library/devices/:id', (req, res) => {
    const changes = lib(req).revokeDevice.run(Number(req.params.id)).changes;
    if (!changes) return res.status(404).json({ error: 'device not found' });
    res.status(204).end();
  });
}
