// Control register and control testing: policies state intent, controls prove operation.
// Separation of duties (enforced here, never in the browser):
//   - the design author cannot approve the control's design;
//   - the design approver cannot test the control;
//   - a failed test cannot be closed by the person who recorded it.
// Every state change is appended to the workspace's hash-chained audit trail.
import { all, get, run, tx, nextCode } from './db.js';
import { audit } from './audit.js';
import { HttpError, bad, today, nowIso, addMonths, addDays, parseJson, str, date, oneOf, idList } from './util.js';

export const FREQUENCIES = { continuous: 1, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
export const FREQUENCY_LABELS = { continuous: 'Continuous (monthly check)', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Annually' };
const RESULTS = ['pass', 'fail', 'exception'];
const EFFECTIVENESS = ['effective', 'partially_effective', 'ineffective'];
const DEFAULT_EFFECTIVENESS = { pass: 'effective', exception: 'partially_effective', fail: 'ineffective' };
// A newly approved control is due for its first test within this many days.
const FIRST_TEST_DAYS = 30;

// When the next test is due: one interval after the last test, or shortly after design approval.
export function nextDue(c) {
  if (c.status !== 'active' || c.design_status !== 'approved') return null;
  if (c.last_tested_on) return addMonths(c.last_tested_on, FREQUENCIES[c.frequency] || 3);
  return addDays((c.design_approved_at || c.created_at || nowIso()).slice(0, 10), FIRST_TEST_DAYS);
}

export function registerControlRoutes({ route, R, pid, notFound, forbidden, controlsMap, userName, evidenceView, hydratePolicy }) {
  const ctlRow = (id, org) => {
    const c = get('SELECT * FROM org_controls WHERE id = ? AND org_id = ?', id, org);
    if (!c) throw notFound('Control');
    return c;
  };
  const hydrate = (c) => ({ ...c, framework_ids: parseJson(c.framework_ids, []), statement_refs: parseJson(c.statement_refs, []), evidence_ids: parseJson(c.evidence_ids, []) });

  // Summary used by the list, the dashboard and the action queue.
  function view(c, org, cmap = controlsMap(org), t = today()) {
    const h = hydrate(c);
    const due = h.next_due || nextDue(h);
    const fws = [...new Set(h.framework_ids.map((id) => cmap.get(id)?.framework_code).filter(Boolean))];
    const openFailures = get("SELECT COUNT(*) n FROM control_tests WHERE control_id = ? AND failure_status = 'open'", c.id).n;
    return {
      ...h, next_due: due, owner_name: userName(h.owner_id), frameworks: fws,
      overdue: !!due && due < t, due_soon: !!due && due >= t && due <= addDays(t, 14), open_failures: openFailures,
      design_approved_by_name: userName(h.design_approved_by),
    };
  }

  // Validation shared by create and update. Statement links must point at this workspace's policies.
  function validate(b, org) {
    const cmap = controlsMap(org);
    const owner = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id);
    if (owner != null && !get('SELECT id FROM users WHERE id = ? AND org_id = ? AND active = 1', owner, org)) throw bad('Control owner must be an active user in this workspace.');
    const refs = Array.isArray(b.statement_refs) ? b.statement_refs.slice(0, 100) : [];
    const statement_refs = [];
    for (const r of refs) {
      const policyId = Number(r?.policy_id), sid = String(r?.statement_id || '');
      if (!/^[a-z0-9]{1,20}$/i.test(sid)) continue;
      const p = hydratePolicy(get('SELECT id, statements FROM policies WHERE id = ? AND org_id = ?', policyId, org));
      if (!p || !p.statements.some((s) => s.id === sid)) throw bad('A linked policy statement no longer exists. Reload and choose again.');
      if (!statement_refs.some((x) => x.policy_id === policyId && x.statement_id === sid)) statement_refs.push({ policy_id: policyId, statement_id: sid });
    }
    const evidence_ids = idList(b.evidence_ids || [], { name: 'Evidence' }).filter((id) => get('SELECT id FROM evidence WHERE id = ? AND org_id = ?', id, org));
    return {
      name: str(b.name, { name: 'Control name', min: 3, max: 200, required: true }),
      description: str(b.description, { name: 'Description', max: 4000 }),
      owner_id: owner,
      frequency: oneOf(b.frequency, Object.keys(FREQUENCIES), { name: 'Test frequency' }),
      framework_ids: idList(b.framework_ids || [], { name: 'Framework controls' }).filter((id) => cmap.has(id)),
      statement_refs, evidence_ids,
    };
  }
  const DESIGN_FIELDS = ['name', 'description', 'frequency', 'framework_ids', 'statement_refs'];
  const designOf = (v) => JSON.stringify(DESIGN_FIELDS.map((k) => v[k]));

  route('GET', '/api/control-register', R.READ, (ctx) => {
    const org = ctx.user.org_id, cmap = controlsMap(org), t = today();
    return all('SELECT * FROM org_controls WHERE org_id = ? ORDER BY code', org).map((c) => view(c, org, cmap, t));
  });

  route('GET', '/api/control-register/:id', R.READ, (ctx) => {
    const org = ctx.user.org_id, cmap = controlsMap(org);
    const c = view(ctlRow(pid(ctx.params.id), org), org, cmap);
    // The chain: policy statement(s) → control → framework refs → tests → evidence.
    const statements = c.statement_refs.map((r) => {
      const p = hydratePolicy(get('SELECT id, code, title, status, version, statements FROM policies WHERE id = ? AND org_id = ?', r.policy_id, org));
      const i = p ? p.statements.findIndex((s) => s.id === r.statement_id) : -1;
      return p && i >= 0 ? { ...r, policy_code: p.code, policy_title: p.title, policy_status: p.status, policy_version: p.version, num: `4.${i + 1}`, text: p.statements[i].text }
        : { ...r, missing: true };
    });
    const frameworks = c.framework_ids.map((id) => cmap.get(id)).filter(Boolean);
    const tests = all('SELECT * FROM control_tests WHERE control_id = ? ORDER BY tested_on DESC, id DESC', c.id).map((t) => ({
      ...t, evidence_ids: parseJson(t.evidence_ids, []), tester_name: userName(t.tester_id), closed_by_name: userName(t.closed_by),
    }));
    const evIds = [...new Set([...c.evidence_ids, ...tests.flatMap((t) => t.evidence_ids)])];
    const evidence = evIds.map((id) => get('SELECT * FROM evidence WHERE id = ? AND org_id = ?', id, org)).filter(Boolean).map(evidenceView)
      .map((e) => ({ ...e, control_ref: cmap.get(e.control_id)?.ref, framework_code: cmap.get(e.control_id)?.framework_code }));
    return { ...c, statements, frameworks, tests, evidence, created_by_name: userName(c.created_by), design_author_name: userName(c.design_author) };
  });

  // Policy statements to link, with the framework controls each is mapped to (for suggestions).
  route('GET', '/api/control-register-statements', R.READ, (ctx) => all("SELECT id, code, title, status, statements FROM policies WHERE org_id = ? AND status != 'retired' ORDER BY code", ctx.user.org_id)
    .map(hydratePolicy).map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status,
      statements: p.statements.filter((s) => (s.text || '').trim()).map((s) => ({ id: s.id, num: `4.${p.statements.indexOf(s) + 1}`, text: s.text, controls: s.controls || [] })) })));

  route('POST', '/api/control-register', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = validate(ctx.body, org);
    let id, code;
    tx(() => {
      code = nextCode('org_controls', 'CTL', org);
      id = Number(run(`INSERT INTO org_controls(org_id, code, name, description, owner_id, frequency, framework_ids, statement_refs, evidence_ids, design_author, created_by, updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, org, code, v.name, v.description, v.owner_id, v.frequency, JSON.stringify(v.framework_ids), JSON.stringify(v.statement_refs),
      JSON.stringify(v.evidence_ids), ctx.user.id, ctx.user.id, ctx.user.id).lastInsertRowid);
      audit(ctx.actor, 'control.created', 'control', id, { code, name: v.name, frequency: v.frequency, owner_id: v.owner_id, framework_controls: v.framework_ids.length, statements: v.statement_refs.length });
    });
    return { id, code };
  });

  route('PUT', '/api/control-register/:id', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const c = hydrate(ctlRow(pid(ctx.params.id), org));
    if (c.status === 'retired') throw new HttpError(409, 'Retired controls cannot be edited. Reactivate it first.');
    const v = validate(ctx.body, org);
    const designChanged = designOf(v) !== designOf(c);
    const reset = designChanged && c.design_status === 'approved';
    tx(() => {
      run(`UPDATE org_controls SET name=?, description=?, owner_id=?, frequency=?, framework_ids=?, statement_refs=?, evidence_ids=?, updated_by=?, updated_at=?
        ${designChanged ? ', design_author = ?' : ''} ${reset ? ", design_status = 'draft', design_approved_by = NULL, design_approved_at = NULL, next_due = NULL" : ''} WHERE id = ?`,
      v.name, v.description, v.owner_id, v.frequency, JSON.stringify(v.framework_ids), JSON.stringify(v.statement_refs), JSON.stringify(v.evidence_ids), ctx.user.id, nowIso(),
      ...(designChanged ? [ctx.user.id] : []), c.id);
      audit(ctx.actor, 'control.updated', 'control', c.id, { code: c.code, design_changed: designChanged });
      if (reset) audit(ctx.actor, 'control.design_reset', 'control', c.id, { code: c.code, reason: 'Design changed after approval; it must be approved again before testing.' });
    });
    return { ok: true, design_reset: reset };
  });

  route('POST', '/api/control-register/:id/approve-design', R.APPROVE, (ctx) => {
    const org = ctx.user.org_id;
    const c = ctlRow(pid(ctx.params.id), org);
    if (c.status !== 'active') throw new HttpError(409, 'Only active controls can be approved.');
    if (c.design_status === 'approved') throw new HttpError(409, 'This control design is already approved.');
    if (c.design_author === ctx.user.id || c.created_by === ctx.user.id) {
      audit(ctx.actor, 'control.design_approval_blocked_sod', 'control', c.id, { code: c.code });
      throw forbidden('Separation of duties: you designed this control, so a different approver must approve its design.');
    }
    const ts = nowIso();
    tx(() => {
      run("UPDATE org_controls SET design_status = 'approved', design_approved_by = ?, design_approved_at = ?, updated_at = ? WHERE id = ?", ctx.user.id, ts, ts, c.id);
      const due = nextDue({ ...c, design_status: 'approved', design_approved_at: ts });
      run('UPDATE org_controls SET next_due = ? WHERE id = ?', due, c.id);
      audit(ctx.actor, 'control.design_approved', 'control', c.id, { code: c.code, next_due: due });
    });
    return { ok: true };
  });

  route('POST', '/api/control-register/:id/status', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const c = ctlRow(pid(ctx.params.id), org);
    const status = oneOf(ctx.body.status, ['active', 'retired'], { name: 'Status' });
    if (status === c.status) return { ok: true };
    const reason = str(ctx.body.reason, { name: 'Reason', min: status === 'retired' ? 5 : 0, max: 500, required: status === 'retired' });
    tx(() => {
      run(`UPDATE org_controls SET status = ?, updated_by = ?, updated_at = ?, next_due = ${status === 'retired' ? 'NULL' : 'next_due'} WHERE id = ?`, status, ctx.user.id, nowIso(), c.id);
      audit(ctx.actor, status === 'retired' ? 'control.retired' : 'control.reactivated', 'control', c.id, { code: c.code, reason });
    });
    return { ok: true };
  });

  // Record a test. Updates last-tested, recomputes next-due and the current result.
  route('POST', '/api/control-register/:id/tests', R.STEWARD, (ctx) => {
    const org = ctx.user.org_id;
    const c = hydrate(ctlRow(pid(ctx.params.id), org));
    if (c.status !== 'active') throw new HttpError(409, 'Retired controls cannot be tested.');
    if (c.design_status !== 'approved') throw new HttpError(409, 'Approve the control design before testing it, so the test checks an agreed design.');
    if (c.design_approved_by === ctx.user.id) {
      audit(ctx.actor, 'control.test_blocked_sod', 'control', c.id, { code: c.code });
      throw forbidden('Separation of duties: you approved this control\'s design, so someone else must test it.');
    }
    const b = ctx.body;
    const tested_on = date(b.tested_on, { name: 'Test date', required: true });
    if (tested_on > today()) throw bad('The test date cannot be in the future.');
    const result = oneOf(b.result, RESULTS, { name: 'Result' });
    const effectiveness = b.effectiveness ? oneOf(b.effectiveness, EFFECTIVENESS, { name: 'Operating effectiveness' }) : DEFAULT_EFFECTIVENESS[result];
    if (result === 'pass' && effectiveness === 'ineffective') throw bad('A passed test cannot rate the control ineffective. Record it as failed instead.');
    const methodology = str(b.methodology, { name: 'Methodology', min: 10, max: 4000, required: true });
    const notes = str(b.notes, { name: 'Notes', max: 4000, min: result === 'pass' ? 0 : 10, required: result !== 'pass' });
    const evidence_ids = idList(b.evidence_ids || [], { name: 'Evidence' }).filter((id) => get('SELECT id FROM evidence WHERE id = ? AND org_id = ?', id, org));
    let testId, due;
    tx(() => {
      testId = Number(run(`INSERT INTO control_tests(org_id, control_id, tester_id, tested_on, result, effectiveness, methodology, notes, evidence_ids, failure_status)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, org, c.id, ctx.user.id, tested_on, result, effectiveness, methodology, notes, JSON.stringify(evidence_ids), result === 'fail' ? 'open' : null).lastInsertRowid);
      // The latest test (by date) sets the control's current state; back-dated tests only add history.
      const latest = get('SELECT * FROM control_tests WHERE control_id = ? ORDER BY tested_on DESC, id DESC LIMIT 1', c.id);
      due = nextDue({ ...c, last_tested_on: latest.tested_on });
      const allEvidence = [...new Set([...c.evidence_ids, ...evidence_ids])];
      run('UPDATE org_controls SET last_tested_on = ?, next_due = ?, result = ?, effectiveness = ?, evidence_ids = ?, updated_at = ? WHERE id = ?',
        latest.tested_on, due, latest.result, latest.effectiveness, JSON.stringify(allEvidence), nowIso(), c.id);
      audit(ctx.actor, 'control.tested', 'control', c.id, { code: c.code, test_id: testId, tested_on, result, effectiveness, evidence: evidence_ids.length, next_due: due });
      if (result === 'fail') audit(ctx.actor, 'control.test_failed', 'control', c.id, { code: c.code, test_id: testId, finding: 'open' });
    });
    return { id: testId, next_due: due, failure_opened: result === 'fail' };
  });

  // Close a failed test once remediated. Never by the tester alone.
  route('POST', '/api/control-tests/:tid/close', R.STEWARD, (ctx) => {
    const org = ctx.user.org_id;
    const t = get('SELECT * FROM control_tests WHERE id = ? AND org_id = ?', pid(ctx.params.tid), org);
    if (!t) throw notFound('Control test');
    const c = ctlRow(t.control_id, org);
    if (t.failure_status !== 'open') throw new HttpError(409, 'Only open failures can be closed.');
    if (t.tester_id === ctx.user.id) {
      audit(ctx.actor, 'control.failure_close_blocked_sod', 'control', c.id, { code: c.code, test_id: t.id });
      throw forbidden('Separation of duties: you recorded this failed test, so someone else must confirm it is remediated and close it.');
    }
    const note = str(ctx.body.note, { name: 'Closure note', min: 10, max: 2000, required: true });
    tx(() => {
      run("UPDATE control_tests SET failure_status = 'closed', closed_by = ?, closed_at = ?, close_note = ? WHERE id = ?", ctx.user.id, nowIso(), note, t.id);
      audit(ctx.actor, 'control.failure_closed', 'control', c.id, { code: c.code, test_id: t.id, note });
    });
    return { ok: true };
  });

  // People who can own a control (lightweight list, readable by every non-employee role).
  route('GET', '/api/people', R.READ, (ctx) => all('SELECT id, name, username, role FROM users WHERE org_id = ? AND active = 1 ORDER BY name', ctx.user.org_id));

  // For the dashboard and the action queue.
  return {
    summary(org, me) {
      const cmap = controlsMap(org), t = today();
      const list = all("SELECT * FROM org_controls WHERE org_id = ? AND status = 'active'", org).map((c) => view(c, org, cmap, t));
      const approved = list.filter((c) => c.design_status === 'approved');
      const failures = all(`SELECT ct.*, oc.code, oc.name, oc.owner_id FROM control_tests ct JOIN org_controls oc ON oc.id = ct.control_id
        WHERE ct.org_id = ? AND ct.failure_status = 'open' ORDER BY ct.tested_on`, org);
      const actions = [];
      failures.forEach((f) => actions.push({ kind: 'control', severity: 'critical', title: `${f.code} ${f.name} failed its test on ${f.tested_on}`,
        detail: f.tester_id === me.id ? 'Open failure. Someone other than you must confirm remediation and close it.' : 'Open failure: remediate, then close it with a note.', link: `#/controls/${f.control_id}` }));
      approved.filter((c) => c.overdue).forEach((c) => actions.push({ kind: 'control', severity: 'high', title: `${c.code} ${c.name} test overdue`, detail: `Was due ${c.next_due}${c.owner_name ? ` · owner ${c.owner_name}` : ''}`, link: `#/controls/${c.id}` }));
      approved.filter((c) => c.due_soon && c.owner_id === me.id).forEach((c) => actions.push({ kind: 'control', severity: 'medium', title: `${c.code} ${c.name} test due ${c.next_due}`, detail: 'You own this control.', link: `#/controls/${c.id}` }));
      if (R.APPROVE.includes(me.role)) {
        list.filter((c) => c.design_status === 'draft').forEach((c) => actions.push({ kind: 'control', severity: c.design_author === me.id ? 'info' : 'medium',
          title: `${c.code} ${c.name} design awaits approval`, detail: c.design_author === me.id ? 'You designed it, so another approver must approve it.' : 'Approve the design so it can be tested.', link: `#/controls/${c.id}` }));
      }
      const eff = { effective: 0, partially_effective: 0, ineffective: 0, not_rated: 0 };
      approved.forEach((c) => { eff[c.effectiveness || 'not_rated']++; });
      return {
        stats: {
          active: list.length, approved: approved.length, draft: list.length - approved.length,
          passing: approved.filter((c) => c.result === 'pass').length, failing: approved.filter((c) => c.result === 'fail').length,
          exception: approved.filter((c) => c.result === 'exception').length, not_tested: approved.filter((c) => c.result === 'not_tested').length,
          overdue: approved.filter((c) => c.overdue).length, open_failures: failures.length, effectiveness: eff,
        },
        actions,
      };
    },
  };
}
