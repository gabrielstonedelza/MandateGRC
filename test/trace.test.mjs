// Phase 5.1: risk → control → policy → evidence traceability.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';

let srv, admin, approver, analyst, meta;
const fw = (code, ref) => meta.controls.find((c) => c.framework_code === code && c.ref === ref).id;
const today = () => new Date().toISOString().slice(0, 10);
const join = async (role) => client(srv.base, { invite: (await admin.post('/api/invites', { role })).code });
before(async () => {
  srv = await startServer();
  admin = await client(srv.base, { username: 'tara.admin' });
  approver = await join('approver');
  analyst = await join('analyst');
  meta = await admin.get('/api/meta');
});
after(() => srv.stop());

test('a risk shows its full mitigation chain and a verdict that follows the tests', async () => {
  const { id: pid } = await admin.post('/api/policies', { title: 'Access Control Policy' });
  const p = await admin.get(`/api/policies/${pid}`);
  p.statements = [{ id: 'm1', text: 'Multi-factor authentication must be enforced for all remote access.', controls: [fw('ISO27001', '8.5')] }];
  await admin.put(`/api/policies/${pid}`, p);
  const { id: cid } = await admin.post('/api/control-register', { name: 'MFA on VPN', owner_id: analyst.user.id, frequency: 'quarterly', framework_ids: [fw('ISO27001', '8.5')], statement_refs: [{ policy_id: pid, statement_id: 'm1' }] });
  const { id: other } = await admin.post('/api/control-register', { name: 'Access reviews', owner_id: analyst.user.id, frequency: 'quarterly', framework_ids: [fw('ISO27001', '5.18')], statement_refs: [] });
  const risk = await admin.post('/api/risks', { title: 'Account takeover via stolen VPN passwords', owner: 'CISO', likelihood: 4, impact: 4, res_likelihood: 2, res_impact: 4, treatment: 'Mitigate', status: 'In Treatment',
    policy_ids: [pid], control_ids: [fw('ISO27001', '8.5'), fw('ISO27001', '8.2')], org_control_ids: [other] });
  let t = await admin.get(`/api/risks/${risk.id}/trace`);
  assert.deepEqual(t.controls.map((c) => [c.id, c.link]).sort(), [[cid, 'requirement'], [other, 'direct']].sort());
  assert.deepEqual(t.controls.find((c) => c.id === cid).via, ['ISO27001 8.5']);
  assert.equal(t.controls.find((c) => c.id === cid).statements[0].num, '4.1');
  assert.equal(t.verdict, 'gap', 'untested controls are a gap');
  assert.deepEqual(t.summary.unoperated_requirements, ['ISO27001 8.2']);
  assert.equal(t.policies[0].id, pid);
  for (const id of [cid, other]) {
    await approver.post(`/api/control-register/${id}/approve-design`);
    const ev = (await analyst.post('/api/evidence', { control_id: fw('ISO27001', '8.5'), title: `Proof ${id}`, location: 'https://x', owner: 'IT', collected_on: today(), valid_days: 90 })).id;
    await analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled 25 records; all compliant.', evidence_ids: [ev] });
  }
  t = await admin.get(`/api/risks/${risk.id}/trace`);
  assert.equal(t.verdict, 'operating');
  assert.ok(t.controls.every((c) => c.latest_test.result === 'pass' && c.evidence.length === 1));
  // A failure on one control becomes a gap, and its finding appears on the risk.
  await analyst.post(`/api/control-register/${cid}/tests`, { tested_on: today(), result: 'fail', methodology: 'Password-only login allowed.', notes: 'Legacy profile.' });
  t = await admin.get(`/api/risks/${risk.id}/trace`);
  assert.equal(t.verdict, 'gap');
  assert.deepEqual(t.summary.gaps, [(await admin.get(`/api/control-register/${cid}`)).code]);
  assert.equal(t.findings.length, 1);
  assert.equal(t.summary.open_findings, 1);
});

test('a risk with no controls says so; links are validated and audited; other workspaces see nothing', async () => {
  const risk = await admin.post('/api/risks', { title: 'Insider data theft', owner: 'CISO', likelihood: 3, impact: 4, res_likelihood: 3, res_impact: 3, treatment: 'Mitigate', status: 'Open', org_control_ids: [999999] });
  const t = await admin.get(`/api/risks/${risk.id}/trace`);
  assert.equal(t.verdict, 'none');
  assert.equal((await admin.get('/api/risks')).find((r) => r.id === risk.id).org_control_ids.length, 0, 'unknown controls are dropped');
  const { id: cid } = await admin.post('/api/control-register', { name: 'DLP on email', frequency: 'monthly', framework_ids: [], statement_refs: [] });
  const r = (await admin.get('/api/risks')).find((x) => x.id === risk.id);
  await admin.put(`/api/risks/${risk.id}`, { ...r, org_control_ids: [cid] });
  const log = await admin.get('/api/audit?q=risk.updated');
  assert.ok(JSON.parse(log.rows[0].details).changes.org_control_ids);
  const outsider = await client(srv.base, { org: 'Elsewhere' });
  await assert.rejects(outsider.get(`/api/risks/${risk.id}/trace`), (e) => e.status === 404);
});
