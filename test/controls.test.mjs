// Phase 1: control register, design approval, testing, failures, SoD and audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';

let srv, admin, approver, analyst, meta, policyId, sid;
const fw = (code, ref) => meta.controls.find((c) => c.framework_code === code && c.ref === ref).id;
const today = () => new Date().toISOString().slice(0, 10);
const join = async (role) => client(srv.base, { invite: (await admin.post('/api/invites', { role })).code });

before(async () => {
  srv = await startServer();
  admin = await client(srv.base, { username: 'ada.admin' });
  approver = await join('approver');
  analyst = await join('analyst');
  meta = await admin.get('/api/meta');
  ({ id: policyId } = await admin.post('/api/policies', { title: 'Access Control Policy' }));
  const p = await admin.get(`/api/policies/${policyId}`);
  p.statements = [{ id: 'mfa1', text: 'Multi-factor authentication must be enforced for all remote access.', controls: [fw('ISO27001', '8.5')] }];
  await admin.put(`/api/policies/${policyId}`, p);
  sid = 'mfa1';
});
after(() => srv.stop());

const newControl = (who, extra = {}) => who.post('/api/control-register', {
  name: 'MFA enforced on the VPN', description: 'The VPN concentrator rejects logins without a second factor.', owner_id: analyst.user.id, frequency: 'quarterly',
  framework_ids: [fw('ISO27001', '8.5'), fw('NIST80053', 'IA-2')], statement_refs: [{ policy_id: policyId, statement_id: sid }], ...extra,
});
const evidence = async (who) => (await who.post('/api/evidence', { control_id: fw('ISO27001', '8.5'), title: 'VPN MFA config export', location: 'https://wiki.example/vpn-mfa', owner: 'IT', collected_on: today(), valid_days: 90 })).id;

test('create a control linked to statements and framework controls; it starts as a draft design', async () => {
  const { id, code } = await newControl(admin);
  assert.match(code, /^CTL-\d{3}$/);
  const c = await admin.get(`/api/control-register/${id}`);
  assert.equal(c.design_status, 'draft');
  assert.equal(c.result, 'not_tested');
  assert.equal(c.next_due, null, 'no test is due until the design is approved');
  assert.deepEqual(c.frameworks.map((f) => f.framework_code).sort(), ['ISO27001', 'NIST80053']);
  assert.equal(c.statements[0].num, '4.1');
  assert.match(c.statements[0].text, /Multi-factor/);
  assert.equal(c.owner_name, analyst.user.name);
});

test('SoD: the designer cannot approve the design; a tester cannot be the design approver', async () => {
  const { id } = await newControl(admin);
  await assert.rejects(admin.post(`/api/control-register/${id}/approve-design`), (e) => e.status === 403);
  await approver.post(`/api/control-register/${id}/approve-design`);
  const c = await admin.get(`/api/control-register/${id}`);
  assert.equal(c.design_status, 'approved');
  assert.ok(c.next_due, 'first test is scheduled on approval');
  await assert.rejects(approver.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Attempted VPN login without MFA; it was rejected.' }), (e) => e.status === 403);
  const log = await admin.get('/api/audit?q=blocked_sod');
  assert.ok(log.rows.some((r) => r.action === 'control.design_approval_blocked_sod'));
  assert.ok(log.rows.some((r) => r.action === 'control.test_blocked_sod'));
});

test('testing requires an approved design', async () => {
  const { id } = await newControl(admin);
  await assert.rejects(analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled 25 logins; all used MFA.' }), (e) => e.status === 409);
});

test('recording a passing test with evidence updates last tested, next due and the result', async () => {
  const { id } = await newControl(admin);
  await approver.post(`/api/control-register/${id}/approve-design`);
  const ev = await evidence(analyst);
  const r = await analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled 25 VPN logins from the last quarter; all used MFA.', evidence_ids: [ev] });
  const c = await admin.get(`/api/control-register/${id}`);
  assert.equal(c.result, 'pass');
  assert.equal(c.effectiveness, 'effective');
  assert.equal(c.last_tested_on, today());
  const d = new Date(today()); d.setUTCMonth(d.getUTCMonth() + 3);
  assert.equal(c.next_due, r.next_due);
  assert.equal(c.next_due.slice(0, 7), d.toISOString().slice(0, 7), 'quarterly: next due in three months');
  assert.equal(c.overdue, false);
  assert.equal(c.tests.length, 1);
  assert.equal(c.tests[0].tester_name, analyst.user.name);
  assert.ok(c.evidence.some((e) => e.id === ev), 'evidence is linked to the control');
});

test('a failed test opens a failure in the action queue; the tester cannot close it, someone else can', async () => {
  const { id } = await newControl(admin);
  await approver.post(`/api/control-register/${id}/approve-design`);
  await assert.rejects(analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'fail', methodology: 'Tried a login without MFA.' }), (e) => e.status === 400, 'a failure needs notes');
  const r = await analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'fail', methodology: 'Tried a login without MFA.', notes: 'Legacy VPN profile still allows password-only logins.' });
  assert.equal(r.failure_opened, true);
  const c = await admin.get(`/api/control-register/${id}`);
  assert.equal(c.result, 'fail');
  assert.equal(c.effectiveness, 'ineffective');
  assert.equal(c.open_failures, 1);
  const dash = await admin.get('/api/dashboard');
  assert.ok(dash.controls.failing >= 1);
  assert.ok(dash.actions.some((a) => a.kind === 'control' && /failed/.test(a.title)));
  const testId = c.tests[0].id;
  await assert.rejects(analyst.post(`/api/control-tests/${testId}/close`, { note: 'Fixed the legacy profile.' }), (e) => e.status === 403);
  await admin.post(`/api/control-tests/${testId}/close`, { note: 'Legacy profile removed; retest scheduled.' });
  const after = await admin.get(`/api/control-register/${id}`);
  assert.equal(after.open_failures, 0);
  assert.equal(after.tests[0].failure_status, 'closed');
  assert.equal(after.tests[0].closed_by_name, admin.user.name);
});

test('overdue tests surface on the dashboard and in the action queue', async () => {
  const { id } = await newControl(admin, { name: 'Quarterly access review', frequency: 'quarterly' });
  await approver.post(`/api/control-register/${id}/approve-design`);
  await analyst.post(`/api/control-register/${id}/tests`, { tested_on: '2025-01-15', result: 'pass', methodology: 'Reviewed the Q4 access recertification records.' });
  const c = await admin.get(`/api/control-register/${id}`);
  assert.equal(c.next_due, '2025-04-15');
  assert.equal(c.overdue, true);
  const list = await admin.get('/api/control-register');
  assert.ok(list.find((x) => x.id === id).overdue);
  const dash = await admin.get('/api/dashboard');
  assert.ok(dash.controls.overdue >= 1);
  assert.ok(dash.actions.some((a) => a.title.includes('Quarterly access review') && /overdue/.test(a.title)));
});

test('changing an approved design resets approval; testing is blocked until re-approved', async () => {
  const { id } = await newControl(admin);
  await approver.post(`/api/control-register/${id}/approve-design`);
  const c = await admin.get(`/api/control-register/${id}`);
  const r = await admin.put(`/api/control-register/${id}`, { ...c, frequency: 'monthly' });
  assert.equal(r.design_reset, true);
  assert.equal((await admin.get(`/api/control-register/${id}`)).design_status, 'draft');
  await assert.rejects(analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled logins; all used MFA.' }), (e) => e.status === 409);
  // Changing only the owner does not reset an approved design.
  await approver.post(`/api/control-register/${id}/approve-design`);
  const again = await admin.put(`/api/control-register/${id}`, { ...(await admin.get(`/api/control-register/${id}`)), owner_id: admin.user.id });
  assert.equal(again.design_reset, false);
});

test('retired controls cannot be tested; every action is in the hash-chained audit trail', async () => {
  const { id } = await newControl(admin);
  await approver.post(`/api/control-register/${id}/approve-design`);
  await assert.rejects(admin.post(`/api/control-register/${id}/status`, { status: 'retired' }), (e) => e.status === 400, 'retiring needs a reason');
  await admin.post(`/api/control-register/${id}/status`, { status: 'retired', reason: 'Replaced by SSO-enforced MFA.' });
  await assert.rejects(analyst.post(`/api/control-register/${id}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled logins; all used MFA.' }), (e) => e.status === 409);
  const actions = new Set((await admin.get('/api/audit?q=control.&limit=500')).rows.map((r) => r.action));
  for (const a of ['control.created', 'control.design_approved', 'control.tested', 'control.test_failed', 'control.failure_closed', 'control.failure_close_blocked_sod', 'control.design_reset', 'control.retired', 'control.updated'])
    assert.ok(actions.has(a), `missing ${a}`);
  assert.equal((await admin.get('/api/audit/verify')).ok, true);
});

test('validation: owner must be in the workspace, statements must exist, dates not in the future', async () => {
  await assert.rejects(newControl(admin, { owner_id: 999999 }), (e) => e.status === 400);
  await assert.rejects(newControl(admin, { statement_refs: [{ policy_id: policyId, statement_id: 'nope' }] }), (e) => e.status === 400);
  const { id } = await newControl(admin);
  await approver.post(`/api/control-register/${id}/approve-design`);
  await assert.rejects(analyst.post(`/api/control-register/${id}/tests`, { tested_on: '2999-01-01', result: 'pass', methodology: 'Sampled logins; all used MFA.' }), (e) => e.status === 400);
});

test('roles: auditors read the register but cannot change it; another workspace cannot see it', async () => {
  const auditor = await join('auditor');
  assert.ok((await auditor.get('/api/control-register')).length > 0);
  await assert.rejects(newControl(auditor), (e) => e.status === 403);
  const outsider = await client(srv.base, { org: 'Other Org' });
  assert.equal((await outsider.get('/api/control-register')).length, 0);
  const anyId = (await admin.get('/api/control-register'))[0].id;
  await assert.rejects(outsider.get(`/api/control-register/${anyId}`), (e) => e.status === 404);
});
