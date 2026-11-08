// Inspect or roll back schema migrations.
//   node tools/migrate.mjs status
//   node tools/migrate.mjs down <migration-id>    (stop the server first; a backup is taken)
import { db, DB_PATH } from '../src/db.js';
import { MIGRATIONS, appliedMigrations, revertMigration } from '../src/migrations.js';

const [cmd, id] = process.argv.slice(2);
if (cmd === 'status' || !cmd) {
  const done = new Map(appliedMigrations(db).map((r) => [r.id, r.applied_at]));
  for (const m of MIGRATIONS) console.log(`${done.has(m.id) ? '✓' : '·'} ${m.id}  ${m.description}${done.has(m.id) ? `  (applied ${done.get(m.id)})` : ''}`);
} else if (cmd === 'down' && id) {
  const backup = `${DB_PATH}.pre-down-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Backed up to ${backup}`);
  console.log(`Reverted: ${revertMigration(db, id).join(', ') || 'nothing (not applied)'}`);
} else {
  console.log('Usage: node tools/migrate.mjs status | down <migration-id>');
  process.exit(1);
}
