// Control register: the controls the organization operates, their tests and their evidence.
// Each control shows its chain: policy statement(s) → control → framework refs → latest test → evidence.
import { html, mount, $, on, state, can, GET, POST, PUT, toast, fail, modal, confirmDialog, fmtDate, pill, icon, todayStr } from '../core.js';
import { controlPicker, MAP_DISCLAIMER } from './policies.js';
import { fwName } from './shared.js';
import { findingForm, sevPill, statusPill } from './findings.js';

const FREQ = { continuous: 'Continuous', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Annually' };
const RESULT = { pass: ['ok', 'Pass'], fail: ['critical', 'Fail'], exception: ['medium', 'Exception'], not_tested: ['info', 'Not yet tested'] };
const EFF = { effective: ['ok', 'Effective'], partially_effective: ['medium', 'Partially effective'], ineffective: ['critical', 'Ineffective'] };
const resultPill = (r) => pill(RESULT[r]?.[0] || 'info', RESULT[r]?.[1] || r);
const effPill = (e) => (e ? pill(EFF[e][0], EFF[e][1]) : html`<span class="muted small">Not rated</span>`);
const designPill = (c) => (c.status === 'retired' ? pill('retired', 'Retired') : c.design_status === 'approved' ? pill('approved', 'Design approved') : pill('draft', 'Design draft'));
const fwCitation = (c) => { const f = state.meta.frameworks.find((x) => x.code === c.framework_code); return `${f?.name || c.framework_code}${f?.version ? ` (${f.version})` : ''}, ${c.ref}`; };

// =====================================================================
// List
// =====================================================================
export async function controlsView(el) {
  let list = await GET('/api/control-register');
  let fw = '', status = 'active', show = 'all', q = '';
  const draw = () => {
    const rows = list.filter((c) => (status === 'all' || c.status === status)
      && (!fw || c.frameworks.includes(fw))
      && (show === 'all' || (show === 'overdue' ? c.overdue : show === 'design' ? c.design_status === 'draft' && c.status === 'active' : show === 'failures' ? c.open_failures > 0 : c.result === show))
      && (!q || `${c.code} ${c.name} ${c.owner_name || ''}`.toLowerCase().includes(q)));
    const active = list.filter((c) => c.status === 'active');
    const approved = active.filter((c) => c.design_status === 'approved');
    mount(el, html`
      <div class="page-head">
        <div><h1>Control register</h1><div class="sub">Policies state intent; controls prove operation. Each control links the policy statements it implements, the framework requirements it satisfies, its tests and its evidence.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} New control</button>` : ''}</div>
      </div>
      <div class="grid g4">
        ${kpi('Active controls', active.length, `${approved.length} with approved design`)}
        ${kpi('Passing', approved.filter((c) => c.result === 'pass').length, `${approved.filter((c) => c.result === 'not_tested').length} not yet tested`, 'good')}
        ${kpi('Failing', approved.filter((c) => c.result === 'fail').length, `${active.reduce((n, c) => n + c.open_failures, 0)} open failure(s)`, approved.some((c) => c.result === 'fail') ? 'bad' : '')}
        ${kpi('Overdue for test', approved.filter((c) => c.overdue).length, `${approved.filter((c) => c.due_soon).length} due in 14 days`, approved.some((c) => c.overdue) ? 'bad' : 'good')}
      </div>
      <div class="card">
        <div class="card-h ctl-filters">
          <h3>Controls</h3>
          <label class="f-inline"><span class="visually-hidden">Framework</span><select id="f-fw" aria-label="Filter by framework"><option value="">All frameworks</option>${state.meta.frameworks.map((f) => html`<option value="${f.code}" ${fw === f.code ? 'selected' : ''}>${f.name}</option>`)}</select></label>
          <label class="f-inline"><span class="visually-hidden">Show</span><select id="f-show" aria-label="Filter by result">${[['all', 'Any result'], ['overdue', 'Overdue for test'], ['failures', 'Open failures'], ['design', 'Design awaiting approval'], ['pass', 'Passing'], ['fail', 'Failing'], ['exception', 'Exception'], ['not_tested', 'Not yet tested']].map(([v, l]) => html`<option value="${v}" ${show === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="f-inline"><span class="visually-hidden">Status</span><select id="f-status" aria-label="Filter by status">${[['active', 'Active'], ['retired', 'Retired'], ['all', 'Active and retired']].map(([v, l]) => html`<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search controls" aria-label="Search controls"></div>
        </div>
        ${rows.length ? html`<div class="table-wrap"><table class="t ctl-table"><thead><tr><th>Control</th><th>Owner</th><th>Frameworks</th><th>Frequency</th><th>Last tested</th><th>Next due</th><th>Result</th><th>Effectiveness</th></tr></thead><tbody>
          ${rows.map((c) => html`<tr class="clickable" data-id="${c.id}" tabindex="0" aria-label="${c.code} ${c.name}">
            <td class="title-cell"><b>${c.name}</b><small>${c.code} · ${c.status === 'retired' ? 'Retired' : c.design_status === 'approved' ? 'Design approved' : 'Design draft'}${c.open_failures ? ` · ${c.open_failures} open failure` : ''}</small></td>
            <td>${c.owner_name || html`<span class="muted">Unassigned</span>`}</td>
            <td><div class="chips">${c.frameworks.length ? c.frameworks.map((f) => html`<span class="tag" title="${fwName(f)}">${f}</span>`) : html`<span class="muted small">None</span>`}</div></td>
            <td>${FREQ[c.frequency]}</td>
            <td>${c.last_tested_on ? fmtDate(c.last_tested_on) : html`<span class="muted">Never</span>`}</td>
            <td class="${c.overdue ? 's-critical' : ''}">${c.next_due ? html`${fmtDate(c.next_due)}${c.overdue ? html` <b class="small">overdue</b>` : ''}` : html`<span class="muted">${c.status === 'retired' ? '—' : 'After design approval'}</span>`}</td>
            <td>${resultPill(c.result)}</td>
            <td>${effPill(c.effectiveness)}</td></tr>`)}
        </tbody></table></div>`
          : html`<div class="empty"><b>${list.length ? 'No controls match' : 'No controls yet'}</b>${list.length ? 'Change the filters.' : 'Create a control for each safeguard you operate, such as "MFA enforced on the VPN", and link it to the policy statements it implements.'}</div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  on(el, 'change', '#f-fw', (e, s) => { fw = s.value; draw(); });
  on(el, 'change', '#f-show', (e, s) => { show = s.value; draw(); });
  on(el, 'change', '#f-status', (e, s) => { status = s.value; draw(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => { location.hash = `#/controls/${tr.dataset.id}`; });
  on(el, 'keydown', 'tr[data-id]', (e, tr) => { if (e.key === 'Enter') location.hash = `#/controls/${tr.dataset.id}`; });
  on(el, 'click', '#new', () => controlForm(null, async (id) => { location.hash = `#/controls/${id}`; }));
}

function kpi(label, value, foot, tone = '') {
  return html`<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="foot">${foot}</div></div>`;
}

// =====================================================================
// Detail: the full chain, tests and actions
// =====================================================================
export async function controlDetailView(el, id) {
  let [c, findings] = await Promise.all([GET(`/api/control-register/${id}`), GET(`/api/findings?control_id=${id}`)]);
  const me = state.me;
  const reload = async () => { [c, findings] = await Promise.all([GET(`/api/control-register/${id}`), GET(`/api/findings?control_id=${id}`)]); draw(); };

  const draw = () => {
    const latest = c.tests[0];
    const iDesigned = c.design_author === me.id || c.created_by === me.id;
    const iApproved = c.design_approved_by === me.id;
    const canApprove = can.approve() && c.status === 'active' && c.design_status === 'draft';
    const canTest = can.steward() && c.status === 'active' && c.design_status === 'approved';
    mount(el, html`
      <div class="page-head">
        <div>
          <a class="back-link" href="#/controls">${icon("up")} Control register</a>
          <div class="row"><span class="tag gold">${c.code}</span>${designPill(c)}${resultPill(c.result)}${c.overdue ? pill('critical', 'Test overdue') : ''}</div>
          <h1>${c.name}</h1>
        </div>
        <div class="actions">
          ${can.write() && c.status === 'active' ? html`<button class="btn" id="edit">Edit</button>` : ''}
          ${canApprove ? html`<button class="btn ok" id="approve" ${iDesigned ? 'disabled title="Separation of duties: you designed this control"' : ''}>${icon('check')} Approve design</button>` : ''}
          ${canTest ? html`<button class="btn primary" id="test" ${iApproved ? 'disabled title="Separation of duties: you approved this design"' : ''}>${icon('flask')} Record test</button>` : ''}
        </div>
      </div>
      ${c.status === 'active' && c.design_status === 'draft' ? html`<div class="notice info">${icon('lock')}<span>The design must be approved by someone other than its author before the control can be tested.${iDesigned ? ' You designed it, so another approver must approve it.' : ''}</span></div>` : ''}
      ${canTest && iApproved ? html`<div class="notice info">${icon('lock')}<span>Separation of duties: you approved this control's design, so someone else must test it.</span></div>` : ''}
      ${c.status === 'retired' ? html`<div class="notice warn"><span>This control is retired. It is kept for its history and can no longer be tested.</span></div>` : ''}

      <section class="card" aria-labelledby="chain-h">
        <div class="card-h"><h3 id="chain-h">Assurance chain</h3><span class="muted small">Policy statement → control → framework requirement → latest test → evidence</span></div>
        <ol class="chain">
          <li class="chain-col"><div class="chain-h">${icon('policy')} Policy statements</div>
            ${c.statements.length ? c.statements.map((s) => s.missing ? html`<div class="chain-item muted">A linked statement was removed from its policy.</div>`
              : html`<a class="chain-item" href="#/policies/${s.policy_id}"><span class="ref">${s.policy_code} ${s.num}</span><span class="clip">${s.text}</span><small>${s.policy_title} · ${s.policy_status.replace('_', ' ')}</small></a>`)
              : html`<div class="chain-empty">Not linked to a policy statement.</div>`}</li>
          <li class="chain-col chain-ctl"><div class="chain-h">${icon('control')} Control</div>
            <div class="chain-item"><span class="ref">${c.code}</span><b>${c.name}</b><small>${c.description || 'No description.'}</small>
              <small>Owner: ${c.owner_name || 'unassigned'} · ${FREQ[c.frequency]}</small>
              <small>Design: ${c.design_status === 'approved' ? `approved by ${c.design_approved_by_name} on ${fmtDate(c.design_approved_at)}` : `draft by ${c.design_author_name || c.created_by_name || 'unknown'}`}</small></div></li>
          <li class="chain-col"><div class="chain-h">${icon('framework')} Framework requirements</div>
            ${c.frameworks.length ? c.frameworks.map((f) => html`<a class="chain-item" href="#/frameworks/${f.framework_code}" title="Source: ${fwCitation(f)}"><span class="ref">${f.framework_code} ${f.ref}</span><span>${f.title}</span><small>${fwCitation(f)}</small></a>`)
              : html`<div class="chain-empty">No framework requirements linked.</div>`}
            ${c.frameworks.length ? html`<p class="map-disclaimer">${MAP_DISCLAIMER}</p>` : ''}</li>
          <li class="chain-col"><div class="chain-h">${icon('flask')} Latest test</div>
            ${latest ? html`<div class="chain-item">${resultPill(latest.result)}<small>${fmtDate(latest.tested_on)} by ${latest.tester_name}</small><small>${effPill(latest.effectiveness)}</small>
              <small class="clip">${latest.methodology}</small></div>
              <div class="chain-due ${c.overdue ? 'bad' : ''}">${c.next_due ? `Next test ${c.overdue ? 'was due' : 'due'} ${fmtDate(c.next_due)}` : ''}</div>`
              : html`<div class="chain-empty">Not yet tested.${c.next_due ? html`<br>First test due ${fmtDate(c.next_due)}.` : ''}</div>`}</li>
          <li class="chain-col"><div class="chain-h">${icon('evidence')} Evidence</div>
            ${c.evidence.length ? c.evidence.map((e) => html`<a class="chain-item" href="#/evidence"><span>${e.title}</span><small>Collected ${fmtDate(e.collected_on)} · ${e.fresh ? `valid until ${fmtDate(e.expires_on)}` : html`<b class="bad-text">expired ${fmtDate(e.expires_on)}</b>`}</small></a>`)
              : html`<div class="chain-empty">No evidence linked.</div>`}</li>
        </ol>
      </section>

      <section class="card" aria-labelledby="tests-h">
        <div class="card-h"><h3 id="tests-h">Test history</h3><span class="muted small">${c.tests.length} test${c.tests.length === 1 ? '' : 's'} · records cannot be edited or deleted</span></div>
        ${c.tests.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Result</th><th>Effectiveness</th><th>Tester</th><th>Methodology and notes</th><th>Evidence</th><th>Failure</th></tr></thead><tbody>
          ${c.tests.map((t) => html`<tr>
            <td class="nowrap">${fmtDate(t.tested_on)}</td><td>${resultPill(t.result)}</td><td>${effPill(t.effectiveness)}</td><td>${t.tester_name}</td>
            <td class="wrap-cell">${t.methodology}${t.notes ? html`<small class="muted">${t.notes}</small>` : ''}</td>
            <td>${t.evidence_ids.length || html`<span class="muted">—</span>`}</td>
            <td>${t.finding ? html`<a href="#/findings/${t.finding.id}" class="nowrap">${t.finding.code}</a> ${statusPill(t.finding.status)}` : t.failure_status === 'open' ? html`${pill('critical', 'Open')}${can.steward() ? html` <button class="btn xs" data-close-fail="${t.id}" ${t.tester_id === me.id ? 'disabled title="Separation of duties: you recorded this test"' : ''}>Close…</button>` : ''}`
              : t.failure_status === 'closed' ? html`${pill('closed', 'Closed')}<small class="muted">by ${t.closed_by_name}, ${fmtDate(t.closed_at)}: ${t.close_note}</small>` : html`<span class="muted">—</span>`}</td>
          </tr>`)}</tbody></table></div>`
          : html`<div class="empty"><b>No tests yet</b>${c.design_status === 'approved' ? 'Record the first test to show this control operates.' : 'Approve the design first.'}</div>`}
      </section>

      <section class="card" aria-labelledby="cf-h">
        <div class="card-h"><h3 id="cf-h">Findings</h3><span class="muted small">Corrective actions linked to this control</span>${can.write() ? html`<button class="btn xs right" id="new-finding">${icon('plus')} New finding</button>` : ''}</div>
        ${findings.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th></tr></thead><tbody>
          ${findings.map((f) => html`<tr class="clickable ${f.overdue ? 'row-overdue' : ''}" data-fid="${f.id}" tabindex="0"><td class="title-cell"><b>${f.title}</b><small>${f.code}</small></td><td>${sevPill(f.severity)}</td><td>${statusPill(f.status)}</td><td>${f.owner_name || html`<span class="bad-text">No owner</span>`}</td><td class="${f.overdue ? 's-critical' : ''}">${f.due_date ? fmtDate(f.due_date) : '—'}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty small"><b>No findings</b>Failed tests open one automatically.</div>`}
      </section>

      ${can.write() ? html`<div class="row">${c.status === 'active' ? html`<button class="btn ghost danger-text" id="retire">Retire control</button>` : html`<button class="btn" id="reactivate">Reactivate control</button>`}</div>` : ''}`);
  };
  draw();

  on(el, 'click', '#edit', () => controlForm(c, reload));
  on(el, 'click', '[data-fid]', (e, tr) => { location.hash = `#/findings/${tr.dataset.fid}`; });
  on(el, 'keydown', '[data-fid]', (e, tr) => { if (e.key === 'Enter') location.hash = `#/findings/${tr.dataset.fid}`; });
  on(el, 'click', '#new-finding', () => findingForm(null, async (fid) => { location.hash = `#/findings/${fid}`; }, { control_id: c.id, owner_id: c.owner_id, title: `${c.code} ${c.name}: ` }));
  on(el, 'click', '#approve', async (e, b) => {
    if (!(await confirmDialog({ title: `Approve the design of ${c.code}?`, message: 'You confirm the control, as described, would meet the linked policy statements and framework requirements if it operates. Testing can start once approved.', confirm: 'Approve design' }))) return;
    b.disabled = true;
    try { await POST(`/api/control-register/${c.id}/approve-design`); toast('Design approved. The first test is now scheduled.'); await reload(); } catch (err) { fail(err); b.disabled = false; }
  });
  on(el, 'click', '#test', () => testDialog(c, reload));
  on(el, 'click', '[data-close-fail]', (e, b) => closeFailureDialog(c, c.tests.find((t) => t.id === Number(b.dataset.closeFail)), reload));
  on(el, 'click', '#retire', () => {
    modal({
      title: `Retire ${c.code}?`,
      body: html`<form class="stack" id="rf"><p class="dim">Retired controls keep their tests and evidence but are no longer scheduled or tested.</p>
        <label class="f"><span>Reason</span><input id="rr" maxlength="500" required placeholder="e.g. Replaced by CTL-012 (SSO-enforced MFA)"></label></form>`,
      footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rok">Retire control</button>`,
      onMount: ({ el: m, close }) => on(m, 'click', '#rok', async () => {
        try { await POST(`/api/control-register/${c.id}/status`, { status: 'retired', reason: $('#rr', m).value }); close(); toast('Control retired.'); await reload(); } catch (err) { fail(err); }
      }),
    });
  });
  on(el, 'click', '#reactivate', async () => {
    try { await POST(`/api/control-register/${c.id}/status`, { status: 'active' }); toast('Control reactivated.'); await reload(); } catch (err) { fail(err); }
  });
}

// =====================================================================
// Create / edit
// =====================================================================
async function controlForm(c, done) {
  const [people, policies, evidence] = await Promise.all([GET('/api/people'), GET('/api/control-register-statements'), GET('/api/evidence')]);
  const v = c || { name: '', description: '', owner_id: state.me.id, frequency: 'quarterly', framework_ids: [], statement_refs: [], evidence_ids: [] };
  let fwIds = [...v.framework_ids];
  let refs = v.statement_refs.map((r) => `${r.policy_id}:${r.statement_id}`);
  let evIds = [...v.evidence_ids];
  let sq = '';
  const cmap = new Map(state.meta.controls.map((x) => [x.id, x]));
  modal({
    title: c ? `Edit ${c.code}` : 'New control', drawer: true,
    body: html`<form id="cf" class="stack" novalidate>
      <label class="f"><span>Control name <em>(what is done, e.g. "MFA enforced on the VPN")</em></span><input name="name" value="${v.name}" maxlength="200" required></label>
      <label class="f"><span>Description <em>(how it operates, so a tester can check it)</em></span><textarea name="description" rows="3" maxlength="4000">${v.description}</textarea></label>
      <div class="form-grid">
        <label class="f"><span>Control owner</span><select name="owner_id"><option value="">Unassigned</option>${people.map((u) => html`<option value="${u.id}" ${u.id === v.owner_id ? 'selected' : ''}>${u.name} (@${u.username})</option>`)}</select></label>
        <label class="f"><span>Test frequency</span><select name="frequency">${Object.entries(FREQ).map(([k, l]) => html`<option value="${k}" ${k === v.frequency ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <div><div class="section-label">Framework requirements it satisfies</div><div class="chips" id="cf-fw"></div><p class="map-disclaimer">${MAP_DISCLAIMER}</p></div>
      <div><div class="section-label">Policy statements it implements</div>
        <div class="search"><span>${icon('search')}</span><input id="cf-sq" placeholder="Search statements" aria-label="Search policy statements"></div>
        <div class="stmt-pick" id="cf-st" role="group" aria-label="Policy statements"></div></div>
      <div><div class="section-label">Evidence that it operates <em class="muted">(optional; tests can add more)</em></div>
        <div class="stmt-pick small-pick" role="group" aria-label="Evidence">${evidence.length ? evidence.map((e) => html`<label class="pick"><input type="checkbox" data-ev="${e.id}" ${evIds.includes(e.id) ? 'checked' : ''}><span class="ref">${e.framework_code || ''} ${e.control_ref || ''}</span><span>${e.title}<small>Collected ${fmtDate(e.collected_on)}${e.fresh ? '' : ' · expired'}</small></span></label>`) : html`<div class="muted small">No evidence recorded yet.</div>`}</div></div>
      ${c?.design_status === 'approved' ? html`<div class="notice warn small">Changing the name, description, frequency, framework requirements or statements resets the design approval. The control then needs approving again before its next test.</div>` : ''}
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>${c ? 'Save control' : 'Create control'}</button>`,
    onMount: ({ el, close }) => {
      const drawFw = () => mount($('#cf-fw', el), html`${fwIds.map((id) => { const x = cmap.get(id); return x ? html`<span class="chip" title="${x.title}. Source: ${fwCitation(x)}"><b>${x.framework_code}</b> ${x.ref}<button type="button" data-rmfw="${id}" aria-label="Remove ${x.framework_code} ${x.ref}">×</button></span>` : ''; })}<button class="btn xs" type="button" id="cf-pick">${icon('link')} Choose requirements</button>`);
      // Statements mapped to the chosen framework requirements are suggested first.
      const drawSt = () => {
        const all = policies.flatMap((p) => p.statements.map((s) => ({ p, s, key: `${p.id}:${s.id}`, match: s.controls.some((id) => fwIds.includes(id)) })));
        const rows = all.filter((x) => !sq || `${x.p.code} ${x.s.num} ${x.s.text}`.toLowerCase().includes(sq))
          .sort((a, b) => (refs.includes(b.key) - refs.includes(a.key)) || (b.match - a.match));
        mount($('#cf-st', el), rows.length ? html`${rows.slice(0, 80).map((x) => html`<label class="pick ${x.match ? 'sug' : ''}"><input type="checkbox" data-st="${x.key}" ${refs.includes(x.key) ? 'checked' : ''}>
          <span class="ref">${x.p.code} ${x.s.num}</span><span>${x.s.text}<small>${x.p.title} · ${x.p.status.replace('_', ' ')}${x.match ? ' · mapped to a chosen requirement' : ''}</small></span></label>`)}`
          : html`<div class="muted small">${policies.length ? 'No statements match.' : 'No policies yet.'}</div>`);
      };
      drawFw(); drawSt();
      on(el, 'click', '[data-rmfw]', (e, b) => { fwIds = fwIds.filter((x) => x !== Number(b.dataset.rmfw)); drawFw(); drawSt(); });
      on(el, 'click', '#cf-pick', () => controlPicker({ text: `${$('#cf', el).elements.namedItem('name').value} ${$('#cf', el).elements.namedItem('description').value}`, selected: fwIds, title: 'Framework requirements', onSave: (ids) => { fwIds = ids; drawFw(); drawSt(); } }));
      $('#cf-sq', el).addEventListener('input', (e) => { sq = e.target.value.toLowerCase(); drawSt(); });
      on(el, 'change', '[data-st]', (e, cb) => { refs = cb.checked ? [...refs, cb.dataset.st] : refs.filter((k) => k !== cb.dataset.st); });
      on(el, 'change', '[data-ev]', (e, cb) => { const n = Number(cb.dataset.ev); evIds = cb.checked ? [...evIds, n] : evIds.filter((x) => x !== n); });
      on(el, 'click', '[data-save]', async (e, b) => {
        const f = $('#cf', el);
        const body = {
          name: f.elements.namedItem('name').value, description: f.elements.namedItem('description').value,
          owner_id: f.elements.namedItem('owner_id').value || null, frequency: f.elements.namedItem('frequency').value,
          framework_ids: fwIds, evidence_ids: evIds,
          statement_refs: refs.map((k) => { const [policy_id, statement_id] = k.split(':'); return { policy_id: Number(policy_id), statement_id }; }),
        };
        b.disabled = true;
        try {
          if (c) {
            const r = await PUT(`/api/control-register/${c.id}`, body);
            toast(r.design_reset ? 'Saved. The design changed, so it needs approving again.' : 'Control saved.');
            close(); await done(c.id);
          } else {
            const r = await POST('/api/control-register', body);
            toast(`${r.code} created. Ask an approver to approve its design.`);
            close(); await done(r.id);
          }
        } catch (err) { fail(err); b.disabled = false; }
      });
    },
  });
}

// =====================================================================
// Record a test
// =====================================================================
async function testDialog(c, done) {
  const evidence = await GET('/api/evidence');
  const linked = new Set(c.evidence_ids);
  const ordered = [...evidence.filter((e) => linked.has(e.id)), ...evidence.filter((e) => !linked.has(e.id))];
  let picked = new Set();
  modal({
    title: `Record a test of ${c.code}`, wide: true,
    body: html`<form id="tf" class="stack" novalidate>
      <p class="dim small">${c.name}${c.description ? ` · ${c.description}` : ''}</p>
      <div class="form-grid">
        <label class="f"><span>Test date</span><input type="date" name="tested_on" value="${todayStr()}" max="${todayStr()}" required></label>
        <label class="f"><span>Operating effectiveness</span><select name="effectiveness" aria-describedby="eff-hint">
          <option value="effective">Effective</option><option value="partially_effective">Partially effective</option><option value="ineffective">Ineffective</option></select>
          <small class="muted" id="eff-hint">Set from the result; change it if needed.</small></label>
      </div>
      <fieldset class="result-pick"><legend class="section-label">Result</legend>
        ${[['pass', 'Pass', 'The control operated as designed for the whole sample.'], ['fail', 'Fail', 'It did not operate. A failure is opened for remediation.'], ['exception', 'Exception', 'It operated, with a documented deviation (e.g. an approved exception).']]
          .map(([k, l, d], i) => html`<label class="result-opt r-${k}"><input type="radio" name="result" value="${k}" ${i ? '' : 'checked'}><span><b>${l}</b><small>${d}</small></span></label>`)}
      </fieldset>
      <label class="f"><span>Methodology <em>(what you inspected, sampled or observed)</em></span><textarea name="methodology" rows="3" maxlength="4000" required placeholder="e.g. Sampled 25 VPN logins from the last quarter and confirmed each used a second factor."></textarea></label>
      <label class="f"><span id="notes-l">Notes <em>(optional for a pass)</em></span><textarea name="notes" rows="2" maxlength="4000" placeholder="What you found, deviations, follow-ups"></textarea></label>
      <div><div class="section-label">Evidence from this test</div>
        <div class="stmt-pick small-pick" role="group" aria-label="Evidence">${ordered.length ? ordered.map((e) => html`<label class="pick ${linked.has(e.id) ? 'sug' : ''}"><input type="checkbox" data-tev="${e.id}"><span class="ref">${e.framework_code || ''} ${e.control_ref || ''}</span><span>${e.title}<small>Collected ${fmtDate(e.collected_on)}${linked.has(e.id) ? ' · linked to this control' : ''}${e.fresh ? '' : ' · expired'}</small></span></label>`) : html`<div class="muted small">No evidence yet. Add it below.</div>`}</div>
        <details class="new-ev"><summary>Add new evidence</summary>
          <div class="form-grid">
            <label class="f full"><span>Title</span><input id="ne-title" maxlength="200" placeholder="e.g. VPN MFA configuration export"></label>
            <label class="f full"><span>Location <em>(link or path; the file stays where it is)</em></span><input id="ne-loc" maxlength="500" placeholder="https://… or \\\\share\\…"></label>
            <label class="f"><span>Framework requirement</span><select id="ne-ctl">${(c.frameworks.length ? c.frameworks : []).map((f) => html`<option value="${f.id}">${f.framework_code} ${f.ref}</option>`)}</select></label>
            <label class="f"><span>Valid for (days)</span><input id="ne-days" type="number" min="1" max="1095" value="90"></label>
          </div>
          ${c.frameworks.length ? html`<button type="button" class="btn sm" id="ne-add">${icon('plus')} Add and attach</button>` : html`<div class="muted small">Link a framework requirement to this control to add evidence here.</div>`}
        </details></div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="t-save">${icon('check')} Record test</button>`,
    onMount: ({ el, close }) => {
      const f = $('#tf', el);
      const sync = () => {
        const r = f.querySelector('input[name=result]:checked').value;
        f.elements.namedItem('effectiveness').value = { pass: 'effective', exception: 'partially_effective', fail: 'ineffective' }[r];
        mount($('#notes-l', el), html`Notes <em>${r === 'pass' ? '(optional for a pass)' : '(required: what failed or deviated)'}</em>`);
      };
      on(el, 'change', 'input[name=result]', sync);
      on(el, 'change', '[data-tev]', (e, cb) => { const n = Number(cb.dataset.tev); cb.checked ? picked.add(n) : picked.delete(n); });
      on(el, 'click', '#ne-add', async (e, b) => {
        const title = $('#ne-title', el).value.trim();
        if (title.length < 3) return toast('Give the evidence a title.', 'err');
        b.disabled = true;
        try {
          const r = await POST('/api/evidence', { control_id: Number($('#ne-ctl', el).value), title, location: $('#ne-loc', el).value.trim(), owner: state.me.name, collected_on: f.elements.namedItem('tested_on').value || todayStr(), valid_days: Number($('#ne-days', el).value) || 90 });
          picked.add(r.id);
          const list = el.querySelector('.stmt-pick');
          list.querySelector('.muted.small')?.remove();
          list.insertAdjacentHTML('afterbegin', `<label class="pick sug"><input type="checkbox" data-tev="${r.id}" checked><span class="ref">New</span><span></span></label>`);
          list.firstElementChild.lastElementChild.textContent = title;
          $('#ne-title', el).value = ''; $('#ne-loc', el).value = '';
          toast('Evidence added and attached.');
        } catch (err) { fail(err); } finally { b.disabled = false; }
      });
      on(el, 'click', '#t-save', async (e, b) => {
        const body = {
          tested_on: f.elements.namedItem('tested_on').value, result: f.querySelector('input[name=result]:checked').value,
          effectiveness: f.elements.namedItem('effectiveness').value, methodology: f.elements.namedItem('methodology').value,
          notes: f.elements.namedItem('notes').value, evidence_ids: [...picked],
        };
        b.disabled = true;
        try {
          const r = await POST(`/api/control-register/${c.id}/tests`, body);
          close();
          toast(r.failure_opened ? `Test recorded as failed. ${r.finding ? `Finding ${r.finding.code} opened for remediation.` : 'A failure is open.'}` : `Test recorded. Next test due ${fmtDate(r.next_due)}.`);
          await done();
        } catch (err) { fail(err); b.disabled = false; }
      });
    },
  });
}

function closeFailureDialog(c, t, done) {
  modal({
    title: `Close the failure on ${c.code}`,
    body: html`<form class="stack" id="xf"><p class="dim small">Failed on ${fmtDate(t.tested_on)} (tested by ${t.tester_name}): ${t.notes || t.methodology}</p>
      <p class="small">Confirm the cause was remediated. You cannot close a failure you recorded yourself. Record a new passing test to show the control now operates.</p>
      <label class="f"><span>What was done</span><textarea id="xn" rows="3" maxlength="2000" required placeholder="e.g. Legacy VPN profile removed on 12 Nov; verified no password-only logins since."></textarea></label></form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="xok">Close failure</button>`,
    onMount: ({ el, close }) => on(el, 'click', '#xok', async (e, b) => {
      b.disabled = true;
      try { await POST(`/api/control-tests/${t.id}/close`, { note: $('#xn', el).value }); close(); toast('Failure closed.'); await done(); } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}
