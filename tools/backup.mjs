// Consistent online backup of the MandateGRC database (safe while the server is running), plus uploaded files.
//
//   npm run backup                 → data/backups/mandate-YYYY-MM-DDTHH-MM-SS.db
//   npm run backup -- /some/dir    → /some/dir/mandate-….db
//
// Uses SQLite's VACUUM INTO, which writes a compact, transactionally consistent copy.
// Keeps the 14 most recent backups in the default folder.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.MANDATEGRC_DATA_DIR || process.env.MANDATE_DATA_DIR || 'data');
const dbPath = path.join(dataDir, 'mandate.db');
if (!fs.existsSync(dbPath)) { console.error(`No database at ${dbPath}`); process.exit(1); }

const outDir = path.resolve(process.argv[2] || path.join(dataDir, 'backups'));
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const out = path.join(outDir, `mandate-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);

process.umask(0o077);
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);

// Uploaded files (vendor reports) are stored by SHA-256, so copying only what is missing is enough.
const uploads = path.join(dataDir, 'uploads');
if (fs.existsSync(uploads)) {
  let copied = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d);
      else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied++; }
    }
  };
  walk(uploads, path.join(outDir, 'uploads'));
  console.log(`Uploaded files: ${copied} new file(s) copied to ${path.join(outDir, 'uploads')}`);
}

if (!process.argv[2]) {
  const old = fs.readdirSync(outDir).filter((f) => /^mandate-.*\.db$/.test(f)).sort().slice(0, -14);
  old.forEach((f) => fs.unlinkSync(path.join(outDir, f)));
  if (old.length) console.log(`Removed ${old.length} old backup(s).`);
}
