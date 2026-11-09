// Phase 5.3: asset register for scoping.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';
import { unzip } from '../src/zip.js';

let srv, admin;
before(async () => { srv = await startServer(); admin = await client(srv.base, { username: 'ash.admin' }); });
after(() => srv.stop());

test('assets reference policies, controls and risks; filters find them from each side', async () => {
  const { id: pid } = await admin.post('/api/policies', { template: 'access-control' });
  const { id: cid } = await admin.post('/api/control-register', { name: 'MFA on VPN', frequency: 'quarterly', framework_ids: [], statement_refs: [] });
  const { id: rid } = await admin.post('/api/risks', { title: 'Card data breach', owner: 'CISO', likelihood: 3, impact: 5, res_likelihood: 2, res_impact: 5, treatment: 'Mitigate', status: 'Open' });
  const { id, code } = await admin.post('/api/assets', { name: 'Payments API', asset_type: 'Application', classification: 'Restricted', environment: 'Production', owner_id: admin.user.id,
    scope_tags: ['ISO27001', 'PCIDSS'], policy_ids: [pid], control_ids: [cid], risk_ids: [rid, 999999] });
  assert.match(code, /^AST-\d{3}$/);
  const [a] = await admin.get(`/api/assets?control_id=${cid}`);
  assert.equal(a.id, id);
  assert.deepEqual(a.risk_ids, [rid], 'links to other workspaces or missing items are dropped');
  assert.equal((await admin.get(`/api/assets?policy_id=${pid}`)).length, 1);
  assert.equal((await admin.get(`/api/assets?risk_id=${rid}`)).length, 1);
  assert.equal((await admin.get('/api/assets?scope=PCIDSS')).length, 1);
  assert.equal((await admin.get('/api/assets?scope=HIPAA')).length, 0);
  await assert.rejects(admin.post('/api/assets', { name: 'X system', asset_type: 'System', classification: 'Internal', environment: 'Production', scope_tags: ['NOPE'] }), (e) => e.status === 400);
});

test('changes are audited, retired assets are locked, and the audit package lists in-scope assets', async () => {
  const { id } = await admin.post('/api/assets', { name: 'HR file share', asset_type: 'Data', classification: 'Confidential', environment: 'Corporate', scope_tags: ['ISO27001'] });
  const a = (await admin.get('/api/assets')).find((x) => x.id === id);
  await admin.put(`/api/assets/${id}`, { ...a, classification: 'Restricted' });
  const log = await admin.get('/api/audit?q=asset.updated');
  assert.deepEqual(JSON.parse(log.rows[0].details).classification, ['Confidential', 'Restricted']);
  await admin.post(`/api/assets/${id}/status`, { status: 'retired', reason: 'Migrated to the document platform.' });
  await assert.rejects(admin.put(`/api/assets/${id}`, a), (e) => e.status === 409);
  const r = await fetch(srv.base + '/api/audit-package', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: srv.base, Cookie: admin.cookieHeader(), 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ scope: 'PCIDSS' }) });
  const files = unzip(Buffer.from(await r.arrayBuffer()));
  const csv = files.find((f) => f.name === 'assets/asset-register.csv').data.toString();
  assert.ok(csv.includes('Payments API'), 'PCI-scoped asset included');
  assert.ok(!csv.includes('HR file share'), 'ISO-only asset excluded from a PCI package');
  const auditor = await client(srv.base, { invite: (await admin.post('/api/invites', { role: 'auditor' })).code });
  await assert.rejects(auditor.post('/api/assets', { name: 'Nope', asset_type: 'System', classification: 'Internal', environment: 'Production' }), (e) => e.status === 403);
});
