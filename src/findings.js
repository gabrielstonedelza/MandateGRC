// Findings and corrective action (CAP / POA&M).
// Lifecycle: Open → In Progress → Remediated (closure requested, with evidence) → Closed (approved),
// or Risk-Accepted (approved). An approver may send a Remediated finding back to In Progress.
// Separation of duties (server-enforced): the finding owner and the person who requested closure
// can never approve the closure or accept the risk themselves.
// Created automatically from failed control tests and expired exceptions; every transition is audited.
import { all, get, run, tx, nextCode } from './db.js';
import { audit } from './audit.js';
import { HttpError, bad, today, nowIso, addDays, parseJson, str, date, oneOf, idList } from './util.js';

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
export const STATUSES = ['Open', 'In Progress', 'Remediated', 'Closed', 'Risk-Accepted'];
export const SOURCES = ['control_test', 'self_assessment', 'audit', 'expired_exception', 'manual'];
const OPEN_STATES = new Set(['Open', 'In Progress', 'Remediated']);
// Default remediation windows by severity (days), a common CAP/POA&M convention.
export const SLA_DAYS = { Critical: 14, High: 30, Medium: 60, Low: 90 };
const severityForScore = (score) => (score >= 20 ? 'Critical' : score >= 12 ? 'High' : score >= 6 ? 'Medium' : 'Low');

function insertFinding(org, f, actor) {
  const code = nextCode('findings', 'FND', org);
  const id = Number(run(`INSERT INTO findings(org_id, code, title, description, source, severity, control_id, control_test_id, policy_id, statement_id, risk_id, exception_id,
      owner_id, identified_on, due_date, remediation_plan, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  org, code, f.title, f.description || '', f.source, f.severity, f.control_id ?? null, f.control_test_id ?? null, f.policy_id ?? null, f.statement_id ?? null,
  f.risk_id ?? null, f.exception_id ?? null, f.owner_id ?? null, f.identified_on, f.due_date ?? null, f.remediation_plan || '', actor?.user_id ?? null).lastInsertRowid);
  audit(actor, 'finding.created', 'finding', id, { code, source: f.source, severity: f.severity, title: f.title, control_test_id: f.control_test_id ?? undefined, exception_id: f.exception_id ?? undefined });
  return { id, code };
}

// Called inside the control-test transaction when a test fails.
export function openFindingForFailedTest({ org, control, testId, testedOn, notes, methodology, actor }) {
  return insertFinding(org, {
    title: `${control.code} ${control.name} failed its test`, description: notes || methodology, source: 'control_test', severity: 'High',
    control_id: control.id, control_test_id: testId, owner_id: control.owner_id, identified_on: testedOn, due_date: addDays(testedOn, SLA_DAYS.High),
  }, actor);
}
export const findingForTest = (testId) => get('SELECT id, code, status FROM findings WHERE control_test_id = ?', testId);

// Approved exceptions past their expiry date each get one finding (idempotent; run on read).
export function syncExpiredExceptions(org) {
  const t = today();
  const expired = all(`SELECT e.*, p.owner policy_owner FROM exceptions e JOIN policies p ON p.id = e.policy_id
    WHERE e.org_id = ? AND e.status = 'Approved' AND e.expires_at < ? AND NOT EXISTS (SELECT 1 FROM findings f WHERE f.exception_id = e.id)`, org, t);
  for (const e of expired) {
    const severity = severityForScore(e.likelihood * e.impact);
    tx(() => insertFinding(org, {
      title: `Exception ${e.code} expired: ${e.title}`,
      description: `The approved exception expired on ${e.expires_at}, so the deviation it covered is no longer authorized. Remediate the gap, or request a new exception.${e.compensating ? ` Compensating controls were: ${e.compensating}` : ''}`,
      source: 'expired_exception', severity, policy_id: e.policy_id, exception_id: e.id, owner_id: e.requested_by,
      identified_on: e.expires_at, due_date: addDays(t, SLA_DAYS[severity]),
    }, { org_id: org, username: 'system' }));
  }
  return expired.length;
}

export function registerFindingRoutes({ route, R, pid, notFound, forbidden, controlsMap, userName, hydratePolicy, evidenceView }) {
  const row = (id, org) => {
    const f = get('SELECT * FROM findings WHERE id = ? AND org_id = ?', id, org);
    if (!f) throw notFound('Finding');
    return f;
  };
  const view = (f, t = today()) => {
    const open = OPEN_STATES.has(f.status);
    return {
      ...f, closure_evidence_ids: parseJson(f.closure_evidence_ids, []), open,
      overdue: open && !!f.due_date && f.due_date < t, owner_name: userName(f.owner_id),
      closure_requested_by_name: userName(f.closure_requested_by), closed_by_name: userName(f.closed_by), created_by_name: userName(f.created_by),
      control_code: f.control_id ? get('SELECT code FROM org_controls WHERE id = ?', f.control_id)?.code : null,
      control_name: f.control_id ? get('SELECT name FROM org_controls WHERE id = ?', f.control_id)?.name : null,
      risk_code: f.risk_id ? get('SELECT code FROM risks WHERE id = ?', f.risk_id)?.code : null,
      exception_code: f.exception_id ? get('SELECT code FROM exceptions WHERE id = ?', f.exception_id)?.code : null,
      policy_code: f.policy_id ? get('SELECT code FROM policies WHERE id = ?', f.policy_id)?.code : null,
    };
  };
  const isOwnerOrWriter = (ctx, f) => R.WRITE.includes(ctx.user.role) || f.owner_id === ctx.user.id;
  const sameOrg = (table, id, org) => id == null || !!get(`SELECT id FROM ${table} WHERE id = ? AND org_id = ?`, id, org);
  const optId = (v) => (v == null || v === '' ? null : Number(v));

  function validate(b, org, { partial = false } = {}) {
    const v = {
      title: str(b.title, { name: 'Title', min: 5, max: 200, required: true }),
      description: str(b.description, { name: 'Description', max: 4000 }),
      severity: oneOf(b.severity, SEVERITIES, { name: 'Severity' }),
      owner_id: optId(b.owner_id),
      due_date: date(b.due_date, { name: 'Due date' }),
      remediation_plan: str(b.remediation_plan, { name: 'Remediation plan', max: 4000 }),
      control_id: optId(b.control_id), risk_id: optId(b.risk_id), policy_id: optId(b.policy_id),
      statement_id: b.statement_id ? String(b.statement_id).slice(0, 20) : null,
    };
    if (!partial) {
      v.source = oneOf(b.source || 'manual', ['self_assessment', 'audit', 'manual'], { name: 'Source' });
      v.identified_on = date(b.identified_on, { name: 'Identified on' }) || today();
      if (v.identified_on > today()) throw bad('The identified date cannot be in the future.');
    }
    if (v.owner_id != null && !get("SELECT id FROM users WHERE id = ? AND org_id = ? AND active = 1 AND role != 'employee'", v.owner_id, org)) throw bad('Finding owner must be an active analyst, approver, auditor or administrator in this workspace.');
    if (!sameOrg('org_controls', v.control_id, org)) throw bad('Unknown control.');
    if (!sameOrg('risks', v.risk_id, org)) throw bad('Unknown risk.');
    if (!sameOrg('policies', v.policy_id, org)) throw bad('Unknown policy.');
    if (v.statement_id) {
      const p = v.policy_id ? hydratePolicy(get('SELECT statements FROM policies WHERE id = ?', v.policy_id)) : null;
      if (!p || !p.statements.some((s) => s.id === v.statement_id)) throw bad('The linked policy statement does not exist.');
    }
    return v;
  }

  route('GET', '/api/findings', R.READ, (ctx) => {
    const org = ctx.user.org_id;
    syncExpiredExceptions(org);
    const q = ctx.query;
    const where = ['org_id = ?'], params = [org];
    for (const k of ['control_id', 'risk_id', 'policy_id', 'exception_id']) {
      if (q.get(k)) { where.push(`${k} = ?`); params.push(Number(q.get(k))); }
    }
    const t = today();
    return all(`SELECT * FROM findings WHERE ${where.join(' AND ')} ORDER BY id DESC`, ...params).map((f) => view(f, t));
  });

  route('GET', '/api/findings/:id', R.READ, (ctx) => {
    const org = ctx.user.org_id, cmap = controlsMap(org);
    const f = view(row(pid(ctx.params.id), org));
    const test = f.control_test_id ? get('SELECT id, tested_on, result, methodology, notes, tester_id FROM control_tests WHERE id = ?', f.control_test_id) : null;
    let statement = null;
    if (f.policy_id && f.statement_id) {
      const p = hydratePolicy(get('SELECT id, code, title, statements FROM policies WHERE id = ?', f.policy_id));
      const i = p ? p.statements.findIndex((s) => s.id === f.statement_id) : -1;
      if (i >= 0) statement = { policy_id: p.id, policy_code: p.code, policy_title: p.title, num: `4.${i + 1}`, text: p.statements[i].text };
    }
    const evidence = f.closure_evidence_ids.map((id) => get('SELECT * FROM evidence WHERE id = ? AND org_id = ?', id, org)).filter(Boolean).map(evidenceView)
      .map((e) => ({ ...e, control_ref: cmap.get(e.control_id)?.ref, framework_code: cmap.get(e.control_id)?.framework_code }));
    const history = all("SELECT ts, username, action, details FROM audit_log WHERE org_id = ? AND entity = 'finding' AND entity_id = ? ORDER BY id", org, String(f.id))
      .map((h) => ({ ...h, details: parseJson(h.details, null) }));
    return {
      ...f, evidence, history, statement,
      test: test ? { ...test, tester_name: userName(test.tester_id) } : null,
      risk_title: f.risk_id ? get('SELECT title FROM risks WHERE id = ?', f.risk_id)?.title : null,
      exception_title: f.exception_id ? get('SELECT title FROM exceptions WHERE id = ?', f.exception_id)?.title : null,
    };
  });

  route('POST', '/api/findings', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = validate(ctx.body, org);
    if (!v.due_date) v.due_date = addDays(v.identified_on, SLA_DAYS[v.severity]);
    return tx(() => insertFinding(org, v, ctx.actor));
  });

  // Owner, plan, due date and links. Allowed while the finding is open.
  route('PUT', '/api/findings/:id', R.READ, (ctx) => {
    const org = ctx.user.org_id;
    const f = row(pid(ctx.params.id), org);
    if (!isOwnerOrWriter(ctx, f)) throw forbidden();
    if (!['Open', 'In Progress'].includes(f.status)) throw new HttpError(409, `A ${f.status.toLowerCase()} finding cannot be edited.`);
    const v = validate(ctx.body, org, { partial: true });
    // Owners who are not analysts may update the plan and due date, not reassign or re-rate.
    if (!R.WRITE.includes(ctx.user.role) && (v.owner_id !== f.owner_id || v.severity !== f.severity)) throw forbidden('Only analysts can reassign a finding or change its severity.');
    const changed = Object.keys(v).filter((k) => String(v[k] ?? '') !== String(f[k] ?? ''));
    if (!changed.length) return { ok: true };
    tx(() => {
      run(`UPDATE findings SET title=?, description=?, severity=?, owner_id=?, due_date=?, remediation_plan=?, control_id=?, risk_id=?, policy_id=?, statement_id=?, updated_at=? WHERE id=?`,
        v.title, v.description, v.severity, v.owner_id, v.due_date, v.remediation_plan, v.control_id, v.risk_id, v.policy_id, v.statement_id, nowIso(), f.id);
      audit(ctx.actor, 'finding.updated', 'finding', f.id, { code: f.code, changed, ...(changed.includes('owner_id') ? { owner: userName(v.owner_id) } : {}), ...(changed.includes('due_date') ? { due_date: v.due_date } : {}) });
    });
    return { ok: true };
  });

  const transition = (ctx, f, to, extra = {}, sets = '', params = []) => {
    tx(() => {
      run(`UPDATE findings SET status = ?, updated_at = ?${sets} WHERE id = ?`, to, nowIso(), ...params, f.id);
      audit(ctx.actor, `finding.${to.toLowerCase().replace(/[^a-z]+/g, '_')}`, 'finding', f.id, { code: f.code, from: f.status, to, ...extra });
      // A closed or accepted finding from a failed test also closes the failure on the test record.
      if ((to === 'Closed' || to === 'Risk-Accepted') && f.control_test_id) {
        run("UPDATE control_tests SET failure_status = 'closed', closed_by = ?, closed_at = ?, close_note = ? WHERE id = ? AND failure_status = 'open'",
          ctx.user.id, nowIso(), `${to === 'Closed' ? 'Closed' : 'Risk accepted'} via ${f.code}: ${extra.note || ''}`.trim(), f.control_test_id);
      }
    });
  };

  route('POST', '/api/findings/:id/start', R.READ, (ctx) => {
    const f = row(pid(ctx.params.id), ctx.user.org_id);
    if (!isOwnerOrWriter(ctx, f)) throw forbidden();
    if (f.status !== 'Open') throw new HttpError(409, 'Only open findings can be started.');
    if (!f.owner_id) throw bad('Assign an owner before starting remediation.');
    if (!f.remediation_plan.trim() || !f.due_date) throw bad('Add a remediation plan and a due date before starting remediation.');
    transition(ctx, f, 'In Progress');
    return { ok: true };
  });

  // The owner (or an analyst) says it is fixed and attaches the evidence. A different person approves.
  route('POST', '/api/findings/:id/request-closure', R.READ, (ctx) => {
    const org = ctx.user.org_id;
    const f = row(pid(ctx.params.id), org);
    if (!isOwnerOrWriter(ctx, f)) throw forbidden();
    if (!['Open', 'In Progress'].includes(f.status)) throw new HttpError(409, 'Closure can only be requested for open or in-progress findings.');
    const note = str(ctx.body.note, { name: 'What was done', min: 10, max: 2000, required: true });
    const ev = idList(ctx.body.evidence_ids || [], { name: 'Evidence' }).filter((id) => get('SELECT id FROM evidence WHERE id = ? AND org_id = ?', id, org));
    if (!ev.length) throw bad('Attach at least one piece of evidence showing the remediation.');
    transition(ctx, f, 'Remediated', { note, evidence: ev.length }, ', closure_note = ?, closure_evidence_ids = ?, closure_requested_by = ?, closure_requested_at = ?',
      [note, JSON.stringify(ev), ctx.user.id, nowIso()]);
    return { ok: true };
  });

  const sodBlock = (ctx, f, what) => {
    if (f.owner_id === ctx.user.id || f.closure_requested_by === ctx.user.id) {
      audit(ctx.actor, 'finding.approval_blocked_sod', 'finding', f.id, { code: f.code, action: what });
      throw forbidden(`Separation of duties: you ${f.owner_id === ctx.user.id ? 'own this finding' : 'requested its closure'}, so a different approver must ${what === 'close' ? 'approve the closure' : 'accept the risk'}.`);
    }
  };

  route('POST', '/api/findings/:id/approve-closure', R.APPROVE, (ctx) => {
    const f = row(pid(ctx.params.id), ctx.user.org_id);
    if (f.status !== 'Remediated') throw new HttpError(409, 'Only remediated findings awaiting approval can be closed.');
    if (!parseJson(f.closure_evidence_ids, []).length) throw bad('Closure requires attached evidence.');
    sodBlock(ctx, f, 'close');
    const note = str(ctx.body.note, { name: 'Approval note', max: 1000 });
    transition(ctx, f, 'Closed', { note }, ', closed_by = ?, closed_at = ?, decision_note = ?', [ctx.user.id, nowIso(), note]);
    return { ok: true };
  });

  route('POST', '/api/findings/:id/reject-closure', R.APPROVE, (ctx) => {
    const f = row(pid(ctx.params.id), ctx.user.org_id);
    if (f.status !== 'Remediated') throw new HttpError(409, 'Only remediated findings awaiting approval can be sent back.');
    sodBlock(ctx, f, 'close');
    const note = str(ctx.body.note, { name: 'Reason', min: 10, max: 1000, required: true });
    transition(ctx, f, 'In Progress', { note, closure_rejected: true }, ', decision_note = ?', [note]);
    return { ok: true };
  });

  route('POST', '/api/findings/:id/accept-risk', R.APPROVE, (ctx) => {
    const f = row(pid(ctx.params.id), ctx.user.org_id);
    if (!OPEN_STATES.has(f.status)) throw new HttpError(409, `A ${f.status.toLowerCase()} finding cannot be risk-accepted.`);
    sodBlock(ctx, f, 'accept');
    const note = str(ctx.body.note, { name: 'Justification', min: 20, max: 2000, required: true });
    const riskId = optId(ctx.body.risk_id);
    if (!sameOrg('risks', riskId, ctx.user.org_id)) throw bad('Unknown risk.');
    transition(ctx, f, 'Risk-Accepted', { note, risk_id: riskId ?? undefined }, ', closed_by = ?, closed_at = ?, decision_note = ?, risk_id = COALESCE(?, risk_id)', [ctx.user.id, nowIso(), note, riskId]);
    return { ok: true };
  });

  return {
    summary(org, me) {
      syncExpiredExceptions(org);
      const t = today();
      const list = all("SELECT * FROM findings WHERE org_id = ? AND status IN ('Open','In Progress','Remediated')", org).map((f) => view(f, t));
      const actions = [];
      const sevRank = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'info' };
      list.filter((f) => f.overdue).forEach((f) => actions.push({ kind: 'finding', severity: f.severity === 'Low' ? 'high' : 'critical', title: `${f.code} overdue: ${f.title}`, detail: `Was due ${f.due_date}${f.owner_name ? ` · owner ${f.owner_name}` : ' · no owner'}`, link: `#/findings/${f.id}` }));
      list.filter((f) => !f.overdue && f.owner_id === me.id && f.status !== 'Remediated').forEach((f) => actions.push({ kind: 'finding', severity: sevRank[f.severity], title: `${f.code} is yours to remediate: ${f.title}`, detail: f.due_date ? `Due ${f.due_date}` : 'Set a due date', link: `#/findings/${f.id}` }));
      list.filter((f) => !f.owner_id && !f.overdue).forEach((f) => actions.push({ kind: 'finding', severity: 'high', title: `${f.code} has no owner`, detail: f.title, link: `#/findings/${f.id}` }));
      if (R.WRITE.includes(me.role)) {
        list.filter((f) => !f.overdue && f.owner_id && f.owner_id !== me.id && ['Critical', 'High'].includes(f.severity) && f.status !== 'Remediated')
          .forEach((f) => actions.push({ kind: 'finding', severity: 'medium', title: `${f.code} ${f.severity.toLowerCase()} finding open: ${f.title}`, detail: `Owner ${f.owner_name}${f.due_date ? ` · due ${f.due_date}` : ''}`, link: `#/findings/${f.id}` }));
      }
      if (R.APPROVE.includes(me.role)) {
        list.filter((f) => f.status === 'Remediated').forEach((f) => {
          const self = f.owner_id === me.id || f.closure_requested_by === me.id;
          actions.push({ kind: 'finding', severity: self ? 'info' : 'high', title: `${f.code} closure awaits approval`, detail: self ? 'You own it or requested closure, so another approver must approve it.' : `Requested by ${f.closure_requested_by_name}`, link: `#/findings/${f.id}` });
        });
      }
      const bySev = Object.fromEntries(SEVERITIES.map((s) => [s, list.filter((f) => f.severity === s).length]));
      return {
        stats: { open: list.length, overdue: list.filter((f) => f.overdue).length, awaiting_closure: list.filter((f) => f.status === 'Remediated').length, by_severity: bySev, unowned: list.filter((f) => !f.owner_id).length },
        actions,
      };
    },
  };
}
