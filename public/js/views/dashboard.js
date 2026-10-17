import { html, mount, GET, ring, ago, money, icon, can, on, $ } from '../core.js';
import { heatMap } from './shared.js';

const PART_LABELS = {
  policyQuality: ['Policy quality', 'Average linter score of active policies'],
  coverage: ['Framework coverage', 'Controls addressed by published policies, averaged over frameworks in use'],
  evidenceFresh: ['Evidence freshness', 'Evidence items still within their validity window'],
  riskWithinAppetite: ['Risk within appetite', 'Open risks whose residual score is within appetite'],
  attestation: ['Attestation', 'Average acknowledgement rate of published policies'],
};

export async function dashboardView(el) {
  const d = await GET('/api/dashboard');
  let heatMode = 'residual';
  const tone = (v, good, warn) => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad');

  const draw = () => mount(el, html`
    <div class="page-head">
      <div><h1>GRC Posture</h1><div class="sub">One view of governance, risk and compliance health, with the actions that move it.</div></div>
      <div class="actions">
        ${can.write() ? html`<a class="btn" href="#/templates">${icon('template')} From template</a><a class="btn primary" href="#/policies">${icon('plus')} New policy</a>` : ''}
      </div>
    </div>

    <div class="grid g3">
      <div class="card span2">
        <div class="posture">
          ${ring(d.posture.score, { label: 'Posture' })}
          <div class="parts">
            ${Object.entries(d.posture.parts).map(([k, v]) => html`<div class="part" title="${PART_LABELS[k][1]}">
              <span>${PART_LABELS[k][0]}</span><div class="bar"><i class="${v >= 80 ? 'ok' : v >= 50 ? 'warn' : 'bad'}" data-w="${v}"></i></div><b>${v}%</b></div>`)}
            <div class="muted small">Posture index = 25% policy quality + 25% coverage + 20% evidence + 20% risk + 10% attestation.</div>
          </div>
        </div>
      </div>
      <div class="card" data-tour="queue">
        <div class="card-h"><h3>Action queue</h3><span class="badge ${d.actions.length ? '' : 'hidden'}">${d.actions.length}</span></div>
        ${d.actions.length ? html`<ul class="queue" id="queue">${d.actions.slice(0, 4).map((a) => html`<li><span class="sev ${a.severity}"></span><div><a class="t1" href="${a.link}">${a.title}</a><div class="d">${a.detail}</div></div></li>`)}</ul>
          ${d.actions.length > 4 ? html`<div class="card-b small"><button class="btn sm ghost" id="more">Show all ${d.actions.length}</button></div>` : ''}`
          : html`<div class="empty"><b>All clear</b>Nothing needs your attention.</div>`}
      </div>
    </div>

    <div class="grid g6">
      ${kpi('Policies', d.policies.total, `${d.policies.byStatus.published} published · ${d.policies.byStatus.draft + d.policies.byStatus.in_review} in progress`)}
      ${kpi('Avg. policy quality', d.policies.avgScore, 'Linter score /100', tone(d.policies.avgScore, 85, 65))}
      ${kpi('Reviews overdue', d.policies.overdue, `${d.policies.upcoming} due in 60 days`, d.policies.overdue ? 'bad' : 'good')}
      ${kpi('Risks above appetite', d.risks.aboveAppetite, `${d.risks.open} open · appetite ≤ ${d.risks.appetite}`, d.risks.aboveAppetite ? 'bad' : 'good')}
      ${kpi('Active exceptions', d.exceptions.active, `${d.exceptions.expiring} expiring ≤30d · ${d.exceptions.expired} expired`, d.exceptions.expired ? 'bad' : d.exceptions.expiring ? 'warn' : '')}
      ${kpi('Stale evidence', d.evidence.stale, `${d.evidence.total} items · ${d.evidence.dueSoon} due soon`, d.evidence.stale ? 'bad' : 'good')}
    </div>

    <div class="grid g3">
      <div class="card span2">
        <div class="card-h"><h3>Framework coverage</h3><span class="muted">Controls addressed by policy statements</span>
          <div class="right legend"><span><span class="ctrl-dot pub"></span>Published</span><span><span class="ctrl-dot plan"></span>In draft</span></div></div>
        <div class="card-b stack">
          ${d.frameworks.map((f) => html`<div class="part" title="${f.published} of ${f.total} controls covered by published policies; ${f.planned} including drafts">
            <a href="#/frameworks/${f.code}">${f.name}</a>
            <div class="bar"><i class="planned" data-w="${f.plannedPct}"></i><i data-w="${f.pct}"></i></div><b>${f.pct}%</b></div>`)}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Risk heat map</h3>
          <div class="right"><div class="tabs compact"><button data-heat="inherent" class="${heatMode === 'inherent' ? 'on' : ''}">Inherent</button><button data-heat="residual" class="${heatMode === 'residual' ? 'on' : ''}">Residual</button></div></div></div>
        <div class="card-b">${heatMap(d.risks.heat[heatMode], { appetite: d.risks.appetite })}
          <div class="row small dim mt"><span>Annualized loss exposure (open risks):</span><b class="right">${money(d.risks.ale)}</b></div>
        </div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h3>Policy pipeline</h3></div>
        <div class="card-b">
          <div class="grid g4">
            ${[['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['published', 'Published']].map(([k, l]) => html`
              <a class="card kpi" href="#/policies"><div class="label">${l}</div><div class="value">${d.policies.byStatus[k]}</div></a>`)}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Recent activity</h3>${can.audit() ? html`<a class="right small" href="#/audit">Audit trail →</a>` : ''}</div>
        <ul class="feed">${d.recent.map((r) => html`<li><span class="when">${ago(r.ts)}</span><span><b>${r.username}</b> <span class="dim">${r.action}</span> ${r.entity ? html`<span class="muted">${r.entity} ${r.entity_id || ''}</span>` : ''}</span></li>`)}</ul>
      </div>
    </div>
  `);

  draw();
  on(el, 'click', '[data-heat]', (e, b) => { heatMode = b.dataset.heat; draw(); });
  on(el, 'click', '#more', () => {
    mount($('#queue'), html`${d.actions.map((a) => html`<li><span class="sev ${a.severity}"></span><div><a class="t1" href="${a.link}">${a.title}</a><div class="d">${a.detail}</div></div></li>`)}`);
    $('#more')?.remove();
  });
}

function kpi(label, value, foot, tone = '') {
  return html`<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="foot">${foot}</div></div>`;
}
