import { html, mount, $, on, state, can, GET, POST, PUT, DEL, toast, fail, modal, confirmDialog, formData, fmtDate, pill, icon, money } from '../core.js';
import { riskLevel } from '../lint.js';
import { heatMap, LIKELIHOOD, IMPACT, ctrlLabel } from './shared.js';
import { controlPicker } from './policies.js';
import { sevPill, statusPill } from './findings.js';

export async function risksView(el) {
  let [risks, policies, regControls] = await Promise.all([GET('/api/risks'), GET('/api/policies'), GET('/api/control-register')]);
  const appetite = state.meta.risk_appetite;
  let filter = null, q = '', showClosed = false;

  const matrix = (key) => {
    const m = Array.from({ length: 5 }, () => Array(5).fill(0));
    risks.filter((r) => r.status !== 'Closed').forEach((r) => {
      const [l, i] = key === 'inherent' ? [r.likelihood, r.impact] : [r.res_likelihood, r.res_impact];
      m[l - 1][i - 1]++;
    });
    return m;
  };

  const draw = () => {
    const rows = risks.filter((r) => (showClosed || r.status !== 'Closed')
      && (!filter || (r.res_likelihood === filter[0] && r.res_impact === filter[1]))
      && (!q || `${r.code} ${r.title} ${r.owner} ${r.category}`.toLowerCase().includes(q)));
    const open = risks.filter((r) => r.status !== 'Closed');
    mount(el, html`
      <div class="page-head">
        <div><h1>Risk register</h1><div class="sub">5×5 likelihood × impact scoring with inherent and residual views, risk appetite, treatment plans, and optional quantification (SLE × ARO = ALE).</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} New risk</button>` : ''}</div>
      </div>
      <div class="grid g4">
        <div class="card kpi"><div class="label">Open risks</div><div class="value">${open.length}</div><div class="foot">${risks.length - open.length} closed</div></div>
        <div class="card kpi"><div class="label">Above appetite</div><div class="value ${open.some((r) => r.above_appetite) ? 'bad' : 'good'}">${open.filter((r) => r.above_appetite).length}</div><div class="foot">Residual score &gt; ${appetite}</div></div>
        <div class="card kpi"><div class="label">Critical residual</div><div class="value ${open.some((r) => r.residual_level === 'critical') ? 'bad' : ''}">${open.filter((r) => r.residual_level === 'critical').length}</div><div class="foot">Score ≥ 20</div></div>
        <div class="card kpi"><div class="label">Annualized loss exposure</div><div class="value">${money(open.reduce((a, r) => a + (r.ale || 0), 0))}</div><div class="foot">Sum of ALE on open risks</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Inherent risk</h3><span class="muted">before controls</span></div><div class="card-b">${heatMap(matrix('inherent'), { appetite })}</div></div>
        <div class="card" data-tour="heat"><div class="card-h"><h3>Residual risk</h3><span class="muted">after controls · click a cell to filter</span>${filter ? html`<button class="btn xs right" id="clear">Clear filter</button>` : ''}</div><div class="card-b">${heatMap(matrix('residual'), { appetite, selectable: true, selected: filter })}</div></div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Register</h3><label class="row small dim"><input type="checkbox" id="closed" ${showClosed ? 'checked' : ''}> Show closed</label>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search risks" aria-label="Search risks"></div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Risk</th><th>Owner</th><th>Inherent</th><th>Residual</th><th>Treatment</th><th>Status</th><th>Due</th><th class="num">ALE</th><th>Mitigation</th></tr></thead><tbody>
          ${rows.map((r) => html`<tr class="clickable" data-id="${r.id}">
            <td class="title-cell"><b>${r.title}</b><small>${r.code} · ${r.category}${r.above_appetite ? ' · above appetite' : ''}</small></td>
            <td>${r.owner}</td>
            <td>${pill(r.inherent_level, `${r.inherent} ${riskLevel(r.inherent).label}`)}</td>
            <td>${pill(r.residual_level, `${r.residual} ${riskLevel(r.residual).label}`)}</td>
            <td>${r.treatment}</td><td>${pill(r.status)}</td>
            <td class="${r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && r.status !== 'Closed' ? 's-critical' : ''}">${fmtDate(r.due_date)}</td>
            <td class="num">${money(r.ale)}</td>
            <td><a class="btn xs" href="#/risks/${r.id}" title="Open the traceability view: controls, policy statements, tests and evidence">${icon('link')} ${r.org_control_ids.length ? `${r.org_control_ids.length} control${r.org_control_ids.length === 1 ? '' : 's'}` : 'Trace'}</a></td></tr>`)}
        </tbody></table></div>` : html`<div class="empty"><b>No risks match</b></div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();

  on(el, 'click', '[data-cell]', (e, c) => { const [l, i] = c.dataset.cell.split(',').map(Number); filter = filter && filter[0] === l && filter[1] === i ? null : [l, i]; draw(); });
  on(el, 'click', '#clear', () => { filter = null; draw(); });
  on(el, 'change', '#closed', (e, c) => { showClosed = c.checked; draw(); });
  on(el, 'click', '#new', () => riskForm(null, policies, async () => { risks = await GET('/api/risks'); draw(); }, regControls));
  on(el, 'click', 'tr[data-id]', (e, tr) => { if (e.target.closest('a')) return; riskForm(risks.find((r) => r.id === Number(tr.dataset.id)), policies, async () => { risks = await GET('/api/risks'); draw(); }, regControls); });
}

function riskForm(r, policies, done, regControls = []) {
  const editable = can.write();
  const v = r || { title: '', description: '', category: 'Information Security', owner: '', likelihood: 3, impact: 3, res_likelihood: 2, res_impact: 3, treatment: 'Mitigate', treatment_plan: '', status: 'Open', due_date: '', sle: '', aro: '', policy_ids: [], control_ids: [], org_control_ids: [] };
  let controlIds = [...v.control_ids];
  const scale = (name, labels, val) => html`<select name="${name}" ${editable ? '' : 'disabled'}>${labels.map((l, i) => html`<option value="${i + 1}" ${i + 1 === val ? 'selected' : ''}>${i + 1}. ${l}</option>`)}</select>`;
  const cmap = new Map(state.meta.controls.map((c) => [c.id, c]));

  modal({
    title: r ? `${r.code} · ${r.title}` : 'New risk', drawer: true,
    body: html`<form id="rf" class="stack">
      <label class="f"><span>Risk title <em>(event + cause + consequence)</em></span><input name="title" value="${v.title}" maxlength="200" required ${editable ? '' : 'readonly'}></label>
      <label class="f"><span>Description</span><textarea name="description" rows="3" maxlength="4000" ${editable ? '' : 'readonly'}>${v.description}</textarea></label>
      <div class="form-grid">
        <label class="f"><span>Category</span><select name="category" ${editable ? '' : 'disabled'}>${['Information Security', 'Operational', 'Compliance', 'Third Party', 'Physical', 'Privacy', 'Strategic', 'Financial'].map((c) => html`<option ${c === v.category ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="f"><span>Risk owner</span><input name="owner" value="${v.owner}" maxlength="120" required ${editable ? '' : 'readonly'}></label>
        <label class="f"><span>Inherent likelihood</span>${scale('likelihood', LIKELIHOOD, v.likelihood)}</label>
        <label class="f"><span>Inherent impact</span>${scale('impact', IMPACT, v.impact)}</label>
        <label class="f"><span>Residual likelihood</span>${scale('res_likelihood', LIKELIHOOD, v.res_likelihood)}</label>
        <label class="f"><span>Residual impact</span>${scale('res_impact', IMPACT, v.res_impact)}</label>
        <div class="full" id="scores"></div>
        <label class="f"><span>Treatment</span><select name="treatment" ${editable ? '' : 'disabled'}>${['Mitigate', 'Accept', 'Transfer', 'Avoid'].map((c) => html`<option ${c === v.treatment ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="f"><span>Status</span><select name="status" ${editable ? '' : 'disabled'}>${['Open', 'In Treatment', 'Accepted', 'Closed'].map((c) => html`<option ${c === v.status ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="f full"><span>Treatment plan</span><textarea name="treatment_plan" rows="3" maxlength="4000" ${editable ? '' : 'readonly'}>${v.treatment_plan}</textarea></label>
        <label class="f"><span>Treatment due</span><input type="date" name="due_date" value="${v.due_date || ''}" ${editable ? '' : 'readonly'}></label>
        <span></span>
        <label class="f"><span>Single loss expectancy (USD) <em>optional</em></span><input type="number" min="0" step="1000" name="sle" value="${v.sle ?? ''}" ${editable ? '' : 'readonly'}></label>
        <label class="f"><span>Annual rate of occurrence <em>e.g. 0.25</em></span><input type="number" min="0" max="365" step="0.01" name="aro" value="${v.aro ?? ''}" ${editable ? '' : 'readonly'}></label>
        <div class="full small dim" id="ale"></div>
        <label class="f full"><span>Policies that govern this risk</span><select name="policy_ids" multiple size="5" ${editable ? '' : 'disabled'}>${policies.filter((p) => p.status !== 'retired').map((p) => html`<option value="${p.id}" ${v.policy_ids.includes(p.id) ? 'selected' : ''}>${p.code} ${p.title}</option>`)}</select></label>
        <div class="full"><div class="section-label">Mitigating controls <em class="muted">(from the control register)</em></div>
          <div class="stmt-pick small-pick" role="group" aria-label="Mitigating controls">${regControls.length ? regControls.filter((c) => c.status === 'active' || (v.org_control_ids || []).includes(c.id)).map((c) => html`<label class="pick"><input type="checkbox" data-oc="${c.id}" ${(v.org_control_ids || []).includes(c.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span class="ref">${c.code}</span><span>${c.name}<small>${c.result === 'not_tested' ? 'Not yet tested' : `Latest result: ${c.result}`}${c.overdue ? ' · overdue' : ''}</small></span></label>`) : html`<div class="muted small">No controls in the register yet.</div>`}</div></div>
        <div class="full"><div class="section-label">Framework requirements it relates to</div><div class="chips" id="rc"></div></div>
        ${r ? html`<div class="full"><div class="section-label">Findings</div><div id="rfind" class="muted small">Loading…</div></div>` : ''}
      </div>
    </form>`,
    footer: html`${r && can.admin() ? html`<button class="btn danger" data-del>${icon('trash')} Delete</button>` : ''}${r ? html`<a class="btn" href="#/risks/${r.id}" data-close>${icon('link')} Traceability</a>` : ''}<span class="right"></span><button class="btn ghost" data-close>${editable ? 'Cancel' : 'Close'}</button>${editable ? html`<button class="btn primary" data-save>${r ? 'Save risk' : 'Add risk'}</button>` : ''}`,
    onMount: ({ el, close }) => {
      const form = $('#rf', el);
      const recalc = () => {
        const d = formData(form);
        const inh = d.likelihood * d.impact, res = d.res_likelihood * d.res_impact;
        const a = state.meta.risk_appetite;
        mount($('#scores', el), html`<div class="row">Inherent ${pill(riskLevel(inh).key, `${inh} ${riskLevel(inh).label}`)} → Residual ${pill(riskLevel(res).key, `${res} ${riskLevel(res).label}`)}
          ${res > inh ? html`<span class="pill s-error">Residual exceeds inherent</span>` : res > a ? html`<span class="pill s-high">Above appetite (${a})</span>` : html`<span class="pill s-ok">Within appetite</span>`}</div>`);
        const ale = d.sle && d.aro ? Math.round(d.sle * d.aro) : null;
        $('#ale', el).textContent = ale != null ? `Annualized loss expectancy: ${money(ale)}` : 'Add SLE and ARO to quantify this risk in monetary terms.';
      };
      const drawControls = () => mount($('#rc', el), html`${controlIds.map((id) => html`<span class="chip" title="${cmap.get(id)?.title || ''}"><b>${ctrlLabel(cmap.get(id))}</b>${editable ? html`<button data-rm="${id}">×</button>` : ''}</span>`)}${editable ? html`<button class="btn xs" type="button" data-pick>${icon('link')} Link controls</button>` : ''}${!controlIds.length && !editable ? html`<span class="muted small">None</span>` : ''}`);
      recalc(); drawControls();
      // Findings linked to this risk: open corrective actions and accepted residual gaps.
      if (r) GET(`/api/findings?risk_id=${r.id}`).then((list) => mount($('#rfind', el), list.length
        ? html`<ul class="plain-list">${list.map((f) => html`<li><a href="#/findings/${f.id}">${f.code}</a> ${sevPill(f.severity)} ${statusPill(f.status)} <span>${f.title}</span>${f.overdue ? html` <b class="bad-text small">overdue</b>` : ''}</li>`)}</ul>`
        : html`<span>No findings linked.</span>`)).catch(() => {});
      form.addEventListener('input', recalc);
      form.addEventListener('change', recalc);
      on(el, 'click', '[data-rm]', (e, b) => { controlIds = controlIds.filter((x) => x !== Number(b.dataset.rm)); drawControls(); });
      on(el, 'click', '[data-pick]', () => controlPicker({ text: `${form.elements.namedItem("title").value} ${form.description.value} ${form.treatment_plan.value}`, selected: controlIds, title: 'Mitigating controls', onSave: (ids) => { controlIds = ids; drawControls(); } }));
      on(el, 'click', '[data-save]', async () => {
        const d = formData(form);
        const body = { ...d, policy_ids: d.policy_ids.map(Number), control_ids: controlIds, org_control_ids: [...el.querySelectorAll('[data-oc]:checked')].map((x) => Number(x.dataset.oc)) };
        try {
          if (r) await PUT(`/api/risks/${r.id}`, body); else await POST('/api/risks', body);
          toast(r ? 'Risk updated.' : 'Risk added.'); close(); await done();
        } catch (e) { fail(e); }
      });
      on(el, 'click', '[data-del]', async () => {
        if (!(await confirmDialog({ title: `Delete ${r.code}?`, message: 'Prefer closing risks to keep history. Deletion is recorded in the audit trail.', confirm: 'Delete', danger: true }))) return;
        try { await DEL(`/api/risks/${r.id}`); toast('Risk deleted.'); close(); await done(); } catch (e) { fail(e); }
      });
    },
  });
}
