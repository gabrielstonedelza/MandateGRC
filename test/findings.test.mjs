// Phase 2: findings & corrective action — auto-creation, lifecycle, SoD, traceability, audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, client } from './server.mjs';

let srv, admin, approver, analyst, employee, meta, policyId;
const fw = (code, ref) => meta.controls.find((c) => c.framework_code === code && c.ref === ref).id;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);
const join = async (role) => client(srv.base, { invite: (await admin.post('/api/invites', { role })).code });
const evidence = async (who) => (await who.post('/api/evidence', { control_id: fw('ISO27001', '8.5'), title: 'Remediation proof', location: 'https://wiki.example/fix', owner: 'IT', collected_on: today(), valid_days: 90 })).id;

before(async () => {
  srv = await startServer();
  admin = await client(srv.base, { username: 'fiona.admin' });
  approver = await join('approver');
  analyst = await join('analyst');
  employee = await join('employee');
  meta = await admin.get('/api/meta');
  ({ id: policyId } = await admin.post('/api/policies', { template: 'access-control' }));
});
after(() => srv.stop());

async function failedControl(ownerId = analyst.user.id) {
  const { id } = await admin.post('/api/control-register', { name: 'MFA enforced on the VPN', owner_id: ownerId, frequency: 'quarterly', framework_ids: [fw('ISO27001', '8.5')], statement_refs: [] });
  await approver.post(`/api/control-register/${id}/approve-design`);
  const r = await analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'fail', methodology: 'Tried a password-only login.', notes: 'Legacy profile accepts password-only logins.' });
  return { controlId: id, findingId: r.finding.id, testId: (await admin.get(`/api/control-register/${id}`)).tests[0].id };
}

test('a failed control test creates a linked finding with an owner and a due date', async () => {
  const { controlId, findingId } = await failedControl();
  const f = await admin.get(`/api/findings/${findingId}`);
  assert.equal(f.source, 'control_test');
  assert.equal(f.severity, 'High');
  assert.equal(f.status, 'Open');
  assert.equal(f.control_id, controlId);
  assert.equal(f.owner_id, analyst.user.id, 'owned by the control owner');
  assert.equal(f.due_date, plusDays(today(), 30), 'High: 30-day remediation window');
  assert.equal(f.test.result, 'fail');
  const perControl = await admin.get(`/api/findings?control_id=${controlId}`);
  assert.deepEqual(perControl.map((x) => x.id), [findingId], 'findings appear in the per-control view');
});

test('lifecycle: plan → in progress → remediated with evidence → closed by a different approver; the test failure closes too', async () => {
  const { controlId, findingId, testId } = await failedControl(approver.user.id);
  let f = await approver.get(`/api/findings/${findingId}`);
  await assert.rejects(approver.post(`/api/findings/${findingId}/start`), (e) => e.status === 400, 'needs a plan first');
  await approver.put(`/api/findings/${findingId}`, { ...f, remediation_plan: 'Remove the legacy VPN profile and force re-enrolment.', due_date: plusDays(today(), 10) });
  await approver.post(`/api/findings/${findingId}/start`);
  await assert.rejects(approver.post(`/api/findings/${findingId}/request-closure`, { note: 'Legacy profile removed.' }), (e) => e.status === 400, 'needs evidence');
  await approver.post(`/api/findings/${findingId}/request-closure`, { note: 'Legacy profile removed; no password-only logins since.', evidence_ids: [await evidence(approver)] });
  f = await admin.get(`/api/findings/${findingId}`);
  assert.equal(f.status, 'Remediated');
  assert.equal(f.evidence.length, 1);
  await assert.rejects(approver.post(`/api/findings/${findingId}/approve-closure`, {}), (e) => e.status === 403, 'the owner cannot approve their own closure');
  await assert.rejects(analyst.post(`/api/findings/${findingId}/approve-closure`, {}), (e) => e.status === 403, 'analysts cannot approve closures');
  await admin.post(`/api/findings/${findingId}/approve-closure`, { note: 'Evidence reviewed.' });
  f = await admin.get(`/api/findings/${findingId}`);
  assert.equal(f.status, 'Closed');
  assert.equal(f.closed_by, admin.user.id);
  const c = await admin.get(`/api/control-register/${controlId}`);
  assert.equal(c.tests.find((t) => t.id === testId).failure_status, 'closed');
  assert.equal(c.open_failures, 0);
  const actions = f.history.map((h) => h.action);
  for (const a of ['finding.created', 'finding.updated', 'finding.in_progress', 'finding.remediated', 'finding.approval_blocked_sod', 'finding.closed']) assert.ok(actions.includes(a), `history missing ${a}`);
});

test('the person who requested closure cannot approve it; an approver can send it back', async () => {
  const { findingId } = await failedControl();
  const f = await admin.get(`/api/findings/${findingId}`);
  await admin.put(`/api/findings/${findingId}`, { ...f, remediation_plan: 'Rebuild the profile.' });
  await admin.post(`/api/findings/${findingId}/request-closure`, { note: 'Profile rebuilt with MFA required.', evidence_ids: [await evidence(admin)] });
  await assert.rejects(admin.post(`/api/findings/${findingId}/approve-closure`, {}), (e) => e.status === 403);
  await assert.rejects(approver.post(`/api/findings/${findingId}/reject-closure`, { note: 'short' }), (e) => e.status === 400);
  await approver.post(`/api/findings/${findingId}/reject-closure`, { note: 'The evidence predates the fix; attach a new export.' });
  assert.equal((await admin.get(`/api/findings/${findingId}`)).status, 'In Progress');
});

test('risk acceptance needs a justification and a non-owner approver, and links the risk', async () => {
  const { findingId } = await failedControl();
  const risk = await admin.post('/api/risks', { title: 'Password-only VPN access', owner: 'CISO', likelihood: 3, impact: 4, res_likelihood: 2, res_impact: 3, treatment: 'Accept', status: 'Accepted' });
  await assert.rejects(approver.post(`/api/findings/${findingId}/accept-risk`, { note: 'too short' }), (e) => e.status === 400);
  await approver.post(`/api/findings/${findingId}/accept-risk`, { note: 'Legacy profile serves one vendor until contract end; compensating IP allow-list.', risk_id: risk.id });
  const f = await admin.get(`/api/findings/${findingId}`);
  assert.equal(f.status, 'Risk-Accepted');
  assert.equal(f.risk_id, risk.id);
  assert.deepEqual((await admin.get(`/api/findings?risk_id=${risk.id}`)).map((x) => x.id), [findingId], 'findings appear in the per-risk view');
  await assert.rejects(admin.put(`/api/findings/${findingId}`, f), (e) => e.status === 409, 'accepted findings are locked');
});

test('an expired exception creates one finding automatically', async () => {
  const ex = await analyst.post('/api/exceptions', { policy_id: policyId, title: 'Legacy payroll app without MFA', justification: 'Vendor upgrade pending.', compensating: 'IP allow-list and monthly log review.', likelihood: 4, impact: 4, expires_at: plusDays(today(), 10) });
  await approver.post(`/api/exceptions/${ex.id}/decide`, { decision: 'Approved' });
  // Time travel: move the expiry into the past directly in the test server's database.
  const db = new DatabaseSync(srv.dbPath);
  db.prepare('UPDATE exceptions SET expires_at = ? WHERE id = ?').run(plusDays(today(), -2), ex.id);
  db.close();
  const list = await admin.get(`/api/findings?exception_id=${ex.id}`);
  assert.equal(list.length, 1);
  assert.equal(list[0].source, 'expired_exception');
  assert.equal(list[0].severity, 'High', 'severity from the exception risk score (4×4 = 16)');
  assert.equal(list[0].owner_id, analyst.user.id, 'owned by the requester');
  await admin.get('/api/dashboard');
  assert.equal((await admin.get(`/api/findings?exception_id=${ex.id}`)).length, 1, 'idempotent');
});

test('manual findings: default due date by severity, overdue findings surface, owners must be staff', async () => {
  const m = await admin.post('/api/findings', { title: 'Offboarding checklist not used for contractors', severity: 'Medium', source: 'audit', owner_id: analyst.user.id, policy_id: policyId });
  const f = await admin.get(`/api/findings/${m.id}`);
  assert.equal(f.due_date, plusDays(today(), 60));
  assert.equal(f.source, 'audit');
  const late = await admin.post('/api/findings', { title: 'Firewall rule review missed in Q2', severity: 'Low', owner_id: analyst.user.id, identified_on: '2026-01-10', due_date: '2026-02-10' });
  const list = await admin.get('/api/findings');
  assert.equal(list.find((x) => x.id === late.id).overdue, true);
  const dash = await admin.get('/api/dashboard');
  assert.ok(dash.findings.overdue >= 1);
  assert.ok(dash.actions.some((a) => a.kind === 'finding' && a.title.includes(late.code) && /overdue/.test(a.title)));
  await assert.rejects(admin.post('/api/findings', { title: 'Something to fix', severity: 'Low', owner_id: employee.user.id }), (e) => e.status === 400);
  await assert.rejects(employee.get('/api/findings'), (e) => e.status === 403);
});

test('non-owner analysts and auditors: who can edit what', async () => {
  const m = await admin.post('/api/findings', { title: 'Shared admin account on the NAS', severity: 'High', owner_id: approver.user.id });
  const auditor = await join('auditor');
  const f = await auditor.get(`/api/findings/${m.id}`);
  await assert.rejects(auditor.put(`/api/findings/${m.id}`, { ...f, remediation_plan: 'x' }), (e) => e.status === 403);
  // The owner (an approver) can update the plan but not reassign it.
  await approver.put(`/api/findings/${m.id}`, { ...f, remediation_plan: 'Create named accounts and disable the shared one.' });
  await assert.rejects(approver.put(`/api/findings/${m.id}`, { ...f, owner_id: admin.user.id }), (e) => e.status === 403);
  assert.equal((await admin.get('/api/audit/verify')).ok, true);
});
