import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createPriorFixture(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'idea', difficulty TEXT NOT NULL DEFAULT 'Intermediate',
      estimated_hours INTEGER NOT NULL DEFAULT 0, wood_types TEXT, tools_needed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE shaper_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      shaper_url TEXT NOT NULL DEFAULT '',
      description TEXT,
      photo_url TEXT,
      materials TEXT NOT NULL DEFAULT '[]',
      instructions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE project_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, kind TEXT NOT NULL,
      image_data BLOB, image_type TEXT, image_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE cut_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      shaper_project_id INTEGER REFERENCES shaper_projects(id) ON DELETE CASCADE,
      part_name TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, length TEXT, width TEXT, thickness TEXT,
      material TEXT, sort_order INTEGER NOT NULL DEFAULT 0, CHECK ((project_id IS NULL) <> (shaper_project_id IS NULL))
    );
    CREATE TABLE materials (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, qty_label TEXT, cost REAL NOT NULL DEFAULT 0, purchased INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
    INSERT INTO projects (title) VALUES ('Prior release project');
    INSERT INTO cut_list_items (project_id, part_name) VALUES (1, 'Apron');
    INSERT INTO materials (project_id, name) VALUES (1, 'Oak');
  `);
}

function parseArgs(args) {
  let profile = null;
  let initial = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--initial') {
      initial = true;
      continue;
    }
    if (args[index] === '--profile' && args[index + 1]) {
      profile = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${args[index]}`);
  }
  if (profile !== 'sqlite-one-worker') throw new Error('--profile must be sqlite-one-worker');
  return { initial, profile };
}

async function loadInitSchema(root) {
  const previous = new Map();
  const overrides = {
    NODE_ENV: 'test',
    AZURE_HOME_TENANT_ID: '00000000-0000-4000-8000-000000000001',
    API_AUDIENCE: '00000000-0000-4000-8000-000000000002',
    DATA_ROOT: root,
    DB_PATH: join(root, 'legacy.db'),
    SEED_DB_PATH: join(root, 'seed.db'),
    USERS_DIR: join(root, 'users'),
    UPLOADS_PATH: join(root, 'uploads'),
    BACKUP_PATH: join(root, 'backups'),
  };
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    const module = await import(`../server.js?migration-check=${Date.now()}`);
    return { close: module.closeAllDatabases, initSchema: module.initSchema, previous };
  } catch (error) {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    throw error;
  }
}

function restoreEnvironment(previous) {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

export async function checkMigrationCompatibility() {
  const root = mkdtempSync(join(tmpdir(), 'workshop-migration-check-'));
  const loaded = await loadInitSchema(root);
  const db = new Database(':memory:');
  try {
    createPriorFixture(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      loaded.initSchema(db, { acceptLegacySessionTokens: true });
      const integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`integrity check failed: ${integrity}`);
      if (db.pragma('foreign_key_check', { simple: true }) !== undefined) throw new Error('foreign key check failed');
      const required = [
        'projects',
        'project_images',
        'cut_list_items',
        'materials',
        'build_log_entries',
        'finish_log_entries',
        'project_links',
        'shaper_projects',
        'notebook_pages',
        'notebook_links',
        'user_profile',
        'auth_state',
        'apple_credentials',
        'account_deletion_files',
      ];
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      if (!required.every(table => tables.has(table))) throw new Error('candidate schema is missing required tables');
      const projectColumns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(column => column.name));
      for (const column of ['source_url', 'cut_plan_url', 'cut_plan_config', 'is_template', 'template_name']) {
        if (!projectColumns.has(column)) throw new Error(`candidate projects schema is missing ${column}`);
      }
      const imageColumns = new Set(db.prepare('PRAGMA table_info(project_images)').all().map(column => column.name));
      for (const column of ['file_path', 'shaper_project_id']) {
        if (!imageColumns.has(column)) throw new Error(`candidate project_images schema is missing ${column}`);
      }
      const row = db.prepare('SELECT title, source_url, cut_plan_url, is_template FROM projects WHERE id = 1').get();
      if (row?.title !== 'Prior release project') throw new Error('candidate migration lost representative data');
      if (db.prepare('SELECT accept_legacy_tokens FROM auth_state WHERE id = 1').get()?.accept_legacy_tokens !== 1) {
        throw new Error('candidate migration did not preserve legacy session compatibility');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const priorRead = db.prepare(`
      SELECT p.title, p.status, p.difficulty, p.is_template, c.part_name, m.name
      FROM projects p JOIN cut_list_items c ON c.project_id = p.id
      JOIN materials m ON m.project_id = p.id WHERE p.id = 1
    `).get();
    if (priorRead?.title !== 'Prior release project' || priorRead.part_name !== 'Apron' || priorRead.name !== 'Oak') {
      throw new Error('prior-release read compatibility failed');
    }
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('foreign keys were not restored');
    return true;
  } finally {
    db.close();
    loaded.close();
    restoreEnvironment(loaded.previous);
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    parseArgs(process.argv.slice(2));
    await checkMigrationCompatibility();
    console.log('SQLite migration compatibility passed');
  } catch (error) {
    console.error(`SQLite migration compatibility failed: ${error.message}`);
    process.exitCode = 1;
  }
}

export { parseArgs };
