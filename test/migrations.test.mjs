// Migrations are additive and reversible; test records are immutable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, revertMigration, appliedMigrations, MIGRATIONS } from '../src/migrations.js';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, username TEXT);
    INSERT INTO orgs VALUES (1, 'o'); INSERT INTO users VALUES (1, 1, 'u');`);
  return db;
}

test('migrations apply once, record themselves, and revert cleanly', () => {
  const db = base();
  assert.deepEqual(runMigrations(db, null), MIGRATIONS.map((m) => m.id));
  assert.deepEqual(runMigrations(db, null), [], 'idempotent');
  assert.equal(appliedMigrations(db).length, MIGRATIONS.length);
  db.exec("INSERT INTO org_controls(org_id, code, name) VALUES (1, 'CTL-001', 'x')");
  revertMigration(db, '003-control-register');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('org_controls','control_tests')").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orgs').get().n, 1, 'existing data untouched');
  runMigrations(db, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'org_controls'").get().n, 1, 're-applies after a revert');
});

test('control test records are immutable except for failure closure', () => {
  const db = base();
  runMigrations(db, null);
  db.exec("INSERT INTO org_controls(id, org_id, code, name) VALUES (1, 1, 'CTL-001', 'x')");
  db.exec("INSERT INTO control_tests(id, org_id, control_id, tester_id, tested_on, result, effectiveness, methodology, failure_status) VALUES (1, 1, 1, 1, '2026-01-01', 'fail', 'ineffective', 'm', 'open')");
  assert.throws(() => db.exec("UPDATE control_tests SET result = 'pass' WHERE id = 1"), /immutable/);
  assert.throws(() => db.exec('DELETE FROM control_tests WHERE id = 1'), /cannot be deleted/);
  db.exec("UPDATE control_tests SET failure_status = 'closed', closed_by = 1, close_note = 'fixed' WHERE id = 1");
  assert.equal(db.prepare('SELECT failure_status FROM control_tests WHERE id = 1').get().failure_status, 'closed');
});
