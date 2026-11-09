// Risk traceability: one screen from a risk to the controls that mitigate it, the policy statements
// behind them, their latest tests and their evidence.
import { html, mount, GET, fmtDate, pill, icon } from '../core.js';
import { riskLevel } from '../lint.js';
import { sevPill, statusPill } from './findings.js';
import { assetsPanel } from './assets.js';

const RESULT = { pass: ['ok', 'Pass'], fail: ['critical', 'Fail'], exception: ['medium', 'Exception'], not_tested: ['info', 'Not yet tested'] };
const VERDICT = {
  operating: ['ok', 'Mitigation operating', 'Every mitigating control has an approved design, passed its latest test and is not overdue.'],
  gap: ['high', 'Mitigation gap', 'At least one mitigating control is untested, failing, overdue or awaiting design approval.'],
  none: ['critical', 'No mitigating controls', 'No control in the register mitigates this risk yet. Link controls in the risk, or add framework requirements that a control operates.'],
};

export async function riskTraceView(el, id) {
  const [d, assets] = await Promise.all([GET(`/api/risks/${id}/trace`), GET(`/api/assets?risk_id=${id}`)]);
  const r = d.risk;
  const [vk, vl, vd] = VERDICT[d.verdict];
  mount(el, html`
    <div class="page-head">
      <div>
        <a class="back-link" href="#/risks">${icon('up')} Risk register</a>
        <div class="row"><span class="tag gold">${r.code}</span>${pill(r.inherent_level, `Inherent ${r.inherent} ${riskLevel(r.inherent).label}`)}<span class="muted">→</span>${pill(r.residual_level, `Residual ${r.residual} ${riskLevel(r.residual).label}`)}${r.above_appetite ? pill('high', 'Above appetite') : ''}${pill(r.status)}</div>
        <h1>${r.title}</h1>
        <div class="sub">Owner ${r.owner} · ${r.category} · ${r.treatment}${r.due_date ? ` · treatment due ${fmtDate(r.due_date)}` : ''}</div>
      </div>
    </div>
    <div class="notice ${vk === 'ok' ? 'good' : vk === 'high' ? 'warn' : 'bad'} trace-verdict" role="status"><b>${vl}.</b>&nbsp;<span>${vd}${d.summary.controls ? ` ${d.summary.operating} of ${d.summary.controls} controls operating.` : ''}${d.summary.unoperated_requirements.length ? ` Framework requirements with no operating control: ${d.summary.unoperated_requirements.join(', ')}.` : ''}</span></div>

    <section class="card" aria-labelledby="mc-h">
      <div class="card-h"><h3 id="mc-h">Mitigation chain</h3><span class="muted small">Control → policy statements → latest test → evidence</span></div>
      ${d.controls.length ? html`<div class="trace-rows">${d.controls.map((c) => html`
        <ol class="chain trace-row ${c.operating ? 'ok' : 'gap'}" aria-label="${c.code} ${c.name}">
          <li class="chain-col chain-ctl"><div class="chain-h">${icon('control')} Control</div>
            <a class="chain-item" href="#/controls/${c.id}"><span class="ref">${c.code}</span><b>${c.name}</b>
              <small>${c.owner_name ? `Owner ${c.owner_name}` : 'No owner'} · ${c.design_status === 'approved' ? 'design approved' : 'design draft'}${c.status === 'retired' ? ' · retired' : ''}</small>
              <small>${c.link === 'direct' ? 'Linked to this risk' : `Operates ${c.via.join(', ')}`}</small></a></li>
          <li class="chain-col"><div class="chain-h">${icon('policy')} Policy statements</div>
            ${c.statements.length ? c.statements.map((s) => html`<a class="chain-item" href="#/policies/${s.policy_id}"><span class="ref">${s.policy_code} ${s.num}</span><span class="clip">${s.text}</span><small>${s.policy_status.replace('_', ' ')}</small></a>`) : html`<div class="chain-empty">No policy statement linked.</div>`}</li>
          <li class="chain-col"><div class="chain-h">${icon('flask')} Latest test</div>
            ${c.latest_test ? html`<div class="chain-item">${pill(RESULT[c.latest_test.result][0], RESULT[c.latest_test.result][1])}<small>${fmtDate(c.latest_test.tested_on)} by ${c.latest_test.tester_name}</small><small class="clip">${c.latest_test.methodology}</small></div>` : html`<div class="chain-empty">Not yet tested.</div>`}
            ${c.next_due ? html`<div class="chain-due ${c.overdue ? 'bad' : ''}">Next test ${c.overdue ? 'was due' : 'due'} ${fmtDate(c.next_due)}</div>` : ''}
            ${c.findings.map((f) => html`<a class="chain-item" href="#/findings/${f.id}"><span class="ref">${f.code}</span><span>${f.title}</span><small>${f.severity} · ${f.status}</small></a>`)}</li>
          <li class="chain-col"><div class="chain-h">${icon('evidence')} Evidence</div>
            ${c.evidence.length ? c.evidence.map((e) => html`<a class="chain-item" href="#/evidence"><span>${e.title}</span><small>Collected ${fmtDate(e.collected_on)} · ${e.fresh ? `valid until ${fmtDate(e.expires_on)}` : html`<b class="bad-text">expired</b>`}</small></a>`) : html`<div class="chain-empty">No evidence.</div>`}</li>
        </ol>`)}</div>` : html`<div class="empty"><b>No mitigating controls</b>Open the risk in the register and choose controls under “Mitigating controls”, or create controls in the <a href="#/controls">control register</a> that operate the framework requirements below.</div>`}
    </section>

    <div class="grid g2">
      <section class="card" aria-labelledby="rq-h"><div class="card-h"><h3 id="rq-h">Framework requirements</h3></div><div class="card-b stack">
        ${d.requirements.length ? d.requirements.map((q) => html`<div class="chain-item"><span class="ref">${q.framework_code} ${q.ref}</span><span>${q.title}</span><small>${q.operated_by.length ? `Operated by ${q.operated_by.join(', ')}` : html`<b class="bad-text">No control operates it</b>`}</small></div>`) : html`<div class="chain-empty">None linked to this risk.</div>`}
        <p class="map-disclaimer">Control mappings are guidance, not a substitute for your auditor's judgment.</p></div></section>
      <section class="card" aria-labelledby="gp-h"><div class="card-h"><h3 id="gp-h">Governing policies</h3></div><div class="card-b stack">
        ${d.policies.length ? d.policies.map((p) => html`<a class="chain-item" href="#/policies/${p.id}"><span class="ref">${p.code}</span><span>${p.title}</span><small>${p.status.replace('_', ' ')}${p.version !== '0.0' ? ` · v${p.version}` : ''}</small></a>`) : html`<div class="chain-empty">No policy linked to this risk.</div>`}</div></section>
      <section class="card" aria-labelledby="fd-h"><div class="card-h"><h3 id="fd-h">Findings</h3></div><div class="card-b stack">
        ${d.findings.length ? d.findings.map((f) => html`<a class="chain-item" href="#/findings/${f.id}"><span class="ref">${f.code}</span><span>${f.title}</span><small class="row">${sevPill(f.severity)} ${statusPill(f.status)}${f.overdue ? html` <b class="bad-text">overdue</b>` : ''}</small></a>`) : html`<div class="chain-empty">No findings for this risk or its controls.</div>`}</div></section>
      <section class="card" aria-labelledby="as-h"><div class="card-h"><h3 id="as-h">Assets at risk</h3></div><div class="card-b">${assetsPanel(assets, { empty: 'No asset references this risk.' })}</div></section>
    </div>`);
}
