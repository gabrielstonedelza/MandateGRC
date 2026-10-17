import { html, mount, $, on, state, can, GET, POST, PUT, DEL, toast, fail, modal, confirmDialog, formData, fmtDate, pill, icon, todayStr, daysUntil } from '../core.js';

const isUrl = (s) => /^https?:\/\//i.test(s || '');

export async function evidenceView(el) {
  let list = await GET('/api/evidence');
  let tab = 'all', q = '';
  const groups = { all: () => true, stale: (e) => !e.fresh, soon: (e) => e.due_soon, fresh: (e) => e.fresh && !e.due_soon };

  const draw = () => {
    const rows = list.filter(groups[tab]).filter((e) => !q || `${e.title} ${e.owner} ${e.control_ref} ${e.control_title} ${e.framework_code}`.toLowerCase().includes(q));
    mount(el, html`
      <div class="page-head">
        <div><h1>Evidence</h1><div class="sub">Proof that controls operate. Every item has a validity window; stale evidence surfaces in the action queue before an auditor finds it. MandateGRC stores references (links, ticket IDs, repository paths), not files, so sensitive artefacts stay in your systems of record.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} Add evidence</button>` : ''}</div>
      </div>
      <div class="card">
        <div class="card-h"><div class="tabs compact">${[['all', 'All'], ['stale', 'Stale'], ['soon', 'Due ≤ 14 days'], ['fresh', 'Fresh']].map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l} <span class="muted">${list.filter(groups[k]).length}</span></button>`)}</div>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search evidence" aria-label="Search evidence"></div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Evidence</th><th>Control</th><th>Owner</th><th>Collected</th><th>Valid until</th><th>Status</th><th>Location</th></tr></thead><tbody>
          ${rows.map((e) => { const d = daysUntil(e.expires_on); return html`<tr class="clickable" data-id="${e.id}">
            <td class="title-cell"><b>${e.title}</b><small>${e.description.slice(0, 90)}</small></td>
            <td><span class="tag">${e.framework_code} ${e.control_ref}</span><br><small class="muted">${e.control_title}</small></td>
            <td>${e.owner || '—'}</td><td>${fmtDate(e.collected_on)}</td>
            <td>${fmtDate(e.expires_on)}<br><small class="muted">${d < 0 ? `${-d} days overdue` : `${d} days left`}</small></td>
            <td>${pill(e.fresh ? (e.due_soon ? 'medium' : 'fresh') : 'stale', e.fresh ? (e.due_soon ? 'Due soon' : 'Fresh') : 'Stale')}</td>
            <td class="small">${isUrl(e.location) ? html`<a href="${e.location}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : html`<span class="mono">${e.location || '—'}</span>`}</td>
          </tr>`; })}</tbody></table></div>` : html`<div class="empty"><b>No evidence here</b></div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  const reload = async () => { list = await GET('/api/evidence'); draw(); };
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw(); });
  on(el, 'click', '#new', () => evidenceForm(null, reload));
  on(el, 'click', 'tr[data-id]', (e, tr) => { if (!e.target.closest('a')) evidenceForm(list.find((x) => x.id === Number(tr.dataset.id)), reload); });
}

export function evidenceForm(ev, done, controlId = null) {
  const editable = can.write();
  const v = ev || { control_id: controlId, title: '', description: '', location: '', owner: '', collected_on: todayStr(), valid_days: 90 };
  const fws = state.meta.frameworks;
  const initialCtrl = state.meta.controls.find((c) => c.id === v.control_id);
  modal({
    title: ev ? 'Evidence' : 'Add evidence', drawer: true,
    body: html`<form id="ef" class="stack">
      <div class="form-grid">
        <label class="f"><span>Framework</span><select id="efw" ${editable ? '' : 'disabled'}>${fws.map((f) => html`<option value="${f.code}" ${initialCtrl?.framework_code === f.code ? 'selected' : ''}>${f.name}</option>`)}</select></label>
        <label class="f"><span>Control</span><select name="control_id" id="ectl" ${editable ? '' : 'disabled'}></select></label>
      </div>
      <label class="f"><span>Title</span><input name="title" value="${v.title}" maxlength="200" required ${editable ? '' : 'readonly'}></label>
      <label class="f"><span>Description <em>(what it shows, how it was produced)</em></span><textarea name="description" rows="3" maxlength="2000" ${editable ? '' : 'readonly'}>${v.description}</textarea></label>
      <label class="f"><span>Location <em>(https link, ticket ID or repository path)</em></span><input name="location" value="${v.location}" maxlength="1000" ${editable ? '' : 'readonly'}></label>
      <div class="form-grid">
        <label class="f"><span>Owner</span><input name="owner" value="${v.owner}" maxlength="120" ${editable ? '' : 'readonly'}></label>
        <label class="f"><span>Collected on</span><input type="date" name="collected_on" value="${v.collected_on}" max="${todayStr()}" ${editable ? '' : 'readonly'}></label>
        <label class="f"><span>Valid for</span><select name="valid_days" ${editable ? '' : 'disabled'}>${[[7, '7 days (weekly)'], [31, '31 days (monthly)'], [90, '90 days (quarterly)'], [180, '180 days'], [365, '365 days (annual)']].map(([d, l]) => html`<option value="${d}" ${d === Number(v.valid_days) ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
    </form>`,
    footer: html`${ev && editable ? html`<button class="btn danger" data-del>${icon('trash')}</button>` : ''}<span class="right"></span><button class="btn ghost" data-close>Cancel</button>${editable ? html`<button class="btn primary" data-save>Save</button>` : ''}`,
    onMount: ({ el, close }) => {
      const fill = () => {
        const code = $('#efw', el).value;
        mount($('#ectl', el), html`${state.meta.controls.filter((c) => c.framework_code === code).map((c) => html`<option value="${c.id}" ${c.id === v.control_id ? 'selected' : ''}>${c.ref}: ${c.title}</option>`)}`);
      };
      fill();
      $('#efw', el).addEventListener('change', fill);
      on(el, 'click', '[data-save]', async () => {
        const d = formData($('#ef', el));
        try { if (ev) await PUT(`/api/evidence/${ev.id}`, d); else await POST('/api/evidence', d); toast('Evidence saved.'); close(); await done?.(); } catch (e) { fail(e); }
      });
      on(el, 'click', '[data-del]', async () => {
        if (!(await confirmDialog({ title: 'Delete evidence?', message: ev.title, confirm: 'Delete', danger: true }))) return;
        try { await DEL(`/api/evidence/${ev.id}`); toast('Evidence deleted.'); close(); await done?.(); } catch (e) { fail(e); }
      });
    },
  });
}
