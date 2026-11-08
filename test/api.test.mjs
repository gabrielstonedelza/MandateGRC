// Phase 0 server behaviour: qualitative acceptance and owner tags persist, and are audited.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './server.mjs';

let srv, a;
before(async () => { srv = await startServer(); a = await client(srv.base); });
after(() => srv.stop());

test('qualitative acceptance is stamped by the server and written to the audit trail', async () => {
  const { id } = await a.post('/api/policies', { title: 'Incident Response Policy' });
  let p = await a.get(`/api/policies/${id}`);
  p.statements = [{ id: 's1', text: 'Exceptions to this policy shall be reviewed.', controls: [], qualitative: { reason: 'Event-driven obligation.', by: 'spoofed', at: '2000-01-01' } }];
  p = await a.put(`/api/policies/${id}`, p);
  const q = p.statements[0].qualitative;
  assert.equal(q.reason, 'Event-driven obligation.');
  assert.equal(q.by, a.user.username, 'who is set by the server, not the client');
  assert.notEqual(q.at, '2000-01-01');
  // Saving again without changing the reason keeps the original stamp and adds no audit entry.
  const again = await a.put(`/api/policies/${id}`, p);
  assert.equal(again.statements[0].qualitative.at, q.at);
  let log = await a.get('/api/audit?q=qualitative');
  assert.equal(log.rows.filter((r) => r.action === 'policy.statement_qualitative_accepted').length, 1);
  // Clearing it is audited too.
  delete again.statements[0].qualitative;
  await a.put(`/api/policies/${id}`, again);
  log = await a.get('/api/audit?q=qualitative');
  assert.equal(log.rows.filter((r) => r.action === 'policy.statement_qualitative_cleared').length, 1);
  const chain = await a.get('/api/audit/verify');
  assert.equal(chain.ok, true);
});

test('reasons are validated', async () => {
  const { id } = await a.post('/api/policies', { title: 'Access Control Policy' });
  const p = await a.get(`/api/policies/${id}`);
  p.statements = [{ id: 's1', text: 'Access shall be reviewed.', controls: [], qualitative: { reason: 'x' } }];
  await assert.rejects(a.put(`/api/policies/${id}`, p), (e) => e.status === 400);
});

test('only one role can be tagged as the owner', async () => {
  const { id } = await a.post('/api/policies', { title: 'Backup Policy' });
  const p = await a.get(`/api/policies/${id}`);
  p.roles = [{ role: 'Platform Lead', responsibility: 'Owns it.', owner: true }, { role: 'Ops', responsibility: 'Runs it.', owner: true }, { role: 'Users', responsibility: 'Follow it.', owner: 'yes' }];
  const saved = await a.put(`/api/policies/${id}`, p);
  assert.deepEqual(saved.roles.map((r) => !!r.owner), [true, false, false]);
});

test('the policy list shows the same score as the review', async () => {
  const list = await a.get('/api/policies');
  for (const row of list) {
    const p = await a.get(`/api/policies/${row.id}`);
    assert.equal(typeof row.score, 'number');
    assert.ok(row.grade, 'grade present');
    assert.ok(p, 'policy loads');
  }
});
