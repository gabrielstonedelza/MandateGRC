// Phase 4: audit evidence package — contents, manifest hashes, independent chain verification, audit record.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer, client } from './server.mjs';
import { unzip } from '../src/zip.js';

let srv, admin;
before(async () => { srv = await startServer(); admin = await client(srv.base, { username: 'pat.admin' }); await admin.post('/api/policies', { template: 'access-control' }); });
after(() => srv.stop());

const generate = async (scope) => {
  const r = await fetch(srv.base + '/api/audit-package', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: srv.base, Cookie: admin.cookieHeader(), 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ scope }) });
  assert.equal(r.status, 200, await r.clone().text());
  return Buffer.from(await r.arrayBuffer());
};

test('a scoped package contains the expected files, a valid manifest, and verifies independently', async () => {
  const buf = await generate('ISO27001');
  const files = unzip(buf);
  const names = files.map((f) => f.name);
  for (const n of ['00-index.pdf', 'manifest.json', 'verify-package.mjs', 'controls/control-register.csv', 'risks/risk-register.csv', 'audit/audit-trail.jsonl', 'audit/hash-chain-verification.pdf', 'evidence/evidence-index.csv'])
    assert.ok(names.includes(n), `missing ${n}`);
  assert.ok(names.some((n) => n.startsWith('soa/') && n.endsWith('.pdf')), 'ISO scope includes the SoA');
  const manifest = JSON.parse(files.find((f) => f.name === 'manifest.json').data);
  assert.equal(manifest.scope, 'ISO27001');
  assert.equal(manifest.audit_chain.ok, true);
  for (const f of manifest.files) assert.equal(crypto.createHash('sha256').update(files.find((x) => x.name === f.path).data).digest('hex'), f.sha256, f.path);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-'));
  for (const f of files) { fs.mkdirSync(path.join(dir, path.dirname(f.name)), { recursive: true }); fs.writeFileSync(path.join(dir, f.name), f.data); }
  assert.match(execFileSync(process.execPath, [path.join(dir, 'verify-package.mjs')]).toString(), /chain intact/);
  // Tampering with the audit trail is detected.
  const p = path.join(dir, 'audit', 'audit-trail.jsonl');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"auth.signup"', '"auth.tampered"'));
  assert.throws(() => execFileSync(process.execPath, [path.join(dir, 'verify-package.mjs')], { stdio: 'pipe' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the export is recorded in the audit trail with the manifest hash; unknown scopes are rejected', async () => {
  const buf = await generate('all');
  const manifestSha = crypto.createHash('sha256').update(unzip(buf).find((f) => f.name === 'manifest.json').data).digest('hex');
  const hist = await admin.get('/api/audit-package/history');
  assert.equal(hist[0].details.manifest_sha256, manifestSha);
  assert.equal(hist[0].details.scope, 'all');
  await assert.rejects(admin.get('/api/audit-package/preview?scope=NOPE'), (e) => e.status === 400);
});
