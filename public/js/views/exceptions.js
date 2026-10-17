import { html, mount, $, on, state, can, GET, POST, toast, fail, modal, confirmDialog, formData, fmtDate, pill, icon, daysUntil, todayStr } from '../core.js';
import { riskLevel } from '../lint.js';
import { LIKELIHOOD, IMPACT } from './shared.js';

export async function exceptionsView(el) {
  let [list, policies] = await Promise.all([GET('/api/exceptions'), GET('/api/policies')]);
  let tab = 'open';
  const groups = {
    open: (e) => ['Requested', 'Approved', 'Expired'].includes(e.status),
    requested: (e) => e.status === 'Requested',
    expired: (e) => e.status === 'Expired',
    all: () => true,
  };

  const draw = () => {
    const rows = list.filter(groups[tab]);
    mount(el, html`
      <div class="page-head">
        <div><h1>Policy exceptions</h1><div class="sub">Time-boxed deviations from a specific policy statement. Each one needs a justification and compensating controls, is capped at 365 days, and is approved by someone other than the requester.</div></div>
        <div class="actions">${can.steward() ? html`<button class="btn primary" id="new">${icon('plus')} Request exception</button>` : ''}</div>
      </div>
      <div class="card" data-tour="exceptions">
        <div class="card-h"><div class="tabs compact">${[['open', 'Open'], ['requested', 'Awaiting decision'], ['expired', 'Expired'], ['all', 'All']].map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l} <span class="muted">${list.filter(groups[k]).length}</span></button>`)}</div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Exception</th><th>Policy</th><th>Risk</th><th>Status</th><th>Expires</th><th>Requested by</th><th></th></tr></thead><tbody>
          ${rows.map((e) => {
            const days = daysUntil(e.expires_at);
            return html`<tr class="clickable" data-id="${e.id}">
              <td class="title-cell"><b>${e.title}</b><small>${e.code}${e.statement_ref ? ` · statement ${e.statement_ref}` : ''}</small></td>
              <td><a href="#/policies/${e.policy_id}">${e.policy_code}</a></td>
              <td>${pill(e.level, `${e.score} ${riskLevel(e.score).label}`)}</td>
              <td>${pill(e.status)}</td>
              <td>${fmtDate(e.expires_at)}<br><small class="${days < 0 ? 's-critical' : days <= 30 ? 'muted' : 'muted'}">${days < 0 ? `${-days} days ago` : `in ${days} days`}</small></td>
              <td>${e.requested_by_name || '—'}</td>
              <td class="nowrap">${e.status === 'Requested' && can.approve() ? html`<button class="btn xs" data-decide="${e.id}">Decide</button>` : ''}${['Approved', 'Expired'].includes(e.status) && can.steward() ? html`<button class="btn xs" data-close-ex="${e.id}">Close</button>` : ''}</td>
            </tr>`;
          })}</tbody></table></div>` : html`<div class="empty"><b>No exceptions here</b>Deviations from policy will be tracked here with expiry dates.</div>`}
      </div>`);
  };
  draw();
  const reload = async () => { list = await GET('/api/exceptions'); draw(); };

  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw(); });
  on(el, 'click', '#new', () => requestForm(policies, reload));
  on(el, 'click', 'tr[data-id]', (e, tr) => {
    if (e.target.closest('button,a')) return;
    detail(list.find((x) => x.id === Number(tr.dataset.id)), reload);
  });
  on(el, 'click', '[data-decide]', (e, b) => detail(list.find((x) => x.id === Number(b.dataset.decide)), reload));
  on(el, 'click', '[data-close-ex]', async (e, b) => {
    const x = list.find((y) => y.id === Number(b.dataset.closeEx));
    if (!(await confirmDialog({ title: `Close ${x.code}?`, message: 'Close the exception once the underlying gap has been remediated or the deviation has ended.', confirm: 'Close exception' }))) return;
    try { await POST(`/api/exceptions/${x.id}/close`); toast('Exception closed.'); await reload(); } catch (err) { fail(err); }
  });
}

function detail(e, reload) {
  const me = state.me.id;
  const canDecide = e.status === 'Requested' && can.approve() && e.requested_by !== me;
  modal({
    title: `${e.code} · ${e.title}`, drawer: true,
    body: html`<div class="stack">
      <dl class="kv">
        <dt>Policy</dt><dd><a href="#/policies/${e.policy_id}" data-close>${e.policy_code} ${e.policy_title}</a>${e.statement_ref ? ` · statement ${e.statement_ref}` : ''}</dd>
        <dt>Status</dt><dd>${pill(e.status)}</dd>
        <dt>Risk</dt><dd>${pill(e.level, `${e.score} ${riskLevel(e.score).label}`)} <span class="muted small">L${e.likelihood} × I${e.impact}</span></dd>
        <dt>Expires</dt><dd>${fmtDate(e.expires_at)}</dd>
        <dt>Requested by</dt><dd>${e.requested_by_name || '—'} · ${fmtDate(e.created_at)}</dd>
        ${e.decided_by_name ? html`<dt>Decided by</dt><dd>${e.decided_by_name} · ${fmtDate(e.decided_at)}</dd>` : ''}
      </dl>
      <div><div class="section-label">Business justification</div><p class="pre">${e.justification}</p></div>
      <div><div class="section-label">Compensating controls</div><p class="pre">${e.compensating || '—'}</p>${!e.compensating ? html`<div class="notice warn small">No compensating controls are documented, so this exception cannot be approved.</div>` : ''}</div>
      ${e.decision_note ? html`<div><div class="section-label">Decision note</div><p class="pre">${e.decision_note}</p></div>` : ''}
      ${e.status === 'Requested' && can.approve() && e.requested_by === me ? html`<div class="notice info">Separation of duties: you requested this exception, so another approver must decide it.</div>` : ''}
      ${canDecide ? html`<label class="f"><span>Decision note <em>(required to reject)</em></span><textarea id="dn" rows="3" maxlength="1000"></textarea></label>` : ''}
    </div>`,
    footer: canDecide ? html`<button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-d="Rejected">Reject</button><button class="btn ok" data-d="Approved">Approve exception</button>` : html`<button class="btn" data-close>Close</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-d]', async (ev, b) => {
      try { await POST(`/api/exceptions/${e.id}/decide`, { decision: b.dataset.d, note: $('#dn', el).value }); toast(`Exception ${b.dataset.d.toLowerCase()}.`); close(); await reload(); } catch (err) { fail(err); }
    }),
  });
}

function requestForm(policies, done) {
  const active = policies.filter((p) => p.status !== 'retired');
  const max = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  modal({
    title: 'Request a policy exception', drawer: true,
    body: html`<form id="xf" class="stack">
      <label class="f"><span>Policy</span><select name="policy_id" required>${active.map((p) => html`<option value="${p.id}">${p.code} ${p.title}</option>`)}</select></label>
      <label class="f"><span>Statement</span><select name="statement_ref" id="stsel"></select></label>
      <label class="f"><span>Title</span><input name="title" maxlength="200" required placeholder="e.g. Legacy system cannot enforce MFA"></label>
      <label class="f"><span>Business justification</span><textarea name="justification" rows="3" maxlength="4000" required placeholder="Why the requirement cannot be met, and the plan to remediate."></textarea></label>
      <label class="f"><span>Compensating controls</span><textarea name="compensating" rows="3" maxlength="4000" placeholder="What reduces the risk while the exception is active (required for approval)."></textarea></label>
      <div class="form-grid">
        <label class="f"><span>Likelihood</span><select name="likelihood">${LIKELIHOOD.map((l, i) => html`<option value="${i + 1}" ${i === 2 ? 'selected' : ''}>${i + 1}. ${l}</option>`)}</select></label>
        <label class="f"><span>Impact</span><select name="impact">${IMPACT.map((l, i) => html`<option value="${i + 1}" ${i === 2 ? 'selected' : ''}>${i + 1}. ${l}</option>`)}</select></label>
        <label class="f"><span>Expires on <em>(max 365 days)</em></span><input type="date" name="expires_at" min="${todayStr()}" max="${max}" required></label>
      </div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Submit request</button>`,
    onMount: async ({ el, close }) => {
      const form = $('#xf', el);
      const loadStatements = async () => {
        try {
          const p = await GET(`/api/policies/${form.policy_id.value}`);
          mount($('#stsel', el), html`<option value="">Whole policy</option>${p.statements.map((s, i) => html`<option value="4.${i + 1}">4.${i + 1}: ${s.text.slice(0, 90)}${s.text.length > 90 ? '…' : ''}</option>`)}`);
        } catch (e) { fail(e); }
      };
      form.policy_id.addEventListener('change', loadStatements);
      loadStatements();
      on(el, 'click', '[data-go]', async () => {
        try { await POST('/api/exceptions', formData(form)); toast('Exception requested.'); close(); await done(); } catch (e) { fail(e); }
      });
    },
  });
}
