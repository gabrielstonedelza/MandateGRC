// ISO/IEC 27001 Statement of Applicability: generated from mappings, controls, tests and evidence;
// applicability and justification are edited here and saved as a new version.
import { html, mount, $, on, can, GET, PUT, toast, fail, modal, fmtDate, fmtDateTime, pill, icon, ring } from '../core.js';

const STATUS = {
  implemented: ['ok', 'Implemented'], partial: ['medium', 'Partially implemented'], planned: ['info', 'Planned'],
  not_implemented: ['critical', 'Not implemented'], not_applicable: ['retired', 'Not applicable'],
};
const statusPill = (s) => pill(STATUS[s][0], STATUS[s][1]);

export async function soaView(el) {
  let soa = await GET('/api/soa');
  const pending = new Map(); // control_id -> { applicable, justification }
  let open = new Set(), theme = '', status = '', q = '';
  const edited = (r) => pending.get(r.control_id) || { applicable: r.applicable, justification: r.justification_auto ? '' : r.justification };
  const changed = (r) => { const p = pending.get(r.control_id); if (!p) return false; return p.applicable !== r.applicable || p.justification !== (r.justification_auto ? '' : r.justification); };

  const draw = () => {
    const c = soa.coverage;
    const themes = [...new Set(soa.rows.map((r) => r.family))];
    const rows = soa.rows.filter((r) => (!theme || r.family === theme) && (!status || r.status === status)
      && (!q || `${r.ref} ${r.title} ${r.justification}`.toLowerCase().includes(q)));
    mount(el, html`
      <div class="page-head">
        <div><h1>Statement of Applicability</h1>
          <div class="sub">ISO/IEC 27001:2022 Annex A. Each control's status, policy statements, controls and evidence come from your workspace; you decide applicability and justify it. Every saved change is a new version.</div>
          <div class="row mt"><span class="tag gold">SoA v${soa.version}</span><span class="muted small">${soa.version ? `Last changed ${fmtDateTime(soa.updated_at)} by ${soa.updated_by_name}` : 'Not yet reviewed: every control is applicable by default'}</span></div></div>
        <div class="actions">
          <button class="btn" id="history">${icon('diff')} History</button>
          <button class="btn" data-export="csv">${icon('download')} CSV</button>
          <button class="btn primary" data-export="pdf">${icon('download')} PDF</button>
        </div>
      </div>
      <div class="grid g3">
        <div class="card span2"><div class="posture">
          ${ring(c.pct, { label: 'Tested' })}
          <div class="parts">
            <div class="soa-cov"><b>${c.covered} of ${c.applicable}</b> applicable controls have at least one linked, tested control.</div>
            ${Object.entries(STATUS).map(([k, [, label]]) => html`<div class="part"><span>${label}</span><div class="bar"><i class="${k === 'implemented' ? 'ok' : k === 'not_implemented' ? 'bad' : 'warn'}" data-w="${c.total ? Math.round((c.counts[k] / c.total) * 100) : 0}"></i></div><b>${c.counts[k]}</b></div>`)}
          </div></div></div>
        <div class="card"><div class="card-h"><h3>Scope</h3></div><div class="card-b stack">
          <div class="kpi-inline"><b>${c.applicable}</b><span>applicable</span></div>
          <div class="kpi-inline"><b>${c.excluded}</b><span>excluded, each with a justification</span></div>
          <div class="kpi-inline"><b>${c.with_control}</b><span>applicable controls with a linked control</span></div>
          <p class="map-disclaimer">${soa.disclaimer}</p>
        </div></div>
      </div>
      <div class="card">
        <div class="card-h ctl-filters">
          <h3>Annex A controls</h3>
          <select id="f-theme" aria-label="Theme"><option value="">All themes</option>${themes.map((t) => html`<option ${theme === t ? 'selected' : ''}>${t}</option>`)}</select>
          <select id="f-status" aria-label="Implementation status"><option value="">Any status</option>${Object.entries(STATUS).map(([k, [, l]]) => html`<option value="${k}" ${status === k ? 'selected' : ''}>${l}</option>`)}</select>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search controls" aria-label="Search Annex A controls"></div>
        </div>
        <div class="table-wrap"><table class="t soa-table"><thead><tr><th>Control</th><th>Applicable</th><th>Justification</th><th>Implementation</th><th>Linked</th><th></th></tr></thead><tbody>
          ${rows.map((r) => {
            const e = edited(r);
            const isOpen = open.has(r.control_id);
            return html`<tr class="${changed(r) ? 'soa-dirty' : ''}">
              <td class="title-cell"><b>${r.ref} ${r.title}</b><small>${r.family}</small></td>
              <td>${e.applicable ? pill('ok', 'Yes') : pill('retired', 'No')}</td>
              <td class="wrap-cell">${e.justification || r.justification_auto ? html`<span class="${!e.justification ? 'muted' : ''}">${e.justification || r.justification}</span>${!e.justification ? html` <span class="tag">auto</span>` : ''}` : html`<span class="bad-text">Justification needed</span>`}</td>
              <td>${statusPill(e.applicable ? (r.status === 'not_applicable' ? 'not_implemented' : r.status) : 'not_applicable')}</td>
              <td class="nowrap small"><span title="Policy statements">${icon('policy')} ${r.statements.length}</span> <span title="Controls">${icon('control')} ${r.controls.length}</span> <span title="Evidence">${icon('evidence')} ${r.evidence.length}</span></td>
              <td><button class="btn xs" data-open="${r.control_id}" aria-expanded="${isOpen}" aria-controls="soa-${r.control_id}">${isOpen ? 'Close' : can.write() ? 'Edit' : 'Details'}</button></td>
            </tr>
            ${isOpen ? html`<tr class="soa-detail" id="soa-${r.control_id}"><td colspan="6"><div class="soa-edit">
              <div class="stack">
                ${can.write() ? html`<fieldset class="soa-app"><legend class="section-label">Applicable to your organization?</legend>
                  <label class="row"><input type="radio" name="app-${r.control_id}" value="1" data-app="${r.control_id}" ${e.applicable ? 'checked' : ''}> Yes, included</label>
                  <label class="row"><input type="radio" name="app-${r.control_id}" value="0" data-app="${r.control_id}" ${e.applicable ? '' : 'checked'}> No, excluded</label></fieldset>
                  <label class="f"><span>Justification <em>${e.applicable ? '(optional: the suggested text is used when blank)' : '(required for an exclusion)'}</em></span>
                    <textarea rows="3" maxlength="2000" data-just="${r.control_id}" placeholder="${r.justification_auto ? r.justification : ''}">${e.justification}</textarea></label>`
                  : html`<p>${r.justification || 'No justification recorded.'}</p>`}
                ${r.updated_at ? html`<div class="muted small">Decision last changed ${fmtDate(r.updated_at)} by ${r.updated_by_name}</div>` : ''}
              </div>
              <div class="soa-links">
                <div><div class="section-label">Policy statements</div>${r.statements.length ? r.statements.map((s) => html`<a class="chain-item" href="#/policies/${s.policy_id}"><span class="ref">${s.policy_code} ${s.num}</span><span class="clip">${s.text}</span><small>${s.status.replace('_', ' ')}</small></a>`) : html`<div class="chain-empty">None mapped.</div>`}</div>
                <div><div class="section-label">Controls</div>${r.controls.length ? r.controls.map((k) => html`<a class="chain-item" href="#/controls/${k.id}"><span class="ref">${k.code}</span><span>${k.name}</span><small>${k.result === 'not_tested' ? 'Not yet tested' : `Latest test: ${k.result}`}${k.last_tested_on ? ` on ${fmtDate(k.last_tested_on)}` : ''}${k.overdue ? ' · overdue' : ''}</small></a>`) : html`<div class="chain-empty">No control operates it.</div>`}</div>
                <div><div class="section-label">Evidence</div>${r.evidence.length ? r.evidence.map((x) => html`<a class="chain-item" href="#/evidence"><span>${x.title}</span><small>Collected ${fmtDate(x.collected_on)}${x.fresh ? '' : ' · expired'}</small></a>`) : html`<div class="chain-empty">None.</div>`}</div>
              </div></div></td></tr>` : ''}`;
          })}
        </tbody></table></div>
      </div>
      <div id="savebar-slot"></div>`);
    drawBar();
    $('#q', el).addEventListener('input', (ev) => { q = ev.target.value.toLowerCase(); const pos = ev.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  // The save bar is drawn on its own so typing a justification never re-renders the table.
  function drawBar() {
    const n = soa.rows.filter(changed).length;
    const slot = $('#savebar-slot', el);
    if (!slot) return;
    const note = $('#note', el)?.value || '';
    mount(slot, n ? html`<div class="savebar" role="region" aria-label="Unsaved SoA changes">
      <b>${n} unsaved change${n === 1 ? '' : 's'}</b>
      <input id="note" maxlength="500" value="${note}" placeholder="Change note (optional), e.g. Annual scoping review" aria-label="Change note">
      <button class="btn ghost" id="discard">Discard</button>
      <button class="btn primary" id="save">${icon('check')} Save as v${soa.version + 1}</button></div>` : html``);
  }
  draw();

  const rowOf = (id) => soa.rows.find((r) => r.control_id === Number(id));
  on(el, 'change', '#f-theme', (e, s) => { theme = s.value; draw(); });
  on(el, 'change', '#f-status', (e, s) => { status = s.value; draw(); });
  on(el, 'click', '[data-open]', (e, b) => { const id = Number(b.dataset.open); open.has(id) ? open.delete(id) : open.add(id); draw(); });
  on(el, 'change', '[data-app]', (e, i) => { const r = rowOf(i.dataset.app); pending.set(r.control_id, { ...edited(r), applicable: i.value === '1' }); draw(); });
  on(el, 'input', '[data-just]', (e, t) => { const r = rowOf(t.dataset.just); pending.set(r.control_id, { ...edited(r), justification: t.value }); drawBar(); });
  on(el, 'click', '#discard', () => { pending.clear(); draw(); });
  on(el, 'click', '#save', async (e, b) => {
    const changes = soa.rows.filter(changed).map((r) => ({ control_id: r.control_id, ...pending.get(r.control_id) }));
    const bad = changes.find((ch) => !ch.applicable && (ch.justification || '').trim().length < 10);
    if (bad) { const r = rowOf(bad.control_id); open.add(r.control_id); draw(); return toast(`Excluding ${r.ref} needs a justification of at least 10 characters.`, 'err'); }
    b.disabled = true;
    try {
      const res = await PUT('/api/soa', { changes, note: $('#note', el)?.value || '' });
      pending.clear(); open = new Set();
      soa = await GET('/api/soa');
      draw();
      toast(res.changed ? `Saved SoA v${res.version} (${res.changed} change${res.changed === 1 ? '' : 's'}).` : 'Nothing changed.');
    } catch (err) { fail(err); b.disabled = false; }
  });
  on(el, 'click', '[data-export]', async (e, b) => {
    b.disabled = true;
    try {
      const fmt = b.dataset.export;
      const res = await fetch(`/api/soa/export?format=${fmt}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `soa.${fmt}`;
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast(`Exported ${name}.`);
    } catch (err) { fail(err); } finally { b.disabled = false; }
  });
  on(el, 'click', '#history', async () => {
    const revs = await GET('/api/soa/revisions');
    modal({
      title: 'SoA version history', wide: true,
      body: revs.length ? html`<ol class="soa-history">${revs.map((r) => html`<li><div class="row"><span class="tag gold">v${r.version}</span><b>${r.created_by_name}</b><span class="muted small">${fmtDateTime(r.created_at)}</span></div>
        ${r.note ? html`<div class="dim small">${r.note}</div>` : ''}
        <ul class="plain-list">${r.changes.map((c) => html`<li><b>${c.ref}</b> ${c.applicable[0] !== c.applicable[1] ? html`${c.applicable[1] ? 'included' : 'excluded'}` : 'justification updated'}${c.justification[1] ? html`: <span class="dim">${c.justification[1]}</span>` : ''}</li>`)}</ul></li>`)}</ol>`
        : html`<div class="empty"><b>No versions yet</b>Every control is applicable by default until you save a decision.</div>`,
      footer: html`<button class="btn primary" data-close>Close</button>`,
    });
  });
}
