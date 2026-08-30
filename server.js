import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname, resolve } from 'path';
import {
  createWriteStream,
  mkdirSync,
  unlinkSync,
  existsSync,
  renameSync,
  copyFileSync,
  readdirSync,
} from 'fs';
import { open as openFile, unlink as unlinkAsync } from 'fs/promises';
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {
  randomUUID,
  randomBytes,
  createHash,
  createSecretKey,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'crypto';
import multer from 'multer';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { jwtVerify, createLocalJWKSet, createRemoteJWKSet, importPKCS8, SignJWT } from 'jose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { fileTypeFromFile } from 'file-type';
import { createBackupBundle, resolveStorageConfig } from './recovery.js';
import { startOffhostExportSchedule } from './offhost-export.js';
import { loadDeploymentInfo } from './deployment-info.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PORT = process.env.PORT ?? 3006;
const deploymentInfo = loadDeploymentInfo({ appDir: __dirname });
const deploymentInstance = randomUUID();
const storageConfig = resolveStorageConfig(process.env, { appDir: __dirname });
const {
  dbPath: DB_PATH,
  uploadsPath: UPLOADS_PATH,
  usersDir: USERS_DIR,
  seedDbPath: SEED_DB_PATH,
  backupRoot: BACKUP_ROOT,
} = storageConfig;
const THINGIVERSE_APP_TOKEN = process.env.THINGIVERSE_APP_TOKEN || '';

mkdirSync(UPLOADS_PATH, { recursive: true });

// ── Database (per-user, isolated by identity key) ──────────────────────────────
//
// Each user gets their own SQLite file at USERS_DIR/<userKey>.db, created lazily
// on first request. There is no shared global connection — every request resolves
// its own { db, stmts } via getUserDb (see the auth middleware).

// The legacy single-user DB (DB_PATH) becomes the primary user's own workspace.
// Its snapshot backs demo mode only. ALLOWED_OID — formerly the single-user gate
// — now only identifies that primary user.
const PRIMARY_USER_OID = (process.env.ALLOWED_OID || '').toLowerCase();
const OID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Home-tenant Microsoft users keep their existing raw `oid` path. Every other
// tenant is namespaced as `<tid>_<oid>` so equal object IDs in different tenants
// cannot collide. Apple keys remain unchanged.
const APPLE_KEY_RE = /^apple_[0-9a-f]{64}$/;
const ENTRA_KEY_RE = new RegExp(
  `^(?:${OID_RE.source.slice(1, -1)}|${OID_RE.source.slice(1, -1)}_${OID_RE.source.slice(1, -1)})$`,
  'i'
);
const USER_KEY_RE  = new RegExp(`^(?:${ENTRA_KEY_RE.source.slice(1, -1)}|${APPLE_KEY_RE.source.slice(1, -1)})$`, 'i');
const appleUserKey = (sub) => `apple_${createHash('sha256').update(String(sub)).digest('hex')}`;

function initSchema(db, { acceptLegacySessionTokens = true } = {}) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    description     TEXT,
    source_url      TEXT,
    cut_plan_url    TEXT,
    status          TEXT NOT NULL DEFAULT 'idea',
    difficulty      TEXT NOT NULL DEFAULT 'Intermediate',
    estimated_hours INTEGER NOT NULL DEFAULT 0,
    wood_types      TEXT,
    tools_needed    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    image_data BLOB,
    image_type TEXT,
    image_url  TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_images_project ON project_images(project_id, kind, sort_order);

  CREATE TABLE IF NOT EXISTS cut_list_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    part_name  TEXT NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    length     TEXT,
    width      TEXT,
    thickness  TEXT,
    material   TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_cutlist_project ON cut_list_items(project_id, sort_order);

  CREATE TABLE IF NOT EXISTS materials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    qty_label  TEXT,
    cost       REAL NOT NULL DEFAULT 0,
    purchased  INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id, sort_order);

  CREATE TABLE IF NOT EXISTS build_log_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    note        TEXT NOT NULL,
    file_path   TEXT,
    image_type  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_buildlog_project ON build_log_entries(project_id, created_at);

  CREATE TABLE IF NOT EXISTS finish_log_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    finish_type  TEXT,
    color        TEXT,
    coats        INTEGER,
    notes        TEXT,
    applied_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_finishlog_project ON finish_log_entries(project_id);

  CREATE TABLE IF NOT EXISTS project_links (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    linked_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    relationship      TEXT NOT NULL DEFAULT 'related',
    UNIQUE(project_id, linked_project_id)
  );
`);

// Additive column migrations for existing DBs — keep idempotent.
const projectCols = new Set(db.prepare(`PRAGMA table_info(projects)`).all().map(c => c.name));
if (!projectCols.has('source_url')) {
  db.exec(`ALTER TABLE projects ADD COLUMN source_url TEXT`);
}
if (!projectCols.has('cut_plan_url')) {
  db.exec(`ALTER TABLE projects ADD COLUMN cut_plan_url TEXT`);
}

const imageCols = new Set(db.prepare(`PRAGMA table_info(project_images)`).all().map(c => c.name));
if (!imageCols.has('file_path')) {
  db.exec(`ALTER TABLE project_images ADD COLUMN file_path TEXT`);
}

if (!projectCols.has('cut_plan_config')) {
  db.exec(`ALTER TABLE projects ADD COLUMN cut_plan_config TEXT`);
}

if (!imageCols.has('shaper_project_id')) {
  db.exec(`ALTER TABLE project_images ADD COLUMN shaper_project_id INTEGER REFERENCES shaper_projects(id) ON DELETE CASCADE`);
}

const cutTableInfo = db.prepare(`PRAGMA table_info(cut_list_items)`).all();
const cutCols = new Set(cutTableInfo.map(c => c.name));
if (!cutCols.has('shaper_project_id')) {
  db.exec(`ALTER TABLE cut_list_items ADD COLUMN shaper_project_id INTEGER REFERENCES shaper_projects(id) ON DELETE CASCADE`);
}

// cut_list_items needs two adjustments:
//   - project_id must be nullable (rows can belong to a shaper_project instead)
//   - exactly one of project_id / shaper_project_id must be set (CHECK constraint)
// SQLite can't ALTER a column constraint, so detect and recreate when needed.
// Wrapped in try/finally so a failure restores PRAGMA foreign_keys = ON for the
// rest of the process lifetime.
const projectIdCol = cutTableInfo.find(c => c.name === 'project_id');
const cutTableSql  = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='cut_list_items'`).get()?.sql ?? '').toUpperCase();
const needsRecreate = (projectIdCol && projectIdCol.notnull === 1) || !cutTableSql.includes('CHECK');
if (needsRecreate) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE cut_list_items_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          shaper_project_id INTEGER REFERENCES shaper_projects(id) ON DELETE CASCADE,
          part_name         TEXT NOT NULL,
          qty               INTEGER NOT NULL DEFAULT 1,
          length            TEXT,
          width             TEXT,
          thickness         TEXT,
          material          TEXT,
          sort_order        INTEGER NOT NULL DEFAULT 0,
          CHECK ((project_id IS NULL) <> (shaper_project_id IS NULL))
        );
        INSERT INTO cut_list_items_new (id, project_id, shaper_project_id, part_name, qty, length, width, thickness, material, sort_order)
          SELECT id, project_id, shaper_project_id, part_name, qty, length, width, thickness, material, sort_order
          FROM cut_list_items;
        DROP TABLE cut_list_items;
        ALTER TABLE cut_list_items_new RENAME TO cut_list_items;
        CREATE INDEX IF NOT EXISTS idx_cutlist_project ON cut_list_items(project_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_cutlist_shaper  ON cut_list_items(shaper_project_id, sort_order);
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

if (!projectCols.has('is_template')) {
  db.exec(`ALTER TABLE projects ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0`);
}
if (!projectCols.has('template_name')) {
  db.exec(`ALTER TABLE projects ADD COLUMN template_name TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS shaper_projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL DEFAULT '',
    shaper_url   TEXT NOT NULL DEFAULT '',
    description  TEXT,
    photo_url    TEXT,
    materials    TEXT NOT NULL DEFAULT '[]',
    instructions TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bambu_projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL DEFAULT '',
    source_url      TEXT NOT NULL,
    source_site     TEXT NOT NULL,
    source_model_id TEXT,
    description     TEXT,
    creator_name    TEXT,
    license_name    TEXT,
    import_warnings TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bambu_assets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bambu_project_id INTEGER NOT NULL REFERENCES bambu_projects(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('image', 'model', 'file')),
    filename         TEXT NOT NULL,
    content_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes       INTEGER NOT NULL DEFAULT 0,
    original_url     TEXT NOT NULL,
    file_path        TEXT,
    source_key       TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_bambu_assets_project
    ON bambu_assets(bambu_project_id, kind, sort_order, id);

  CREATE TABLE IF NOT EXISTS provider_credentials (
    provider       TEXT PRIMARY KEY CHECK (provider IN ('thingiverse')),
    token_enc      TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notebook_pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT 'Untitled',
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notebook_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES notebook_pages(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    caption    TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_notebook_links_page ON notebook_links(page_id, sort_order);

  -- Single-row profile per user DB. Populated for Sign in with Apple users:
  -- Apple only sends the display name on the FIRST consent, so we persist it
  -- (and the email from the verified token) once and reuse it on later sign-ins
  -- and refreshes. Microsoft users get their name from the token client-side.
  CREATE TABLE IF NOT EXISTS user_profile (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    display_name TEXT,
    email        TEXT,
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  -- Workshop's Apple access/refresh JWTs are stateless, so bind them to a
  -- random generation stored inside the account DB. Deleting the DB revokes
  -- every issued token; recreating the account produces a different generation.
  CREATE TABLE IF NOT EXISTS auth_state (
    id                    INTEGER PRIMARY KEY CHECK (id = 1),
    session_generation    TEXT NOT NULL,
    accept_legacy_tokens  INTEGER NOT NULL DEFAULT 0
  );

  -- Apple's long-lived refresh token is encrypted before storage and used only
  -- to revoke the Sign in with Apple grant during account deletion.
  CREATE TABLE IF NOT EXISTS apple_credentials (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id             TEXT NOT NULL,
    refresh_token_enc     TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at            TEXT
  );

  -- Durable cleanup queue makes filesystem deletion restartable. References
  -- are nulled in the same transaction that enqueues each local filename.
  CREATE TABLE IF NOT EXISTS account_deletion_files (
    filename              TEXT PRIMARY KEY
  );
`);

const bambuProjectCols = new Set(
  db.prepare(`PRAGMA table_info(bambu_projects)`).all().map(column => column.name)
);
if (!bambuProjectCols.has('import_warnings')) {
  db.exec(`ALTER TABLE bambu_projects ADD COLUMN import_warnings TEXT NOT NULL DEFAULT '[]'`);
}
const bambuAssetCols = new Set(
  db.prepare(`PRAGMA table_info(bambu_assets)`).all().map(column => column.name)
);
if (!bambuAssetCols.has('source_key')) {
  db.exec(`ALTER TABLE bambu_assets ADD COLUMN source_key TEXT`);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bambu_assets_source_key
  ON bambu_assets(bambu_project_id, source_key)
  WHERE source_key IS NOT NULL
`);

db.prepare(`
  INSERT OR IGNORE INTO auth_state (id, session_generation, accept_legacy_tokens)
  VALUES (1, ?, ?)
`).run(randomUUID(), acceptLegacySessionTokens ? 1 : 0);
}

// ── Prepared statements ───────────────────────────────────────────────────────

function buildStmts(db) {
  return {
  listProjects: db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM cut_list_items c WHERE c.project_id = p.id) AS parts_count,
      (SELECT COALESCE(SUM(m.cost), 0) FROM materials m WHERE m.project_id = p.id) AS total_cost,
      (SELECT pi.id FROM project_images pi
        WHERE pi.project_id = p.id AND pi.kind = 'sketch'
          AND (pi.image_type IS NULL OR pi.image_type != 'application/pdf')
        ORDER BY pi.sort_order, pi.id LIMIT 1) AS hero_image_id,
      (SELECT GROUP_CONCAT(c.part_name, ' ') FROM cut_list_items c WHERE c.project_id = p.id) AS cut_list_names,
      (SELECT GROUP_CONCAT(m.name, ' ') FROM materials m WHERE m.project_id = p.id) AS material_names
    FROM projects p
    WHERE p.is_template = 0 OR p.is_template IS NULL
    ORDER BY p.updated_at DESC
  `),
  getProject: db.prepare(`SELECT * FROM projects WHERE id = ?`),
  insertProject: db.prepare(`
    INSERT INTO projects (title, description, source_url, cut_plan_url, status, difficulty, estimated_hours, wood_types, tools_needed)
    VALUES (@title, @description, @source_url, @cut_plan_url, @status, @difficulty, @estimated_hours, @wood_types, @tools_needed)
  `),
  updateProject: db.prepare(`
    UPDATE projects SET
      title           = @title,
      description     = @description,
      source_url      = @source_url,
      cut_plan_url    = @cut_plan_url,
      status          = @status,
      difficulty      = @difficulty,
      estimated_hours = @estimated_hours,
      wood_types      = @wood_types,
      tools_needed    = @tools_needed,
      updated_at      = datetime('now')
    WHERE id = @id
  `),
  deleteProject: db.prepare(`DELETE FROM projects WHERE id = ?`),

  listImages: db.prepare(`
    SELECT id, project_id, kind, image_type, image_url, sort_order
    FROM project_images WHERE project_id = ? ORDER BY kind, sort_order, id
  `),
  getImage: db.prepare(`SELECT image_data, image_type, file_path FROM project_images WHERE id = ?`),
  insertImage: db.prepare(`
    INSERT INTO project_images (project_id, kind, image_data, image_type, image_url, file_path, sort_order)
    VALUES (@project_id, @kind, @image_data, @image_type, @image_url, @file_path, @sort_order)
  `),
  deleteImage: db.prepare(`DELETE FROM project_images WHERE id = ?`),

  listCutList: db.prepare(`SELECT * FROM cut_list_items WHERE project_id = ? ORDER BY sort_order, id`),
  insertCutItem: db.prepare(`
    INSERT INTO cut_list_items (project_id, part_name, qty, length, width, thickness, material, sort_order)
    VALUES (@project_id, @part_name, @qty, @length, @width, @thickness, @material, @sort_order)
  `),
  updateCutItem: db.prepare(`
    UPDATE cut_list_items SET
      part_name = @part_name, qty = @qty, length = @length, width = @width,
      thickness = @thickness, material = @material, sort_order = @sort_order
    WHERE id = @id
  `),
  deleteCutItem: db.prepare(`DELETE FROM cut_list_items WHERE id = ?`),

  listMaterials: db.prepare(`SELECT * FROM materials WHERE project_id = ? ORDER BY sort_order, id`),
  insertMaterial: db.prepare(`
    INSERT INTO materials (project_id, name, qty_label, cost, purchased, sort_order)
    VALUES (@project_id, @name, @qty_label, @cost, @purchased, @sort_order)
  `),
  updateMaterial: db.prepare(`
    UPDATE materials SET name = @name, qty_label = @qty_label, cost = @cost,
      purchased = @purchased, sort_order = @sort_order
    WHERE id = @id
  `),
  deleteMaterial: db.prepare(`DELETE FROM materials WHERE id = ?`),

  listShaperProjects: db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM cut_list_items c WHERE c.shaper_project_id = s.id) AS part_count
    FROM shaper_projects s ORDER BY s.updated_at DESC`),
  getShaperProject:   db.prepare(`SELECT * FROM shaper_projects WHERE id = ?`),
  insertShaperProject: db.prepare(`
    INSERT INTO shaper_projects (title, shaper_url, description, photo_url, materials, instructions)
    VALUES (@title, @shaper_url, @description, @photo_url, @materials, @instructions)
  `),
  updateShaperProject: db.prepare(`
    UPDATE shaper_projects SET
      title        = @title,
      shaper_url   = @shaper_url,
      description  = @description,
      photo_url    = @photo_url,
      materials    = @materials,
      instructions = @instructions,
      updated_at   = datetime('now')
    WHERE id = @id
  `),
  deleteShaperProject: db.prepare(`DELETE FROM shaper_projects WHERE id = ?`),

  listShaperImages:    db.prepare(`SELECT * FROM project_images WHERE shaper_project_id = ? ORDER BY sort_order, id`),
  insertShaperImage:   db.prepare(`
    INSERT INTO project_images (shaper_project_id, kind, image_type, image_url, file_path, sort_order)
    VALUES (@shaper_project_id, @kind, @image_type, @image_url, @file_path, @sort_order)
  `),
  listShaperCutList:   db.prepare(`SELECT * FROM cut_list_items WHERE shaper_project_id = ? ORDER BY sort_order, id`),
  insertShaperCutItem: db.prepare(`
    INSERT INTO cut_list_items (shaper_project_id, part_name, qty, length, width, thickness, material, sort_order)
    VALUES (@shaper_project_id, @part_name, @qty, @length, @width, @thickness, @material, @sort_order)
  `),
  shaperHeroImage:     db.prepare(`
    SELECT id FROM project_images
    WHERE shaper_project_id = ? AND (image_type IS NULL OR image_type != 'application/pdf')
    ORDER BY sort_order, id LIMIT 1
  `),

  // ── Bambu Hub ────────────────────────────────────────────────────────────────
  listBambuProjects: db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM bambu_assets a
        WHERE a.bambu_project_id = b.id AND a.kind = 'image' AND a.file_path IS NOT NULL) AS image_count,
      (SELECT COUNT(*) FROM bambu_assets a
        WHERE a.bambu_project_id = b.id AND a.kind != 'image' AND a.file_path IS NOT NULL) AS file_count,
      (SELECT a.id FROM bambu_assets a
        WHERE a.bambu_project_id = b.id AND a.kind = 'image' AND a.file_path IS NOT NULL
        ORDER BY a.sort_order, a.id LIMIT 1) AS hero_asset_id
    FROM bambu_projects b
    ORDER BY b.updated_at DESC
  `),
  getBambuProject: db.prepare(`SELECT * FROM bambu_projects WHERE id = ?`),
  insertBambuProject: db.prepare(`
    INSERT INTO bambu_projects (
      title, source_url, source_site, source_model_id,
      description, creator_name, license_name
    ) VALUES (
      @title, @source_url, @source_site, @source_model_id,
      @description, @creator_name, @license_name
    )
  `),
  updateBambuProject: db.prepare(`
    UPDATE bambu_projects SET
      title = @title,
      source_url = @source_url,
      description = @description,
      creator_name = @creator_name,
      license_name = @license_name,
      updated_at = datetime('now')
    WHERE id = @id
  `),
  deleteBambuProject: db.prepare(`DELETE FROM bambu_projects WHERE id = ?`),
  touchBambuProject: db.prepare(`
    UPDATE bambu_projects SET updated_at = datetime('now') WHERE id = ?
  `),
  saveBambuImportWarnings: db.prepare(`
    UPDATE bambu_projects
    SET import_warnings = @warnings, updated_at = datetime('now')
    WHERE id = @id
  `),
  listBambuAssets: db.prepare(`
    SELECT id, bambu_project_id, kind, filename, content_type,
      size_bytes, original_url, sort_order
    FROM bambu_assets
    WHERE bambu_project_id = ? AND file_path IS NOT NULL
    ORDER BY sort_order, id
  `),
  getBambuAsset: db.prepare(`SELECT * FROM bambu_assets WHERE id = ?`),
  getBambuAssetBySourceKey: db.prepare(`
    SELECT id FROM bambu_assets
    WHERE bambu_project_id = ? AND source_key = ?
  `),
  deleteBambuAsset: db.prepare(`DELETE FROM bambu_assets WHERE id = ?`),
  bambuStorageUsage: db.prepare(`
    SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes
    FROM bambu_assets
    WHERE file_path IS NOT NULL
  `),
  bambuProjectStorageUsage: db.prepare(`
    SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes
    FROM bambu_assets
    WHERE bambu_project_id = ? AND file_path IS NOT NULL
  `),
  insertBambuAsset: db.prepare(`
    INSERT INTO bambu_assets (
      bambu_project_id, kind, filename, content_type,
      size_bytes, original_url, file_path, sort_order
    ) VALUES (
      @bambu_project_id, @kind, @filename, @content_type,
      @size_bytes, @original_url, @file_path, @sort_order
    )
  `),
  insertMakerWorldAsset: db.prepare(`
    INSERT INTO bambu_assets (
      bambu_project_id, kind, filename, content_type,
      size_bytes, original_url, file_path, source_key, sort_order
    ) VALUES (
      @bambu_project_id, @kind, @filename, @content_type,
      @size_bytes, @original_url, @file_path, @source_key, @sort_order
    )
  `),
  getProviderCredential: db.prepare(`
    SELECT provider, token_enc, created_at, updated_at
    FROM provider_credentials
    WHERE provider = ?
  `),
  upsertProviderCredential: db.prepare(`
    INSERT INTO provider_credentials (provider, token_enc)
    VALUES (@provider, @token_enc)
    ON CONFLICT(provider) DO UPDATE SET
      token_enc = excluded.token_enc,
      updated_at = datetime('now')
  `),
  deleteProviderCredential: db.prepare(`
    DELETE FROM provider_credentials WHERE provider = ?
  `),

  getCutPlanConfig:  db.prepare(`SELECT cut_plan_config FROM projects WHERE id = ?`),
  saveCutPlanConfig: db.prepare(`UPDATE projects SET cut_plan_config = @config WHERE id = @id`),

  // ── Build log ────────────────────────────────────────────────────────────────
  listBuildLog:        db.prepare(`SELECT * FROM build_log_entries WHERE project_id = ? ORDER BY created_at DESC`),
  insertBuildLogEntry: db.prepare(`INSERT INTO build_log_entries (project_id, note, file_path, image_type) VALUES (@project_id, @note, @file_path, @image_type)`),
  getBuildLogEntry:    db.prepare(`SELECT * FROM build_log_entries WHERE id = ?`),
  deleteBuildLogEntry: db.prepare(`DELETE FROM build_log_entries WHERE id = ?`),

  // ── Finish log ───────────────────────────────────────────────────────────────
  listFinishLog:        db.prepare(`SELECT * FROM finish_log_entries WHERE project_id = ? ORDER BY applied_at DESC`),
  insertFinishLogEntry: db.prepare(`INSERT INTO finish_log_entries (project_id, product_name, finish_type, color, coats, notes, applied_at) VALUES (@project_id, @product_name, @finish_type, @color, @coats, @notes, @applied_at)`),
  updateFinishLogEntry: db.prepare(`UPDATE finish_log_entries SET product_name = @product_name, finish_type = @finish_type, color = @color, coats = @coats, notes = @notes, applied_at = @applied_at WHERE id = @id`),
  deleteFinishLogEntry: db.prepare(`DELETE FROM finish_log_entries WHERE id = ?`),

  // ── Shopping list ────────────────────────────────────────────────────────────
  getShoppingList: db.prepare(`
    SELECT m.*, p.title AS project_title
    FROM materials m
    JOIN projects p ON p.id = m.project_id
    WHERE (p.is_template = 0 OR p.is_template IS NULL)
    ORDER BY p.title, m.sort_order, m.id
  `),
  setPurchased: db.prepare(`UPDATE materials SET purchased = @purchased WHERE id = @id`),

  // ── Project links ────────────────────────────────────────────────────────────
  listProjectLinks: db.prepare(`
    SELECT pl.id, pl.relationship, p.id AS linked_id, p.title AS linked_title, p.status AS linked_status
    FROM project_links pl JOIN projects p ON p.id = pl.linked_project_id WHERE pl.project_id = ?
    UNION
    SELECT pl.id, pl.relationship, p.id AS linked_id, p.title AS linked_title, p.status AS linked_status
    FROM project_links pl JOIN projects p ON p.id = pl.project_id WHERE pl.linked_project_id = ?
  `),
  insertProjectLink: db.prepare(`INSERT OR IGNORE INTO project_links (project_id, linked_project_id, relationship) VALUES (@project_id, @linked_project_id, @relationship)`),
  deleteProjectLink: db.prepare(`DELETE FROM project_links WHERE id = ?`),

  // ── Templates ────────────────────────────────────────────────────────────────
  listTemplates: db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM cut_list_items c WHERE c.project_id = p.id) AS parts_count,
      (SELECT pi.id FROM project_images pi WHERE pi.project_id = p.id AND pi.kind = 'sketch'
        AND (pi.image_type IS NULL OR pi.image_type != 'application/pdf')
       ORDER BY pi.sort_order, pi.id LIMIT 1) AS hero_image_id
    FROM projects p WHERE p.is_template = 1 ORDER BY COALESCE(p.template_name, p.title)
  `),
  setTemplate: db.prepare(`UPDATE projects SET is_template = 1, template_name = @template_name WHERE id = @id`),

  // ── Notebook ──────────────────────────────────────────────────────────────────
  listNotebookPages:  db.prepare(`SELECT id, title, substr(body,1,200) AS body_preview, created_at, updated_at FROM notebook_pages ORDER BY updated_at DESC`),
  getNotebookPage:    db.prepare(`SELECT * FROM notebook_pages WHERE id = ?`),
  insertNotebookPage: db.prepare(`INSERT INTO notebook_pages (title, body) VALUES (@title, @body)`),
  updateNotebookPage: db.prepare(`UPDATE notebook_pages SET title = @title, body = @body, updated_at = datetime('now') WHERE id = @id`),
  deleteNotebookPage: db.prepare(`DELETE FROM notebook_pages WHERE id = ?`),
  listNotebookLinks:  db.prepare(`SELECT * FROM notebook_links WHERE page_id = ? ORDER BY sort_order, id`),
  insertNotebookLink: db.prepare(`INSERT INTO notebook_links (page_id, url, caption, sort_order) VALUES (@page_id, @url, @caption, @sort_order)`),
  deleteNotebookLink: db.prepare(`DELETE FROM notebook_links WHERE id = ?`),
  notebookLinkCount:  db.prepare(`SELECT COUNT(*) AS n FROM notebook_links WHERE page_id = ?`),

  // ── Account auth state ────────────────────────────────────────────────────────
  getAuthState:          db.prepare(`SELECT session_generation, accept_legacy_tokens FROM auth_state WHERE id = 1`),
  disableLegacySessions: db.prepare(`UPDATE auth_state SET accept_legacy_tokens = 0 WHERE id = 1`),
  countAppleCredentials: db.prepare(`SELECT COUNT(*) AS count FROM apple_credentials`),
  listAppleCredentials:  db.prepare(`
    SELECT id, client_id, refresh_token_enc
    FROM apple_credentials
    WHERE revoked_at IS NULL
    ORDER BY id
  `),
  insertAppleCredential: db.prepare(`
    INSERT INTO apple_credentials (client_id, refresh_token_enc)
    VALUES (@client_id, @refresh_token_enc)
  `),
  markAppleCredentialRevoked: db.prepare(`
    UPDATE apple_credentials SET revoked_at = datetime('now') WHERE id = ?
  `),

  // Reject the reverse direction of a pair (B→A when A→B already exists) so the
  // UNION-based link listing doesn't double-count an unordered pair.
  reverseLinkExists:  db.prepare(`SELECT 1 FROM project_links WHERE project_id = ? AND linked_project_id = ?`),
  };
}

// ── Per-user DB resolution + seeding ──────────────────────────────────────────

const dbHandles = new Map();   // user key → { db, stmts }
const activeUserRequests = new Map();
const deletingUserKeys = new Set();
const bambuRequestLocks = new Map();
const makerWorldBridgeJobs = new Map();
let accountDeletionLock = Promise.resolve();
let activeStorageRequests = 0;
let recoveryCaptureActive = false;
let recoveryBackupPromise = null;
let recoveryInitialTimer = null;
let recoveryIntervalTimer = null;
let offhostExportSchedule = null;
let offhostExporterFallbackHealth = 'not_started';

const userDbPath = (userKey) => join(USERS_DIR, `${userKey}.db`);

function openDb(path) {
  const existed = existsSync(path);
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  initSchema(database, { acceptLegacySessionTokens: existed });
  return database;
}

function openUserDb(userKey) {
  const db = openDb(userDbPath(userKey));
  const entry = { db, stmts: buildStmts(db) };
  dbHandles.set(userKey, entry);
  return entry;
}

// Build the starter snapshot once, from the legacy single-user DB, BEFORE that
// file is claimed by the primary user (getUserDb renames it away). This captures
// the real current data as the seed for every new user and for demo mode.
function ensureSeedTemplate() {
  if (existsSync(SEED_DB_PATH) || !existsSync(DB_PATH)) return;
  try {
    const legacy = new Database(DB_PATH);
    legacy.pragma('wal_checkpoint(TRUNCATE)');
    legacy.close();
    copyFileSync(DB_PATH, SEED_DB_PATH);
    console.log(`[seed] created starter snapshot → ${SEED_DB_PATH}`);
  } catch (err) {
    console.error('[seed] failed to build seed template:', err.message);
  }
}

mkdirSync(USERS_DIR, { recursive: true });
ensureSeedTemplate();

function getUserDb(userKey) {
  const cached = dbHandles.get(userKey);
  if (cached) return cached;
  if (!USER_KEY_RE.test(userKey)) throw new Error('invalid user key');

  const target = userDbPath(userKey);

  if (!existsSync(target)) {
    if (PRIMARY_USER_OID && userKey === PRIMARY_USER_OID && existsSync(DB_PATH)) {
      // Primary user (Enzo) inherits the legacy DB as their own workspace.
      renameSync(DB_PATH, target);
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(DB_PATH + ext)) { try { renameSync(DB_PATH + ext, target + ext); } catch { /* tolerated */ } }
      }
      console.log(`[migrate] moved legacy DB → ${target}`);
    }
    // Everyone else starts EMPTY: openDb() creates the file and initSchema()
    // builds a blank schema. We deliberately do NOT seed from SEED_DB_PATH here —
    // that snapshot is the primary user's real data and must not be handed to
    // other accounts once Apple sign-in opens the app to any Apple ID. The seed
    // snapshot still backs demo mode only (getDemoDb).
  }

  return openUserDb(userKey);
}

function getExistingUserDb(userKey) {
  if (!USER_KEY_RE.test(userKey)) throw new Error('invalid user key');
  const target = userDbPath(userKey);
  const cached = dbHandles.get(userKey);
  if (!existsSync(target)) {
    if (cached) {
      if (cached.db.open) cached.db.close();
      dbHandles.delete(userKey);
    }
    return null;
  }
  if (cached) return cached;
  return openUserDb(userKey);
}

async function acquireBambuLock(userKey) {
  const previous = bambuRequestLocks.get(userKey) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolveLock => { release = resolveLock; });
  const tail = previous.then(() => gate);
  bambuRequestLocks.set(userKey, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (bambuRequestLocks.get(userKey) === tail) bambuRequestLocks.delete(userKey);
  };
}

function serializeBambuRequest(req, res, next) {
  const userKey = req.user?.userKey;
  if (!userKey) return next();

  acquireBambuLock(userKey).then(release => {
    if (res.destroyed) {
      release();
      return;
    }
    const done = () => {
      release();
    };
    res.once('finish', done);
    res.once('close', done);
    next();
  }).catch(next);
}

// Demo mode reads the shared starter snapshot; writes are blocked upstream.
let demoEntry = null;
function getDemoDb() {
  if (demoEntry) return demoEntry;
  if (!existsSync(SEED_DB_PATH)) return null;
  const db = openDb(SEED_DB_PATH);
  demoEntry = { db, stmts: buildStmts(db) };
  return demoEntry;
}

// Auth-exempt image routes have no token: pick the user DB named by ?userKey=
// (`?oid=` remains a legacy alias), else fall back to the demo snapshot.
function resolveReadDb(req) {
  const userKey = String(req.query.userKey ?? req.query.oid ?? '');
  if (USER_KEY_RE.test(userKey) && !deletingUserKeys.has(userKey)) {
    try { return getExistingUserDb(userKey) ?? getDemoDb(); }
    catch { return getDemoDb(); }
  }
  return getDemoDb();
}

function collectAccountUploadReferences(db) {
  const tables = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(row => row.name)
  );
  const references = [];
  const hasFilePathColumn = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'file_path');
  const addRows = (table, rows) => {
    for (const row of rows) {
      if (typeof row.file_path === 'string' && row.file_path) {
        references.push({
          table,
          filePath: row.file_path,
          filename: basename(row.file_path),
        });
      }
    }
  };

  if (tables.has('project_images') && hasFilePathColumn('project_images')) {
    addRows(
      'project_images',
      db.prepare(`SELECT file_path FROM project_images WHERE file_path IS NOT NULL ORDER BY id`).all()
    );
  }
  if (tables.has('build_log_entries') && hasFilePathColumn('build_log_entries')) {
    addRows(
      'build_log_entries',
      db.prepare(`SELECT file_path FROM build_log_entries WHERE file_path IS NOT NULL ORDER BY id`).all()
    );
  }
  if (tables.has('bambu_assets') && hasFilePathColumn('bambu_assets')) {
    addRows(
      'bambu_assets',
      db.prepare(`SELECT file_path FROM bambu_assets WHERE file_path IS NOT NULL ORDER BY id`).all()
    );
  }
  return references;
}

function collectReferencedUploadNames(db) {
  return new Set(collectAccountUploadReferences(db).map(reference => reference.filename));
}

function otherDatabasePaths(targetPath) {
  const candidates = [
    ...readdirSync(USERS_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.db'))
      .map(entry => join(USERS_DIR, entry.name)),
    DB_PATH,
    SEED_DB_PATH,
  ];
  const target = resolve(targetPath);
  return [...new Set(candidates.map(path => resolve(path)))]
    .filter(path => path !== target && existsSync(path));
}

function collectUnsharedAccountFiles(db, targetPath) {
  const references = collectAccountUploadReferences(db);
  const owned = new Set(references.map(reference => reference.filename));
  if (owned.size === 0) return { filenames: [], references: [] };

  const referencedElsewhere = new Set();
  for (const path of otherDatabasePaths(targetPath)) {
    const other = new Database(path, { readonly: true, fileMustExist: true });
    try {
      for (const filename of collectReferencedUploadNames(other)) {
        if (owned.has(filename)) referencedElsewhere.add(filename);
      }
    } finally {
      other.close();
    }
  }
  const filenames = [...owned].filter(filename => !referencedElsewhere.has(filename));
  const removable = new Set(filenames);
  return {
    filenames,
    references: references.filter(reference => removable.has(reference.filename)),
  };
}

async function unlinkIfPresent(path) {
  try {
    await unlinkAsync(path);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

function unlinkSyncIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

async function deleteAccountData(userKey) {
  if (!USER_KEY_RE.test(userKey)) throw new Error('invalid user key');
  const target = userDbPath(userKey);
  const entry = getExistingUserDb(userKey);
  if (!entry) return;

  // Uploaded filenames are globally unique today, but older seeded workspaces
  // can share references. Never unlink a file another DB or the demo seed uses.
  const cleanup = collectUnsharedAccountFiles(entry.db, target);
  entry.db.transaction(() => {
    const enqueue = entry.db.prepare(`
      INSERT OR IGNORE INTO account_deletion_files (filename) VALUES (?)
    `);
    const clearProjectImage = entry.db.prepare(`
      UPDATE project_images SET file_path = NULL WHERE file_path = ?
    `);
    const clearBuildLogImage = entry.db.prepare(`
      UPDATE build_log_entries SET file_path = NULL WHERE file_path = ?
    `);
    const clearBambuAsset = entry.db.prepare(`
      UPDATE bambu_assets SET file_path = NULL WHERE file_path = ?
    `);

    for (const filename of cleanup.filenames) enqueue.run(filename);
    for (const reference of cleanup.references) {
      const clear = reference.table === 'project_images'
        ? clearProjectImage
        : reference.table === 'build_log_entries'
          ? clearBuildLogImage
          : clearBambuAsset;
      clear.run(reference.filePath);
    }
  })();

  const pendingFiles = entry.db.prepare(`
    SELECT filename FROM account_deletion_files ORDER BY filename
  `).all();
  const markRemoved = entry.db.prepare(`
    DELETE FROM account_deletion_files WHERE filename = ?
  `);
  for (const { filename } of pendingFiles) {
    await unlinkIfPresent(join(UPLOADS_PATH, filename));
    markRemoved.run(filename);
  }

  // Removing the whole isolated DB purges every current and future table in one
  // operation, including BLOB images, profile data, and the token generation.
  entry.db.pragma('wal_checkpoint(TRUNCATE)');
  entry.db.close();
  dbHandles.delete(userKey);

  for (const suffix of ['-wal', '-shm', '-journal']) {
    unlinkSyncIfPresent(target + suffix);
  }
  unlinkSyncIfPresent(target);
}

async function waitForActiveUserRequests(userKey, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while ((activeUserRequests.get(userKey) ?? 0) > 0 && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 25));
  }
  if ((activeUserRequests.get(userKey) ?? 0) > 0) {
    const error = new Error('account still has active requests');
    error.status = 409;
    throw error;
  }
}

function beginActiveStorageOperation() {
  activeStorageRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeStorageRequests = Math.max(0, activeStorageRequests - 1);
  };
}

function trackActiveStorageRequest(res) {
  const release = beginActiveStorageOperation();
  res.once('finish', release);
  res.once('close', release);
}

function recoveryStorageGate(req, res, next) {
  if (req.path === '/health' || req.path === '/live') return next();
  if (recoveryCaptureActive) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ error: 'recovery_backup_in_progress' });
  }
  trackActiveStorageRequest(res);
  return next();
}

async function waitForStorageQuiescence(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (activeStorageRequests > 0 && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 25));
  }
  if (activeStorageRequests > 0) {
    throw new Error(`timed out waiting for ${activeStorageRequests} active storage request(s)`);
  }
}

function requestOffhostExportAfterBackup() {
  return offhostExportSchedule?.runAfterBackup()
    ?? Promise.resolve({ status: 'unavailable', trigger: 'backup' });
}

function runRecoveryBackup({ onVerified = requestOffhostExportAfterBackup } = {}) {
  if (recoveryBackupPromise) return recoveryBackupPromise;
  if (typeof onVerified !== 'function') {
    throw new TypeError('onVerified must be a function');
  }

  const run = (async () => {
    recoveryCaptureActive = true;
    try {
      await waitForStorageQuiescence(storageConfig.backupQuiesceTimeoutMs);
      return await createBackupBundle({
        dbPath: DB_PATH,
        seedDbPath: SEED_DB_PATH,
        usersDir: USERS_DIR,
        uploadsPath: UPLOADS_PATH,
        backupRoot: BACKUP_ROOT,
        retentionCount: storageConfig.backupRetentionCount,
        lockStaleMs: storageConfig.backupLockStaleMs,
      });
    } finally {
      recoveryCaptureActive = false;
    }
  })();
  recoveryBackupPromise = run;
  void run.finally(() => {
    if (recoveryBackupPromise === run) recoveryBackupPromise = null;
  }).catch(() => {});
  void run.then(result => onVerified(result)).catch(() => {});
  return run;
}

function startRecoverySchedule() {
  if (storageConfig.backupIntervalHours <= 0 || recoveryInitialTimer || recoveryIntervalTimer) {
    return;
  }
  const intervalMs = storageConfig.backupIntervalHours * 60 * 60 * 1_000;
  const initialDelayMs = storageConfig.backupInitialDelayMinutes * 60 * 1_000;
  const triggerBackup = () => {
    void runRecoveryBackup()
      .then(result => {
        console.log(
          `[recovery] verified ${result.manifest.bundleId} `
          + `(${result.manifest.databases.length} DBs, ${result.manifest.uploads.fileCount} uploads)`,
        );
      })
      .catch(error => console.error('[recovery] backup failed:', error.message));
  };

  recoveryInitialTimer = setTimeout(() => {
    recoveryInitialTimer = null;
    triggerBackup();
    recoveryIntervalTimer = setInterval(triggerBackup, intervalMs);
    recoveryIntervalTimer.unref();
  }, initialDelayMs);
  recoveryInitialTimer.unref();
}

function stopRecoverySchedule() {
  if (recoveryInitialTimer) clearTimeout(recoveryInitialTimer);
  if (recoveryIntervalTimer) clearInterval(recoveryIntervalTimer);
  recoveryInitialTimer = null;
  recoveryIntervalTimer = null;
}

function startOffhostSchedule() {
  if (offhostExportSchedule) return;
  offhostExporterFallbackHealth = 'starting';
  try {
    offhostExportSchedule = startOffhostExportSchedule({
      backupRoot: BACKUP_ROOT,
      appDir: __dirname,
    });
  } catch (error) {
    offhostExporterFallbackHealth = 'error';
    console.error(JSON.stringify({
      component: 'offhost-backup',
      event: 'schedule_start_failed',
      code: typeof error?.code === 'string' ? error.code : 'OFFHOST_EXPORT_FAILED',
    }));
  }
}

function stopOffhostSchedule() {
  offhostExportSchedule?.stop();
  offhostExportSchedule = null;
  offhostExporterFallbackHealth = 'stopped';
}

async function serializeAccountDeletion(operation) {
  const previous = accountDeletionLock;
  let release;
  accountDeletionLock = new Promise(resolveLock => { release = resolveLock; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toJsonArray = (v) => {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string' && v.trim()) {
    return JSON.stringify(v.split(',').map(s => s.trim()).filter(Boolean));
  }
  return JSON.stringify([]);
};

const parseJsonArray = (s) => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
};

const hydrateProject = (p) => p && ({
  ...p,
  wood_types: parseJsonArray(p.wood_types),
  tools_needed: parseJsonArray(p.tools_needed),
});

// Extract Next.js SSR data embedded as __NEXT_DATA__ JSON — present in most Next.js pages.
const extractNextData = (html) => {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

// Extract all JSON-LD blocks (schema.org structured data).
const extractJsonLd = (html) => {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return results;
};


// ── File upload (multer — disk storage) ──────────────────────────────────────

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_PATH),
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extensionForStoredAsset(file.originalname)}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const bambuUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 250 * 1024 * 1024, files: 1 },
});

function receiveBambuUpload(req, res, next) {
  bambuUpload.single('file')(req, res, error => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 413
      : 400;
    return res.status(status).json({
      error: status === 413
        ? 'File exceeds the 250 MB upload limit'
        : 'Workshop could not read that uploaded file',
    });
  });
}

// Server-side MIME sniffing. The client-supplied req.file.mimetype is not
// trustworthy — an HTML file uploaded as image/jpeg would otherwise be served
// back as image/jpeg from our origin (still safe), but worse, anything we
// echoed as text/html could host stored XSS. Sniff magic bytes instead.
const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'image/heif', 'image/avif', 'image/bmp', 'image/tiff',
  'application/pdf',
]);

async function sniffMimeOrReject(filePath) {
  const detected = await fileTypeFromFile(filePath);
  if (!detected || !ALLOWED_UPLOAD_MIMES.has(detected.mime)) {
    await unlinkAsync(filePath).catch(() => {});
    const e = new Error('Unsupported file type — only images and PDFs are accepted');
    e.status = 400;
    throw e;
  }
  return detected.mime;
}

// ── SSRF-safe outbound fetch ─────────────────────────────────────────────────
//
// analyze-url endpoints take a URL from the user and fetch it server-side.
// Without guardrails an attacker (or a confused user) could point them at
// cloud metadata endpoints (169.254.169.254), localhost, RFC1918 hosts, or
// long-tail content that exhausts memory. Block private addresses both
// before the initial connect AND on the final URL after redirects.

function isPrivateOrReservedIp(ip) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') ||
    v6.startsWith('fe80:') || v6.startsWith('::ffff:127.') ||
    v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:169.254.') ||
    v6.startsWith('::ffff:172.') || v6.startsWith('::ffff:192.168.')
  );
}

async function assertHostIsPublic(hostname) {
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error('private/internal address blocked');
    return;
  }
  const { address } = await dnsLookup(hostname);
  if (isPrivateOrReservedIp(address)) throw new Error('private/internal address blocked');
}

const FETCH_TIMEOUT_MS    = 15_000;
const MAX_RESPONSE_BYTES  = 5 * 1024 * 1024;

async function safeFetchHtml(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('invalid url'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http and https URLs are allowed');
  }
  await assertHostIsPublic(parsed.hostname);

  const resp = await fetch(rawUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Workshop AI Analyzer)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // Re-validate after redirects: resp.url is the final URL.
  const finalUrl = new URL(resp.url || rawUrl);
  if (finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') {
    throw new Error('redirect to disallowed scheme');
  }
  await assertHostIsPublic(finalUrl.hostname);

  if (!resp.ok) throw new Error(`fetch failed with status ${resp.status}`);

  // Stream and cap.
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ── Anthropic client (lazy, optional) ─────────────────────────────────────────

let _anthropic = null;
const getAnthropic = () => {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
};

// Extract og/twitter meta tags directly from HTML — more reliable than AI for SPAs.
const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
  .replace(/&amp;/g,  '&').replace(/&lt;/g,   '<').replace(/&gt;/g,  '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const extractOgMeta = (html) => {
  const tag = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*?)["']`, 'i'))
           ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
    const v = m?.[1]?.trim() ?? null;
    return v ? decodeEntities(v) : null;
  };
  return {
    title:       tag('og:title')       || tag('twitter:title'),
    description: tag('og:description') || tag('twitter:description'),
    image:       tag('og:image')       || tag('twitter:image:src') || tag('twitter:image'),
  };
};

// Strip HTML to plain text and clip to a token-friendly size for Claude.
const htmlToPlainText = (html) => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ── Bambu Hub provider import ─────────────────────────────────────────────────

const BAMBU_IMPORT_USER_AGENT = 'Workshop/0.1 (+https://github.com/EnzoLopez2023/workshop)';
const BAMBU_MAX_JSON_BYTES = 10 * 1024 * 1024;
const BAMBU_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const BAMBU_MAX_FILE_BYTES = 250 * 1024 * 1024;
const BAMBU_MAX_PROJECT_BYTES = 1024 * 1024 * 1024;
const BAMBU_MAX_USER_BYTES = 5 * 1024 * 1024 * 1024;
const BAMBU_MAX_REDIRECTS = 5;
const BAMBU_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAKERWORLD_BRIDGE_JOB_TTL_MS = 10 * 60 * 1000;
const MAKERWORLD_BRIDGE_PROCESS_TTL_MS = 6 * 60 * 60 * 1000;
const MAKERWORLD_BRIDGE_MAX_ASSETS = 150;
const MAKERWORLD_BRIDGE_MAX_JOBS = 100;

const MAKERWORLD_API_HOSTS = ['api.bambulab.com'];
const MAKERWORLD_ASSET_HOSTS = ['.bblmw.com'];
const PRINTABLES_API_HOSTS = ['api.printables.com'];
const PRINTABLES_IMAGE_HOSTS = ['media.printables.com'];
const PRINTABLES_FILE_HOSTS = ['files.printables.com'];
const THINGIVERSE_PAGE_HOSTS = ['www.thingiverse.com'];
const THINGIVERSE_API_HOSTS = ['api.thingiverse.com'];
const THINGIVERSE_ASSET_HOSTS = [
  '.thingiverse.com',
  'thingiverse-production-new.s3.amazonaws.com',
];

const BAMBU_MODEL_EXTENSIONS = new Set([
  '.3mf', '.amf', '.blend', '.dwg', '.dxf', '.f3d', '.fbx', '.gcode',
  '.iges', '.igs', '.obj', '.ply', '.scad', '.step', '.stl', '.stp',
]);

function hostMatchesAllowlist(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some(pattern =>
    pattern.startsWith('.')
      ? host.endsWith(pattern) && host.length > pattern.length
      : host === pattern
  );
}

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanImportedText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return htmlToPlainText(value).replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function safeDecodeURIComponent(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function sanitizeAssetFilename(value, fallback = 'download') {
  const decoded = safeDecodeURIComponent(String(value || ''));
  const leaf = decoded.split(/[\\/]/).pop() ?? '';
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 180) return cleaned;
  const extension = extname(cleaned).slice(0, 16);
  return `${cleaned.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function filenameFromUrl(rawUrl, fallback) {
  try {
    const leaf = new URL(rawUrl).pathname.split('/').pop();
    return sanitizeAssetFilename(leaf, fallback);
  } catch {
    return fallback;
  }
}

function bambuAssetKind(filename, fallback = 'file') {
  const extension = extname(filename).toLowerCase();
  return BAMBU_MODEL_EXTENSIONS.has(extension) ? 'model' : fallback;
}

function parseBambuSourceUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw apiError('Enter a valid model URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw apiError('Only HTTP and HTTPS model URLs are supported.');
  }
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) {
    throw apiError('Model URLs cannot contain credentials or custom ports.');
  }
  url.protocol = 'https:';
  url.port = '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'makerworld.com') {
    const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)(?:-[^/]*)?\/?$/i);
    if (!match) throw apiError('Enter a MakerWorld model URL.');
    const profileMatch = url.hash.match(/profileId[-=](\d+)/i);
    url.hostname = 'makerworld.com';
    return {
      site: 'makerworld',
      modelId: match[1],
      profileId: profileMatch?.[1] ?? null,
      sourceUrl: url.href,
    };
  }

  if (host === 'printables.com') {
    const match = url.pathname.match(/^\/model\/(\d+)(?:-[^/]*)?(?:\/files)?\/?$/i);
    if (!match) throw apiError('Enter a Printables model URL.');
    url.hostname = 'www.printables.com';
    url.pathname = url.pathname.replace(/\/files\/?$/i, '').replace(/\/$/, '');
    url.hash = '';
    url.search = '';
    return { site: 'printables', modelId: match[1], profileId: null, sourceUrl: url.href };
  }

  if (host === 'thingiverse.com') {
    const match = url.pathname.match(/^\/thing:(\d+)(?:\/files)?\/?$/i);
    if (!match) throw apiError('Enter a Thingiverse thing URL.');
    return {
      site: 'thingiverse',
      modelId: match[1],
      profileId: null,
      sourceUrl: `https://www.thingiverse.com/thing:${match[1]}`,
    };
  }

  throw apiError('Use a MakerWorld, Thingiverse, or Printables model URL.');
}

async function openPublicResponse(rawUrl, options = {}, redirectCount = 0) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('invalid asset url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('disallowed asset url');
  }
  if (!Array.isArray(options.allowedHosts) || !hostMatchesAllowlist(url.hostname, options.allowedHosts)) {
    throw new Error('provider redirected to an untrusted host');
  }
  await assertHostIsPublic(url.hostname);

  const headers = new Headers(options.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', BAMBU_IMPORT_USER_AGENT);
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= BAMBU_MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new Error('too many redirects');
    }
    const location = response.headers.get('location');
    if (!location) {
      await response.body?.cancel();
      throw new Error('redirect missing location');
    }
    const nextUrl = new URL(location, url);
    const nextHeaders = new Headers(headers);
    if (nextUrl.origin !== url.origin) {
      nextHeaders.delete('Authorization');
      nextHeaders.delete('Cookie');
    }
    const switchToGet = response.status === 303
      || ((response.status === 301 || response.status === 302) && options.method === 'POST');
    await response.body?.cancel();
    return openPublicResponse(nextUrl.href, {
      ...options,
      method: switchToGet ? 'GET' : options.method,
      body: switchToGet ? undefined : options.body,
      headers: nextHeaders,
    }, redirectCount + 1);
  }
  return response;
}

async function readResponseBuffer(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body.cancel();
    throw new Error('response too large');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchPublicJson(rawUrl, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await openPublicResponse(rawUrl, { ...options, headers });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`provider returned ${response.status}`);
  }
  const buffer = await readResponseBuffer(response, BAMBU_MAX_JSON_BYTES);
  try { return JSON.parse(buffer.toString('utf8')); }
  catch { throw new Error('provider returned invalid JSON'); }
}

async function fetchPublicText(rawUrl, allowedHosts) {
  const response = await openPublicResponse(rawUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    allowedHosts,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`provider returned ${response.status}`);
  }
  return (await readResponseBuffer(response, MAX_RESPONSE_BYTES)).toString('utf8');
}

function collectHtmlImages(html, baseUrl) {
  if (typeof html !== 'string') return [];
  const urls = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl);
      if (['http:', 'https:'].includes(url.protocol)) urls.push(url.href);
    } catch { /* skip malformed image URLs */ }
  }
  return urls;
}

function dedupeDownloadAssets(assets) {
  const seen = new Set();
  return assets.filter(asset => {
    const key = asset.downloadUrl
      ? `url:${asset.downloadUrl}`
      : `missing:${asset.providerKey ?? asset.filename}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function flattenMakerWorldFiles(entries, result = []) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (Array.isArray(entry?.children) && entry.children.length > 0) {
      flattenMakerWorldFiles(entry.children, result);
      continue;
    }
    const filename = sanitizeAssetFilename(entry?.modelName || entry?.modelFileName, 'MakerWorld file');
    result.push({
      kind: bambuAssetKind(filename),
      filename,
      declaredSize: Number(entry?.modelSize) || null,
      downloadUrl: typeof entry?.modelUrl === 'string' && entry.modelUrl.startsWith('http')
        ? entry.modelUrl
        : null,
      originalUrl: typeof entry?.modelUrl === 'string' && entry.modelUrl.startsWith('http')
        ? entry.modelUrl
        : null,
      providerKey: `makerworld-file:${entry?.unikey || filename}`,
      allowedHosts: MAKERWORLD_ASSET_HOSTS,
    });
  }
  return result;
}

async function inspectMakerWorld(source) {
  const design = await fetchPublicJson(
    `https://api.bambulab.com/v1/design-service/design/${source.modelId}`,
    { allowedHosts: MAKERWORLD_API_HOSTS }
  );
  if (!design || String(design.id) !== source.modelId) {
    throw apiError('MakerWorld did not return that model.', 502);
  }

  const imageCandidates = [];
  let skippedExternalImages = 0;
  const addImage = (url, filename) => {
    if (typeof url !== 'string' || !url.startsWith('http')) return;
    try {
      if (!hostMatchesAllowlist(new URL(url).hostname, MAKERWORLD_ASSET_HOSTS)) {
        skippedExternalImages += 1;
        return;
      }
    } catch {
      return;
    }
    imageCandidates.push({
      kind: 'image',
      filename: sanitizeAssetFilename(filename || filenameFromUrl(url, 'MakerWorld image')),
      downloadUrl: url,
      originalUrl: url,
      declaredSize: null,
      allowedHosts: MAKERWORLD_ASSET_HOSTS,
    });
  };

  addImage(design.coverUrl, 'cover' + (extname(filenameFromUrl(design.coverUrl, '')) || '.jpg'));
  for (const image of design.designExtension?.design_pictures ?? []) addImage(image?.url, image?.name);
  for (const url of collectHtmlImages(design.summary, source.sourceUrl)) addImage(url);

  for (const instance of design.instances ?? []) {
    addImage(instance?.cover);
    for (const image of instance?.pictures ?? []) addImage(image?.url, image?.name);
    const modelInfo = instance?.extention?.modelInfo;
    for (const plate of modelInfo?.plates ?? []) {
      addImage(plate?.thumbnail?.url, plate?.thumbnail?.name);
      addImage(plate?.top_picture?.url, plate?.top_picture?.name);
      addImage(plate?.pick_picture?.url, plate?.pick_picture?.name);
    }
    for (const auxiliary of [
      ...(modelInfo?.auxiliaryPictures ?? []),
      ...(modelInfo?.auxiliaryGuide ?? []),
      ...(modelInfo?.auxiliaryOther ?? []),
    ]) {
      addImage(auxiliary?.url, auxiliary?.name);
    }
  }

  const files = flattenMakerWorldFiles(design.designExtension?.model_files);
  for (const instance of design.instances ?? []) {
    const filename = `${sanitizeAssetFilename(instance?.title, `Print profile ${instance?.id}`)}.3mf`;
    files.push({
      kind: 'model',
      filename,
      declaredSize: null,
      downloadUrl: null,
      originalUrl: null,
      providerKey: `makerworld-instance:${instance?.id}`,
      allowedHosts: MAKERWORLD_ASSET_HOSTS,
    });
  }

  const missingFiles = files.filter(file => !file.downloadUrl).map(file => file.filename);
  const warnings = missingFiles.length > 0
    ? [`MakerWorld requires sign-in to download ${missingFiles.length} original file${missingFiles.length === 1 ? '' : 's'}: ${missingFiles.join(', ')}. Images were imported; download the originals from MakerWorld, then use Add files in this project.`]
    : [];
  if (skippedExternalImages > 0) {
    warnings.push(`Skipped ${skippedExternalImages} image${skippedExternalImages === 1 ? '' : 's'} hosted outside MakerWorld's media service.`);
  }

  return {
    sourceSite: 'makerworld',
    sourceModelId: source.modelId,
    sourceUrl: source.sourceUrl,
    title: cleanImportedText(design.title, 300) || `MakerWorld model ${source.modelId}`,
    description: cleanImportedText(design.summary, 50_000),
    creatorName: cleanImportedText(design.designCreator?.name || design.designCreator?.handle, 300) || null,
    licenseName: cleanImportedText(design.license, 300) || null,
    images: dedupeDownloadAssets(imageCandidates),
    files: dedupeDownloadAssets(files),
    warnings,
  };
}

const PRINTABLES_MODEL_QUERY = `
  query ModelDetail($id: ID!) {
    model: print(id: $id) {
      id name slug description
      user { handle publicUsername }
      license { name }
      image { filePath }
      images { filePath }
      stls { id name fileSize }
      gcodes { id name fileSize }
      slas { id name fileSize }
      otherFiles { id name fileSize }
    }
  }
`;

const PRINTABLES_DOWNLOAD_QUERY = `
  mutation GetDownloadLink(
    $printId: ID!,
    $files: [DownloadFileInput],
    $source: DownloadSourceEnum!
  ) {
    getDownloadLink(printId: $printId, files: $files, source: $source) {
      ok
      errors { field messages }
      output {
        files { id link fileType }
      }
    }
  }
`;

async function printablesGraphql(query, variables) {
  const payload = await fetchPublicJson('https://api.printables.com/graphql/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    allowedHosts: PRINTABLES_API_HOSTS,
  });
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors.map(error => error?.message).filter(Boolean).join('; ') || 'Printables query failed');
  }
  return payload?.data;
}

async function inspectPrintables(source, includeDownloadUrls) {
  const data = await printablesGraphql(PRINTABLES_MODEL_QUERY, { id: source.modelId });
  const model = data?.model;
  if (!model) throw apiError('Printables did not return that model.', 502);

  const imagePaths = [
    model.image?.filePath,
    ...(model.images ?? []).map(image => image?.filePath),
  ].filter(Boolean);
  const images = dedupeDownloadAssets(imagePaths.map((filePath, index) => {
    const url = new URL(filePath, 'https://media.printables.com/').href;
    return {
      kind: 'image',
      filename: filenameFromUrl(url, `Printables image ${index + 1}`),
      downloadUrl: url,
      originalUrl: url,
      declaredSize: null,
      allowedHosts: PRINTABLES_IMAGE_HOSTS,
    };
  }));

  const groups = [
    ['stls', 'stl'],
    ['gcodes', 'gcode'],
    ['slas', 'sla'],
    ['otherFiles', 'other'],
  ];
  const files = [];
  for (const [field, fileType] of groups) {
    for (const file of model[field] ?? []) {
      const filename = sanitizeAssetFilename(file?.name, `Printables file ${file?.id}`);
      files.push({
        id: String(file.id),
        fileType,
        kind: bambuAssetKind(filename),
        filename,
        declaredSize: Number(file?.fileSize) || null,
        downloadUrl: null,
        originalUrl: null,
        providerKey: `printables:${fileType}:${file?.id}`,
      });
    }
  }

  const warnings = [];
  if (includeDownloadUrls && files.length > 0) {
    const groupedFiles = groups
      .map(([, fileType]) => ({
        ids: files.filter(file => file.fileType === fileType).map(file => file.id),
        fileType,
      }))
      .filter(group => group.ids.length > 0);
    try {
      const downloadData = await printablesGraphql(PRINTABLES_DOWNLOAD_QUERY, {
        printId: source.modelId,
        files: groupedFiles,
        source: 'model_detail',
      });
      const result = downloadData?.getDownloadLink;
      if (!result?.ok) {
        const messages = (result?.errors ?? [])
          .flatMap(error => error?.messages ?? [])
          .filter(Boolean);
        throw new Error(messages.join('; ') || 'Printables did not issue download links');
      }
      const linksById = new Map(
        (result.output?.files ?? []).map(file => [String(file.id), file.link])
      );
      for (const file of files) {
        const link = linksById.get(file.id);
        if (typeof link === 'string' && link.startsWith('http')) {
          file.downloadUrl = link;
          file.originalUrl = link;
          file.allowedHosts = PRINTABLES_FILE_HOSTS;
        }
      }
      const missing = files.filter(file => !file.downloadUrl);
      if (missing.length > 0) {
        warnings.push(`Printables did not provide download links for: ${missing.map(file => file.filename).join(', ')}.`);
      }
    } catch (error) {
      warnings.push(`Printables file links were unavailable: ${error.message}.`);
    }
  }

  return {
    sourceSite: 'printables',
    sourceModelId: source.modelId,
    sourceUrl: source.sourceUrl,
    title: cleanImportedText(model.name, 300) || `Printables model ${source.modelId}`,
    description: cleanImportedText(model.description, 50_000),
    creatorName: cleanImportedText(model.user?.publicUsername || model.user?.handle, 300) || null,
    licenseName: cleanImportedText(model.license?.name, 300) || null,
    images,
    files,
    warnings,
  };
}

function thingiverseCreatorName(creator) {
  if (typeof creator === 'string') return creator;
  return creator?.name || creator?.public_name || creator?.username || '';
}

function thingiverseLicenseName(license) {
  if (typeof license === 'string') return license;
  return license?.name || license?.title || '';
}

async function inspectThingiverse(source, thingiverseToken) {
  if (!thingiverseToken) {
    let html = '';
    try {
      html = await fetchPublicText(source.sourceUrl, THINGIVERSE_PAGE_HOSTS);
    } catch { /* provider commonly rate-limits anonymous fetches */ }
    const og = html ? extractOgMeta(html) : {};
    const images = og.image
      ? [{
          kind: 'image',
          filename: filenameFromUrl(og.image, 'Thingiverse cover'),
          downloadUrl: og.image,
          originalUrl: og.image,
          declaredSize: null,
          allowedHosts: THINGIVERSE_ASSET_HOSTS,
        }]
      : [];
    return {
      sourceSite: 'thingiverse',
      sourceModelId: source.modelId,
      sourceUrl: source.sourceUrl,
      title: cleanImportedText(og.title, 300) || `Thingiverse model ${source.modelId}`,
      description: cleanImportedText(og.description, 50_000),
      creatorName: null,
      licenseName: null,
      images,
      files: [],
      warnings: [
        'Thingiverse requires API authentication for complete metadata, images, and file downloads. Connect an official token in Workshop Settings, or open Thingiverse and download the files manually.',
      ],
    };
  }

  const authHeaders = { Authorization: `Bearer ${thingiverseToken}` };
  const apiBase = 'https://api.thingiverse.com';
  let thing;
  let files;
  let images;
  try {
    [thing, files, images] = await Promise.all([
      fetchPublicJson(`${apiBase}/things/${source.modelId}`, {
        headers: authHeaders,
        allowedHosts: THINGIVERSE_API_HOSTS,
      }),
      fetchPublicJson(`${apiBase}/things/${source.modelId}/files`, {
        headers: authHeaders,
        allowedHosts: THINGIVERSE_API_HOSTS,
      }),
      fetchPublicJson(`${apiBase}/things/${source.modelId}/images`, {
        headers: authHeaders,
        allowedHosts: THINGIVERSE_API_HOSTS,
      }),
    ]);
  } catch (error) {
    throw apiError(`Thingiverse import failed: ${error.message}`, 502);
  }

  const imageAssets = dedupeDownloadAssets((Array.isArray(images) ? images : []).map((image, index) => {
    const sizes = Array.isArray(image?.sizes) ? image.sizes : [];
    const largest = [...sizes].sort((a, b) =>
      (Number(b?.width) * Number(b?.height)) - (Number(a?.width) * Number(a?.height))
    )[0];
    const url = largest?.url || image?.url;
    if (typeof url !== 'string' || !url.startsWith('http')) return null;
    return {
      kind: 'image',
      filename: filenameFromUrl(url, `Thingiverse image ${index + 1}`),
      downloadUrl: url,
      originalUrl: url,
      declaredSize: null,
      providerKey: `thingiverse-image:${image?.id || index}`,
      allowedHosts: THINGIVERSE_ASSET_HOSTS,
    };
  }).filter(Boolean));

  const fileAssets = (Array.isArray(files) ? files : []).map(file => {
    const filename = sanitizeAssetFilename(file?.name, `Thingiverse file ${file?.id}`);
    const directUrl = [file?.download_url, file?.direct_url]
      .find(url => typeof url === 'string' && url.startsWith('http'));
    const downloadUrl = directUrl || `${apiBase}/files/${file.id}/download`;
    const downloadHost = new URL(downloadUrl).hostname.toLowerCase();
    return {
      kind: bambuAssetKind(filename),
      filename,
      declaredSize: Number(file?.size) || null,
      downloadUrl,
      originalUrl: typeof file?.public_url === 'string' ? file.public_url : downloadUrl,
      downloadHeaders: downloadHost === 'api.thingiverse.com' ? authHeaders : undefined,
      providerKey: `thingiverse-file:${file?.id}`,
      allowedHosts: [...THINGIVERSE_API_HOSTS, ...THINGIVERSE_ASSET_HOSTS],
    };
  });

  return {
    sourceSite: 'thingiverse',
    sourceModelId: source.modelId,
    sourceUrl: source.sourceUrl,
    title: cleanImportedText(thing?.name, 300) || `Thingiverse model ${source.modelId}`,
    description: cleanImportedText(thing?.description_html || thing?.description, 50_000),
    creatorName: cleanImportedText(thingiverseCreatorName(thing?.creator), 300) || null,
    licenseName: cleanImportedText(thingiverseLicenseName(thing?.license), 300) || null,
    images: imageAssets,
    files: fileAssets,
    warnings: [],
  };
}

async function inspectBambuSource(
  rawUrl,
  {
    includeDownloadUrls = false,
    thingiverseToken = THINGIVERSE_APP_TOKEN,
  } = {}
) {
  const source = parseBambuSourceUrl(rawUrl);
  if (source.site === 'makerworld') return inspectMakerWorld(source);
  if (source.site === 'printables') return inspectPrintables(source, includeDownloadUrls);
  return inspectThingiverse(source, thingiverseToken);
}

function extensionForStoredAsset(filename) {
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '';
}

function contentTypeForFilename(filename) {
  const extension = extname(filename).toLowerCase();
  const known = {
    '.3mf': 'model/3mf',
    '.gcode': 'text/x-gcode',
    '.obj': 'model/obj',
    '.pdf': 'application/pdf',
    '.stl': 'model/stl',
    '.zip': 'application/zip',
  };
  return known[extension] || 'application/octet-stream';
}

async function fileStartsWithMarkup(filePath) {
  const handle = await openFile(filePath, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString('utf8').trimStart().toLowerCase();
    return prefix.startsWith('<!doctype html')
      || prefix.startsWith('<html')
      || prefix.startsWith('<svg')
      || (prefix.startsWith('<?xml') && prefix.includes('<svg'))
      || prefix.startsWith('{"error"');
  } finally {
    await handle.close();
  }
}

async function downloadBambuAsset(asset, importState) {
  const maxBytes = asset.kind === 'image' ? BAMBU_MAX_IMAGE_BYTES : BAMBU_MAX_FILE_BYTES;
  const projectBytes = Number(importState.projectBytes) || 0;
  if (asset.declaredSize && asset.declaredSize > maxBytes) {
    throw new Error(`declared size exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB per-file limit`);
  }
  if (
    asset.declaredSize
    && projectBytes + importState.totalBytes + asset.declaredSize > BAMBU_MAX_PROJECT_BYTES
  ) {
    throw new Error('project exceeds the 1 GB import limit');
  }
  if (asset.declaredSize && importState.userBytes + importState.totalBytes + asset.declaredSize > BAMBU_MAX_USER_BYTES) {
    throw new Error('Bambu Hub storage exceeds the 5 GB per-account limit');
  }

  const tempName = `${randomUUID()}.part`;
  const storedName = `${randomUUID()}${extensionForStoredAsset(asset.filename)}`;
  const tempPath = join(UPLOADS_PATH, tempName);
  const storedPath = join(UPLOADS_PATH, storedName);

  try {
    const response = await openPublicResponse(asset.downloadUrl, {
      headers: asset.downloadHeaders,
      timeoutMs: BAMBU_DOWNLOAD_TIMEOUT_MS,
      allowedHosts: asset.allowedHosts,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`download returned ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body.cancel();
      throw new Error(`file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB per-file limit`);
    }
    if (
      Number.isFinite(contentLength)
      && projectBytes + importState.totalBytes + contentLength > BAMBU_MAX_PROJECT_BYTES
    ) {
      await response.body.cancel();
      throw new Error('project exceeds the 1 GB import limit');
    }
    if (
      Number.isFinite(contentLength)
      && importState.userBytes + importState.totalBytes + contentLength > BAMBU_MAX_USER_BYTES
    ) {
      await response.body.cancel();
      throw new Error('Bambu Hub storage exceeds the 5 GB per-account limit');
    }

    let sizeBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        const exceedsFile = sizeBytes > maxBytes;
        const exceedsProject =
          projectBytes + importState.totalBytes + sizeBytes > BAMBU_MAX_PROJECT_BYTES;
        const exceedsUser = importState.userBytes + importState.totalBytes + sizeBytes > BAMBU_MAX_USER_BYTES;
        if (exceedsFile || exceedsProject || exceedsUser) {
          callback(new Error(
            exceedsFile
              ? `file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB per-file limit`
              : exceedsProject
                ? 'project exceeds the 1 GB import limit'
                : 'Bambu Hub storage exceeds the 5 GB per-account limit'
          ));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      createWriteStream(tempPath, { flags: 'wx' })
    );

    const detected = await fileTypeFromFile(tempPath);
    const responseType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (asset.kind === 'image') {
      if (!detected?.mime?.startsWith('image/') || detected.mime === 'image/svg+xml') {
        throw new Error('provider returned a non-image response');
      }
    } else if (
      responseType === 'text/html'
      || responseType === 'application/json'
      || await fileStartsWithMarkup(tempPath)
    ) {
      throw new Error('provider returned an error page instead of a model file');
    }

    const contentType = detected?.mime
      || (responseType && responseType !== 'application/octet-stream' ? responseType : '')
      || contentTypeForFilename(asset.filename);
    renameSync(tempPath, storedPath);
    importState.totalBytes += sizeBytes;
    return { filePath: storedName, contentType, sizeBytes };
  } catch (error) {
    await unlinkAsync(tempPath).catch(() => {});
    await unlinkAsync(storedPath).catch(() => {});
    throw error;
  }
}

function bambuAnalysisResponse(inspection) {
  return {
    source_site: inspection.sourceSite,
    source_model_id: inspection.sourceModelId,
    title: inspection.title,
    description: inspection.description,
    creator_name: inspection.creatorName,
    license_name: inspection.licenseName,
    preview_image_url: inspection.images[0]?.downloadUrl ?? null,
    image_count: inspection.images.length,
    file_count: inspection.files.length,
    files: inspection.files.map(file => ({ filename: file.filename, kind: file.kind })),
    warnings: inspection.warnings,
  };
}

function hydrateBambuProject(stmts, id, includeAssets = true) {
  const project = stmts.getBambuProject.get(id);
  if (!project) return null;
  const assets = stmts.listBambuAssets.all(id);
  const images = assets.filter(asset => asset.kind === 'image');
  const result = {
    ...project,
    import_warnings: parseJsonArray(project.import_warnings),
    image_count: images.length,
    file_count: assets.length - images.length,
    hero_asset_id: images[0]?.id ?? null,
  };
  return includeAssets ? { ...result, assets } : result;
}

function publicBambuAsset(asset) {
  if (!asset) return null;
  const result = { ...asset };
  delete result.file_path;
  return result;
}

function cleanBambuInput(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\u0000/g, '').trim().slice(0, maxLength);
  return cleaned || null;
}

function pruneMakerWorldBridgeJobs(now = Date.now()) {
  for (const [id, job] of makerWorldBridgeJobs) {
    if (job.status !== 'processing' && job.expiresAt <= now) {
      makerWorldBridgeJobs.delete(id);
    }
  }
  if (makerWorldBridgeJobs.size < MAKERWORLD_BRIDGE_MAX_JOBS) return;
  const removable = [...makerWorldBridgeJobs.values()]
    .filter(job => job.status === 'complete' || job.status === 'failed')
    .sort((left, right) => left.createdAt - right.createdAt);
  for (const job of removable) {
    makerWorldBridgeJobs.delete(job.id);
    if (makerWorldBridgeJobs.size < MAKERWORLD_BRIDGE_MAX_JOBS) break;
  }
}

function makerWorldBridgeJobResponse(job) {
  return {
    id: job.id,
    status: job.status,
    expires_at: new Date(job.expiresAt).toISOString(),
    imported_count: job.importedCount,
    skipped_count: job.skippedCount,
    failed_count: job.failedCount,
    warnings: job.warnings,
    error: job.error,
  };
}

function bridgeTokenMatches(job, rawToken) {
  if (!job.tokenHash || typeof rawToken !== 'string' || rawToken.length > 256) return false;
  const supplied = createHash('sha256').update(rawToken, 'utf8').digest();
  const expected = Buffer.from(job.tokenHash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function normalizeMakerWorldBridgeManifest(body, job) {
  if (String(body?.design_id ?? '') !== job.designId) {
    throw apiError('MakerWorld design does not match this Workshop project');
  }
  if (!Array.isArray(body?.assets) || body.assets.length === 0) {
    throw apiError('MakerWorld returned no downloadable files');
  }
  if (body.assets.length > MAKERWORLD_BRIDGE_MAX_ASSETS) {
    throw apiError(`MakerWorld returned more than ${MAKERWORLD_BRIDGE_MAX_ASSETS} files`);
  }

  const seen = new Set();
  const assets = [];
  for (const [index, item] of body.assets.entries()) {
    const sourceKey = typeof item?.source_key === 'string' ? item.source_key.trim() : '';
    if (!/^(?:instance|design):[a-zA-Z0-9:_-]{1,120}$/.test(sourceKey)) {
      throw apiError(`MakerWorld file ${index + 1} has an invalid source key`);
    }
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    let signedUrl;
    try { signedUrl = new URL(String(item?.url ?? '')); }
    catch { throw apiError(`MakerWorld file ${index + 1} has an invalid download URL`); }
    if (
      signedUrl.protocol !== 'https:'
      || signedUrl.username
      || signedUrl.password
      || !hostMatchesAllowlist(signedUrl.hostname, MAKERWORLD_ASSET_HOSTS)
      || !signedUrl.search
    ) {
      throw apiError(`MakerWorld file ${index + 1} is not a signed MakerWorld download`);
    }

    const filename = sanitizeAssetFilename(
      item?.filename || filenameFromUrl(signedUrl.href, `MakerWorld file ${index + 1}`),
      `MakerWorld file ${index + 1}`
    );
    assets.push({
      sourceKey,
      kind: bambuAssetKind(filename),
      filename,
      downloadUrl: signedUrl.href,
      declaredSize: null,
      allowedHosts: MAKERWORLD_ASSET_HOSTS,
    });
  }
  if (assets.length === 0) throw apiError('MakerWorld returned no unique downloadable files');
  const warnings = Array.isArray(body?.warnings)
    ? body.warnings
        .filter(value => typeof value === 'string')
        .map(value => value.replace(/\u0000/g, '').trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return { assets, warnings };
}

async function processMakerWorldBridgeJob(
  job,
  assets,
  releaseLock,
  releaseUser,
  releaseStorage
) {
  try {
    const entry = getExistingUserDb(job.userKey);
    if (!entry) throw new Error('Workshop account no longer exists');
    const project = entry.stmts.getBambuProject.get(job.projectId);
    if (
      !project
      || project.source_site !== 'makerworld'
      || String(project.source_model_id) !== job.designId
    ) {
      throw new Error('MakerWorld project no longer matches this import');
    }

    const userBytes = Number(entry.stmts.bambuStorageUsage.get()?.total_bytes) || 0;
    const projectBytes = Number(
      entry.stmts.bambuProjectStorageUsage.get(job.projectId)?.total_bytes
    ) || 0;
    const importState = { totalBytes: 0, userBytes, projectBytes };
    const failures = [];

    for (const [index, asset] of assets.entries()) {
      if (entry.stmts.getBambuAssetBySourceKey.get(job.projectId, asset.sourceKey)) {
        job.skippedCount += 1;
        continue;
      }
      let downloaded;
      try {
        downloaded = await downloadBambuAsset(asset, importState);
        entry.stmts.insertMakerWorldAsset.run({
          bambu_project_id: job.projectId,
          kind: asset.kind,
          filename: asset.filename,
          content_type: downloaded.contentType,
          size_bytes: downloaded.sizeBytes,
          original_url: project.source_url,
          file_path: downloaded.filePath,
          source_key: asset.sourceKey,
          sort_order: Date.now() + index,
        });
        job.importedCount += 1;
      } catch (error) {
        if (downloaded?.filePath) {
          await unlinkAsync(join(UPLOADS_PATH, basename(downloaded.filePath))).catch(() => {});
        }
        job.failedCount += 1;
        failures.push(`${asset.filename}: ${error.message || 'download failed'}`);
      }
    }

    const preservedWarnings = parseJsonArray(project.import_warnings).filter(warning =>
      !/^MakerWorld requires sign-in\b/i.test(warning)
      && !/^Automatic MakerWorld import\b/i.test(warning)
    );
    const bridgeWarnings = [
      ...job.extensionWarnings,
      ...(failures.length > 0
        ? [`Automatic MakerWorld import could not download ${failures.length} file${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`]
        : []),
    ];
    entry.stmts.saveBambuImportWarnings.run({
      id: job.projectId,
      warnings: JSON.stringify([...preservedWarnings, ...bridgeWarnings].slice(0, 100)),
    });
    entry.stmts.touchBambuProject.run(job.projectId);
    job.warnings = bridgeWarnings;
    job.status = 'complete';
  } catch (error) {
    job.status = 'failed';
    job.error = error.message || 'Automatic MakerWorld import failed';
  } finally {
    job.updatedAt = Date.now();
    job.expiresAt = job.updatedAt + MAKERWORLD_BRIDGE_JOB_TTL_MS;
    releaseLock?.();
    releaseUser();
    releaseStorage();
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────────────────────────────

const HOME_TENANT_ID = process.env.AZURE_HOME_TENANT_ID || process.env.AZURE_TENANT_ID;
const API_AUDIENCE = process.env.API_AUDIENCE;

if (!HOME_TENANT_ID || !API_AUDIENCE || !OID_RE.test(HOME_TENANT_ID) || !OID_RE.test(API_AUDIENCE)) {
  console.error('[auth] AZURE_HOME_TENANT_ID (or legacy AZURE_TENANT_ID) and API_AUDIENCE must be set. Refusing to start with auth disabled.');
  process.exit(1);
}

const ENTRA_TEST_JWKS = process.env.NODE_ENV === 'test' && process.env.ENTRA_TEST_JWKS
  ? JSON.parse(process.env.ENTRA_TEST_JWKS)
  : null;
const ENTRA_JWKS = ENTRA_TEST_JWKS
  ? createLocalJWKSet(ENTRA_TEST_JWKS)
  : createRemoteJWKSet(
      new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys')
    );
const ACCEPTED_AUDIENCES = [`api://${API_AUDIENCE}`, API_AUDIENCE];
const REQUIRED_API_SCOPE = 'access_as_user';
const normalizedHomeTenantId = HOME_TENANT_ID.toLowerCase();

function entraUserKey(tid, oid) {
  if (!OID_RE.test(tid) || !OID_RE.test(oid)) {
    throw new Error('Token missing valid tenant or object identifier');
  }
  const normalizedTid = tid.toLowerCase();
  const normalizedOid = oid.toLowerCase();
  return normalizedTid === normalizedHomeTenantId
    ? normalizedOid
    : `${normalizedTid}_${normalizedOid}`;
}

function validateEntraIssuer(payload) {
  const tid = typeof payload.tid === 'string' ? payload.tid : '';
  if (!OID_RE.test(tid)) throw new Error('Token missing valid tid claim');
  const normalizedTid = tid.toLowerCase();
  const acceptedIssuers = new Set([
    `https://login.microsoftonline.com/${normalizedTid}/v2.0`,
    `https://sts.windows.net/${normalizedTid}/`,
  ]);
  if (typeof payload.iss !== 'string' || !acceptedIssuers.has(payload.iss)) {
    throw new Error('Token issuer does not match tid claim');
  }
}

function validateEntraScope(payload) {
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : [];
  if (!scopes.includes(REQUIRED_API_SCOPE)) {
    throw new Error(`Token missing ${REQUIRED_API_SCOPE} scope`);
  }
}

// ── Auth (Sign in with Apple — additive second identity) ──────────────────
// A second, independent sign-in path that never touches the Entra path above.
// Apple id_tokens are verified once (against Apple's JWKS) at POST /api/auth/apple;
// we then mint our own short-lived session JWT that clients send as the bearer
// (Apple id_tokens can't be silently refreshed, so we own the session instead).
//
// Apple identity-token sign-in needs only the audience + Workshop session key.
// Server credentials are additionally required to exchange authorization codes
// and retain a revocable Apple refresh token. Keeping those gates separate is
// deliberate: already-shipped iOS builds send only `id_token`, and must continue
// to sign in while the new revocation credentials are being configured.
const APPLE_BUNDLE_ID       = process.env.APPLE_BUNDLE_ID       || '';  // native app audience
const APPLE_WEB_SERVICES_ID = process.env.APPLE_WEB_SERVICES_ID || '';  // web Services ID audience (if web Apple sign-in comes later)
const SESSION_SECRET        = process.env.SESSION_SECRET        || '';  // HMAC key for our session JWTs
const PROVIDER_TOKEN_ENCRYPTION_SECRET =
  process.env.PROVIDER_TOKEN_ENCRYPTION_KEY || SESSION_SECRET;
const APPLE_TEAM_ID          = process.env.APPLE_TEAM_ID          || '';
const APPLE_KEY_ID           = process.env.APPLE_KEY_ID           || '';
const APPLE_PRIVATE_KEY      = (process.env.APPLE_PRIVATE_KEY     || '').replace(/\\n/g, '\n');
const APPLE_TOKEN_ENCRYPTION_SECRET = process.env.APPLE_TOKEN_ENCRYPTION_KEY || '';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_OAUTH_ORIGIN = process.env.NODE_ENV === 'test' && process.env.APPLE_OAUTH_BASE_URL
  ? process.env.APPLE_OAUTH_BASE_URL
  : APPLE_ISSUER;
const APPLE_JWKS_URL = process.env.NODE_ENV === 'test' && process.env.APPLE_JWKS_URL
  ? process.env.APPLE_JWKS_URL
  : `${APPLE_ISSUER}/auth/keys`;
const APPLE_JWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
const APPLE_AUDIENCES = [APPLE_BUNDLE_ID, APPLE_WEB_SERVICES_ID].filter(Boolean);

const SESSION_ISSUER   = 'workshop-api';
const SESSION_AUDIENCE = 'workshop-clients';
const SESSION_KEY = SESSION_SECRET ? createSecretKey(Buffer.from(SESSION_SECRET, 'utf8')) : null;
const APPLE_TOKEN_KEY = APPLE_TOKEN_ENCRYPTION_SECRET.length >= 32
  ? createHash('sha256').update(APPLE_TOKEN_ENCRYPTION_SECRET, 'utf8').digest()
  : null;
const PROVIDER_TOKEN_KEY = PROVIDER_TOKEN_ENCRYPTION_SECRET.length >= 32
  ? createHash('sha256')
      .update('workshop-provider-token:', 'utf8')
      .update(PROVIDER_TOKEN_ENCRYPTION_SECRET, 'utf8')
      .digest()
  : null;
const APPLE_SERVER_CREDENTIALS_CONFIGURED = Boolean(
  APPLE_BUNDLE_ID
  && APPLE_TEAM_ID
  && APPLE_KEY_ID
  && APPLE_PRIVATE_KEY
  && APPLE_TOKEN_KEY
);
const APPLE_SIGN_IN_ENABLED = Boolean(SESSION_KEY && APPLE_AUDIENCES.length > 0);
const ACCESS_TTL  = '1h';
const REFRESH_TTL = '60d';

if (!APPLE_SIGN_IN_ENABLED) {
  console.log('[auth] Apple sign-in disabled (session secret or audience missing); Microsoft/Entra sign-in only.');
} else if (!APPLE_SERVER_CREDENTIALS_CONFIGURED) {
  console.log('[auth] Apple sign-in running in compatibility mode; account deletion needs server revocation credentials.');
}

class AppleOAuthError extends Error {
  constructor(message, { status = 502, providerCode = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppleOAuthError';
    this.status = status;
    this.providerCode = providerCode;
  }
}

function encryptAppleRefreshToken(userKey, refreshToken) {
  if (!APPLE_TOKEN_KEY) throw new Error('Apple token encryption is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', APPLE_TOKEN_KEY, iv);
  cipher.setAAD(Buffer.from(userKey, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptAppleRefreshToken(userKey, encrypted) {
  if (!APPLE_TOKEN_KEY) throw new Error('Apple token encryption is not configured');
  const [version, ivRaw, tagRaw, ciphertextRaw] = String(encrypted).split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Stored Apple refresh token is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    APPLE_TOKEN_KEY,
    Buffer.from(ivRaw, 'base64url')
  );
  decipher.setAAD(Buffer.from(userKey, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptProviderToken(userKey, provider, token) {
  if (!PROVIDER_TOKEN_KEY) throw new Error('Provider token encryption is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', PROVIDER_TOKEN_KEY, iv);
  cipher.setAAD(Buffer.from(`${userKey}:${provider}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptProviderToken(userKey, provider, encrypted) {
  if (!PROVIDER_TOKEN_KEY) throw new Error('Provider token encryption is not configured');
  const [version, ivRaw, tagRaw, ciphertextRaw] = String(encrypted).split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Stored provider token is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    PROVIDER_TOKEN_KEY,
    Buffer.from(ivRaw, 'base64url')
  );
  decipher.setAAD(Buffer.from(`${userKey}:${provider}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function normalizeThingiverseToken(value) {
  if (typeof value !== 'string') throw apiError('Thingiverse token is required');
  const token = value.trim().replace(/^Bearer\s+/i, '');
  if (token.length < 16 || token.length > 4096 || /\s/.test(token)) {
    throw apiError('Enter a valid Thingiverse API token');
  }
  return token;
}

function thingiverseConnectionStatus(stmts, userKey) {
  const credential = stmts.getProviderCredential.get('thingiverse');
  if (credential && PROVIDER_TOKEN_KEY && userKey) {
    try {
      decryptProviderToken(userKey, 'thingiverse', credential.token_enc);
      return {
        connected: true,
        source: 'account',
        storage_configured: true,
      };
    } catch {
      // A rotated encryption key makes the old token unusable; never claim it is connected.
    }
  }
  if (THINGIVERSE_APP_TOKEN) {
    return {
      connected: true,
      source: 'server',
      storage_configured: Boolean(PROVIDER_TOKEN_KEY),
    };
  }
  return {
    connected: false,
    source: 'none',
    storage_configured: Boolean(PROVIDER_TOKEN_KEY),
  };
}

function thingiverseTokenForRequest(req) {
  const credential = req.stmts.getProviderCredential.get('thingiverse');
  if (!credential) return THINGIVERSE_APP_TOKEN;
  try {
    return decryptProviderToken(req.user.userKey, 'thingiverse', credential.token_enc);
  } catch (error) {
    if (THINGIVERSE_APP_TOKEN) return THINGIVERSE_APP_TOKEN;
    throw apiError('Saved Thingiverse token is unavailable. Reconnect it in Settings.', 500);
  }
}

async function validateThingiverseToken(token) {
  try {
    await fetchPublicJson('https://api.thingiverse.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      allowedHosts: THINGIVERSE_API_HOSTS,
    });
  } catch (error) {
    if (/\b(401|403)\b/.test(error.message)) {
      throw apiError('Thingiverse rejected that token. Check it and try again.');
    }
    throw apiError(`Thingiverse could not validate the token: ${error.message}`, 502);
  }
}

let applePrivateKeyPromise = null;
function getApplePrivateKey() {
  if (!applePrivateKeyPromise) {
    applePrivateKeyPromise = importPKCS8(APPLE_PRIVATE_KEY, 'ES256');
  }
  return applePrivateKeyPromise;
}

async function mintAppleClientSecret(clientId) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(await getApplePrivateKey());
}

async function appleOAuthRequest(path, clientId, values) {
  let clientSecret;
  try {
    clientSecret = await mintAppleClientSecret(clientId);
  } catch (err) {
    throw new AppleOAuthError('Apple client secret signing failed', {
      status: 503,
      cause: err,
    });
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...values,
  });

  let response;
  try {
    response = await fetch(new URL(path, APPLE_OAUTH_ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new AppleOAuthError('Apple OAuth request failed', { cause: err });
  }

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      throw new AppleOAuthError('Apple OAuth returned invalid JSON', { cause: err });
    }
  }
  if (!response.ok) {
    const providerCode = typeof payload.error === 'string' ? payload.error : null;
    throw new AppleOAuthError('Apple OAuth rejected the request', {
      status: providerCode === 'invalid_grant' ? 401 : 502,
      providerCode,
    });
  }
  return payload;
}

async function exchangeAppleAuthorizationCode(authorizationCode, expectedSub, clientId) {
  const tokens = await appleOAuthRequest('/auth/token', clientId, {
    code: authorizationCode,
    grant_type: 'authorization_code',
  });
  if (typeof tokens.refresh_token !== 'string' || typeof tokens.id_token !== 'string') {
    throw new AppleOAuthError('Apple token response is incomplete');
  }

  let exchangedPayload;
  try {
    ({ payload: exchangedPayload } = await jwtVerify(tokens.id_token, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: clientId,
    }));
  } catch (err) {
    throw new AppleOAuthError('Apple token response identity is invalid', { cause: err });
  }
  if (exchangedPayload.sub !== expectedSub) {
    throw new AppleOAuthError('Apple authorization code belongs to another user', {
      status: 401,
      providerCode: 'subject_mismatch',
    });
  }
  return tokens.refresh_token;
}

async function revokeAppleRefreshToken(clientId, refreshToken) {
  await appleOAuthRequest('/auth/revoke', clientId, {
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
}

// Mint a Workshop session pair (access + refresh) for a user key. HS256 over
// SESSION_KEY. `typ` keeps an access token from being replayed as a refresh one.
async function mintSession(userKey) {
  if (deletingUserKeys.has(userKey)) throw new Error('account deletion in progress');
  const { stmts } = getUserDb(userKey);
  const authState = stmts.getAuthState.get();
  if (!authState?.session_generation) throw new Error('account auth state unavailable');

  const sign = (typ, ttl, extra = {}) =>
    new SignJWT({ uk: userKey, typ, sg: authState.session_generation, ...extra })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SESSION_ISSUER).setAudience(SESSION_AUDIENCE)
      .setIssuedAt().setExpirationTime(ttl).sign(SESSION_KEY);
  const accessToken  = await sign('access',  ACCESS_TTL);
  const refreshToken = await sign('refresh', REFRESH_TTL, { jti: randomUUID() });
  stmts.disableLegacySessions.run();
  return { accessToken, refreshToken };
}

// Verify one of our session tokens; returns the validated user key.
async function verifySession(token, expectedTyp) {
  const { payload } = await jwtVerify(token, SESSION_KEY, {
    issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE,
  });
  if (payload.typ !== expectedTyp) throw new Error('wrong token type');
  const uk = typeof payload.uk === 'string' ? payload.uk : '';
  if (!USER_KEY_RE.test(uk)) throw new Error('bad user key');
  if (deletingUserKeys.has(uk)) throw new Error('account deletion in progress');

  const entry = getExistingUserDb(uk);
  if (!entry) throw new Error('account no longer exists');
  const authState = entry.stmts.getAuthState.get();
  const tokenGeneration = typeof payload.sg === 'string' ? payload.sg : '';
  if (tokenGeneration) {
    if (tokenGeneration !== authState?.session_generation) {
      throw new Error('session revoked');
    }
  } else if (authState?.accept_legacy_tokens !== 1) {
    throw new Error('legacy session revoked');
  }
  return uk;
}

// Resolve a bearer token to a user key. Tries our own session token first
// (local HMAC, no network) then falls back to an Entra access token. Throws if
// neither verifies. Shared by the /api middleware and (indirectly) requireAuth.
async function userKeyFromBearer(token) {
  if (SESSION_KEY) {
    try { return await verifySession(token, 'access'); }
    catch { /* not one of ours — try Entra below */ }
  }
  const { payload } = await jwtVerify(token, ENTRA_JWKS, {
    audience: ACCEPTED_AUDIENCES,
    algorithms: ['RS256'],
  });
  validateEntraIssuer(payload);
  validateEntraScope(payload);
  const tid = typeof payload.tid === 'string' ? payload.tid : '';
  const oid = typeof payload.oid === 'string' ? payload.oid : '';
  if (!OID_RE.test(oid)) throw new Error('Token missing valid oid claim');
  return entraUserKey(tid, oid);
}

// Read/populate the single-row profile. `name` (from the Apple client, first
// consent only) and `email` are stored the first time they're seen and then
// kept — Apple only sends the name once, so we never overwrite a stored name
// with a blank. Returns the current { display_name, email }.
function upsertProfile(db, name, email) {
  db.prepare('INSERT OR IGNORE INTO user_profile (id) VALUES (1)').run();
  const cur = db.prepare('SELECT display_name, email FROM user_profile WHERE id = 1').get() ?? {};
  const nextName  = (name  && !cur.display_name) ? name  : (cur.display_name ?? null);
  const nextEmail = (email && !cur.email)        ? email : (cur.email ?? null);
  if (nextName !== (cur.display_name ?? null) || nextEmail !== (cur.email ?? null)) {
    db.prepare("UPDATE user_profile SET display_name = ?, email = ?, updated_at = datetime('now') WHERE id = 1")
      .run(nextName, nextEmail);
  }
  return { display_name: nextName, email: nextEmail };
}

function readProfile(db) {
  try { return db.prepare('SELECT display_name, email FROM user_profile WHERE id = 1').get() ?? {}; }
  catch { return {}; }
}

function accountDeletionError(status, apiCode, cause) {
  const error = new Error(apiCode, cause ? { cause } : undefined);
  error.status = status;
  error.apiCode = apiCode;
  return error;
}

async function revokeAppleAccountCredential(userKey) {
  if (!APPLE_KEY_RE.test(userKey)) return;
  if (!APPLE_SERVER_CREDENTIALS_CONFIGURED) {
    throw accountDeletionError(503, 'apple_revocation_unavailable');
  }

  const entry = getExistingUserDb(userKey);
  const credentialCount = entry?.stmts.countAppleCredentials.get().count ?? 0;
  const credentials = entry?.stmts.listAppleCredentials.all() ?? [];
  if (credentialCount === 0) {
    // Accounts created before authorization-code exchange was introduced need
    // one fresh Apple sign-in so the server can capture a revocable token.
    throw accountDeletionError(409, 'apple_reauthentication_required');
  }

  for (const credential of credentials) {
    let refreshToken;
    try {
      refreshToken = decryptAppleRefreshToken(userKey, credential.refresh_token_enc);
    } catch (err) {
      throw accountDeletionError(500, 'apple_refresh_token_unavailable', err);
    }

    try {
      await revokeAppleRefreshToken(credential.client_id, refreshToken);
      entry.stmts.markAppleCredentialRevoked.run(credential.id);
    } catch (err) {
      throw accountDeletionError(502, 'apple_token_revocation_failed', err);
    }
  }
}

// Verify a bearer (Entra access token OR our Apple session token) and attach the
// resolved per-user storage key used downstream by withUserDb/getUserDb.
async function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return res.status(401).json({ error: 'missing token' });
  try {
    const userKey = await userKeyFromBearer(m[1]);
    if (!USER_KEY_RE.test(userKey)) return res.status(401).json({ error: 'invalid token' });
    req.user = { userKey };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function beginActiveUserOperation(userKey) {
  if (deletingUserKeys.has(userKey)) {
    return null;
  }

  activeUserRequests.set(userKey, (activeUserRequests.get(userKey) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeUserRequests.get(userKey) ?? 1) - 1;
    if (remaining > 0) activeUserRequests.set(userKey, remaining);
    else activeUserRequests.delete(userKey);
  };
}

function trackActiveUserRequest(userKey, res) {
  const release = beginActiveUserOperation(userKey);
  if (!release) return false;
  res.once('finish', release);
  res.once('close', release);
  return true;
}

// Attach the caller's own isolated database to the request.
function withUserDb(req, res, next) {
  const userKey = req.user.userKey;
  if (deletingUserKeys.has(userKey)) {
    return res.status(409).json({ error: 'account deletion in progress' });
  }

  try {
    const { db, stmts } = getUserDb(userKey);
    if (!trackActiveUserRequest(userKey, res)) {
      return res.status(409).json({ error: 'account deletion in progress' });
    }
    req.db = db;
    req.stmts = stmts;
    next();
  } catch (err) {
    console.error('[withUserDb]', err.message);
    res.status(500).json({ error: 'workspace unavailable' });
  }
}

// `<img src>` and `<iframe src>` cannot send Authorization headers, so image
// fetches stay open (they resolve their DB from ?userKey= / the demo snapshot).
// Structured data and the AI endpoints are fully gated.
// `/health` is open so monitors and CI probes can hit it without a token.
function isExemptPath(path) {
  return path === '/health'
    || path === '/live'
    || path === '/ready'
    || /^\/images\/\d+$/.test(path)
    || /^\/bambu-assets\/\d+\/image$/.test(path)
    || /^\/build-log\/\d+\/image$/.test(path);
}

const app = express();
app.set('trust proxy', 1);   // IIS/ARR is one hop in front
app.use(express.json());
app.use(express.static(join(__dirname, 'dist')));
app.use('/api', recoveryStorageGate);

const DEMO_READONLY_MSG = 'Demo mode is read-only — sign in with Microsoft to make changes.';

// Sign in with Apple — exchange a verified Apple id_token for a Workshop session.
// New clients also send `authorization_code`, which is exchanged and retained
// for later revocation. The code stays optional so already-shipped clients can
// sign in; those legacy sessions receive `apple_reauthentication_required` if
// they attempt account deletion before one fresh sign-in on a current client.
app.post('/api/auth/apple', async (req, res) => {
  if (!APPLE_SIGN_IN_ENABLED) return res.status(503).json({ error: 'Apple sign-in not configured' });
  const idToken = req.body?.id_token;
  const authorizationCode = req.body?.authorization_code;
  if (typeof idToken !== 'string' || !idToken) return res.status(400).json({ error: 'Missing id_token' });
  const hasAuthorizationCode = typeof authorizationCode === 'string' && authorizationCode.length > 0;
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, APPLE_JWKS, { issuer: APPLE_ISSUER, audience: APPLE_AUDIENCES }));
  } catch {
    return res.status(401).json({ error: 'Invalid Apple token' });
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) return res.status(401).json({ error: 'Apple token missing sub' });
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const clientId = tokenAudiences.find(audience => APPLE_AUDIENCES.includes(audience));
  if (!clientId) return res.status(401).json({ error: 'Invalid Apple token audience' });

  const userKey = appleUserKey(sub);
  if (!trackActiveUserRequest(userKey, res)) {
    return res.status(409).json({ error: 'account_deletion_in_progress' });
  }

  let appleRefreshToken = null;
  if (hasAuthorizationCode && APPLE_SERVER_CREDENTIALS_CONFIGURED) {
    try {
      appleRefreshToken = await exchangeAppleAuthorizationCode(authorizationCode, sub, clientId);
    } catch (err) {
      console.error('[auth/apple] authorization-code exchange failed:', err.providerCode ?? err.message);
      const status = err instanceof AppleOAuthError ? err.status : 500;
      const message = status === 401
        ? 'Invalid Apple authorization code'
        : 'Apple sign-in unavailable';
      return res.status(status).json({ error: message });
    }
  } else if (hasAuthorizationCode) {
    console.warn('[auth/apple] authorization code not retained because server revocation credentials are incomplete');
  }

  // The display name only arrives (in the client body) on the FIRST Apple consent;
  // email comes from the verified token. Persist both so later sign-ins — including
  // on other devices — can show the real name instead of a placeholder.
  const name  = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  try {
    const { db, stmts } = getUserDb(userKey);
    const encryptedRefreshToken = appleRefreshToken
      ? encryptAppleRefreshToken(userKey, appleRefreshToken)
      : null;
    const profile = db.transaction(() => {
      const currentProfile = upsertProfile(db, name, email);
      if (encryptedRefreshToken) {
        stmts.insertAppleCredential.run({
          client_id: clientId,
          refresh_token_enc: encryptedRefreshToken,
        });
      }
      return currentProfile;
    })();
    if (deletingUserKeys.has(userKey)) {
      return res.status(409).json({ error: 'account_deletion_in_progress' });
    }
    const tokens = await mintSession(userKey);
    return res.json({
      ...tokens,
      userKey,
      expiresIn: 3600,
      displayName: profile.display_name ?? null,
      email: profile.email ?? null,
    });
  } catch (err) {
    console.error('[auth/apple] failed to persist credentials:', err.message);
    return res.status(500).json({ error: 'Apple sign-in failed' });
  }
});

// Rotate a session: verify a refresh token, issue a fresh access + refresh pair.
// Also returns the stored profile so clients self-heal the display name.
app.post('/api/auth/refresh', async (req, res) => {
  if (!SESSION_KEY) return res.status(503).json({ error: 'Apple sign-in not configured' });
  const rt = req.body?.refresh_token;
  if (typeof rt !== 'string' || !rt) return res.status(400).json({ error: 'Missing refresh_token' });
  let userKey;
  try { userKey = await verifySession(rt, 'refresh'); }
  catch { return res.status(401).json({ error: 'Invalid refresh token' }); }
  const profile = readProfile(getUserDb(userKey).db);
  const tokens = await mintSession(userKey);
  res.json({ ...tokens, userKey, expiresIn: 3600, displayName: profile.display_name ?? null, email: profile.email ?? null });
});

// Permanently delete the authenticated caller's isolated account. This route is
// deliberately before the general /api DB middleware so an idempotent Entra
// retry does not recreate an empty workspace just to delete it again.
app.delete('/api/account', requireAuth, async (req, res) => {
  const userKey = req.user.userKey;
  if (deletingUserKeys.has(userKey)) {
    return res.status(409).json({ error: 'account deletion already in progress' });
  }

  deletingUserKeys.add(userKey);
  try {
    await serializeAccountDeletion(async () => {
      await waitForActiveUserRequests(userKey);
      await revokeAppleAccountCredential(userKey);
      await deleteAccountData(userKey);
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[delete-account]', err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const apiCode = err?.apiCode
      ?? (status === 409 ? 'account_has_active_requests' : 'account_deletion_failed');
    return res.status(status).json({ error: apiCode });
  } finally {
    deletingUserKeys.delete(userKey);
  }
});

const makerWorldBridgeSubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => ipKeyGenerator(req.ip),
  message: { error: 'MakerWorld bridge rate limit exceeded — try again later' },
});

function makerWorldBridgeCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

app.options('/api/extensions/makerworld-import/:jobId', makerWorldBridgeCors);
app.post(
  '/api/extensions/makerworld-import/:jobId',
  makerWorldBridgeCors,
  makerWorldBridgeSubmitLimiter,
  async (req, res) => {
    pruneMakerWorldBridgeJobs();
    const job = makerWorldBridgeJobs.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: 'MakerWorld import job not found or expired' });
    if (job.status !== 'waiting') {
      return res.status(409).json({ error: `MakerWorld import job is already ${job.status}` });
    }
    if (!bridgeTokenMatches(job, req.body?.token)) {
      return res.status(401).json({ error: 'Invalid MakerWorld import job token' });
    }

    let manifest;
    try {
      manifest = normalizeMakerWorldBridgeManifest(req.body, job);
    } catch (error) {
      return res.status(Number.isInteger(error.status) ? error.status : 400).json({
        error: error.message || 'Invalid MakerWorld file manifest',
      });
    }

    if (bambuRequestLocks.has(job.userKey)) {
      return res.status(409).json({
        error: 'Another Bambu operation is active. Return to Workshop and retry.',
      });
    }
    const releaseLock = await acquireBambuLock(job.userKey);
    const releaseUser = beginActiveUserOperation(job.userKey);
    if (!releaseUser) {
      releaseLock();
      return res.status(409).json({ error: 'Workshop account deletion is in progress' });
    }
    const releaseStorage = beginActiveStorageOperation();
    job.tokenHash = null;
    job.status = 'processing';
    job.extensionWarnings = manifest.warnings;
    job.updatedAt = Date.now();
    job.expiresAt = job.updatedAt + MAKERWORLD_BRIDGE_PROCESS_TTL_MS;
    res.status(202).json(makerWorldBridgeJobResponse(job));
    setImmediate(() => {
      void processMakerWorldBridgeJob(
        job,
        manifest.assets,
        releaseLock,
        releaseUser,
        releaseStorage
      );
    });
  }
);

app.use('/api', (req, res, next) => {
  // Exemption is GET-only — only `<img>`/`<iframe>` loads need it. Any write
  // (e.g. DELETE /api/images/:id) still goes through auth + per-user scoping.
  if (req.method === 'GET' && isExemptPath(req.path)) return next();
  // Demo mode: no token, read-only against the shared starter snapshot.
  if (req.get('X-Demo') === '1') {
    if (req.method !== 'GET') return res.status(403).json({ error: DEMO_READONLY_MSG });
    const entry = getDemoDb();
    if (!entry) return res.status(503).json({ error: 'demo data unavailable' });
    req.db = entry.db;
    req.stmts = entry.stmts;
    return next();
  }
  // Authenticated: verify the token, then attach that user's own database.
  return requireAuth(req, res, () => withUserDb(req, res, next));
});

// Rate limit the paid AI endpoints per tenant-aware user key, not per IP.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,    // 1 hour
  limit: 30,                    // 30 analyze calls / user / hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userKey ?? ipKeyGenerator(req.ip),
  message: { error: 'rate limit exceeded — try again later' },
});
app.use(['/api/projects/analyze-url', '/api/shaper-projects/analyze-url'], aiLimiter);

const bambuImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userKey ?? ipKeyGenerator(req.ip),
  message: { error: 'Bambu import rate limit exceeded — try again later' },
});

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    sha: deploymentInfo.sha,
    version: deploymentInfo.version,
    instance: deploymentInstance,
    buildId: deploymentInfo.buildId,
    db: DB_PATH,
    exporter: offhostExportSchedule?.health().status ?? offhostExporterFallbackHealth,
  });
});

app.get('/api/live', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    sha: deploymentInfo.sha,
    version: deploymentInfo.version,
    buildId: deploymentInfo.buildId,
    instanceId: deploymentInstance,
  });
});

function readinessDatabasePath() {
  const userDatabase = readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.db'))
    .map(entry => entry.name)
    .sort()
    .at(0);
  if (userDatabase) return join(USERS_DIR, userDatabase);
  if (existsSync(DB_PATH)) return DB_PATH;
  throw new Error('no authoritative Workshop database is available');
}

app.get('/api/ready', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let database = null;
  try {
    const databasePath = readinessDatabasePath();
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.prepare('SELECT 1').get();
    const exporter = offhostExportSchedule?.health().status ?? offhostExporterFallbackHealth;
    if (exporter !== 'healthy') {
      return res.status(503).json({
        status: 'unavailable',
        sha: deploymentInfo.sha,
        version: deploymentInfo.version,
        buildId: deploymentInfo.buildId,
        instanceId: deploymentInstance,
        db: DB_PATH,
        dbRoot: USERS_DIR,
        database: { status: 'ready' },
        exporter,
      });
    }
    return res.json({
      status: 'ok',
      sha: deploymentInfo.sha,
      version: deploymentInfo.version,
      buildId: deploymentInfo.buildId,
      instanceId: deploymentInstance,
      db: DB_PATH,
      dbRoot: USERS_DIR,
      database: { status: 'ready' },
      exporter,
    });
  } catch (error) {
    console.error(JSON.stringify({
      component: 'readiness',
      event: 'database_unavailable',
      code: typeof error?.code === 'string' ? error.code : 'SQLITE_READINESS_FAILED',
    }));
    return res.status(503).json({
      status: 'unavailable',
      sha: deploymentInfo.sha,
      version: deploymentInfo.version,
      buildId: deploymentInfo.buildId,
      instanceId: deploymentInstance,
      db: DB_PATH,
      dbRoot: USERS_DIR,
      database: { status: 'unavailable' },
      exporter: offhostExportSchedule?.health().status ?? offhostExporterFallbackHealth,
    });
  } finally {
    database?.close();
  }
});

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  const { db, stmts } = req;
  const rows = stmts.listProjects.all().map(hydrateProject);
  res.json(rows);
});

app.get('/api/projects/:id', (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const project = hydrateProject(stmts.getProject.get(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const images    = stmts.listImages.all(id);
  const cut_list  = stmts.listCutList.all(id);
  const materials = stmts.listMaterials.all(id).map(m => ({ ...m, purchased: !!m.purchased }));
  const total_cost = materials.reduce((sum, m) => sum + (m.cost || 0), 0);
  const parts_count = cut_list.length;
  const build_log  = stmts.listBuildLog.all(id);
  const finish_log = stmts.listFinishLog.all(id);
  const links      = stmts.listProjectLinks.all(id, id);

  res.json({ ...project, images, cut_list, materials, total_cost, parts_count, build_log, finish_log, links });
});

app.post('/api/projects', (req, res) => {
  const { db, stmts } = req;
  const body = req.body ?? {};
  const info = stmts.insertProject.run({
    title: body.title ?? 'Untitled project',
    description: body.description ?? null,
    source_url: body.source_url || null,
    cut_plan_url: body.cut_plan_url || null,
    status: body.status ?? 'idea',
    difficulty: body.difficulty ?? 'Intermediate',
    estimated_hours: Number(body.estimated_hours) || 0,
    wood_types: toJsonArray(body.wood_types),
    tools_needed: toJsonArray(body.tools_needed),
  });
  res.status(201).json(hydrateProject(stmts.getProject.get(info.lastInsertRowid)));
});

app.put('/api/projects/:id', (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const existing = stmts.getProject.get(id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  const body = req.body ?? {};
  stmts.updateProject.run({
    id,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    source_url: body.source_url !== undefined ? (body.source_url || null) : existing.source_url,
    cut_plan_url: body.cut_plan_url !== undefined ? (body.cut_plan_url || null) : existing.cut_plan_url,
    status: body.status ?? existing.status,
    difficulty: body.difficulty ?? existing.difficulty,
    estimated_hours: body.estimated_hours !== undefined
      ? Number(body.estimated_hours) || 0
      : existing.estimated_hours,
    wood_types: body.wood_types !== undefined ? toJsonArray(body.wood_types) : existing.wood_types,
    tools_needed: body.tools_needed !== undefined ? toJsonArray(body.tools_needed) : existing.tools_needed,
  });
  res.json(hydrateProject(stmts.getProject.get(id)));
});

// Collect every disk-resident filename owned by a project so we can unlink
// them after the cascading DB delete. Runs before the delete so we still
// have the rows to inspect.
function collectProjectFiles(db, projectId) {
  const imgs    = db.prepare(`SELECT file_path FROM project_images   WHERE project_id = ? AND file_path IS NOT NULL`).all(projectId);
  const builds  = db.prepare(`SELECT file_path FROM build_log_entries WHERE project_id = ? AND file_path IS NOT NULL`).all(projectId);
  return [...imgs, ...builds].map(r => r.file_path);
}
function collectShaperProjectFiles(db, shaperProjectId) {
  const imgs = db.prepare(`SELECT file_path FROM project_images WHERE shaper_project_id = ? AND file_path IS NOT NULL`).all(shaperProjectId);
  return imgs.map(r => r.file_path);
}
function collectBambuProjectFiles(db, bambuProjectId) {
  return db.prepare(`
    SELECT file_path FROM bambu_assets
    WHERE bambu_project_id = ? AND file_path IS NOT NULL
  `).all(bambuProjectId).map(row => row.file_path);
}
async function unlinkAll(filenames) {
  await Promise.all(filenames.map(f => unlinkAsync(join(UPLOADS_PATH, basename(f))).catch(() => {})));
}

app.delete('/api/projects/:id', async (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const filesToRemove = collectProjectFiles(db, id);
  const info = stmts.deleteProject.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Project not found' });
  await unlinkAll(filesToRemove);
  res.json({ success: true });
});

app.get('/api/projects/:id/cut-plan-config', (req, res) => {
  const { db, stmts } = req;
  const row = stmts.getCutPlanConfig.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Project not found' });
  const config = row.cut_plan_config ? JSON.parse(row.cut_plan_config) : null;
  res.json({ config });
});

app.put('/api/projects/:id/cut-plan-config', (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  stmts.saveCutPlanConfig.run({ config: JSON.stringify(req.body), id });
  res.json({ success: true });
});

// ── Analyze project URL with Claude ──────────────────────────────────────────

const ANALYZE_SYSTEM = `You extract structured woodworking-project data from a webpage.
Return ONLY a single JSON object matching this exact shape — no prose, no markdown fences:

{
  "title": string,
  "description": string,                     // 1-3 sentences, plus a "## Build Steps" section if numbered steps exist
  "difficulty": "Beginner" | "Intermediate" | "Advanced",
  "estimated_hours": number,                 // 0 if not stated
  "wood_types": string[],                    // e.g. ["Plywood", "Walnut"]
  "tools_needed": string[],                  // e.g. ["Pocket-hole jig", "Table saw"]
  "cut_list": [
    { "part_name": string, "qty": number, "length": string|null, "width": string|null, "thickness": string|null, "material": string|null }
  ],
  "materials": [
    { "name": string, "qty_label": string|null }   // hardware, fasteners, finish, sheet goods
  ]
}

Rules:
- "Easy" → "Beginner", "Hard" / "Advanced" → "Advanced", default → "Intermediate".
- Dimensions stay as the page presents them (e.g. "27 1/2"). Do not convert units.
- Pull screw sizes mentioned in step text into materials (e.g. {"name":"1 1/4\\" pocket screws","qty_label":null}).
- If a field is missing, use the empty value ([], "", or 0). Do not invent numbers.`;

app.post('/api/projects/analyze-url', async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY in .env to enable Analyze.' });
  }

  let html;
  try {
    html = await safeFetchHtml(url);
  } catch (err) {
    return res.status(502).json({ error: `Fetch failed: ${err.message}` });
  }

  const nextData = extractNextData(html);
  const jsonLd   = extractJsonLd(html);
  const textLimit = (nextData || jsonLd.length > 0) ? 15_000 : 60_000;
  const text = htmlToPlainText(html).slice(0, textLimit);

  try {
    const structuredParts = [];
    if (nextData?.props?.pageProps) {
      structuredParts.push(`Next.js page data:\n${JSON.stringify(nextData.props.pageProps).slice(0, 14_000)}`);
    }
    if (jsonLd.length > 0) {
      structuredParts.push(`JSON-LD structured data:\n${JSON.stringify(jsonLd).slice(0, 6_000)}`);
    }
    const structuredContext = structuredParts.length > 0
      ? `\nStructured data extracted from page:\n---\n${structuredParts.join('\n\n')}\n---\n`
      : '';

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: ANALYZE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Source URL: ${url}${structuredContext}\nPage text:\n---\n${text}\n---\n\nReturn the JSON object.`,
      }],
    });

    const out = msg.content.find(b => b.type === 'text')?.text ?? '';
    const jsonStart = out.indexOf('{');
    const jsonEnd   = out.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) {
      return res.status(502).json({ error: 'AI did not return JSON', raw: out });
    }
    const parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
    res.json(parsed);
  } catch (err) {
    console.error('analyze-url error', err);
    res.status(500).json({ error: err.message ?? 'Analyze failed' });
  }
});

// ── Images ────────────────────────────────────────────────────────────────────

app.get('/api/images/:id', (req, res) => {
  const rdb = resolveReadDb(req);
  if (!rdb) return res.status(404).end();
  const row = rdb.stmts.getImage.get(Number(req.params.id));
  if (!row) return res.status(404).end();

  if (row.file_path) {
    // Serve from disk — basename prevents path traversal
    return res.sendFile(join(UPLOADS_PATH, basename(row.file_path)), {
      headers: {
        'Content-Type': row.image_type || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (!row.image_data) return res.status(404).end();
  res.setHeader('Content-Type', row.image_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(row.image_data);
});

app.post('/api/projects/:id/images', upload.single('file'), async (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  if (!stmts.getProject.get(project_id)) {
    if (req.file) await unlinkAsync(join(UPLOADS_PATH, req.file.filename)).catch(() => {});
    return res.status(404).json({ error: 'Project not found' });
  }

  const { kind, url } = req.body ?? {};
  if (kind !== 'sketch' && kind !== 'inspiration') {
    if (req.file) await unlinkAsync(join(UPLOADS_PATH, req.file.filename)).catch(() => {});
    return res.status(400).json({ error: 'kind must be "sketch" or "inspiration"' });
  }

  const sort_order = Date.now();

  if (req.file) {
    let mime;
    try { mime = await sniffMimeOrReject(join(UPLOADS_PATH, req.file.filename)); }
    catch (err) { return res.status(err.status ?? 400).json({ error: err.message }); }
    const info = stmts.insertImage.run({
      project_id, kind,
      image_data: null, image_type: mime,
      image_url: null, file_path: req.file.filename,
      sort_order,
    });
    return res.status(201).json({ id: info.lastInsertRowid, kind, image_type: mime });
  }

  if (url) {
    const info = stmts.insertImage.run({
      project_id, kind,
      image_data: null, image_type: null,
      image_url: url, file_path: null,
      sort_order,
    });
    return res.status(201).json({ id: info.lastInsertRowid, kind, image_url: url });
  }

  res.status(400).json({ error: 'provide file or url' });
});

app.delete('/api/images/:id', async (req, res) => {
  const { stmts } = req;
  const id = Number(req.params.id);
  const row = stmts.getImage.get(id);
  const info = stmts.deleteImage.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Image not found' });
  if (row?.file_path) {
    try {
      await unlinkIfPresent(join(UPLOADS_PATH, basename(row.file_path)));
    } catch (error) {
      console.error('[delete-image] failed to remove upload:', error.message);
    }
  }
  res.json({ success: true });
});

// ── Cut list ──────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/cut-list', (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  if (!stmts.getProject.get(project_id)) return res.status(404).json({ error: 'Project not found' });

  const b = req.body ?? {};
  const info = stmts.insertCutItem.run({
    project_id,
    part_name: b.part_name ?? 'Part',
    qty: Number(b.qty) || 1,
    length: b.length ?? null,
    width: b.width ?? null,
    thickness: b.thickness ?? null,
    material: b.material ?? null,
    sort_order: Number(b.sort_order) || Date.now(),
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/cut-list/:id', (req, res) => {
  const { db, stmts } = req;
  const b = req.body ?? {};
  if (typeof b.part_name !== 'string' || !b.part_name.trim()) {
    return res.status(400).json({ error: 'part_name is required' });
  }
  const info = stmts.updateCutItem.run({
    id: Number(req.params.id),
    part_name: b.part_name.trim(),
    qty: Number(b.qty) || 1,
    length: b.length ?? null,
    width: b.width ?? null,
    thickness: b.thickness ?? null,
    material: b.material ?? null,
    sort_order: Number(b.sort_order) || 0,
  });
  if (info.changes === 0) return res.status(404).json({ error: 'Cut list item not found' });
  res.json({ success: true });
});

app.delete('/api/cut-list/:id', (req, res) => {
  const { db, stmts } = req;
  const info = stmts.deleteCutItem.run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Cut list item not found' });
  res.json({ success: true });
});

// ── Materials ─────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/materials', (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  if (!stmts.getProject.get(project_id)) return res.status(404).json({ error: 'Project not found' });

  const b = req.body ?? {};
  const info = stmts.insertMaterial.run({
    project_id,
    name: b.name ?? 'Material',
    qty_label: b.qty_label ?? null,
    cost: Number(b.cost) || 0,
    purchased: b.purchased ? 1 : 0,
    sort_order: Number(b.sort_order) || Date.now(),
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/materials/:id', (req, res) => {
  const { db, stmts } = req;
  const b = req.body ?? {};
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const info = stmts.updateMaterial.run({
    id: Number(req.params.id),
    name: b.name.trim(),
    qty_label: b.qty_label ?? null,
    cost: Number(b.cost) || 0,
    purchased: b.purchased ? 1 : 0,
    sort_order: Number(b.sort_order) || 0,
  });
  if (info.changes === 0) return res.status(404).json({ error: 'Material not found' });
  res.json({ success: true });
});

app.delete('/api/materials/:id', (req, res) => {
  const { db, stmts } = req;
  const info = stmts.deleteMaterial.run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Material not found' });
  res.json({ success: true });
});

app.patch('/api/materials/:id/purchased', (req, res) => {
  const { db, stmts } = req;
  stmts.setPurchased.run({ purchased: req.body.purchased ? 1 : 0, id: Number(req.params.id) });
  res.json({ success: true });
});

// ── Shopping list ─────────────────────────────────────────────────────────────

app.get('/api/shopping-list', (req, res) => {
  const { db, stmts } = req;
  const rows = stmts.getShoppingList.all().map(m => ({ ...m, purchased: !!m.purchased }));
  res.json(rows);
});

// ── Build log ─────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/build-log', (req, res) => {
  const { db, stmts } = req;
  res.json(stmts.listBuildLog.all(Number(req.params.id)));
});

app.post('/api/projects/:id/build-log', upload.single('file'), async (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  if (!stmts.getProject.get(project_id)) {
    if (req.file) await unlinkAsync(join(UPLOADS_PATH, req.file.filename)).catch(() => {});
    return res.status(404).json({ error: 'Project not found' });
  }
  const { note = '' } = req.body ?? {};
  let mime = null;
  if (req.file) {
    try { mime = await sniffMimeOrReject(join(UPLOADS_PATH, req.file.filename)); }
    catch (err) { return res.status(err.status ?? 400).json({ error: err.message }); }
  }
  const info = stmts.insertBuildLogEntry.run({
    project_id,
    note,
    file_path:  req.file ? req.file.filename : null,
    image_type: mime,
  });
  res.status(201).json(stmts.getBuildLogEntry.get(info.lastInsertRowid));
});

app.get('/api/build-log/:id/image', (req, res) => {
  const rdb = resolveReadDb(req);
  if (!rdb) return res.status(404).end();
  const row = rdb.stmts.getBuildLogEntry.get(Number(req.params.id));
  if (!row?.file_path) return res.status(404).end();
  res.sendFile(join(UPLOADS_PATH, basename(row.file_path)), {
    headers: {
      'Content-Type': row.image_type || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.delete('/api/build-log/:id', async (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const row = stmts.getBuildLogEntry.get(id);
  const info = stmts.deleteBuildLogEntry.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Build log entry not found' });
  if (row?.file_path) {
    try {
      await unlinkIfPresent(join(UPLOADS_PATH, basename(row.file_path)));
    } catch (error) {
      console.error('[delete-build-log] failed to remove upload:', error.message);
    }
  }
  res.json({ success: true });
});

// ── Finish log ────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/finish-log', (req, res) => {
  const { db, stmts } = req;
  res.json(stmts.listFinishLog.all(Number(req.params.id)));
});

app.post('/api/projects/:id/finish-log', (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  if (!stmts.getProject.get(project_id)) return res.status(404).json({ error: 'Project not found' });
  const b = req.body ?? {};
  const info = stmts.insertFinishLogEntry.run({
    project_id,
    product_name: b.product_name ?? 'Product',
    finish_type:  b.finish_type  ?? null,
    color:        b.color        ?? null,
    coats:        b.coats        ? Number(b.coats) : null,
    notes:        b.notes        ?? null,
    applied_at:   b.applied_at   || new Date().toISOString().slice(0, 10),
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/finish-log/:id', (req, res) => {
  const { db, stmts } = req;
  const b = req.body ?? {};
  stmts.updateFinishLogEntry.run({
    id:           Number(req.params.id),
    product_name: b.product_name ?? '',
    finish_type:  b.finish_type  ?? null,
    color:        b.color        ?? null,
    coats:        b.coats        ? Number(b.coats) : null,
    notes:        b.notes        ?? null,
    applied_at:   b.applied_at   || new Date().toISOString().slice(0, 10),
  });
  res.json({ success: true });
});

app.delete('/api/finish-log/:id', (req, res) => {
  const { db, stmts } = req;
  const info = stmts.deleteFinishLogEntry.run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Finish log entry not found' });
  res.json({ success: true });
});

// ── Project links ─────────────────────────────────────────────────────────────

app.get('/api/projects/:id/links', (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  res.json(stmts.listProjectLinks.all(id, id));
});

app.post('/api/projects/:id/links', (req, res) => {
  const { db, stmts } = req;
  const project_id = Number(req.params.id);
  const { linked_project_id, relationship = 'related' } = req.body ?? {};
  const linkedId = Number(linked_project_id);
  if (!linkedId || linkedId === project_id) {
    return res.status(400).json({ error: 'Invalid linked_project_id' });
  }
  if (!stmts.getProject.get(linkedId)) {
    return res.status(404).json({ error: 'Linked project not found' });
  }
  if (stmts.reverseLinkExists.get(linkedId, project_id)) {
    return res.status(409).json({ error: 'These projects are already linked' });
  }
  stmts.insertProjectLink.run({ project_id, linked_project_id: linkedId, relationship });
  res.status(201).json({ success: true });
});

app.delete('/api/project-links/:id', (req, res) => {
  const { db, stmts } = req;
  const info = stmts.deleteProjectLink.run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Link not found' });
  res.json({ success: true });
});

// ── Templates ─────────────────────────────────────────────────────────────────

app.get('/api/templates', (req, res) => {
  const { db, stmts } = req;
  const rows = stmts.listTemplates.all().map(hydrateProject);
  res.json(rows);
});

app.post('/api/projects/:id/save-as-template', (req, res) => {
  const { db, stmts } = req;
  const sourceId = Number(req.params.id);
  const source = stmts.getProject.get(sourceId);
  if (!source) return res.status(404).json({ error: 'Project not found' });

  const templateName = (req.body?.template_name || source.title).trim();

  const newId = db.transaction(() => {
    const info = stmts.insertProject.run({
      title: templateName, description: source.description ?? null,
      source_url: source.source_url ?? null, cut_plan_url: null,
      status: 'idea', difficulty: source.difficulty ?? 'Intermediate',
      estimated_hours: source.estimated_hours ?? 0,
      wood_types: source.wood_types, tools_needed: source.tools_needed,
    });
    const id = info.lastInsertRowid;
    stmts.setTemplate.run({ template_name: templateName, id });
    for (const item of stmts.listCutList.all(sourceId)) {
      stmts.insertCutItem.run({ project_id: id, part_name: item.part_name, qty: item.qty, length: item.length, width: item.width, thickness: item.thickness, material: item.material, sort_order: item.sort_order });
    }
    for (const mat of stmts.listMaterials.all(sourceId)) {
      stmts.insertMaterial.run({ project_id: id, name: mat.name, qty_label: mat.qty_label, cost: mat.cost, purchased: 0, sort_order: mat.sort_order });
    }
    return id;
  })();

  res.status(201).json(hydrateProject(stmts.getProject.get(newId)));
});

app.post('/api/templates/:id/clone', (req, res) => {
  const { db, stmts } = req;
  const templateId = Number(req.params.id);
  const template = stmts.getProject.get(templateId);
  if (!template || !template.is_template) return res.status(404).json({ error: 'Template not found' });

  const title = (req.body?.title || template.template_name || template.title).trim();

  const newId = db.transaction(() => {
    const info = stmts.insertProject.run({
      title, description: template.description ?? null,
      source_url: template.source_url ?? null, cut_plan_url: null,
      status: 'idea', difficulty: template.difficulty ?? 'Intermediate',
      estimated_hours: template.estimated_hours ?? 0,
      wood_types: template.wood_types, tools_needed: template.tools_needed,
    });
    const id = info.lastInsertRowid;
    for (const item of stmts.listCutList.all(templateId)) {
      stmts.insertCutItem.run({ project_id: id, part_name: item.part_name, qty: item.qty, length: item.length, width: item.width, thickness: item.thickness, material: item.material, sort_order: item.sort_order });
    }
    for (const mat of stmts.listMaterials.all(templateId)) {
      stmts.insertMaterial.run({ project_id: id, name: mat.name, qty_label: mat.qty_label, cost: mat.cost, purchased: 0, sort_order: mat.sort_order });
    }
    return id;
  })();

  res.status(201).json(hydrateProject(stmts.getProject.get(newId)));
});

app.delete('/api/templates/:id', (req, res) => {
  const { db, stmts } = req;
  const row = stmts.getProject.get(Number(req.params.id));
  if (!row || !row.is_template) return res.status(404).json({ error: 'Template not found' });
  stmts.deleteProject.run(row.id);
  res.json({ success: true });
});

// ── Provider connections ──────────────────────────────────────────────────────

app.get('/api/provider-connections', (req, res) => {
  const userKey = req.user?.userKey ?? '';
  res.json({
    thingiverse: thingiverseConnectionStatus(req.stmts, userKey),
  });
});

app.put('/api/provider-connections/thingiverse', bambuImportLimiter, async (req, res) => {
  if (!PROVIDER_TOKEN_KEY) {
    return res.status(503).json({
      error: 'Provider token encryption is not configured on the Workshop server.',
    });
  }

  let token;
  try {
    token = normalizeThingiverseToken(req.body?.token);
    await validateThingiverseToken(token);
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 400).json({
      error: error.message || 'Thingiverse token could not be saved',
    });
  }

  const userKey = req.user.userKey;
  req.stmts.upsertProviderCredential.run({
    provider: 'thingiverse',
    token_enc: encryptProviderToken(userKey, 'thingiverse', token),
  });
  return res.json(thingiverseConnectionStatus(req.stmts, userKey));
});

app.delete('/api/provider-connections/thingiverse', (req, res) => {
  req.stmts.deleteProviderCredential.run('thingiverse');
  return res.json(thingiverseConnectionStatus(req.stmts, req.user.userKey));
});

// ── Bambu Hub Projects ────────────────────────────────────────────────────────

app.get('/api/bambu-projects', (req, res) => {
  res.json(req.stmts.listBambuProjects.all().map(project => ({
    ...project,
    import_warnings: parseJsonArray(project.import_warnings),
    assets: [],
  })));
});

app.get('/api/bambu-projects/:id', (req, res) => {
  const project = hydrateBambuProject(req.stmts, Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Bambu project not found' });
  res.json(project);
});

app.post(
  '/api/bambu-projects/:id/makerworld-bridge-jobs',
  bambuImportLimiter,
  (req, res) => {
    const projectId = Number(req.params.id);
    const project = req.stmts.getBambuProject.get(projectId);
    if (!project) return res.status(404).json({ error: 'Bambu project not found' });
    if (project.source_site !== 'makerworld' || !project.source_model_id) {
      return res.status(400).json({ error: 'Automatic bridge import is available only for MakerWorld projects' });
    }

    pruneMakerWorldBridgeJobs();
    for (const existing of makerWorldBridgeJobs.values()) {
      if (existing.userKey !== req.user.userKey) continue;
      if (existing.status === 'processing') {
        return res.status(409).json({ error: 'A MakerWorld import is already processing' });
      }
      if (existing.status === 'waiting') makerWorldBridgeJobs.delete(existing.id);
    }
    if (makerWorldBridgeJobs.size >= MAKERWORLD_BRIDGE_MAX_JOBS) {
      return res.status(503).json({ error: 'MakerWorld bridge is busy — try again shortly' });
    }

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const job = {
      id: randomUUID(),
      tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
      userKey: req.user.userKey,
      projectId,
      designId: String(project.source_model_id),
      sourceUrl: project.source_url,
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MAKERWORLD_BRIDGE_JOB_TTL_MS,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      warnings: [],
      extensionWarnings: [],
      error: null,
    };
    makerWorldBridgeJobs.set(job.id, job);
    return res.status(201).json({
      ...makerWorldBridgeJobResponse(job),
      token,
      design_id: job.designId,
      source_url: job.sourceUrl,
      submit_path: `/api/extensions/makerworld-import/${job.id}`,
    });
  }
);

app.get('/api/bambu-projects/:id/makerworld-bridge-jobs/:jobId', (req, res) => {
  pruneMakerWorldBridgeJobs();
  const job = makerWorldBridgeJobs.get(String(req.params.jobId));
  if (
    !job
    || job.userKey !== req.user.userKey
    || job.projectId !== Number(req.params.id)
  ) {
    return res.status(404).json({ error: 'MakerWorld import job not found or expired' });
  }
  return res.json(makerWorldBridgeJobResponse(job));
});

function sendBambuAsset(res, asset, { attachment, cacheControl }) {
  const headers = {
    'Content-Type': asset.content_type || 'application/octet-stream',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  };
  if (attachment) {
    const asciiName = asset.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(asset.filename)
      .replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    headers['Content-Disposition'] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
  }
  res.sendFile(join(UPLOADS_PATH, basename(asset.file_path)), { headers }, error => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).end();
  });
}

app.get('/api/bambu-assets/:id/image', (req, res) => {
  const entry = resolveReadDb(req);
  if (!entry) return res.status(404).end();
  const asset = entry.stmts.getBambuAsset.get(Number(req.params.id));
  if (!asset?.file_path || asset.kind !== 'image') return res.status(404).end();
  sendBambuAsset(res, asset, {
    attachment: false,
    cacheControl: 'public, max-age=3600',
  });
});

app.get('/api/bambu-assets/:id', (req, res) => {
  const asset = req.stmts.getBambuAsset.get(Number(req.params.id));
  if (!asset?.file_path) return res.status(404).json({ error: 'Bambu asset not found' });
  sendBambuAsset(res, asset, {
    attachment: asset.kind !== 'image',
    cacheControl: 'private, max-age=3600',
  });
});

app.post(
  '/api/bambu-projects/:id/assets',
  serializeBambuRequest,
  receiveBambuUpload,
  async (req, res) => {
    const { stmts } = req;
    const projectId = Number(req.params.id);
    const project = stmts.getBambuProject.get(projectId);
    const uploadedPath = req.file
      ? join(UPLOADS_PATH, basename(req.file.filename))
      : null;

    if (!project) {
      if (uploadedPath) await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(404).json({ error: 'Bambu project not found' });
    }
    if (!req.file || !uploadedPath) {
      return res.status(400).json({ error: 'file is required' });
    }
    if (req.file.size <= 0) {
      await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(400).json({ error: 'Uploaded file is empty' });
    }

    const currentBytes = Number(stmts.bambuStorageUsage.get()?.total_bytes) || 0;
    if (currentBytes + req.file.size > BAMBU_MAX_USER_BYTES) {
      await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(413).json({ error: 'Bambu Hub storage exceeds the 5 GB per-account limit' });
    }
    const projectBytes = Number(stmts.bambuProjectStorageUsage.get(projectId)?.total_bytes) || 0;
    if (projectBytes + req.file.size > BAMBU_MAX_PROJECT_BYTES) {
      await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(413).json({ error: 'Bambu project storage exceeds the 1 GB limit' });
    }

    const filename = sanitizeAssetFilename(req.file.originalname, 'Bambu file');
    if (extname(filename).toLowerCase() === '.svg') {
      await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(400).json({ error: 'SVG files cannot be added to Bambu Hub' });
    }

    let detected;
    try {
      detected = await fileTypeFromFile(uploadedPath);
      const blockedMimes = new Set([
        'application/x-msdownload',
        'application/x-executable',
        'application/x-elf',
        'application/x-mach-binary',
      ]);
      if (blockedMimes.has(detected?.mime) || await fileStartsWithMarkup(uploadedPath)) {
        throw apiError('Executable and web-page files cannot be added to Bambu Hub');
      }
    } catch (error) {
      await unlinkAsync(uploadedPath).catch(() => {});
      return res.status(Number.isInteger(error.status) ? error.status : 400).json({
        error: error.message || 'Uploaded file could not be validated',
      });
    }

    const kind = detected?.mime?.startsWith('image/')
      ? 'image'
      : bambuAssetKind(filename);
    const contentType = detected?.mime || contentTypeForFilename(filename);

    let assetId;
    try {
      assetId = Number(stmts.insertBambuAsset.run({
        bambu_project_id: projectId,
        kind,
        filename,
        content_type: contentType,
        size_bytes: req.file.size,
        original_url: project.source_url,
        file_path: req.file.filename,
        sort_order: Date.now(),
      }).lastInsertRowid);
      stmts.touchBambuProject.run(projectId);
    } catch (error) {
      await unlinkAsync(uploadedPath).catch(() => {});
      throw error;
    }

    return res.status(201).json(publicBambuAsset(stmts.getBambuAsset.get(assetId)));
  }
);

app.delete('/api/bambu-assets/:id', serializeBambuRequest, async (req, res) => {
  const { stmts } = req;
  const id = Number(req.params.id);
  const asset = stmts.getBambuAsset.get(id);
  if (!asset) return res.status(404).json({ error: 'Bambu asset not found' });
  if (asset.file_path) {
    try {
      await unlinkIfPresent(join(UPLOADS_PATH, basename(asset.file_path)));
    } catch (error) {
      console.error('[bambu/asset-delete]', error);
      return res.status(500).json({
        error: 'Bambu asset file could not be removed. Try again.',
      });
    }
  }
  stmts.deleteBambuAsset.run(id);
  stmts.touchBambuProject.run(asset.bambu_project_id);
  return res.json({ success: true });
});

app.post('/api/bambu-projects/analyze-url', bambuImportLimiter, async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const source = parseBambuSourceUrl(url);
    const thingiverseToken = source.site === 'thingiverse'
      ? thingiverseTokenForRequest(req)
      : undefined;
    const inspection = await inspectBambuSource(source.sourceUrl, { thingiverseToken });
    return res.json(bambuAnalysisResponse(inspection));
  } catch (error) {
    console.error('[bambu/analyze]', error.message);
    return res.status(Number.isInteger(error.status) ? error.status : 502).json({
      error: error.message || 'Could not read that model page',
    });
  }
});

app.post(
  '/api/bambu-projects',
  bambuImportLimiter,
  serializeBambuRequest,
  async (req, res) => {
    const { stmts } = req;
    const body = req.body ?? {};
    if (typeof body.source_url !== 'string' || !body.source_url.trim()) {
      return res.status(400).json({ error: 'source_url is required' });
    }
    const userBytes = Number(stmts.bambuStorageUsage.get()?.total_bytes) || 0;
    if (userBytes >= BAMBU_MAX_USER_BYTES) {
      return res.status(413).json({ error: 'Bambu Hub storage has reached the 5 GB per-account limit' });
    }

    let inspection;
    try {
      const source = parseBambuSourceUrl(body.source_url);
      const thingiverseToken = source.site === 'thingiverse'
        ? thingiverseTokenForRequest(req)
        : undefined;
      inspection = await inspectBambuSource(source.sourceUrl, {
        includeDownloadUrls: true,
        thingiverseToken,
      });
    } catch (error) {
      console.error('[bambu/import]', error.message);
      return res.status(Number.isInteger(error.status) ? error.status : 502).json({
        error: error.message || 'Could not import that model page',
      });
    }

    const info = stmts.insertBambuProject.run({
      title: cleanBambuInput(body.title, 300) || inspection.title || `3D model ${inspection.sourceModelId}`,
      source_url: inspection.sourceUrl,
      source_site: inspection.sourceSite,
      source_model_id: inspection.sourceModelId,
      description: body.description !== undefined
        ? cleanBambuInput(body.description, 50_000)
        : (inspection.description || null),
      creator_name: body.creator_name !== undefined
        ? cleanBambuInput(body.creator_name, 300)
        : inspection.creatorName,
      license_name: body.license_name !== undefined
        ? cleanBambuInput(body.license_name, 300)
        : inspection.licenseName,
    });
    const projectId = Number(info.lastInsertRowid);
    const warnings = [...inspection.warnings];
    const importState = { totalBytes: 0, userBytes };
    const assets = [...inspection.images, ...inspection.files];

    for (const [index, asset] of assets.entries()) {
      if (!asset.downloadUrl) continue;
      let downloaded;
      try {
        downloaded = await downloadBambuAsset(asset, importState);
        stmts.insertBambuAsset.run({
          bambu_project_id: projectId,
          kind: asset.kind,
          filename: asset.filename,
          content_type: downloaded.contentType,
          size_bytes: downloaded.sizeBytes,
          original_url: asset.originalUrl || asset.downloadUrl,
          file_path: downloaded.filePath,
          sort_order: index,
        });
      } catch (error) {
        if (downloaded?.filePath) {
          await unlinkAsync(join(UPLOADS_PATH, basename(downloaded.filePath))).catch(() => {});
        }
        warnings.push(`${asset.filename}: ${error.message || 'download failed'}`);
      }
    }

    stmts.saveBambuImportWarnings.run({
      id: projectId,
      warnings: JSON.stringify(warnings.slice(0, 100)),
    });
    const project = hydrateBambuProject(stmts, projectId);
    return res.status(201).json({ project, warnings: warnings.slice(0, 100) });
  }
);

app.put('/api/bambu-projects/:id', serializeBambuRequest, (req, res) => {
  const { stmts } = req;
  const id = Number(req.params.id);
  const existing = stmts.getBambuProject.get(id);
  if (!existing) return res.status(404).json({ error: 'Bambu project not found' });

  const body = req.body ?? {};
  let source;
  try {
    source = parseBambuSourceUrl(body.source_url ?? existing.source_url);
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 400).json({ error: error.message });
  }
  if (source.site !== existing.source_site || source.modelId !== existing.source_model_id) {
    return res.status(409).json({
      error: 'Create a new Bambu project to import a different source model.',
    });
  }

  stmts.updateBambuProject.run({
    id,
    title: body.title !== undefined
      ? (cleanBambuInput(body.title, 300) || existing.title)
      : existing.title,
    source_url: source.sourceUrl,
    description: cleanBambuInput(body.description, 50_000),
    creator_name: cleanBambuInput(body.creator_name, 300),
    license_name: cleanBambuInput(body.license_name, 300),
  });
  return res.json(hydrateBambuProject(stmts, id));
});

app.delete('/api/bambu-projects/:id', serializeBambuRequest, async (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  if (!stmts.getBambuProject.get(id)) {
    return res.status(404).json({ error: 'Bambu project not found' });
  }
  const filesToRemove = collectBambuProjectFiles(db, id);
  try {
    await Promise.all(
      filesToRemove.map(file => unlinkIfPresent(join(UPLOADS_PATH, basename(file))))
    );
  } catch (error) {
    console.error('[bambu/delete]', error);
    return res.status(500).json({
      error: 'Bambu project files could not be removed. Try deleting the project again.',
    });
  }
  const info = stmts.deleteBambuProject.run(id);
  if (info.changes === 0) {
    return res.status(409).json({ error: 'Bambu project changed during deletion. Try again.' });
  }
  return res.json({ success: true });
});

// ── Shaper Hub Projects ───────────────────────────────────────────────────────

const SHAPER_ANALYZE_SYSTEM = `You extract structured data from a Shaper Tools Hub project page.

Return ONLY a single JSON object — no prose, no markdown fences:

{
  "title":        string,
  "description":  string,
  "materials":    [{"name": string, "qty": string}],
  "instructions": string,
  "image_urls":   string[]
}

Rules:
- title: the project name
- description: 1-3 sentence summary of what is being made
- materials: list of required materials, lumber, sheet goods, hardware, fasteners
- instructions: full step-by-step instructions if available, else a summary of the build process
- image_urls: all image URLs found in the structured data for this project (photos, renders, diagrams). Include every distinct image URL you find. Return [] if none found.
- Return "" for missing text fields, [] for missing arrays
- Do NOT invent content not found in the page
- ALWAYS write all output in English, regardless of the source page language. Translate any non-English content.`;

app.get('/api/shaper-projects', (req, res) => {
  const { db, stmts } = req;
  const rows = stmts.listShaperProjects.all().map(s => {
    const hero = stmts.shaperHeroImage.get(s.id);
    return { ...s, materials: parseJsonArray(s.materials), hero_image_id: hero ? hero.id : null };
  });
  res.json(rows);
});

app.get('/api/shaper-projects/:id', (req, res) => {
  const { db, stmts } = req;
  const row = stmts.getShaperProject.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const images   = stmts.listShaperImages.all(row.id);
  const cut_list = stmts.listShaperCutList.all(row.id);
  res.json({ ...row, materials: parseJsonArray(row.materials), images, cut_list });
});

app.post('/api/shaper-projects/analyze-url', async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

  const anthropic = getAnthropic();
  if (!anthropic) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY to enable Analyze.' });

  let html;
  try {
    html = await safeFetchHtml(url);
  } catch (err) {
    return res.status(502).json({ error: `Fetch failed: ${err.message}` });
  }

  const og       = extractOgMeta(html);
  const nextData = extractNextData(html);
  const jsonLd   = extractJsonLd(html);

  // When structured JSON is available, plain text adds little and wastes tokens.
  const textLimit = (nextData || jsonLd.length > 0) ? 15_000 : 60_000;
  const text = htmlToPlainText(html).slice(0, textLimit);

  try {
    const ogContext = [
      og.title       ? `og:title: ${og.title}`             : '',
      og.description ? `og:description: ${og.description}` : '',
    ].filter(Boolean).join('\n');

    // Build structured context from Next.js SSR data and JSON-LD.
    const structuredParts = [];
    if (nextData?.props?.pageProps) {
      structuredParts.push(`Next.js page data:\n${JSON.stringify(nextData.props.pageProps).slice(0, 14_000)}`);
    }
    if (jsonLd.length > 0) {
      structuredParts.push(`JSON-LD structured data:\n${JSON.stringify(jsonLd).slice(0, 6_000)}`);
    }
    const structuredContext = structuredParts.length > 0
      ? `\nStructured data extracted from page:\n---\n${structuredParts.join('\n\n')}\n---\n`
      : '';

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SHAPER_ANALYZE_SYSTEM,
      messages: [{ role: 'user', content: `Source URL: ${url}\n${ogContext ? `\n${ogContext}\n` : ''}${structuredContext}\nPage text:\n---\n${text}\n---\n\nReturn the JSON object. Translate everything to English.` }],
    });
    const out = msg.content.find(b => b.type === 'text')?.text ?? '';
    const js  = out.indexOf('{');
    const je  = out.lastIndexOf('}');
    if (js < 0 || je < 0) return res.status(502).json({ error: 'AI did not return JSON', raw: out });
    const parsed = JSON.parse(out.slice(js, je + 1));

    const primaryPhoto = og.image || '';
    const allImageUrls = Array.isArray(parsed.image_urls)
      ? parsed.image_urls.filter(u => typeof u === 'string' && u.startsWith('http'))
      : [];
    // Exclude the og:image from the extra list — it's already the primary photo
    const extraImageUrls = allImageUrls.filter(u => u !== primaryPhoto);

    res.json({
      title:        parsed.title       || og.title       || '',
      description:  parsed.description || og.description || '',
      photo_url:    primaryPhoto,
      materials:    Array.isArray(parsed.materials) ? parsed.materials : [],
      instructions: parsed.instructions || '',
      image_urls:   extraImageUrls,
    });
  } catch (err) {
    console.error('shaper analyze-url error', err);
    res.status(500).json({ error: err.message ?? 'Analyze failed' });
  }
});

app.post('/api/shaper-projects', (req, res) => {
  const { db, stmts } = req;
  const b = req.body ?? {};
  const info = stmts.insertShaperProject.run({
    title:        b.title        ?? '',
    shaper_url:   b.shaper_url   ?? '',
    description:  b.description  ?? null,
    photo_url:    b.photo_url    ?? null,
    materials:    JSON.stringify(Array.isArray(b.materials) ? b.materials : []),
    instructions: b.instructions ?? null,
  });
  const row = stmts.getShaperProject.get(info.lastInsertRowid);
  res.status(201).json({ ...row, materials: parseJsonArray(row.materials) });
});

app.put('/api/shaper-projects/:id', (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const existing = stmts.getShaperProject.get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  stmts.updateShaperProject.run({
    id,
    title:        b.title        !== undefined ? b.title        : existing.title,
    shaper_url:   b.shaper_url   !== undefined ? b.shaper_url   : existing.shaper_url,
    description:  b.description  !== undefined ? (b.description  || null) : existing.description,
    photo_url:    b.photo_url    !== undefined ? (b.photo_url    || null) : existing.photo_url,
    materials:    b.materials    !== undefined ? JSON.stringify(Array.isArray(b.materials) ? b.materials : []) : existing.materials,
    instructions: b.instructions !== undefined ? (b.instructions || null) : existing.instructions,
  });
  const row = stmts.getShaperProject.get(id);
  res.json({ ...row, materials: parseJsonArray(row.materials) });
});

app.post('/api/shaper-projects/:id/images', upload.single('file'), async (req, res) => {
  const { db, stmts } = req;
  const shaper_project_id = Number(req.params.id);
  if (!stmts.getShaperProject.get(shaper_project_id)) {
    if (req.file) await unlinkAsync(join(UPLOADS_PATH, req.file.filename)).catch(() => {});
    return res.status(404).json({ error: 'Not found' });
  }
  const { kind = 'sketch', url } = req.body ?? {};
  const sort_order = Date.now();
  if (req.file) {
    let mime;
    try { mime = await sniffMimeOrReject(join(UPLOADS_PATH, req.file.filename)); }
    catch (err) { return res.status(err.status ?? 400).json({ error: err.message }); }
    const info = stmts.insertShaperImage.run({ shaper_project_id, kind, image_type: mime, image_url: null, file_path: req.file.filename, sort_order });
    return res.status(201).json({ id: info.lastInsertRowid, kind, image_type: mime });
  }
  if (url) {
    const info = stmts.insertShaperImage.run({ shaper_project_id, kind, image_type: null, image_url: url, file_path: null, sort_order });
    return res.status(201).json({ id: info.lastInsertRowid, kind, image_url: url });
  }
  res.status(400).json({ error: 'provide file or url' });
});

app.post('/api/shaper-projects/:id/cut-list', (req, res) => {
  const { db, stmts } = req;
  const shaper_project_id = Number(req.params.id);
  if (!stmts.getShaperProject.get(shaper_project_id)) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const info = stmts.insertShaperCutItem.run({
    shaper_project_id,
    part_name:  b.part_name  ?? 'Part',
    qty:        Number(b.qty) || 1,
    length:     b.length     ?? null,
    width:      b.width      ?? null,
    thickness:  b.thickness  ?? null,
    material:   b.material   ?? null,
    sort_order: Number(b.sort_order) || Date.now(),
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/shaper-projects/:id', async (req, res) => {
  const { db, stmts } = req;
  const id = Number(req.params.id);
  const filesToRemove = collectShaperProjectFiles(db, id);
  const info = stmts.deleteShaperProject.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  await unlinkAll(filesToRemove);
  res.json({ success: true });
});

// Notebook routes removed: the Workshop notebook UI is now a read-only view
// onto a Tabloom notebook (see src/services/tabloomApi.ts). The notebook_pages
// and notebook_links tables are left in place but unused.

app.get('/{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

function closeAllDatabases() {
  stopRecoverySchedule();
  stopOffhostSchedule();
  for (const { db } of dbHandles.values()) {
    if (db.open) db.close();
  }
  dbHandles.clear();
  makerWorldBridgeJobs.clear();
  bambuRequestLocks.clear();
  if (demoEntry?.db.open) demoEntry.db.close();
  demoEntry = null;
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Workshop API listening on http://localhost:${PORT}`);
    startRecoverySchedule();
    startOffhostSchedule();
  });
}

export {
  app,
  bambuAnalysisResponse,
  closeAllDatabases,
  entraUserKey,
  getUserDb,
  initSchema,
  inspectBambuSource,
  mintSession,
  parseBambuSourceUrl,
  readinessDatabasePath,
  runRecoveryBackup,
  userKeyFromBearer,
};
