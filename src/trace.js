// Risk → control → policy → evidence traceability. From one risk: the controls that mitigate it
// (linked directly, or operating a framework requirement the risk names), the policy statements
// behind each control, each control's latest test, its evidence, and any open findings.
import { all, get } from './db.js';
import { today, parseJson } from './util.js';

export function registerTraceRoutes({ route, R, pid, notFound, controlsMap, userName, hydratePolicy, riskView, evidenceView }) {
  route('GET', '/api/risks/:id/trace', R.READ, (ctx) => {
    const org = ctx.user.org_id, cmap = controlsMap(org), t = today();
    const row = get('SELECT * FROM risks WHERE id = ? AND org_id = ?', pid(ctx.params.id), org);
    if (!row) throw notFound('Risk');
    const risk = riskView(row);
    const direct = new Set(risk.org_control_ids);
    const reqIds = new Set(risk.control_ids);
    const policyCache = new Map();
    const policy = (id) => { if (!policyCache.has(id)) policyCache.set(id, hydratePolicy(get('SELECT id, code, title, status, version, statements FROM policies WHERE id = ? AND org_id = ?', id, org))); return policyCache.get(id); };

    const controls = all('SELECT * FROM org_controls WHERE org_id = ? ORDER BY code', org).map((c) => ({
      ...c, framework_ids: parseJson(c.framework_ids, []), statement_refs: parseJson(c.statement_refs, []), evidence_ids: parseJson(c.evidence_ids, []),
    })).filter((c) => direct.has(c.id) || (c.status === 'active' && c.framework_ids.some((id) => reqIds.has(id))))
      .map((c) => {
        const latest = get('SELECT * FROM control_tests WHERE control_id = ? ORDER BY tested_on DESC, id DESC LIMIT 1', c.id);
        const statements = c.statement_refs.map((r) => {
          const p = policy(r.policy_id);
          const i = p ? p.statements.findIndex((s) => s.id === r.statement_id) : -1;
          return i >= 0 ? { policy_id: p.id, policy_code: p.code, policy_title: p.title, policy_status: p.status, num: `4.${i + 1}`, text: p.statements[i].text } : null;
        }).filter(Boolean);
        const evIds = [...new Set([...c.evidence_ids, ...(latest ? parseJson(latest.evidence_ids, []) : [])])];
        const evidence = evIds.map((id) => get('SELECT * FROM evidence WHERE id = ? AND org_id = ?', id, org)).filter(Boolean).map(evidenceView);
        const findings = all("SELECT id, code, title, severity, status, due_date FROM findings WHERE control_id = ? AND status IN ('Open','In Progress','Remediated')", c.id);
        const overdue = c.status === 'active' && !!c.next_due && c.next_due < t;
        const operating = c.status === 'active' && c.design_status === 'approved' && ['pass', 'exception'].includes(c.result) && !overdue;
        return {
          id: c.id, code: c.code, name: c.name, owner_name: userName(c.owner_id), status: c.status, design_status: c.design_status, frequency: c.frequency,
          result: c.result, effectiveness: c.effectiveness, next_due: c.next_due, overdue, operating,
          link: direct.has(c.id) ? 'direct' : 'requirement',
          via: c.framework_ids.filter((id) => reqIds.has(id)).map((id) => cmap.get(id)).filter(Boolean).map((x) => `${x.framework_code} ${x.ref}`),
          requirements: c.framework_ids.map((id) => cmap.get(id)).filter(Boolean).map((x) => ({ framework_code: x.framework_code, ref: x.ref, title: x.title })),
          latest_test: latest ? { tested_on: latest.tested_on, result: latest.result, effectiveness: latest.effectiveness, tester_name: userName(latest.tester_id), methodology: latest.methodology } : null,
          statements, evidence: evidence.map((e) => ({ id: e.id, title: e.title, collected_on: e.collected_on, expires_on: e.expires_on, fresh: e.fresh })), findings,
        };
      });

    const policies = risk.policy_ids.map(policy).filter(Boolean).map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status, version: p.version }));
    const ctlIds = controls.map((c) => c.id);
    const findings = all(`SELECT id, code, title, severity, status, due_date, control_id FROM findings WHERE org_id = ? AND (risk_id = ?${ctlIds.length ? ` OR control_id IN (${ctlIds.join(',')})` : ''}) ORDER BY id DESC`, org, risk.id)
      .map((f) => ({ ...f, open: ['Open', 'In Progress', 'Remediated'].includes(f.status), overdue: ['Open', 'In Progress', 'Remediated'].includes(f.status) && !!f.due_date && f.due_date < t }));
    const requirements = risk.control_ids.map((id) => cmap.get(id)).filter(Boolean).map((x) => ({
      id: x.id, framework_code: x.framework_code, ref: x.ref, title: x.title, operated_by: controls.filter((c) => c.status === 'active' && c.requirements.some((r) => r.framework_code === x.framework_code && r.ref === x.ref)).map((c) => c.code),
    }));
    const active = controls.filter((c) => c.status === 'active');
    const gaps = active.filter((c) => !c.operating);
    const verdict = !active.length ? 'none' : gaps.length ? 'gap' : 'operating';
    return {
      risk: { id: risk.id, code: risk.code, title: risk.title, description: risk.description, owner: risk.owner, category: risk.category, treatment: risk.treatment, treatment_plan: risk.treatment_plan,
        status: risk.status, inherent: risk.inherent, residual: risk.residual, inherent_level: risk.inherent_level, residual_level: risk.residual_level, above_appetite: risk.above_appetite, due_date: risk.due_date },
      verdict, summary: { controls: active.length, operating: active.length - gaps.length, gaps: gaps.map((c) => c.code), unoperated_requirements: requirements.filter((r) => !r.operated_by.length).map((r) => `${r.framework_code} ${r.ref}`), open_findings: findings.filter((f) => f.open).length },
      controls, policies, requirements, findings,
    };
  });
}
