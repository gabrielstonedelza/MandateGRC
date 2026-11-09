// Asset register for scoping: what is protected, who owns it, how sensitive it is, where it runs,
// and which frameworks, policies, controls and risks cover it.
import { html, mount, $, on, state, can, GET, POST, PUT, toast, fail, modal, pill, icon } from '../core.js';

const TYPES = ['System', 'Application', 'Data', 'Cloud service', 'Network', 'Endpoint', 'Facility', 'Other'];
const CLASS = { Public: 'ok', Internal: 'info', Confidential: 'medium', Restricted: 'high' };
const ENVS = ['Production', 'Staging', 'Development', 'Corporate'];
export const classPill = (c) => pill(CLASS[c], c);

// Compact list for other pages: "Assets in scope".
export function assetsPanel(list, { empty = 'No assets reference this yet.' } = {}) {
  return list.length ? html`<div class="stack">${list.map((a) => html`<a class="chain-item" href="#/assets"><span class="ref">${a.code}</span><span>${a.name}</span><small class="row">${classPill(a.classification)} ${a.environment} · ${a.asset_type}${a.status === 'retired' ? ' · retired' : ''}</small></a>`)}</div>`
    : html`<div class="chain-empty">${empty}</div>`;
}

export async function assetsView(el) {
  let [list, policies, controls, risks, people] = await Promise.all([GET('/api/assets'), GET('/api/policies'), GET('/api/control-register'), GET('/api/risks'), GET('/api/people')]);
  let q = '', type = '', cls = '', env = '', scope = '', showRetired = false;
  const draw = () => {
    const rows = list.filter((a) => (showRetired || a.status === 'active') && (!type || a.asset_type === type) && (!cls || a.classification === cls) && (!env || a.environment === env)
      && (!scope || a.scope_tags.includes(scope)) && (!q || `${a.code} ${a.name} ${a.description} ${a.owner_name || ''}`.toLowerCase().includes(q)));
    const active = list.filter((a) => a.status === 'active');
    mount(el, html`
      <div class="page-head">
        <div><h1>Assets</h1><div class="sub">The systems, applications, data and services you protect. Tag each with the frameworks whose scope it falls in (for example the ISO 27001 ISMS or the PCI DSS cardholder data environment) and link the policies, controls and risks that cover it.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} New asset</button>` : ''}</div>
      </div>
      <div class="grid g4">
        ${kpi('Active assets', active.length, `${list.length - active.length} retired`)}
        ${kpi('Restricted or confidential', active.filter((a) => ['Restricted', 'Confidential'].includes(a.classification)).length, 'Highest sensitivity')}
        ${kpi('Without an owner', active.filter((a) => !a.owner_id).length, 'Every asset needs one', active.some((a) => !a.owner_id) ? 'warn' : 'good')}
        ${kpi('No covering control', active.filter((a) => !a.control_ids.length).length, 'Not linked to any control', active.some((a) => !a.control_ids.length && ['Restricted', 'Confidential'].includes(a.classification)) ? 'bad' : '')}
      </div>
      <div class="card">
        <div class="card-h ctl-filters"><h3>Register</h3>
          <select id="f-type" aria-label="Type"><option value="">Any type</option>${TYPES.map((t) => html`<option ${type === t ? 'selected' : ''}>${t}</option>`)}</select>
          <select id="f-cls" aria-label="Classification"><option value="">Any classification</option>${Object.keys(CLASS).map((t) => html`<option ${cls === t ? 'selected' : ''}>${t}</option>`)}</select>
          <select id="f-env" aria-label="Environment"><option value="">Any environment</option>${ENVS.map((t) => html`<option ${env === t ? 'selected' : ''}>${t}</option>`)}</select>
          <select id="f-scope" aria-label="In scope of"><option value="">Any scope</option>${state.meta.frameworks.map((f) => html`<option value="${f.code}" ${scope === f.code ? 'selected' : ''}>${f.name}</option>`)}</select>
          <label class="row small dim"><input type="checkbox" id="retired" ${showRetired ? 'checked' : ''}> Retired</label>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search assets" aria-label="Search assets"></div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Type</th><th>Owner</th><th>Classification</th><th>Environment</th><th>In scope of</th><th>Covered by</th></tr></thead><tbody>
          ${rows.map((a) => html`<tr class="clickable" data-id="${a.id}" tabindex="0" aria-label="${a.code} ${a.name}">
            <td class="title-cell"><b>${a.name}</b><small>${a.code}${a.status === 'retired' ? ' · retired' : ''}</small></td><td>${a.asset_type}</td>
            <td>${a.owner_name || html`<span class="bad-text">No owner</span>`}</td><td>${classPill(a.classification)}</td><td>${a.environment}</td>
            <td><div class="chips">${a.scope_tags.map((t) => html`<span class="tag">${t}</span>`)}</div></td>
            <td class="small">${a.policy_ids.length} polic${a.policy_ids.length === 1 ? 'y' : 'ies'} · ${a.control_ids.length} control${a.control_ids.length === 1 ? '' : 's'} · ${a.risk_ids.length} risk${a.risk_ids.length === 1 ? '' : 's'}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty"><b>${list.length ? 'Nothing matches' : 'No assets yet'}</b>${list.length ? 'Change the filters.' : 'Add the systems and data your policies and controls protect, to define and evidence your audit scope.'}</div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  const refresh = async () => { list = await GET('/api/assets'); draw(); };
  for (const [sel, set] of [['#f-type', (v) => { type = v; }], ['#f-cls', (v) => { cls = v; }], ['#f-env', (v) => { env = v; }], ['#f-scope', (v) => { scope = v; }]]) on(el, 'change', sel, (e, s) => { set(s.value); draw(); });
  on(el, 'change', '#retired', (e, c) => { showRetired = c.checked; draw(); });
  const open = (a) => assetForm(a, { policies, controls, risks, people }, refresh);
  on(el, 'click', '#new', () => open(null));
  on(el, 'click', 'tr[data-id]', (e, tr) => open(list.find((a) => a.id === Number(tr.dataset.id))));
  on(el, 'keydown', 'tr[data-id]', (e, tr) => { if (e.key === 'Enter') open(list.find((a) => a.id === Number(tr.dataset.id))); });
}

function kpi(label, value, foot, tone = '') {
  return html`<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="foot">${foot}</div></div>`;
}

function assetForm(a, { policies, controls, risks, people }, done) {
  const editable = can.write() && (!a || a.status === 'active');
  const x = a || { name: '', asset_type: 'System', description: '', owner_id: state.me.id, classification: 'Internal', environment: 'Production', scope_tags: [], policy_ids: [], control_ids: [], risk_ids: [] };
  const dis = editable ? '' : 'disabled';
  const picks = (items, key, label, sub) => html`<div class="stmt-pick small-pick" role="group" aria-label="${key}">${items.length ? items.map((it) => html`<label class="pick"><input type="checkbox" data-${key}="${it.id}" ${x[`${key}_ids`].includes(it.id) ? 'checked' : ''} ${dis}><span class="ref">${it.code}</span><span>${label(it)}<small>${sub(it)}</small></span></label>`) : html`<div class="muted small">None yet.</div>`}</div>`;
  modal({
    title: a ? `${a.code} · ${a.name}` : 'New asset', drawer: true,
    body: html`<form id="asf" class="stack" novalidate>
      <label class="f"><span>Asset name</span><input name="name" value="${x.name}" maxlength="200" required ${dis}></label>
      <label class="f"><span>Description</span><textarea name="description" rows="2" maxlength="2000" ${dis}>${x.description}</textarea></label>
      <div class="form-grid">
        <label class="f"><span>Type</span><select name="asset_type" ${dis}>${TYPES.map((t) => html`<option ${t === x.asset_type ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="f"><span>Owner</span><select name="owner_id" ${dis}><option value="">Unassigned</option>${people.map((u) => html`<option value="${u.id}" ${u.id === x.owner_id ? 'selected' : ''}>${u.name}</option>`)}</select></label>
        <label class="f"><span>Classification</span><select name="classification" ${dis}>${Object.keys(CLASS).map((t) => html`<option ${t === x.classification ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="f"><span>Environment</span><select name="environment" ${dis}>${ENVS.map((t) => html`<option ${t === x.environment ? 'selected' : ''}>${t}</option>`)}</select></label>
      </div>
      <fieldset class="scope-tags"><legend class="section-label">In scope of</legend>
        ${state.meta.frameworks.map((f) => html`<label class="am-fwc"><input type="checkbox" data-scope="${f.code}" ${x.scope_tags.includes(f.code) ? 'checked' : ''} ${dis}><span>${f.name}</span></label>`)}</fieldset>
      <div><div class="section-label">Policies that cover it</div>${picks(policies.filter((p) => p.status !== 'retired'), 'policy', (p) => p.title, (p) => p.status.replace('_', ' '))}</div>
      <div><div class="section-label">Controls that protect it</div>${picks(controls.filter((c) => c.status === 'active' || x.control_ids.includes(c.id)), 'control', (c) => c.name, (c) => (c.result === 'not_tested' ? 'Not yet tested' : `Latest result: ${c.result}`))}</div>
      <div><div class="section-label">Risks to it</div>${picks(risks, 'risk', (r) => r.title, (r) => `Residual ${r.residual} · ${r.status}`)}</div>
    </form>`,
    footer: html`${a && can.write() ? (a.status === 'active' ? html`<button class="btn ghost danger-text" data-retire>Retire</button>` : html`<button class="btn" data-reactivate>Reactivate</button>`) : ''}<span class="right"></span><button class="btn ghost" data-close>${editable ? 'Cancel' : 'Close'}</button>${editable ? html`<button class="btn primary" data-save>${a ? 'Save asset' : 'Add asset'}</button>` : ''}`,
    onMount: ({ el, close }) => {
      const ids = (k) => [...el.querySelectorAll(`[data-${k}]:checked`)].map((i) => Number(i.dataset[k]));
      on(el, 'click', '[data-save]', async (e, b) => {
        const f = $('#asf', el); const val = (n) => f.elements.namedItem(n).value;
        const body = { name: val('name'), description: val('description'), asset_type: val('asset_type'), owner_id: val('owner_id') || null, classification: val('classification'), environment: val('environment'),
          scope_tags: [...el.querySelectorAll('[data-scope]:checked')].map((i) => i.dataset.scope), policy_ids: ids('policy'), control_ids: ids('control'), risk_ids: ids('risk') };
        b.disabled = true;
        try { if (a) await PUT(`/api/assets/${a.id}`, body); else await POST('/api/assets', body); toast(a ? 'Asset saved.' : 'Asset added.'); close(); await done(); } catch (err) { fail(err); b.disabled = false; }
      });
      on(el, 'click', '[data-retire]', () => modal({
        title: `Retire ${a.code}?`,
        body: html`<form class="stack"><p class="dim">Retired assets keep their links and history but leave the active register.</p><label class="f"><span>Reason</span><input id="ar-r" maxlength="500" placeholder="e.g. Decommissioned after migration to the new platform"></label></form>`,
        footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="ar-ok">Retire asset</button>`,
        onMount: ({ el: m, close: closeM }) => on(m, 'click', '#ar-ok', async () => {
          try { await POST(`/api/assets/${a.id}/status`, { status: 'retired', reason: $('#ar-r', m).value }); closeM(); close(); toast('Asset retired.'); await done(); } catch (err) { fail(err); }
        }),
      }));
      on(el, 'click', '[data-reactivate]', async () => { try { await POST(`/api/assets/${a.id}/status`, { status: 'active' }); toast('Asset reactivated.'); close(); await done(); } catch (err) { fail(err); } });
    },
  });
}
