// Vendor / third-party risk: register, security questionnaire, SOC 2 reports, reassessment dates.
import { html, mount, $, on, state, can, GET, POST, PUT, toast, fail, modal, fmtDate, fmtDateTime, pill, icon } from '../core.js';

const LEVEL = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
const DATA = { none: 'No access to our data', internal: 'Internal data', confidential: 'Confidential data', restricted: 'Restricted / regulated data' };
const ratingPill = (r) => (r ? pill(LEVEL[r], r) : html`<span class="muted small">Not assessed</span>`);
const ANSWER = { yes: 'Yes', partial: 'Partly', no: 'No', na: 'N/A' };

export async function vendorsView(el) {
  let list = await GET('/api/vendors');
  let q = '', show = 'active';
  const draw = () => {
    const rows = list.filter((v) => (show === 'all' || (show === 'attention' ? v.status === 'active' && (v.reassessment_overdue || v.report_stale || !v.assessed_on) : v.status === show))
      && (!q || `${v.code} ${v.name} ${v.service}`.toLowerCase().includes(q)));
    const active = list.filter((v) => v.status === 'active');
    mount(el, html`
      <div class="page-head">
        <div><h1>Vendors</h1><div class="sub">Third parties that handle your data or run your services: how critical they are, what they can access, their security questionnaire, their SOC 2 report, and when they are due for reassessment.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn primary" id="new">${icon('plus')} New vendor</button>` : ''}</div>
      </div>
      <div class="grid g4">
        ${kpi('Active vendors', active.length, `${active.filter((v) => !v.assessed_on).length} not yet assessed`)}
        ${kpi('High or critical risk', active.filter((v) => ['Critical', 'High'].includes(v.risk_rating)).length, 'From the latest assessment', active.some((v) => v.risk_rating === 'Critical') ? 'bad' : '')}
        ${kpi('Reassessment overdue', active.filter((v) => v.reassessment_overdue).length, `${active.filter((v) => v.reassessment_soon).length} due in 30 days`, active.some((v) => v.reassessment_overdue) ? 'bad' : 'good')}
        ${kpi('No current SOC 2 report', active.filter((v) => v.report_stale).length, 'Critical and high vendors', active.some((v) => v.report_stale) ? 'warn' : 'good')}
      </div>
      <div class="card">
        <div class="card-h ctl-filters"><h3>Register</h3>
          <select id="f-show" aria-label="Show">${[['active', 'Active'], ['attention', 'Needs attention'], ['offboarded', 'Offboarded'], ['all', 'All']].map(([k, l]) => html`<option value="${k}" ${show === k ? 'selected' : ''}>${l}</option>`)}</select>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search vendors" aria-label="Search vendors"></div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Vendor</th><th>Criticality</th><th>Data access</th><th>Risk rating</th><th>Owner</th><th>SOC 2 report</th><th>Reassessment</th></tr></thead><tbody>
          ${rows.map((v) => html`<tr class="clickable" data-id="${v.id}" tabindex="0" aria-label="${v.code} ${v.name}">
            <td class="title-cell"><b>${v.name}</b><small>${v.code}${v.service ? ` · ${v.service}` : ''}${v.status === 'offboarded' ? ' · offboarded' : ''}</small></td>
            <td>${pill(LEVEL[v.criticality], v.criticality)}</td><td class="small">${DATA[v.data_access]}</td><td>${ratingPill(v.risk_rating)}</td>
            <td>${v.owner_name || html`<span class="muted">Unassigned</span>`}</td>
            <td class="small">${v.latest_report ? html`${v.latest_report.report_type}${v.latest_report.period_end ? ` · to ${fmtDate(v.latest_report.period_end)}` : ''}${v.report_stale ? html` <b class="bad-text">out of date</b>` : ''}` : v.report_stale ? html`<b class="bad-text">None</b>` : html`<span class="muted">None</span>`}</td>
            <td class="${v.reassessment_overdue ? 's-critical' : ''}">${v.reassessment_due ? html`${fmtDate(v.reassessment_due)}${v.reassessment_overdue ? html` <b class="small">overdue</b>` : ''}` : '—'}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty"><b>${list.length ? 'Nothing matches' : 'No vendors yet'}</b>${list.length ? 'Change the filter.' : 'Add the third parties that process your data or run critical services.'}</div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  on(el, 'change', '#f-show', (e, s) => { show = s.value; draw(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => { location.hash = `#/vendors/${tr.dataset.id}`; });
  on(el, 'keydown', 'tr[data-id]', (e, tr) => { if (e.key === 'Enter') location.hash = `#/vendors/${tr.dataset.id}`; });
  on(el, 'click', '#new', () => vendorForm(null, async (id) => { location.hash = `#/vendors/${id}`; }));
}

function kpi(label, value, foot, tone = '') {
  return html`<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="foot">${foot}</div></div>`;
}

export async function vendorDetailView(el, id) {
  let [v, questions] = await Promise.all([GET(`/api/vendors/${id}`), GET('/api/vendors/questions')]);
  const reload = async () => { v = await GET(`/api/vendors/${id}`); draw(); };
  const draw = () => mount(el, html`
    <div class="page-head">
      <div>
        <a class="back-link" href="#/vendors">${icon('up')} Vendors</a>
        <div class="row"><span class="tag gold">${v.code}</span>${pill(LEVEL[v.criticality], `${v.criticality} criticality`)}${ratingPill(v.risk_rating)}${v.status === 'offboarded' ? pill('retired', 'Offboarded') : ''}${v.reassessment_overdue ? pill('critical', 'Reassessment overdue') : ''}</div>
        <h1>${v.name}</h1><div class="sub">${v.service || 'No service description'} · ${DATA[v.data_access]}</div>
      </div>
      <div class="actions">${can.write() && v.status === 'active' ? html`<button class="btn" id="edit">Edit</button><button class="btn primary" id="assess">${icon('check')} ${v.assessed_on ? 'Reassess' : 'Assess'}</button>` : ''}</div>
    </div>
    <div class="grid g3">
      <section class="card span2" aria-labelledby="vq-h"><div class="card-h"><h3 id="vq-h">Security questionnaire</h3><span class="muted small">${v.assessed_on ? `Assessed ${fmtDate(v.assessed_on)} by ${v.assessed_by_name}` : 'Not yet assessed'}</span></div>
        ${v.assessed_on ? html`<ul class="vq-list">${questions.map((qq) => { const a = v.questionnaire[qq.key]; return html`<li class="vq-${a}"><span class="vq-a">${ANSWER[a] || '—'}</span><span>${qq.text}</span></li>`; })}</ul>
          <div class="card-b small dim">Rating ${v.risk_rating}: exposure ${v.rating_basis.exposure} of 4 (criticality and data access) × control gaps ${v.rating_basis.gap_pct}% of the weighted questionnaire.</div>`
          : html`<div class="empty small"><b>No assessment yet</b>${can.write() ? 'Click Assess to answer the 12 questions and rate this vendor.' : ''}</div>`}
      </section>
      <section class="card" aria-labelledby="vd-h"><div class="card-h"><h3 id="vd-h">Details</h3></div><div class="card-b">
        <dl class="kv"><dt>Owner</dt><dd>${v.owner_name || 'Unassigned'}</dd><dt>Reassessment</dt><dd class="${v.reassessment_overdue ? 'bad-text' : ''}">${v.reassessment_due ? fmtDate(v.reassessment_due) : '—'}</dd>
          <dt>Data access</dt><dd>${DATA[v.data_access]}</dd><dt>Status</dt><dd>${v.status}</dd></dl>
        ${v.notes ? html`<p class="pre small mt">${v.notes}</p>` : ''}
        ${can.write() ? html`<div class="mt">${v.status === 'active' ? html`<button class="btn sm ghost danger-text" id="offboard">Offboard vendor</button>` : html`<button class="btn sm" id="reactivate">Reactivate</button>`}</div>` : ''}
      </div></section>
    </div>
    <section class="card" aria-labelledby="vr-h"><div class="card-h"><h3 id="vr-h">SOC 2 and assurance reports</h3><span class="muted small">PDFs are stored on your MandateGRC server with their SHA-256</span>${can.write() ? html`<button class="btn xs right" id="upload">${icon('plus')} Upload report</button>` : ''}</div>
      ${v.reports.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Report</th><th>Period end</th><th>Opinion</th><th>Uploaded</th><th>Review</th><th></th></tr></thead><tbody>
        ${v.reports.map((r) => html`<tr><td class="title-cell"><b>${r.report_type}</b><small>${r.filename} · ${Math.max(1, Math.round(r.bytes / 1024))} KB</small></td>
          <td>${r.period_end ? fmtDate(r.period_end) : '—'}</td><td>${r.opinion ? r.opinion.replace('_', ' ') : '—'}${r.exceptions_noted ? html`<small class="muted">${r.exceptions_noted}</small>` : ''}</td>
          <td class="small">${fmtDate(r.uploaded_at)} by ${r.uploaded_by_name}</td>
          <td class="wrap-cell small">${r.reviewed_at ? html`${pill('ok', 'Reviewed')} ${r.reviewed_by_name}, ${fmtDate(r.reviewed_at)}<small class="muted">${r.review_note}</small>` : can.steward() ? html`<button class="btn xs" data-review="${r.id}" ${r.uploaded_by === state.me.id ? 'disabled title="Separation of duties: you uploaded it"' : ''}>Record review…</button>` : html`<span class="muted">Awaiting review</span>`}</td>
          <td><button class="btn xs" data-dl="${r.id}">${icon('download')} PDF</button></td></tr>`)}
      </tbody></table></div>` : html`<div class="empty small"><b>No reports</b>${['Critical', 'High'].includes(v.criticality) ? 'A critical or high vendor should provide a SOC 2 Type II report covering the last 12 months.' : 'Upload a SOC 2 report or ISO 27001 certificate if the vendor provides one.'}</div>`}
    </section>
    <section class="card" aria-labelledby="vh-h"><div class="card-h"><h3 id="vh-h">History</h3><span class="muted small">From the audit trail</span></div>
      <ol class="timeline">${v.history.map((h) => html`<li><span class="when">${fmtDateTime(h.ts)}</span><span><b>${h.username}</b> ${h.action.replace('vendor.', '').replace(/_/g, ' ')}${h.details?.risk_rating ? html` <span class="dim">→ ${Array.isArray(h.details.risk_rating) ? h.details.risk_rating[1] : h.details.risk_rating}</span>` : ''}${h.details?.note ? html`: <span class="dim">${h.details.note}</span>` : ''}</span></li>`)}</ol></section>`);
  draw();
  on(el, 'click', '#edit', () => vendorForm(v, reload));
  on(el, 'click', '#assess', () => assessDialog(v, questions, reload));
  on(el, 'click', '#upload', () => uploadDialog(v, reload));
  on(el, 'click', '[data-review]', (e, b) => {
    modal({
      title: 'Record report review',
      body: html`<form class="stack"><p class="dim small">Note the opinion, any exceptions and complementary user entity controls (CUECs) you must operate.</p><label class="f"><span>Review outcome</span><textarea id="rv-n" rows="3" maxlength="2000"></textarea></label></form>`,
      footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rv-ok">Record review</button>`,
      onMount: ({ el: m, close }) => on(m, 'click', '#rv-ok', async () => {
        try { await POST(`/api/vendor-reports/${b.dataset.review}/review`, { note: $('#rv-n', m).value }); close(); toast('Review recorded.'); await reload(); } catch (err) { fail(err); }
      }),
    });
  });
  on(el, 'click', '[data-dl]', async (e, b) => {
    try {
      const res = await fetch(`/api/vendor-reports/${b.dataset.dl}/download`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'report.pdf';
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (err) { fail(err); }
  });
  on(el, 'click', '#offboard', () => modal({
    title: `Offboard ${v.name}?`,
    body: html`<form class="stack"><p class="dim">Offboarded vendors leave the action queue but keep their history and reports.</p><label class="f"><span>Reason</span><input id="ob-r" maxlength="500" placeholder="e.g. Contract ended; data deletion certificate received"></label></form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="ob-ok">Offboard</button>`,
    onMount: ({ el: m, close }) => on(m, 'click', '#ob-ok', async () => { try { await POST(`/api/vendors/${v.id}/status`, { status: 'offboarded', reason: $('#ob-r', m).value }); close(); toast('Vendor offboarded.'); await reload(); } catch (err) { fail(err); } }),
  }));
  on(el, 'click', '#reactivate', async () => { try { await POST(`/api/vendors/${v.id}/status`, { status: 'active' }); toast('Vendor reactivated.'); await reload(); } catch (err) { fail(err); } });
}

async function vendorForm(v, done) {
  const people = (await GET('/api/people')).filter((u) => u.role !== 'employee');
  const x = v || { name: '', service: '', owner_id: state.me.id, criticality: 'Medium', data_access: 'internal', reassessment_due: '', notes: '' };
  modal({
    title: v ? `Edit ${v.code}` : 'New vendor', drawer: true,
    body: html`<form id="vf" class="stack" novalidate>
      <label class="f"><span>Vendor name</span><input name="name" value="${x.name}" maxlength="200" required></label>
      <label class="f"><span>Service provided</span><input name="service" value="${x.service}" maxlength="500" placeholder="e.g. Payroll processing, cloud hosting"></label>
      <div class="form-grid">
        <label class="f"><span>Criticality <em>(impact if they fail)</em></span><select name="criticality">${Object.keys(LEVEL).map((k) => html`<option ${k === x.criticality ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="f"><span>Access to your data</span><select name="data_access">${Object.entries(DATA).map(([k, l]) => html`<option value="${k}" ${k === x.data_access ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="f"><span>Vendor owner</span><select name="owner_id"><option value="">Unassigned</option>${people.map((u) => html`<option value="${u.id}" ${u.id === x.owner_id ? 'selected' : ''}>${u.name}</option>`)}</select></label>
        <label class="f"><span>Reassessment due <em>${v ? '' : '(blank: assess now)'}</em></span><input type="date" name="reassessment_due" value="${x.reassessment_due || ''}"></label>
      </div>
      <label class="f"><span>Notes</span><textarea name="notes" rows="3" maxlength="4000">${x.notes}</textarea></label>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>${v ? 'Save' : 'Add vendor'}</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-save]', async (e, b) => {
      const f = $('#vf', el); const val = (n) => f.elements.namedItem(n).value;
      const body = { name: val('name'), service: val('service'), criticality: val('criticality'), data_access: val('data_access'), owner_id: val('owner_id') || null, reassessment_due: val('reassessment_due') || null, notes: val('notes') };
      b.disabled = true;
      try {
        if (v) { const r = await PUT(`/api/vendors/${v.id}`, body); toast(`Saved.${r.risk_rating && r.risk_rating !== v.risk_rating ? ` Risk rating is now ${r.risk_rating}.` : ''}`); close(); await done(v.id); }
        else { const r = await POST('/api/vendors', body); toast(`${r.code} added. Assess it next.`); close(); await done(r.id); }
      } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}

function assessDialog(v, questions, done) {
  modal({
    title: `Assess ${v.name}`, wide: true,
    body: html`<form id="af" class="stack">
      <p class="dim small">Answer from the vendor's questionnaire response, SOC 2 report or contract. The rating combines these answers with the vendor's criticality and data access, and the next reassessment is scheduled automatically.</p>
      <ol class="vq-form">${questions.map((qq) => { const cur = v.questionnaire[qq.key]; return html`<li><fieldset><legend>${qq.text}</legend>
        ${Object.entries(ANSWER).map(([k, l]) => html`<label class="vq-opt"><input type="radio" name="${qq.key}" value="${k}" ${cur === k ? 'checked' : ''}> ${l}</label>`)}</fieldset></li>`; })}</ol>
      <label class="f"><span>Notes <em>(optional)</em></span><textarea name="notes" rows="2" maxlength="4000"></textarea></label>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="af-ok">${icon('check')} Save assessment</button>`,
    onMount: ({ el, close }) => on(el, 'click', '#af-ok', async (e, b) => {
      const f = $('#af', el);
      const answers = Object.fromEntries(questions.map((qq) => [qq.key, f.querySelector(`input[name="${qq.key}"]:checked`)?.value]));
      if (Object.values(answers).some((a) => !a)) return toast('Answer every question (use N/A where it does not apply).', 'err');
      b.disabled = true;
      try { const r = await POST(`/api/vendors/${v.id}/assess`, { answers, notes: f.elements.namedItem('notes').value }); close(); toast(`Rated ${r.risk_rating}. Next reassessment ${fmtDate(r.reassessment_due)}.`); await done(); } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}

function uploadDialog(v, done) {
  modal({
    title: `Upload a report for ${v.name}`,
    body: html`<form id="uf" class="stack">
      <label class="f"><span>Report (PDF, up to 15 MB)</span><input type="file" name="file" accept="application/pdf,.pdf" required></label>
      <div class="form-grid">
        <label class="f"><span>Type</span><select name="report_type">${['SOC 2 Type II', 'SOC 2 Type I', 'ISO 27001 certificate', 'Other'].map((t) => html`<option>${t}</option>`)}</select></label>
        <label class="f"><span>Period end / certificate date</span><input type="date" name="period_end"></label>
        <label class="f"><span>Auditor's opinion</span><select name="opinion"><option value="">Not stated</option><option value="unqualified">Unqualified</option><option value="qualified">Qualified</option><option value="adverse">Adverse</option><option value="not_applicable">Not applicable</option></select></label>
      </div>
      <label class="f"><span>Exceptions noted <em>(optional)</em></span><textarea name="exceptions_noted" rows="2" maxlength="4000"></textarea></label>
      <p class="muted small">The file is stored on your MandateGRC server, named by its SHA-256, and the hash is written to the audit trail. Someone other than you records the review.</p>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="uf-ok">${icon('download')} Upload</button>`,
    onMount: ({ el, close }) => on(el, 'click', '#uf-ok', async (e, b) => {
      const f = $('#uf', el); const file = f.elements.namedItem('file').files[0];
      if (!file) return toast('Choose the PDF to upload.', 'err');
      if (file.size > 15 * 1024 * 1024) return toast('The report must be 15 MB or smaller.', 'err');
      b.disabled = true;
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
        await POST(`/api/vendors/${v.id}/reports`, { filename: file.name, report_type: f.elements.namedItem('report_type').value, period_end: f.elements.namedItem('period_end').value || null, opinion: f.elements.namedItem('opinion').value || null, exceptions_noted: f.elements.namedItem('exceptions_noted').value, content_base64: b64 });
        close(); toast('Report uploaded.'); await done();
      } catch (err) { fail(err); b.disabled = false; }
    }),
  });
}
