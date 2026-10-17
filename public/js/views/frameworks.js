import { html, mount, $, on, state, can, GET, POST, DEL, toast, fail, modal, confirmDialog, formData, fmtDate, pill, icon } from '../core.js';
import { THEME_LABELS } from '../lint.js';
import { evidenceForm } from './evidence.js';

export async function frameworksView(el, code) {
  let fws = await GET('/api/frameworks');
  let active = code && fws.find((f) => f.code === code) ? code : fws[0]?.code;
  let filter = 'all', q = '';

  const draw = () => {
    const fw = fws.find((f) => f.code === active);
    const ctrls = fw.controls.filter((c) => (filter === 'all' || (filter === 'gaps' && !c.planned) || (filter === 'draft' && c.planned && !c.published) || (filter === 'covered' && c.published))
      && (!q || `${c.ref} ${c.title} ${c.family}`.toLowerCase().includes(q)));
    const stats = (f) => ({ total: f.controls.length, pub: f.controls.filter((c) => c.published).length, plan: f.controls.filter((c) => c.planned).length });
    const s = stats(fw);
    const families = [...new Set(ctrls.map((c) => c.family))];
    mount(el, html`
      <div class="page-head">
        <div><h1>Frameworks & controls</h1><div class="sub">Coverage is computed from statement-level mappings, so you can see exactly which policy statement satisfies each control and where the gaps are. Related controls in other frameworks are matched by shared control themes.</div></div>
        <div class="actions">${can.write() ? html`<button class="btn" id="newfw">${icon('plus')} Custom framework</button>` : ''}</div>
      </div>
      <div class="grid g4" data-tour="fw-grid">${fws.map((f) => { const x = stats(f); const pct = x.total ? Math.round((x.pub / x.total) * 100) : 0; return html`
        <div class="card fw-card ${f.code === active ? 'on' : ''}" data-fw="${f.code}" role="button" tabindex="0">
          <div class="row"><span class="fw-n">${f.name}</span>${f.custom ? html`<span class="tag gold">Custom</span>` : ''}</div>
          <div class="muted small">${f.version || ''} · ${x.total} controls</div>
          <div class="row mt"><div class="bar right-grow"><i class="planned" data-w="${x.total ? (x.plan / x.total) * 100 : 0}"></i><i data-w="${pct}"></i></div><b>${pct}%</b></div>
        </div>`; })}</div>
      <div class="card">
        <div class="card-h">
          <h3>${fw.name}</h3><span class="muted">${s.pub}/${s.total} covered by published policy · ${s.plan - s.pub} in draft · ${s.total - s.plan} gaps</span>
          <div class="right row">
            ${fw.custom && can.write() ? html`<button class="btn sm" id="import">${icon('plus')} Add / import controls</button>` : ''}
            ${fw.custom && can.admin() ? html`<button class="btn sm danger" id="delfw">${icon('trash')}</button>` : ''}
          </div>
        </div>
        <div class="card-b row">
          <div class="tabs compact">${[['all', 'All'], ['gaps', 'Gaps'], ['draft', 'Draft only'], ['covered', 'Covered']].map(([k, l]) => html`<button data-filter="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`)}</div>
          <div class="legend"><span><span class="ctrl-dot pub"></span>Published policy</span><span><span class="ctrl-dot plan"></span>Draft policy only</span><span><span class="ctrl-dot gap"></span>Gap</span></div>
          <div class="right search"><span>${icon('search')}</span><input id="q" value="${q}" placeholder="Search controls" aria-label="Search controls"></div>
        </div>
        ${ctrls.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th></th><th>Ref</th><th>Control</th><th>Themes</th><th>Evidence</th></tr></thead><tbody>
          ${families.map((fam) => html`<tr><td colspan="5" class="section-label">${fam}</td></tr>${ctrls.filter((c) => c.family === fam).map((c) => html`
            <tr class="clickable" data-ctrl="${c.id}">
              <td><span class="ctrl-dot ${c.published ? 'pub' : c.planned ? 'plan' : 'gap'}" title="${c.published ? 'Covered by a published policy' : c.planned ? 'Covered only by a draft' : 'Not covered'}"></span></td>
              <td class="mono nowrap">${c.ref}</td><td>${c.title}</td>
              <td><div class="row">${c.themes.split(',').filter(Boolean).slice(0, 3).map((t) => html`<span class="tag">${THEME_LABELS[t] || t}</span>`)}</div></td>
              <td>${c.evidence ? pill(c.evidenceFresh === c.evidence ? 'fresh' : 'stale', `${c.evidenceFresh}/${c.evidence} fresh`) : html`<span class="muted small">None</span>`}</td>
            </tr>`)}`)}
        </tbody></table></div>` : html`<div class="empty"><b>${fw.controls.length ? 'No controls match this filter' : 'No controls yet'}</b>${fw.custom && !fw.controls.length ? 'Use “Add / import controls” to paste your catalogue.' : ''}</div>`}
      </div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  };
  draw();
  const reload = async () => { fws = await GET('/api/frameworks'); state.meta = await GET('/api/meta'); draw(); };

  on(el, 'click', '[data-fw]', (e, c) => { active = c.dataset.fw; filter = 'all'; history.replaceState(null, '', `#/frameworks/${active}`); draw(); });
  on(el, 'click', '[data-filter]', (e, b) => { filter = b.dataset.filter; draw(); });
  on(el, 'click', '[data-ctrl]', (e, tr) => controlDrawer(Number(tr.dataset.ctrl), reload));
  on(el, 'click', '#newfw', () => newFramework(async (c) => { await reload(); active = c; draw(); }));
  on(el, 'click', '#import', () => importControls(fws.find((f) => f.code === active), reload));
  on(el, 'click', '#delfw', async () => {
    const fw = fws.find((f) => f.code === active);
    if (!(await confirmDialog({ title: `Delete ${fw.name}?`, message: 'The framework and its controls will be removed. This is only allowed if no policy maps to them.', confirm: 'Delete', danger: true }))) return;
    try { await DEL(`/api/frameworks/${fw.id}`); toast('Framework deleted.'); active = fws[0].code; await reload(); } catch (err) { fail(err); }
  });
}

export async function controlDrawer(id, reload) {
  const c = await GET(`/api/controls/${id}`).catch(fail);
  if (!c) return;
  modal({
    title: `${c.framework_code} ${c.ref}`, drawer: true,
    body: html`<div class="stack">
      <div><h2>${c.title}</h2><div class="muted">${c.framework_name} · ${c.family}</div></div>
      <div><div class="section-label">Satisfied by policy statements (${c.mappings.length})</div>
        ${c.mappings.length ? c.mappings.map((m) => html`<div class="finding info"><div><a href="#/policies/${m.policy_id}" data-close><b>${m.code} §${m.num}</b></a> ${pill(m.status)}<br><span class="dim">${m.text}</span></div></div>`)
          : html`<div class="notice warn">Gap: no policy statement addresses this control yet.</div>`}</div>
      <div><div class="section-label">Evidence (${c.evidence.length})</div>
        ${c.evidence.map((e) => html`<div class="row small"><span>${e.title}</span><span class="right">${pill(e.fresh ? 'fresh' : 'stale', e.fresh ? `valid to ${fmtDate(e.expires_on)}` : `expired ${fmtDate(e.expires_on)}`)}</span></div>`)}
        ${can.write() ? html`<button class="btn xs mt" data-addev>${icon('plus')} Add evidence</button>` : ''}</div>
      ${c.risks.length ? html`<div><div class="section-label">Mitigates risks</div>${c.risks.map((r) => html`<div class="row small"><span class="tag">${r.code}</span><a href="#/risks" data-close>${r.title}</a><span class="right">${pill(r.residual_level, String(r.residual))}</span></div>`)}</div>` : ''}
      <div><div class="section-label">Crosswalk: related controls in other frameworks</div>
        <div class="muted small">Matched on shared themes: ${c.themes.split(',').filter(Boolean).map((t) => THEME_LABELS[t] || t).join(', ') || 'none'}.</div>
        <div class="pick-list mt">${c.crosswalk.map((x) => html`<div class="pick" data-x="${x.id}"><span></span><span class="ref">${x.framework_code} ${x.ref}</span><span>${x.title}<small>${x.family}</small></span></div>`)}</div></div>
    </div>`,
    onMount: ({ el, close }) => {
      on(el, 'click', '[data-x]', (e, x) => { close(); controlDrawer(Number(x.dataset.x), reload); });
      on(el, 'click', '[data-addev]', () => { close(); evidenceForm(null, async () => { await reload?.(); }, c.id); });
    },
  });
}

function newFramework(done) {
  modal({
    title: 'Custom framework',
    body: html`<form id="ff" class="stack">
      <div class="notice info small">Add internal control sets, customer contractual requirements, or regulations not built in (e.g. DORA, NIS2, CMMC, local data protection laws).</div>
      <div class="form-grid">
        <label class="f"><span>Code</span><input name="code" maxlength="24" required placeholder="e.g. NIS2"></label>
        <label class="f"><span>Version</span><input name="version" maxlength="40" placeholder="e.g. 2022/2555"></label>
        <label class="f full"><span>Name</span><input name="name" maxlength="160" required placeholder="e.g. NIS2 Directive"></label>
        <label class="f full"><span>Description</span><textarea name="description" rows="2" maxlength="1000"></textarea></label>
      </div></form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Create</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-go]', async () => {
      const d = formData($('#ff', el));
      try { await POST('/api/frameworks', d); toast('Framework created. Now add its controls.'); close(); await done(d.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '')); } catch (e) { fail(e); }
    }),
  });
}

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function importControls(fw, done) {
  modal({
    title: `Add controls to ${fw.name}`, wide: true,
    body: html`<div class="stack">
      <p class="dim">Paste one control per line as CSV: <code>ref,title,family,themes</code>. Themes are optional and semicolon-separated (they power crosswalk suggestions). Existing refs are updated.</p>
      <div class="muted small">Themes: ${Object.entries(THEME_LABELS).map(([k, v]) => `${k} (${v})`).join(', ')}</div>
      <textarea id="csv" rows="10" placeholder="Art.21(2)(a),Policies on risk analysis and information system security,Cybersecurity risk-management measures,risk;gov&#10;Art.21(2)(b),Incident handling,Cybersecurity risk-management measures,incident"></textarea>
      <div id="prev" class="muted small"></div></div>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Import</button>`,
    onMount: ({ el, close }) => {
      const parse = () => $('#csv', el).value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^ref\s*,/i.test(l))
        .map((l) => { const [ref, title, family, themes] = parseCsvLine(l); return { ref, title, family: family || 'General', themes: (themes || '').replace(/;/g, ',') }; });
      $('#csv', el).addEventListener('input', () => { const r = parse(); $('#prev', el).textContent = `${r.length} control(s) ready${r.some((x) => !x.ref || !x.title) ? ' · some lines are missing a ref or title' : ''}`; });
      on(el, 'click', '[data-go]', async () => {
        try { const r = await POST(`/api/frameworks/${fw.id}/controls`, { controls: parse() }); toast(`${r.added} added, ${r.updated} updated.`); close(); await done(); } catch (e) { fail(e); }
      });
    },
  });
}
