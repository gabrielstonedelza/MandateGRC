// SQLite persistence layer (Node built-in, no third-party drivers).
// Multi-tenant: every row of workspace data carries an org_id, and every query filters on it.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { runMigrations } from './migrations.js';
import path from 'node:path';

// Files created by MandateGRC (database, WAL journal) are private to the service account.
process.umask(0o077);

export const DATA_DIR = path.resolve(process.env.MANDATEGRC_DATA_DIR || process.env.MANDATE_DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const DB_PATH = path.join(DATA_DIR, 'mandate.db');
const SCHEMA_VERSION = 2;

// Version 1 was single-workspace. Its file is kept as a backup rather than migrated in place.
function backupLegacyDatabase() {
  if (!fs.existsSync(DB_PATH)) return null;
  const probe = new DatabaseSync(DB_PATH);
  let legacy = false;
  try {
    const v = probe.prepare('PRAGMA user_version').get().user_version;
    const hasUsers = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    legacy = !!hasUsers && v < SCHEMA_VERSION;
  } finally { probe.close(); }
  if (!legacy) return null;
  const backup = `${DB_PATH}.v1-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) fs.renameSync(DB_PATH + suffix, backup + suffix);
  }
  return backup;
}
export const LEGACY_BACKUP = backupLegacyDatabase();

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA secure_delete = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  risk_appetite INTEGER NOT NULL DEFAULT 9,
  session_idle_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','approver','auditor','employee')),
  active INTEGER NOT NULL DEFAULT 1,
  user_handle TEXT,
  onboarded_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Passkeys: only the public key is stored. Biometrics never leave the user's device.
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL DEFAULT 'Passkey',
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

-- One-time invite (join a workspace) and recovery (new passkey) codes, stored hashed.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('join','recover')),
  role TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Built-in catalogues have scope 'global'; custom frameworks have scope 'org:<id>'.
CREATE TABLE IF NOT EXISTS frameworks (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  custom INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scope, code)
);

CREATE TABLE IF NOT EXISTS controls (
  id INTEGER PRIMARY KEY,
  framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  family TEXT,
  themes TEXT NOT NULL DEFAULT '',
  UNIQUE (framework_id, ref)
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','published','retired')),
  owner TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'Internal',
  effective_date TEXT,
  review_cycle_months INTEGER NOT NULL DEFAULT 12,
  next_review_date TEXT,
  purpose TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  statements TEXT NOT NULL DEFAULT '[]',
  roles TEXT NOT NULL DEFAULT '[]',
  enforcement TEXT NOT NULL DEFAULT '',
  ref_controls TEXT NOT NULL DEFAULT '[]',
  related_docs TEXT NOT NULL DEFAULT '',
  pending_change_type TEXT,
  pending_change_summary TEXT,
  review_note TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  submitted_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  published_at TEXT,
  published_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS policy_revisions (
  id INTEGER PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  approver_id INTEGER REFERENCES users(id),
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS risks (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Information Security',
  owner TEXT NOT NULL DEFAULT '',
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
  res_likelihood INTEGER NOT NULL CHECK (res_likelihood BETWEEN 1 AND 5),
  res_impact INTEGER NOT NULL CHECK (res_impact BETWEEN 1 AND 5),
  treatment TEXT NOT NULL DEFAULT 'Mitigate' CHECK (treatment IN ('Mitigate','Accept','Transfer','Avoid')),
  treatment_plan TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Treatment','Accepted','Closed')),
  due_date TEXT,
  sle REAL,
  aro REAL,
  policy_ids TEXT NOT NULL DEFAULT '[]',
  control_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  statement_ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  justification TEXT NOT NULL,
  compensating TEXT NOT NULL DEFAULT '',
  likelihood INTEGER NOT NULL DEFAULT 3,
  impact INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Approved','Rejected','Closed')),
  expires_at TEXT NOT NULL,
  requested_by INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  collected_on TEXT NOT NULL,
  valid_days INTEGER NOT NULL DEFAULT 90,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attestations (
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (policy_id, version, user_id)
);

-- Tamper-evident, append-only audit trail: one SHA-256 hash chain per workspace.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, id);
CREATE INDEX IF NOT EXISTS idx_policies_org ON policies(org_id);
CREATE INDEX IF NOT EXISTS idx_risks_org ON risks(org_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_org ON exceptions(org_id);
CREATE INDEX IF NOT EXISTS idx_evidence_org ON evidence(org_id);
CREATE INDEX IF NOT EXISTS idx_controls_fw ON controls(framework_id);
CREATE INDEX IF NOT EXISTS idx_rev_policy ON policy_revisions(policy_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id);

PRAGMA user_version = ${SCHEMA_VERSION};
`);

// ---- Migrations for databases created by earlier v2 builds
// `sample` marks the demo content seeded into a new workspace, so it can be labelled and removed.
const SAMPLE_TABLES = ['policies', 'risks', 'exceptions', 'evidence'];
let addedSample = false;
for (const t of SAMPLE_TABLES) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN sample INTEGER NOT NULL DEFAULT 0`); addedSample = true; } catch { /* column exists */ }
}
// The policy type chosen at creation drives the review's coverage checklist (null = detect from name).
try { db.exec('ALTER TABLE policies ADD COLUMN policy_type TEXT'); } catch { /* column exists */ }
if (addedSample) {
  // Backfill: sample content was inserted in the same transaction that created the workspace.
  for (const t of SAMPLE_TABLES) {
    db.exec(`UPDATE ${t} SET sample = 1 WHERE org_id IN (SELECT org_id FROM users WHERE username LIKE 'demo-%')
      AND julianday(created_at) - julianday((SELECT created_at FROM orgs WHERE orgs.id = ${t}.org_id)) < 10.0 / 86400`);
  }
}

// Versioned migrations (src/migrations.js): additive, reversible, with a backup before each run.
runMigrations(db, DB_PATH, { log: (m) => { if (!process.env.MANDATEGRC_QUIET) console.log(`  ${m}`); } });

try { fs.chmodSync(DB_PATH, 0o600); } catch { /* best effort */ }

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Human-friendly sequential codes (POL-001, RSK-001…) numbered per workspace.
const CODE_TABLES = new Set(['policies', 'risks', 'exceptions', 'org_controls', 'findings', 'vendors', 'assets']);
export function nextCode(table, prefix, orgId) {
  if (!CODE_TABLES.has(table)) throw new Error('bad table');
  const rows = all(`SELECT code FROM ${table} WHERE org_id = ? AND code LIKE ?`, orgId, prefix + '-%');
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.code.split('-').pop(), 10) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export const orgSettings = (orgId) => get('SELECT * FROM orgs WHERE id = ?', orgId);
