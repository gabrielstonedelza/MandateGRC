// Phase 5.2: vendor / third-party risk.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';
import { rateVendor, QUESTIONS } from '../src/vendors.js';

let srv, admin, analyst, approver;
const join = async (role) => client(srv.base, { invite: (await admin.post('/api/invites', { role })).code });
const all = (a) => Object.fromEntries(QUESTIONS.map(([k]) => [k, a]));
const fakePdf = Buffer.from('%PDF-1.4\n% fake SOC 2 report for tests\n%%EOF\n');
before(async () => { srv = await startServer(); admin = await client(srv.base, { username: 'vic.admin' }); analyst = await join('analyst'); approver = await join('approver'); });
after(() => srv.stop());

test('risk rating combines exposure and questionnaire gaps', () => {
  assert.equal(rateVendor('Low', 'none', all('yes')).rating, 'Low');
  assert.equal(rateVendor('Critical', 'restricted', all('yes')).rating, 'Medium', 'high exposure with no gaps is still worth watching');
  assert.equal(rateVendor('Critical', 'restricted', all('no')).rating, 'Critical');
  assert.equal(rateVendor('Medium', 'internal', { ...all('yes'), mfa: 'no', incident: 'no', cert: 'partial' }).rating, 'High', 'no MFA and no breach notice is a serious gap');
  assert.equal(rateVendor('Medium', 'internal', { ...all('yes'), screening: 'partial' }).rating, 'Low');
});

test('create, assess (rates and schedules reassessment), upload and review a SOC 2 report', async () => {
  const { id, code } = await admin.post('/api/vendors', { name: 'Payroll Cloud Ltd', service: 'Payroll processing', owner_id: analyst.user.id, criticality: 'High', data_access: 'restricted' });
  assert.match(code, /^VND-\d{3}$/);
  await assert.rejects(admin.post(`/api/vendors/${id}/assess`, { answers: { cert: 'yes' } }), (e) => e.status === 400, 'every question must be answered');
  const a = await admin.post(`/api/vendors/${id}/assess`, { answers: { ...all('yes'), pentest: 'no', bcp: 'partial' } });
  assert.ok(['Medium', 'High'].includes(a.risk_rating));
  const due = new Date(); due.setUTCMonth(due.getUTCMonth() + 12);
  assert.equal(a.reassessment_due.slice(0, 7), due.toISOString().slice(0, 7), 'High: reassess in 12 months');
  await assert.rejects(admin.post(`/api/vendors/${id}/reports`, { filename: 'x.pdf', report_type: 'SOC 2 Type II', content_base64: Buffer.from('not a pdf').toString('base64') }), (e) => e.status === 400);
  const up = await analyst.post(`/api/vendors/${id}/reports`, { filename: 'payroll-soc2-2026.pdf', report_type: 'SOC 2 Type II', period_end: '2026-09-30', opinion: 'unqualified', content_base64: fakePdf.toString('base64') });
  assert.equal(up.sha256.length, 64);
  const dl = await admin.raw(`/api/vendor-reports/${up.id}/download`);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), fakePdf);
  await assert.rejects(analyst.post(`/api/vendor-reports/${up.id}/review`, { note: 'Looks fine to me.' }), (e) => e.status === 403, 'the uploader cannot review it');
  await approver.post(`/api/vendor-reports/${up.id}/review`, { note: 'Unqualified opinion; one CUEC on access reviews noted.' });
  const v = await admin.get(`/api/vendors/${id}`);
  assert.equal(v.reports[0].reviewed_by_name, approver.user.name);
  assert.equal(v.report_stale, false);
  for (const act of ['vendor.created', 'vendor.assessed', 'vendor.report_uploaded', 'vendor.report_review_blocked_sod', 'vendor.report_reviewed']) assert.ok(v.history.some((h) => h.action === act), `missing ${act}`);
  assert.equal((await admin.get('/api/audit/verify')).ok, true);
});

test('overdue reassessments and missing SOC 2 reports surface in the action queue', async () => {
  const { id } = await admin.post('/api/vendors', { name: 'Old Hosting Co', criticality: 'Critical', data_access: 'confidential', reassessment_due: '2026-01-01' });
  const dash = await admin.get('/api/dashboard');
  assert.ok(dash.vendors.overdue >= 1);
  assert.ok(dash.actions.some((a) => a.kind === 'vendor' && a.title.includes('Old Hosting Co') && /overdue/.test(a.title)));
  assert.ok(dash.actions.some((a) => a.kind === 'vendor' && a.title.includes('Old Hosting Co') && /SOC 2/.test(a.title)));
  await admin.post(`/api/vendors/${id}/status`, { status: 'offboarded', reason: 'Contract ended; data deletion certificate received.' });
  assert.ok(!(await admin.get('/api/dashboard')).actions.some((a) => a.title.includes('Old Hosting Co')), 'offboarded vendors leave the queue');
});

test('auditors read but cannot change vendors; other workspaces cannot see them', async () => {
  const auditor = await join('auditor');
  assert.ok((await auditor.get('/api/vendors')).length >= 1);
  await assert.rejects(auditor.post('/api/vendors', { name: 'Nope Inc', criticality: 'Low', data_access: 'none' }), (e) => e.status === 403);
  const outsider = await client(srv.base, { org: 'Elsewhere' });
  assert.equal((await outsider.get('/api/vendors')).length, 0);
});
