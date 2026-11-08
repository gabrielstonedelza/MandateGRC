// Findings & corrective action (CAP / POA&M): the queue, each finding's page, and its lifecycle.
import { html, mount, $, on, state, can, GET, POST, PUT, toast, fail, modal, fmtDate, fmtDateTime, pill, icon, todayStr } from '../core.js';

export const SEV = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STATUS = { Open: 'open', 'In Progress': 'in_review', Remediated: 'requested', Closed: 'closed', 'Risk-Accepted': 'accepted' };
const STATUS_ORDER = { Open: 0, 'In Progress': 1, Remediated: 2, 'Risk-Accepted': 3, Closed: 4 };
const SOURCE = { control_test: 'Control test failure', self_assessment: 'Self-assessment', audit: 'Audit', expired_exception: 'Expired exception', manual: 'Manual' };
export const sevPill = (s) => pill(SEV[s], s);
export const statusPill = (s) => pill(STATUS[s] || 'info', s);

// =====================================================================
// Queue
// =====================================================================
export async function findingsView(el) {
  let list = await GET('/api/findings');
  let show = 'open', sev = '', source = '', q = '', sort = { key: 'severity', dir: 1 };
  const cmp = {
    severity: (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.due_date || '9').localeCompare(b.due_date || '9'),
    due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    identified: (a, b) => b.identified_on.localeCompare(a.identified_on),
  };
  const th = (key, label) => html`<th aria-sort="${sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="th-sort ${sort.key === key ? 'on' : ''}" data-sort="${key}">${label}${sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  const draw = () => {
    const rows = list.filter((f) => (show === 'all' || (show === 'open' ? f.open : show === 'overdue' ? f.overdue : show === 'awaiting' ? f.status === 'Remediated' : show === 'mine' ? f.owner_id === state.me.id && f.open : !f.open))
      && (!sev || f.severity === sev) && (!source || f.source === source)
      && (!q || `${f.code} ${f.title} ${f.owner_name || ''} ${f.control_code || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => cmp[sort.key](a, b) * sort.dir);
    const open = list.filter((f) => f.open);
    mount(el, html`
      <div class="page-head">
        <div><h1>Findings</h1><div class="sub">Corrective action plan: every gap found by a failed control test, an expired exception, an audit or a self-assessment, with an owner, a plan and a due date. Closure needs evidence and a second approver.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} New finding</button>` : ''}</div>
      </div>
      <div class="grid g4">
        ${kpi('Open findings', open.length, `${open.filter((f) => !f.owner_id).length} without an owner`)}
        ${kpi('Overdue', open.filter((f) => f.overdue).length, 'Past their due date', open.some((f) => f.overdue) ? 'bad' : 'good')}
        ${kpi('Critical / high', open.filter((f) => ['Critical', 'High'].includes(f.severity)).length, `${open.filter((f) => f.severity === 'Critical').length} critical`, open.some((f) => f.severity === 'Critical') ? 'bad' : '')}
        ${kpi('Awaiting closure approval', open.filter((f) => f.status === 'Remediated').length, 'Remediated, evidence attached')}
      </div>
      <div class="card">
        <div class="card-h ctl-filters">
          <h3>Queue</h3>
          <select id="f-show" aria-label="Show">${[['open', 'Open'], ['overdue', 'Overdue'], ['awaiting', 'Awaiting closure approval'], ['mine', 'Mine'], ['done', 'Closed or accepted'], ['all', 'All']].map(([v, l]) => html`<option value="${v}" ${show === v ? 'selected' : ''}>${l}</option>`)}</select>
          <select id="f-sev" aria-label="Severity"><option value="">Any severity</option>${Object.keys(SEV).map((s) => html`<option ${sev === s ? 'selected' : ''}>${s}</option>`)}</select>
          <select id="f-src" aria-label="Source"><option value="">Any source</option>${Object.entries(SOURCE).map(([k, l]) => html`<option value="${k}" ${source === k ? 'selected' : ''}>${l}</option>`)}</select>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search findings" aria-label="Search findings"></div>
        </div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Finding</th>${th('severity', 'Severity')}${th('status', 'Status')}<th>Owner</th>${th('due', 'Due')}<th>Source</th><th>Linked to</th></tr></thead><tbody>
          ${rows.map((f) => html`<tr class="clickable ${f.overdue ? 'row-overdue' : ''}" data-id="${f.id}" tabindex="0" aria-label="${f.code} ${f.title}">
            <td class="title-cell"><b>${f.title}</b><small>${f.code} · identified ${fmtDate(f.identified_on)}</small></td>
            <td>${sevPill(f.severity)}</td><td>${statusPill(f.status)}</td>
            <td>${f.owner_name || html`<span class="bad-text">No owner</span>`}</td>
            <td class="${f.overdue ? 's-critical' : ''}">${f.due_date ? html`${fmtDate(f.due_date)}${f.overdue ? html` <b class="small">overdue</b>` : ''}` : html`<span class="muted">Not set</span>`}</td>
            <td>${SOURCE[f.source]}</td>
            <td><div class="chips">${[f.control_code, f.risk_code, f.exception_code, f.policy_code].filter(Boolean).map((c) => html`<span class="tag">${c}</span>`)}</div></td></tr>`)}
        </tbody></table></div>`
          : html`<div class="empty"><b>${list.length ? 'Nothing matches' : 'No findings'}</b>${list.length ? 'Change the filters.' : 'Failed control tests and expired exceptions create findings automatically. You can also log audit and self-assessment findings here.'}</div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  on(el, 'change', '#f-show', (e, s) => { show = s.value; draw(); });
  on(el, 'change', '#f-sev', (e, s) => { sev = s.value; draw(); });
  on(el, 'change', '#f-src', (e, s) => { source = s.value; draw(); });
  on(el, 'click', '[data-sort]', (e, b) => { const k = b.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; draw(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => { location.hash = `#/findings/${tr.dataset.id}`; });
  on(el, 'keydown', 'tr[data-id]', (e, tr) => { if (e.key === 'Enter') location.hash = `#/findings/${tr.dataset.id}`; });
  on(el, 'click', '#new', () => findingForm(null, async (id) => { location.hash = `#/findings/${id}`; }));
}

function kpi(label, value, foot, tone = '') {
  return html`<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="foot">${foot}</div></div>`;
}

// =====================================================================
// One finding
// =====================================================================
const ACTION_LABELS = {
  'finding.created': 'Created', 'finding.updated': 'Updated', 'finding.in_progress': 'Remediation started', 'finding.remediated': 'Closure requested',
  'finding.closed': 'Closure approved', 'finding.risk_accepted': 'Risk accepted', 'finding.approval_blocked_sod': 'Approval blocked (separation of duties)',
};

export async function findingDetailView(el, id) {
  let f = await GET(`/api/findings/${id}`);
  const me = state.me;
  const reload = async () => { f = await GET(`/api/findings/${id}`); draw(); };
  const draw = () => {
    const mine = f.owner_id === me.id;
    const canWork = can.write() || mine;
    const iBlocked = f.owner_id === me.id || f.closure_requested_by === me.id;
    const editable = canWork && ['Open', 'In Progress'].includes(f.status);
    mount(el, html`
      <div class="page-head">
        <div>
          <a class="back-link" href="#/findings">${icon("up")} Findings</a>
          <div class="row"><span class="tag gold">${f.code}</span>${sevPill(f.severity)}${statusPill(f.status)}${f.overdue ? pill('critical', 'Overdue') : ''}</div>
          <h1>${f.title}</h1>
        </div>
        <div class="actions">
          ${editable ? html`<button class="btn" id="edit">Edit plan</button>` : ''}
          ${canWork && f.status === 'Open' ? html`<button class="btn" id="start">Start remediation</button>` : ''}
          ${canWork && ['Open', 'In Progress'].includes(f.status) ? html`<button class="btn primary" id="req">${icon('check')} Request closure</button>` : ''}
          ${can.approve() && f.status === 'Remediated' ? html`<button class="btn" id="reject" ${iBlocked ? 'disabled' : ''}>Send back</button><button class="btn ok" id="approve" ${iBlocked ? 'disabled title="Separation of duties"' : ''}>${icon('check')} Approve closure</button>` : ''}
          ${can.approve() && f.open ? html`<button class="btn ghost" id="accept" ${iBlocked ? 'disabled title="Separation of duties"' : ''}>Accept risk…</button>` : ''}
        </div>
      </div>
      ${f.status === 'Remediated' ? html`<div class="notice info">${icon('lock')}<span>Closure requested by <b>&nbsp;${f.closure_requested_by_name}&nbsp;</b> on ${fmtDate(f.closure_requested_at)}. ${can.approve() ? (iBlocked ? 'You own this finding or requested its closure, so a different approver must decide.' : 'Review the evidence, then approve the closure or send it back.') : 'An approver who is not the owner must approve it.'}</span></div>` : ''}
      ${f.decision_note && f.status === 'In Progress' ? html`<div class="notice warn"><b>Sent back:</b>&nbsp;${f.decision_note}</div>` : ''}
      <div class="grid g3">
        <section class="card span2" aria-labelledby="fd-h"><div class="card-h"><h3 id="fd-h">Remediation</h3></div>
          <div class="card-b stack">
            <dl class="kv">
              <dt>Owner</dt><dd>${f.owner_name || html`<span class="bad-text">No owner assigned</span>`}</dd>
              <dt>Due</dt><dd class="${f.overdue ? 'bad-text' : ''}">${f.due_date ? fmtDate(f.due_date) : 'Not set'}${f.overdue ? ' (overdue)' : ''}</dd>
              <dt>Identified</dt><dd>${fmtDate(f.identified_on)} · ${SOURCE[f.source]}</dd>
              ${f.closed_at ? html`<dt>${f.status === 'Closed' ? 'Closed' : 'Accepted'}</dt><dd>${fmtDate(f.closed_at)} by ${f.closed_by_name}${f.decision_note ? ` · ${f.decision_note}` : ''}</dd>` : ''}
            </dl>
            <div><div class="section-label">What was found</div><p class="pre">${f.description || 'No description.'}</p></div>
            <div><div class="section-label">Remediation plan</div>${f.remediation_plan ? html`<p class="pre">${f.remediation_plan}</p>` : html`<p class="muted">No plan yet.${editable ? ' Click “Edit plan” to add one.' : ''}</p>`}</div>
            ${f.closure_note ? html`<div><div class="section-label">Closure: what was done</div><p class="pre">${f.closure_note}</p></div>` : ''}
            ${f.evidence.length ? html`<div><div class="section-label">Closure evidence</div><ul class="plain-list">${f.evidence.map((e) => html`<li><a href="#/evidence">${e.title}</a> <span class="muted small">${e.framework_code || ''} ${e.control_ref || ''} · collected ${fmtDate(e.collected_on)}</span></li>`)}</ul></div>` : ''}
          </div></section>
        <section class="card" aria-labelledby="fl-h"><div class="card-h"><h3 id="fl-h">Traceability</h3></div>
          <div class="card-b stack">
            ${f.control_id ? html`<a class="chain-item" href="#/controls/${f.control_id}"><span class="ref">${f.control_code}</span><span>${f.control_name}</span>${f.test ? html`<small>Failed test on ${fmtDate(f.test.tested_on)} by ${f.test.tester_name}: ${f.test.notes || f.test.methodology}</small>` : ''}</a>` : ''}
            ${f.statement ? html`<a class="chain-item" href="#/policies/${f.statement.policy_id}"><span class="ref">${f.statement.policy_code} ${f.statement.num}</span><span class="clip">${f.statement.text}</span></a>` : f.policy_id ? html`<a class="chain-item" href="#/policies/${f.policy_id}"><span class="ref">${f.policy_code}</span><span>Policy</span></a>` : ''}
            ${f.risk_id ? html`<a class="chain-item" href="#/risks"><span class="ref">${f.risk_code}</span><span>${f.risk_title}</span></a>` : ''}
            ${f.exception_id ? html`<a class="chain-item" href="#/exceptions"><span class="ref">${f.exception_code}</span><span>${f.exception_title}</span><small>Expired exception</small></a>` : ''}
            ${!f.control_id && !f.policy_id && !f.risk_id && !f.exception_id ? html`<div class="chain-empty">Not linked to a control, policy, risk or exception.</div>` : ''}
          </div></section>
      </div>
      <section class="card" aria-labelledby="fh-h"><div class="card-h"><h3 id="fh-h">History</h3><span class="muted small">From the hash-chained audit trail</span></div>
        <ol class="timeline">${f.history.map((h) => html`<li><span class="when">${fmtDateTime(h.ts)}</span><span><b>${h.username}</b> ${ACTION_LABELS[h.action] || h.action}${h.details?.note ? html`: <span class="dim">${h.details.note}</span>` : ''}${h.details?.changed ? html` <span class="muted">(${h.details.changed.join(', ').replace(/_id\b/g, '').replace(/_/g, ' ')})</span>` : ''}</span></li>`)}</ol></section>`);
  };
  draw();
  on(el, 'click', '#edit', () => findingForm(f, reload));
  on(el, 'click', '#start', async (e, b) => {
    b.disabled = true;
    try { await POST(`/api/findings/${f.id}/start`); toast('Remediation started.'); await reload(); } catch (err) { fail(err); b.disabled = false; }
  });
  on(el, 'click', '#req', () => requestClosureDialog(f, reload));
  on(el, 'click', '#approve', () => noteDialog({ title: `Approve closure of ${f.code}?`, intro: 'You confirm the evidence shows the gap is fixed. The finding is closed and, if it came from a failed test, so is the test failure.', label: 'Approval note (optional)', min: 0, confirm: 'Approve closure',
    send: (note) => POST(`/api/findings/${f.id}/approve-closure`, { note }), done: async () => { toast('Finding closed.'); await reload(); } }));
  on(el, 'click', '#reject', () => noteDialog({ title: `Send ${f.code} back?`, intro: 'It returns to In Progress for the owner to finish.', label: 'What is missing', min: 10, confirm: 'Send back',
    send: (note) => POST(`/api/findings/${f.id}/reject-closure`, { note }), done: async () => { toast('Sent back to the owner.'); await reload(); } }));
  on(el, 'click', '#accept', async () => {
    const risks = await GET('/api/risks');
    noteDialog({ title: `Accept the risk of ${f.code}?`, intro: 'Use this when the gap will not be fixed. Record why and, ideally, the risk register entry that tracks it.', label: 'Justification', min: 20, confirm: 'Accept risk',
      extra: html`<label class="f"><span>Risk register entry <em>(optional)</em></span><select id="nd-risk"><option value="">None</option>${risks.filter((r) => r.status !== 'Closed').map((r) => html`<option value="${r.id}" ${r.id === f.risk_id ? 'selected' : ''}>${r.code} ${r.title}</option>`)}</select></label>`,
      send: (note, m) => POST(`/api/findings/${f.id}/accept-risk`, { note, risk_id: $('#nd-risk', m).value || null }), done: async () => { toast('Risk accepted.'); await reload(); } });
  });
}

function noteDialog({ title, intro, label, min, confirm, send, done, extra = '' }) {
  modal({
    title,
    body: html`<form class="stack" id="nd"><p class="dim">${intro}</p>${extra}<label class="f"><span>${label}</span><textarea id="nd-note" rows="3" maxlength="2000"></textarea></label></form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nd-ok">${confirm}</button>`,
    onMount: ({ el, close }) => on(el, 'click', '#nd-ok', async (e, b) => {
      const note = $('#nd-note', el).value.trim();
      if (note.length < min) return toast(`${label}: at least ${min} characters.`, 'err');
      b.disabled = true;
      try { await send(note, el); close(); await done(); } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}

async function requestClosureDialog(f, done) {
  const evidence = await GET('/api/evidence');
  const picked = new Set();
  modal({
    title: `Request closure of ${f.code}`, wide: true,
    body: html`<form class="stack" id="rc">
      <p class="dim">Describe what was done and attach the evidence. An approver who is not the owner, and not you, reviews it and closes the finding.</p>
      <label class="f"><span>What was done</span><textarea id="rc-note" rows="3" maxlength="2000" placeholder="e.g. Removed the legacy VPN profile on 12 Nov; verified no password-only logins in the 14 days since."></textarea></label>
      <div><div class="section-label">Evidence of remediation <em class="muted">(at least one)</em></div>
        <div class="stmt-pick small-pick" role="group" aria-label="Evidence">${evidence.length ? evidence.map((e) => html`<label class="pick"><input type="checkbox" data-rev="${e.id}"><span class="ref">${e.framework_code || ''} ${e.control_ref || ''}</span><span>${e.title}<small>Collected ${fmtDate(e.collected_on)}${e.fresh ? '' : ' · expired'}</small></span></label>`) : html`<div class="muted small">No evidence yet. Add it below.</div>`}</div>
        <details class="new-ev"><summary>Add new evidence</summary>
          <div class="form-grid">
            <label class="f full"><span>Title</span><input id="ne-title" maxlength="200" placeholder="e.g. VPN profile list after the change"></label>
            <label class="f full"><span>Location <em>(link or path)</em></span><input id="ne-loc" maxlength="500" placeholder="https://…"></label>
            <label class="f"><span>Framework requirement</span><select id="ne-ctl">${state.meta.controls.slice(0, 400).map((c) => html`<option value="${c.id}">${c.framework_code} ${c.ref} · ${c.title}</option>`)}</select></label>
          </div>
          <button type="button" class="btn sm" id="ne-add">${icon('plus')} Add and attach</button>
        </details></div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rc-ok">${icon('check')} Request closure</button>`,
    onMount: ({ el, close }) => {
      on(el, 'change', '[data-rev]', (e, cb) => { const n = Number(cb.dataset.rev); cb.checked ? picked.add(n) : picked.delete(n); });
      on(el, 'click', '#ne-add', async (e, b) => {
        const title = $('#ne-title', el).value.trim();
        if (title.length < 3) return toast('Give the evidence a title.', 'err');
        b.disabled = true;
        try {
          const r = await POST('/api/evidence', { control_id: Number($('#ne-ctl', el).value), title, location: $('#ne-loc', el).value.trim(), owner: state.me.name, collected_on: todayStr(), valid_days: 365 });
          picked.add(r.id);
          const list = el.querySelector('.stmt-pick');
          list.querySelector('.muted.small')?.remove();
          list.insertAdjacentHTML('afterbegin', `<label class="pick sug"><input type="checkbox" data-rev="${r.id}" checked><span class="ref">New</span><span></span></label>`);
          list.firstElementChild.lastElementChild.textContent = title;
          $('#ne-title', el).value = ''; $('#ne-loc', el).value = '';
          toast('Evidence added and attached.');
        } catch (err) { fail(err); } finally { b.disabled = false; }
      });
      on(el, 'click', '#rc-ok', async (e, b) => {
        b.disabled = true;
        try { await POST(`/api/findings/${f.id}/request-closure`, { note: $('#rc-note', el).value, evidence_ids: [...picked] }); close(); toast('Closure requested. An approver will review it.'); await done(); } catch (err) { fail(err); b.disabled = false; }
      });
    },
  });
}

// Create (manual / audit / self-assessment) or edit plan, owner, due date, severity and links.
export async function findingForm(f, done, preset = {}) {
  const [people, risks, controls, policies] = await Promise.all([GET('/api/people'), GET('/api/risks'), GET('/api/control-register'), GET('/api/control-register-statements')]);
  const staff = people.filter((u) => u.role !== 'employee');
  const v = f || { title: '', description: '', severity: 'Medium', source: 'manual', owner_id: null, due_date: '', remediation_plan: '', control_id: null, risk_id: null, policy_id: null, statement_id: null, identified_on: todayStr(), ...preset };
  const analyst = can.write();
  modal({
    title: f ? `Edit ${f.code}` : 'New finding', drawer: true,
    body: html`<form id="ff" class="stack" novalidate>
      <label class="f"><span>Title <em>(the gap, in one line)</em></span><input name="title" value="${v.title}" maxlength="200" required></label>
      <label class="f"><span>What was found</span><textarea name="description" rows="3" maxlength="4000">${v.description}</textarea></label>
      <div class="form-grid">
        <label class="f"><span>Severity</span><select name="severity" ${analyst ? '' : 'disabled'}>${Object.keys(SEV).map((s) => html`<option ${s === v.severity ? 'selected' : ''}>${s}</option>`)}</select></label>
        ${f ? '' : html`<label class="f"><span>Source</span><select name="source">${[['manual', 'Manual'], ['audit', 'Audit'], ['self_assessment', 'Self-assessment']].map(([k, l]) => html`<option value="${k}" ${k === v.source ? 'selected' : ''}>${l}</option>`)}</select></label>`}
        <label class="f"><span>Owner</span><select name="owner_id" ${analyst ? '' : 'disabled'}><option value="">Unassigned</option>${staff.map((u) => html`<option value="${u.id}" ${u.id === v.owner_id ? 'selected' : ''}>${u.name}</option>`)}</select></label>
        <label class="f"><span>Due date <em>${f ? '' : '(blank: by severity, 14 to 90 days)'}</em></span><input type="date" name="due_date" value="${v.due_date || ''}"></label>
        ${f ? '' : html`<label class="f"><span>Identified on</span><input type="date" name="identified_on" value="${v.identified_on}" max="${todayStr()}"></label>`}
      </div>
      <label class="f"><span>Remediation plan</span><textarea name="remediation_plan" rows="4" maxlength="4000" placeholder="Steps, who does them, and how you will show it is fixed">${v.remediation_plan}</textarea></label>
      <div class="section-label">Linked to</div>
      <div class="form-grid">
        <label class="f"><span>Control</span><select name="control_id"><option value="">None</option>${controls.map((c) => html`<option value="${c.id}" ${c.id === v.control_id ? 'selected' : ''}>${c.code} ${c.name}</option>`)}</select></label>
        <label class="f"><span>Risk</span><select name="risk_id"><option value="">None</option>${risks.map((r) => html`<option value="${r.id}" ${r.id === v.risk_id ? 'selected' : ''}>${r.code} ${r.title}</option>`)}</select></label>
        <label class="f full"><span>Policy statement</span><select name="stmt"><option value="">None</option>${policies.map((p) => html`<optgroup label="${p.code} ${p.title}">${p.statements.map((s) => html`<option value="${p.id}:${s.id}" ${p.id === v.policy_id && s.id === v.statement_id ? 'selected' : ''}>${s.num} ${s.text.slice(0, 90)}</option>`)}</optgroup>`)}</select></label>
      </div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>${f ? 'Save' : 'Create finding'}</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-save]', async (e, b) => {
      const form = $('#ff', el);
      const val = (n) => form.elements.namedItem(n)?.value ?? '';
      const [policy_id, statement_id] = val('stmt') ? val('stmt').split(':') : [v.policy_id && !v.statement_id ? v.policy_id : null, null];
      const body = {
        title: val('title'), description: val('description'), severity: val('severity') || v.severity, owner_id: val('owner_id') || (analyst ? null : v.owner_id),
        due_date: val('due_date') || null, remediation_plan: val('remediation_plan'), control_id: val('control_id') || null, risk_id: val('risk_id') || null,
        policy_id: policy_id ? Number(policy_id) : null, statement_id: statement_id || null,
        ...(f ? {} : { source: val('source'), identified_on: val('identified_on') }),
      };
      b.disabled = true;
      try {
        if (f) { await PUT(`/api/findings/${f.id}`, body); toast('Finding saved.'); close(); await done(f.id); }
        else { const r = await POST('/api/findings', body); toast(`${r.code} created.`); close(); await done(r.id); }
      } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}
