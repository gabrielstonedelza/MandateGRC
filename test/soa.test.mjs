// Phase 3: ISO/IEC 27001 Statement of Applicability.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';

let srv, admin, approver, analyst, meta;
const iso = (ref) => meta.controls.find((c) => c.framework_code === 'ISO27001' && c.ref === ref).id;
const today = () => new Date().toISOString().slice(0, 10);
const join = async (role) => client(srv.base, { invite: (await admin.post('/api/invites', { role })).code });

before(async () => {
  srv = await startServer();
  admin = await client(srv.base, { username: 'sam.admin' });
  approver = await join('approver');
  analyst = await join('analyst');
  meta = await admin.get('/api/meta');
});
after(() => srv.stop());

test('renders all 93 Annex A controls, applicable by default, in Annex order', async () => {
  const soa = await admin.get('/api/soa');
  assert.equal(soa.rows.length, 93);
  assert.equal(soa.rows[0].ref, '5.1');
  assert.equal(soa.rows.at(-1).ref, '8.34');
  assert.ok(soa.rows.findIndex((r) => r.ref === '5.10') > soa.rows.findIndex((r) => r.ref === '5.9'), 'numeric order, not text order');
  assert.ok(soa.rows.every((r) => r.applicable));
  assert.equal(soa.version, 0);
  assert.equal(soa.coverage.applicable, 93);
  assert.match(soa.disclaimer, /guidance, not a substitute/);
});

test('statuses and links come from existing mappings, controls and tests', async () => {
  const { id: pid } = await admin.post('/api/policies', { template: 'access-control' });
  let soa = await admin.get('/api/soa');
  const r85 = soa.rows.find((r) => r.ref === '8.5');
  assert.equal(r85.status, 'planned', 'a draft policy statement alone is "planned"');
  assert.ok(r85.statements.some((s) => s.policy_id === pid));
  assert.match(r85.justification, /addressed by POL-/);
  assert.equal(r85.justification_auto, true);
  // A control operating 8.5 with a passing test makes it implemented and covered.
  const { id: cid } = await admin.post('/api/control-register', { name: 'MFA on VPN', owner_id: analyst.user.id, frequency: 'quarterly', framework_ids: [iso('8.5')], statement_refs: [] });
  soa = await admin.get('/api/soa');
  assert.equal(soa.rows.find((r) => r.ref === '8.5').status, 'partial', 'linked but untested');
  await approver.post(`/api/control-register/${cid}/approve-design`);
  const ev = (await analyst.post('/api/evidence', { control_id: iso('8.5'), title: 'VPN MFA config', location: 'https://x', owner: 'IT', collected_on: today(), valid_days: 90 })).id;
  await analyst.post(`/api/control-register/${cid}/tests`, { tested_on: today(), result: 'pass', methodology: 'Sampled 25 logins; all used MFA.', evidence_ids: [ev] });
  soa = await admin.get('/api/soa');
  const row = soa.rows.find((r) => r.ref === '8.5');
  assert.equal(row.status, 'implemented');
  assert.ok(row.controls.some((k) => k.id === cid && k.result === 'pass'));
  assert.ok(row.evidence.some((e) => e.id === ev));
  assert.equal(soa.coverage.covered, 1);
  assert.equal(soa.coverage.pct, Math.round(100 / 93));
});

test('applicability and justification are editable, versioned and audited; exclusions need a justification', async () => {
  await assert.rejects(admin.put('/api/soa', { changes: [{ control_id: iso('7.4'), applicable: false, justification: 'n/a' }] }), (e) => e.status === 400);
  await assert.rejects(admin.put('/api/soa', { changes: [{ control_id: meta.controls.find((c) => c.framework_code === 'NIST80053').id, applicable: false, justification: 'Not ISO at all, rejected.' }] }), (e) => e.status === 400);
  const r1 = await admin.put('/api/soa', { note: 'Initial scoping', changes: [
    { control_id: iso('7.4'), applicable: false, justification: 'No company premises: fully remote organisation using a co-working provider\'s monitored building.' },
    { control_id: iso('8.30'), applicable: false, justification: 'No development is outsourced; all software is built in-house.' },
  ] });
  assert.equal(r1.version, 1);
  assert.equal(r1.changed, 2);
  const same = await admin.put('/api/soa', { changes: [{ control_id: iso('8.30'), applicable: false, justification: 'No development is outsourced; all software is built in-house.' }] });
  assert.equal(same.changed, 0, 'no change, no new version');
  const r2 = await admin.put('/api/soa', { changes: [{ control_id: iso('8.30'), applicable: true, justification: 'A contractor now builds the mobile app.' }] });
  assert.equal(r2.version, 2);
  const soa = await admin.get('/api/soa');
  assert.equal(soa.version, 2);
  assert.equal(soa.coverage.excluded, 1);
  const r74 = soa.rows.find((r) => r.ref === '7.4');
  assert.equal(r74.applicable, false);
  assert.equal(r74.status, 'not_applicable');
  assert.equal(soa.rows.find((r) => r.ref === '8.30').justification_auto, false);
  const revs = await admin.get('/api/soa/revisions');
  assert.deepEqual(revs.map((r) => r.version), [2, 1]);
  assert.deepEqual(revs[1].changes.map((c) => c.ref).sort(), ['7.4', '8.30']);
  assert.deepEqual(revs[0].changes[0].applicable, [false, true]);
  const log = await admin.get('/api/audit?q=soa.updated');
  assert.equal(log.rows.length, 2);
  await assert.rejects(approver.put('/api/soa', { changes: [{ control_id: iso('7.4'), applicable: true }] }), (e) => e.status === 403, 'approvers read, analysts edit');
});

test('exports CSV and PDF stamped with version and date; exports are audited', async () => {
  const csv = await admin.raw('/api/soa/export?format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /soa-v2-\d{4}-\d{2}-\d{2}\.csv/);
  const text = await csv.text();
  const lines = text.trim().split('\r\n');
  assert.match(lines[0], /Annex A control/);
  assert.equal(lines.filter((l) => /^"?\d\.\d+/.test(l)).length, 93);
  assert.ok(lines.some((l) => l.startsWith('"7.4"') && l.includes('"No"') && l.includes('"v2"')));
  assert.ok(text.includes('guidance, not a substitute'));
  const pdf = await admin.raw('/api/soa/export?format=pdf');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.subarray(-6).toString().includes('%%EOF'));
  const log = await admin.get('/api/audit?q=soa.exported');
  assert.deepEqual(log.rows.map((r) => JSON.parse(r.details).format).sort(), ['csv', 'pdf']);
});
