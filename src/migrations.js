// Versioned, reversible schema migrations. Each one is additive (new tables, columns, triggers),
// never rewrites or drops existing data on the way up, and has a `down` that removes exactly what it
// added. Before any pending migration runs, the database is copied with VACUUM INTO, so a release can
// always be rolled back to the previous file as well.
//   node tools/migrate.mjs status | down <id>
import fs from 'node:fs';

export const MIGRATIONS = [
  {
    id: '003-control-register',
    description: 'Control register and control test records',
    up: `
      -- A control the organization operates (distinct from the framework catalogue in "controls").
      CREATE TABLE IF NOT EXISTS org_controls (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner_id INTEGER REFERENCES users(id),
        frequency TEXT NOT NULL DEFAULT 'quarterly' CHECK (frequency IN ('continuous','monthly','quarterly','semiannual','annual')),
        framework_ids TEXT NOT NULL DEFAULT '[]',
        statement_refs TEXT NOT NULL DEFAULT '[]',
        evidence_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        design_status TEXT NOT NULL DEFAULT 'draft' CHECK (design_status IN ('draft','approved')),
        design_author INTEGER REFERENCES users(id),
        design_approved_by INTEGER REFERENCES users(id),
        design_approved_at TEXT,
        last_tested_on TEXT,
        next_due TEXT,
        result TEXT NOT NULL DEFAULT 'not_tested' CHECK (result IN ('pass','fail','exception','not_tested')),
        effectiveness TEXT CHECK (effectiveness IN ('effective','partially_effective','ineffective')),
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (org_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_org_controls_org ON org_controls(org_id);

      -- One record per test performed. The test itself is immutable; only the closure of a failure
      -- (by someone other than the tester) is written later.
      CREATE TABLE IF NOT EXISTS control_tests (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        control_id INTEGER NOT NULL REFERENCES org_controls(id) ON DELETE CASCADE,
        tester_id INTEGER NOT NULL REFERENCES users(id),
        tested_on TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('pass','fail','exception')),
        effectiveness TEXT NOT NULL CHECK (effectiveness IN ('effective','partially_effective','ineffective')),
        methodology TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        evidence_ids TEXT NOT NULL DEFAULT '[]',
        failure_status TEXT CHECK (failure_status IN ('open','closed')),
        closed_by INTEGER REFERENCES users(id),
        closed_at TEXT,
        close_note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_control_tests_control ON control_tests(control_id, tested_on);
      CREATE INDEX IF NOT EXISTS idx_control_tests_org ON control_tests(org_id);
      CREATE TRIGGER IF NOT EXISTS control_tests_immutable
        BEFORE UPDATE OF control_id, tester_id, tested_on, result, effectiveness, methodology, notes, evidence_ids, created_at ON control_tests
        BEGIN SELECT RAISE(ABORT, 'control test records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS control_tests_no_delete BEFORE DELETE ON control_tests
        WHEN (SELECT COUNT(*) FROM org_controls WHERE id = OLD.control_id) > 0
        BEGIN SELECT RAISE(ABORT, 'control test records cannot be deleted'); END;
    `,
    down: `
      DROP TRIGGER IF EXISTS control_tests_no_delete;
      DROP TRIGGER IF EXISTS control_tests_immutable;
      DROP TABLE IF EXISTS control_tests;
      DROP TABLE IF EXISTS org_controls;
    `,
  },
  {
    id: '004-findings',
    description: 'Findings and corrective action (CAP / POA&M)',
    up: `
      CREATE TABLE IF NOT EXISTS findings (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('control_test','self_assessment','audit','expired_exception','manual')),
        severity TEXT NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
        control_id INTEGER REFERENCES org_controls(id) ON DELETE SET NULL,
        control_test_id INTEGER REFERENCES control_tests(id) ON DELETE SET NULL,
        policy_id INTEGER REFERENCES policies(id) ON DELETE SET NULL,
        statement_id TEXT,
        risk_id INTEGER REFERENCES risks(id) ON DELETE SET NULL,
        exception_id INTEGER REFERENCES exceptions(id) ON DELETE SET NULL,
        owner_id INTEGER REFERENCES users(id),
        identified_on TEXT NOT NULL,
        due_date TEXT,
        remediation_plan TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Remediated','Closed','Risk-Accepted')),
        closure_note TEXT,
        closure_evidence_ids TEXT NOT NULL DEFAULT '[]',
        closure_requested_by INTEGER REFERENCES users(id),
        closure_requested_at TEXT,
        closed_by INTEGER REFERENCES users(id),
        closed_at TEXT,
        decision_note TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (org_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_findings_org ON findings(org_id, status);
      -- One finding per failed test and per expired exception, so automatic creation is idempotent.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_test ON findings(control_test_id) WHERE control_test_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_exception ON findings(exception_id) WHERE exception_id IS NOT NULL;
    `,
    // Phase 1 stored open test failures on the test record; each becomes a finding.
    data(db) {
      const open = db.prepare(`SELECT ct.*, oc.owner_id, oc.code ccode, oc.name cname FROM control_tests ct JOIN org_controls oc ON oc.id = ct.control_id
        WHERE ct.failure_status = 'open' AND NOT EXISTS (SELECT 1 FROM findings f WHERE f.control_test_id = ct.id)`).all();
      for (const t of open) {
        const max = db.prepare("SELECT code FROM findings WHERE org_id = ?").all(t.org_id).reduce((m, r) => Math.max(m, parseInt(r.code.split('-').pop(), 10) || 0), 0);
        const due = new Date(Date.parse(t.tested_on) + 30 * 86400_000).toISOString().slice(0, 10);
        db.prepare(`INSERT INTO findings(org_id, code, title, description, source, severity, control_id, control_test_id, owner_id, identified_on, due_date, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.org_id, `FND-${String(max + 1).padStart(3, '0')}`, `${t.ccode} ${t.cname} failed its test`, t.notes || t.methodology,
          'control_test', 'High', t.control_id, t.id, t.owner_id, t.tested_on, due, t.tester_id);
      }
    },
    down: `
      DROP INDEX IF EXISTS idx_findings_exception;
      DROP INDEX IF EXISTS idx_findings_test;
      DROP TABLE IF EXISTS findings;
    `,
  },
  {
    id: '005-soa',
    description: 'ISO/IEC 27001 Statement of Applicability (entries and versioned revisions)',
    up: `
      -- Current applicability decision per Annex A control. A missing row means "applicable, not yet justified".
      CREATE TABLE IF NOT EXISTS soa_entries (
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
        applicable INTEGER NOT NULL DEFAULT 1 CHECK (applicable IN (0, 1)),
        justification TEXT NOT NULL DEFAULT '',
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (org_id, control_id)
      );
      -- Every change is a new SoA version; the log is append-only.
      CREATE TABLE IF NOT EXISTS soa_revisions (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        changes TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (org_id, version)
      );
      CREATE TRIGGER IF NOT EXISTS soa_revisions_no_update BEFORE UPDATE ON soa_revisions
        BEGIN SELECT RAISE(ABORT, 'SoA revisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS soa_revisions_no_delete BEFORE DELETE ON soa_revisions
        WHEN (SELECT COUNT(*) FROM orgs WHERE id = OLD.org_id) > 0
        BEGIN SELECT RAISE(ABORT, 'SoA revisions are append-only'); END;
    `,
    down: `
      DROP TRIGGER IF EXISTS soa_revisions_no_delete;
      DROP TRIGGER IF EXISTS soa_revisions_no_update;
      DROP TABLE IF EXISTS soa_revisions;
      DROP TABLE IF EXISTS soa_entries;
    `,
  },
  {
    id: '006-risk-controls',
    description: 'Link risks to the controls in the control register that mitigate them',
    up: "ALTER TABLE risks ADD COLUMN org_control_ids TEXT NOT NULL DEFAULT '[]';",
    down: 'ALTER TABLE risks DROP COLUMN org_control_ids;',
  },
  {
    id: '007-vendors',
    description: 'Vendor / third-party risk: vendors, security questionnaires and SOC 2 reports',
    up: `
      CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        owner_id INTEGER REFERENCES users(id),
        criticality TEXT NOT NULL DEFAULT 'Medium' CHECK (criticality IN ('Critical','High','Medium','Low')),
        data_access TEXT NOT NULL DEFAULT 'internal' CHECK (data_access IN ('none','internal','confidential','restricted')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','offboarded')),
        questionnaire TEXT NOT NULL DEFAULT '{}',
        assessed_on TEXT,
        assessed_by INTEGER REFERENCES users(id),
        risk_rating TEXT CHECK (risk_rating IN ('Critical','High','Medium','Low')),
        reassessment_due TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (org_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);
      -- SOC 2 (or similar) reports. The PDF is stored under the data directory, named by its SHA-256.
      CREATE TABLE IF NOT EXISTS vendor_reports (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        report_type TEXT NOT NULL CHECK (report_type IN ('SOC 2 Type II','SOC 2 Type I','ISO 27001 certificate','Other')),
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        period_end TEXT,
        opinion TEXT CHECK (opinion IN ('unqualified','qualified','adverse','not_applicable')),
        exceptions_noted TEXT NOT NULL DEFAULT '',
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        review_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_vendor_reports_vendor ON vendor_reports(vendor_id);
    `,
    down: `
      DROP TABLE IF EXISTS vendor_reports;
      DROP TABLE IF EXISTS vendors;
    `,
  },
];

const ensureTable = (db) => db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, description TEXT, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);

export function appliedMigrations(db) {
  ensureTable(db);
  return db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id').all();
}

export function runMigrations(db, dbPath, { log = () => {} } = {}) {
  ensureTable(db);
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const pending = MIGRATIONS.filter((m) => !done.has(m.id));
  if (!pending.length) return [];
  // A brand-new database has nothing to protect; an existing one is copied first.
  const hasData = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  if (hasData && dbPath) {
    const backup = `${dbPath}.pre-${pending[0].id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    try { fs.chmodSync(backup, 0o600); } catch { /* best effort */ }
    log(`Backed up the database to ${backup} before migrating.`);
  }
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.up);
      m.data?.(db);
      db.prepare('INSERT INTO schema_migrations(id, description) VALUES (?, ?)').run(m.id, m.description);
      db.exec('COMMIT');
      log(`Applied migration ${m.id}: ${m.description}`);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return pending.map((m) => m.id);
}

// Reverts one migration and every migration applied after it, newest first.
export function revertMigration(db, id) {
  const idx = MIGRATIONS.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error(`Unknown migration ${id}`);
  ensureTable(db);
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const reverted = [];
  for (const m of MIGRATIONS.slice(idx).reverse()) {
    if (!done.has(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.down);
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(m.id);
      db.exec('COMMIT');
      reverted.push(m.id);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return reverted;
}
