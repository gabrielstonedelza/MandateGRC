import {
  html, raw, esc, mount, $, $$, on, state, can, GET, POST, PUT, DEL, toast, fail, modal, confirmDialog, formData,
  fmtDate, fmtDateTime, ago, pill, ring, icon, download, todayStr, statusLabel,
} from '../core.js';
import { SECTIONS, reviewPolicy, REVIEW_CATEGORIES, analyzeStatement, applyFix, suggestThemes, THEME_LABELS } from '../lint.js';
import { ctrlLabel, fwName } from './shared.js';

const STATUS_TABS = [['all', 'All'], ['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['published', 'Published'], ['retired', 'Retired']];
const uid = () => Math.random().toString(36).slice(2, 10);
const controlsIndex = () => new Map(state.meta.controls.map((c) => [c.id, c]));

// =====================================================================
// Policy list
// =====================================================================
export async function policiesView(el) {
  const list = await GET('/api/policies');
  if (!can.read()) return employeeList(el, list);
  let tab = 'all', q = '';

  const draw = () => {
    const rows = list.filter((p) => (tab === 'all' || p.status === tab) && (!q || `${p.code} ${p.title} ${p.owner}`.toLowerCase().includes(q)));
    mount($('#tbl', el), rows.length ? html`<div class="table-wrap"><table class="t">
      <thead><tr><th>Policy</th><th>Status</th><th>Version</th><th>Quality</th><th>Frameworks</th><th>Next review</th><th>Attestation</th></tr></thead>
      <tbody>${rows.map((p) => {
        const overdue = p.status === 'published' && p.next_review_date && p.next_review_date < todayStr();
        return html`<tr class="clickable" data-href="#/policies/${p.id}">
          <td class="title-cell"><b>${p.title}</b><small>${p.code} · ${p.owner || 'No owner'} · ${p.statements} statements</small></td>
          <td>${pill(p.status)}</td>
          <td class="mono">${p.version === '0.0' ? '—' : 'v' + p.version}</td>
          <td><div class="row">${ring(p.score, { size: 'sm' })}<span class="small dim">${p.errors ? html`<b class="nowrap" title="Blocking issues">${p.errors} blocking</b><br>` : ''}${p.warnings} warnings</span></div></td>
          <td><div class="row">${p.frameworks.length ? p.frameworks.map((f) => html`<span class="tag">${f}</span>`) : html`<span class="muted small">Unmapped</span>`}</div></td>
          <td>${p.next_review_date ? html`<span class="${overdue ? 's-critical pill' : ''}">${fmtDate(p.next_review_date)}</span>` : html`<span class="muted">—</span>`}</td>
          <td>${p.attestation ? html`<div class="bar" title="${p.attestation.attested}/${p.attestation.total}"><i class="${p.attestation.rate >= 90 ? 'ok' : 'warn'}" data-w="${p.attestation.rate}"></i></div><small class="muted">${p.attestation.rate}% · ${p.attestation.attested}/${p.attestation.total}</small>` : html`<span class="muted">—</span>`}</td>
        </tr>`;
      })}</tbody></table></div>` : html`<div class="empty"><b>No policies here</b>${can.write() ? 'Create one from scratch or start from a template.' : ''}</div>`);
  };

  mount(el, html`
    <div class="page-head">
      <div><h1>Policies</h1><div class="sub">Every policy is built on the eight-part anatomy and scored by the MandateGRC linter. Blocking issues must be cleared before review.</div></div>
      <div class="actions">${can.write() ? html`<a class="btn" href="#/templates">${icon('template')} Template library</a><button class="btn primary" id="new">${icon('plus')} New policy</button>` : ''}</div>
    </div>
    <div class="card" data-tour="policy-table">
      <div class="card-h">
        <div class="tabs compact">${STATUS_TABS.map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l} <span class="muted">${k === 'all' ? list.length : list.filter((p) => p.status === k).length}</span></button>`)}</div>
        <div class="right search"><span>${icon('search')}</span><input id="q" placeholder="Search policies" aria-label="Search policies"></div>
      </div>
      <div id="tbl"></div>
    </div>`);
  draw();
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; $$('[data-tab]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  $('#q', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
  on(el, 'click', 'tr[data-href]', (e, tr) => { location.hash = tr.dataset.href; });
  $('#new', el)?.addEventListener('click', newPolicyDialog);
}

function employeeList(el, list) {
  mount(el, html`<div class="page-head"><div><h1>Policies in force</h1><div class="sub">The policies you are expected to know and follow.</div></div></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Policy</th><th>Version</th><th>Effective</th></tr></thead>
    <tbody>${list.map((p) => html`<tr class="clickable" data-href="#/policies/${p.id}/doc"><td class="title-cell"><b>${p.title}</b><small>${p.code} · ${p.owner}</small></td><td class="mono">v${p.version}</td><td>${fmtDate(p.effective_date)}</td></tr>`)}</tbody></table></div>
    ${!list.length ? html`<div class="empty"><b>No policies published yet</b></div>` : ''}</div>`);
  on(el, 'click', 'tr[data-href]', (e, tr) => { location.hash = tr.dataset.href; });
}

function newPolicyDialog() {
  modal({
    title: 'New policy',
    body: html`<form id="np" class="stack">
      <label class="f"><span>Policy name</span><input name="title" required maxlength="200" placeholder="e.g. Encryption Policy" autofocus></label>
      <div class="notice info">The draft opens with the full anatomy scaffolded: all 8 sections and the four standard roles. To start from proven wording instead, use the <a href="#/templates" data-close>Template library</a>.</div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-create>Create draft</button>`,
    onMount: ({ el, close }) => {
      const go = async (e) => {
        e?.preventDefault();
        const title = $('[name=title]', el).value.trim();
        if (!title) return toast('Give the policy a name.', 'err');
        try { const r = await POST('/api/policies', { title }); close(); location.hash = `#/policies/${r.id}`; } catch (err) { fail(err); }
      };
      on(el, 'click', '[data-create]', go);
      $('#np', el).addEventListener('submit', go);
    },
  });
}

// =====================================================================
// Template library
// =====================================================================
export async function templatesView(el) {
  const t = state.meta.templates;
  mount(el, html`
    <div class="page-head"><div><h1>Template library</h1><div class="sub">Professionally worded policies that already pass the linter: mandatory language, measurable criteria, and statement-level mappings across frameworks. Use one as a starting point, then tailor it to your organization.</div></div></div>
    <div class="grid g3">${t.map((x) => html`<div class="card tpl">
      <h3>${x.title}</h3><div class="dim">${x.summary}</div>
      <div class="row">${x.frameworks.map((f) => html`<span class="tag">${f}</span>`)}</div>
      <div class="row"><span class="muted small">${x.statements} statements · 8/8 sections</span><button class="btn sm primary right" data-use="${x.key}">Use template</button></div>
    </div>`)}</div>`);
  on(el, 'click', '[data-use]', async (e, b) => {
    b.disabled = true;
    try { const r = await POST('/api/policies', { template: b.dataset.use }); toast('Draft created from template.'); location.hash = `#/policies/${r.id}`; } catch (err) { fail(err); b.disabled = false; }
  });
}

// =====================================================================
// Policy editor: the anatomy, live lint, workflow
// =====================================================================
export async function policyEditorView(el, id) {
  let p = await GET(`/api/policies/${id}`);
  let saved = '';
  const editable = () => can.write() && p.status === 'draft';
  const content = () => ({
    title: p.title, owner: p.owner, classification: p.classification, effective_date: p.effective_date || '',
    review_cycle_months: p.review_cycle_months, purpose: p.purpose, scope: p.scope, statements: p.statements,
    roles: p.roles, enforcement: p.enforcement, ref_controls: p.ref_controls, related_docs: p.related_docs || '',
  });
  const snapshotSaved = () => { saved = JSON.stringify(content()); };
  const dirty = () => editable() && JSON.stringify(content()) !== saved;
  snapshotSaved();

  const ro = () => (editable() ? '' : raw('readonly'));
  const dis = () => (editable() ? '' : raw('disabled'));

  // ---------- Layout ----------
  function drawAll() {
    mount(el, html`
      <div class="page-head">
        <div>
          <div class="row"><span class="tag gold">${p.code}</span>${pill(p.status)}<span class="muted mono">${p.version === '0.0' ? 'Unversioned draft' : (p.status === 'draft' || p.status === 'in_review' ? `Revising v${p.version}` : `v${p.version}`)}</span></div>
          <h1 id="h-title">${p.title}</h1>
        </div>
        <div class="actions">
          <a class="btn" href="#/policies/${p.id}/doc">${icon('doc')} Document view</a>
          <button class="btn" id="export">${icon('download')} Export</button>
          ${editable() ? html`<button class="btn primary" id="save" disabled>Saved</button>` : ''}
        </div>
      </div>
      <div class="card" id="workflow"></div>
      <div class="editor">
        <aside class="card anatomy" id="anatomy"></aside>
        <div class="stack editor-main"><section class="card review" id="review"></section><div class="stack" id="sections"></div></div>
        <aside class="card lint" id="lint"></aside>
      </div>`);
    drawWorkflow();
    drawSections();
    refreshLint();
  }

  function drawWorkflow() {
    const steps = ['draft', 'in_review', 'approved', 'published'];
    const idx = steps.indexOf(p.status);
    const me = state.me.id;
    const sod = p.status === 'in_review' && (p.submitted_by === me || p.updated_by === me);
    mount($('#workflow', el), html`<div class="wf">
      <div class="wf-steps">${steps.map((s, i) => html`${i ? html`<i></i>` : ''}<span class="${s === p.status ? 'on' : i < idx ? 'done' : ''}">${statusLabel(s)}</span>`)}${p.status === 'retired' ? html`<i></i><span class="on">Retired</span>` : ''}</div>
      <div class="row right">
        ${p.status === 'draft' && can.write() ? html`
          ${p.version === '0.0' ? html`<button class="btn danger sm" data-act="delete">${icon('trash')} Delete draft</button>` : ''}
          <button class="btn primary sm" data-act="submit">Submit for review</button>` : ''}
        ${p.status === 'in_review' && can.approve() ? html`
          <button class="btn sm" data-act="reject">Return for rework</button>
          <button class="btn ok sm" data-act="approve" ${sod ? raw('disabled title="Separation of duties"') : ''}>${icon('check')} Approve</button>` : ''}
        ${p.status === 'approved' && can.steward() ? html`<button class="btn primary sm" data-act="publish">Publish</button>` : ''}
        ${['approved', 'published'].includes(p.status) && can.write() ? html`<button class="btn sm" data-act="revise">Revise</button>` : ''}
        ${['approved', 'published'].includes(p.status) && can.steward() ? html`<button class="btn danger sm" data-act="retire">Retire</button>` : ''}
      </div>
    </div>
    ${p.review_note && p.status === 'draft' ? html`<div class="card-b"><div class="notice warn"><b>Returned for rework:</b>&nbsp;${p.review_note}</div></div>` : ''}
    ${p.status === 'in_review' ? html`<div class="card-b"><div class="notice info">Submitted by <b>&nbsp;${p.submitted_by_name || 'unknown'}&nbsp;</b> as a <b>&nbsp;${p.pending_change_type}&nbsp;</b> change: “${p.pending_change_summary}”${sod ? html`<br>Separation of duties: you authored or submitted this policy, so a different approver must approve it.` : ''}</div></div>` : ''}
    ${['draft', 'in_review', 'approved'].includes(p.status) && p.published_version ? html`<div class="card-b"><div class="notice info">v${p.published_version} stays in force for employees until this revision is approved and published.</div></div>` : ''}
    ${p.status === 'published' && p.attestation ? html`<div class="card-b row small"><span class="dim">Acknowledged by ${p.attestation.attested} of ${p.attestation.total} active users</span><div class="bar right" title="${p.attestation.rate}%"><i class="ok" data-w="${p.attestation.rate}"></i></div><b>${p.attestation.rate}%</b>${!p.attested_at ? html`<button class="btn xs" data-act="attest">Acknowledge</button>` : ''}</div>` : ''}`);
  }

  function sectionCard(key, body, extraHead = '') {
    const s = SECTIONS.find((x) => x.key === key);
    return html`<section class="card sec" id="sec-${key}">
      <div class="card-h"><h2><span class="num">${s.n}</span>${s.title}</h2><span class="hint">${s.hint}</span>${extraHead ? html`<div class="right">${extraHead}</div>` : ''}</div>
      ${body}</section>`;
  }

  function drawSections() {
    const cmap = controlsIndex();
    const nextReview = p.effective_date ? addMonthsLocal(p.effective_date, p.review_cycle_months) : '';
    const refGroups = groupRefs(p, cmap);
    mount($('#sections', el), html`
      ${sectionCard('header', html`<div class="card-b form-grid">
        <label class="f full"><span>Policy name</span><input data-f="title" value="${p.title}" maxlength="200" ${ro()}></label>
        <label class="f"><span>Policy owner <em>(accountable role or person)</em></span><input data-f="owner" value="${p.owner}" maxlength="200" placeholder="e.g. Chief Information Security Officer" ${ro()}></label>
        <label class="f"><span>Classification</span><select data-f="classification" ${dis()}>${['Public', 'Internal', 'Confidential', 'Restricted'].map((c) => html`<option ${c === p.classification ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="f"><span>Effective date</span><input type="date" data-f="effective_date" value="${p.effective_date || ''}" ${ro()}></label>
        <label class="f"><span>Review cycle</span><select data-f="review_cycle_months" ${dis()}>${[3, 6, 12, 18, 24, 36].map((m) => html`<option value="${m}" ${m === Number(p.review_cycle_months) ? 'selected' : ''}>${m === 12 ? 'Annually (12 months)' : `${m} months`}</option>`)}</select></label>
        <label class="f"><span>Version</span><input value="${p.version === '0.0' ? 'Assigned at approval (v1.0)' : 'v' + p.version}" readonly></label>
        <label class="f"><span>Next review</span><input value="${nextReview ? fmtDate(nextReview) : 'Set an effective date'}" readonly id="next-review"></label>
        <label class="f full"><span>Approval</span><input value="${p.approved_at ? `Approved by ${p.approved_by_name || 'unknown'} on ${fmtDateTime(p.approved_at)}` : 'Pending. Recorded automatically when an approver signs off.'}" readonly></label>
      </div>`)}

      ${sectionCard('purpose', html`<div class="card-b"><textarea data-f="purpose" rows="4" maxlength="5000" placeholder="This policy establishes … in order to …" ${ro()}>${p.purpose}</textarea><div class="small muted mt" id="purpose-meta"></div></div>`)}

      ${sectionCard('scope', html`<div class="card-b"><textarea data-f="scope" rows="3" maxlength="5000" placeholder="This policy applies to all employees, contractors and third parties, and to all systems …" ${ro()}>${p.scope}</textarea></div>`)}

      ${sectionCard('statements', html`<ol class="stmts">${p.statements.map((s, i) => html`<li class="stmt" id="st-${s.id}">
          <div class="sn">4.${i + 1}</div>
          <div>
            <textarea data-stmt="${s.id}" rows="2" maxlength="2000" placeholder="[Who] must [do what] [by when / how often]." ${ro()}>${s.text}</textarea>
            <div class="chips">${(s.controls || []).map((cid) => { const c = cmap.get(cid); return c ? html`<span class="chip" title="${c.title}"><b>${c.framework_code}</b> ${c.ref}${editable() ? html`<button data-unmap="${s.id}:${cid}" aria-label="Remove mapping">×</button>` : ''}</span>` : ''; })}
              ${editable() ? html`<button class="btn xs" data-map="${s.id}">${icon('link')} Map controls</button>` : ''}</div>
            <div class="findings" data-findings="${s.id}"></div>
          </div>
          <div class="tools">${editable() ? html`
            <button class="icon-btn" data-move="${s.id}:-1" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button class="icon-btn" data-move="${s.id}:1" title="Move down" ${i === p.statements.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button class="icon-btn" data-del-stmt="${s.id}" title="Delete statement">${icon('trash')}</button>` : ''}</div>
        </li>`)}</ol>
        ${editable() ? html`<div class="card-b"><button class="btn sm" id="add-stmt">${icon('plus')} Add statement</button></div>` : ''}`,
        html`<span class="muted small">${p.statements.length} statements</span>`)}

      ${sectionCard('roles', html`<div>${p.roles.map((r, i) => html`<div class="role-row">
          <input data-role="${i}" data-k="role" value="${r.role}" maxlength="120" placeholder="Role" ${ro()}>
          <textarea data-role="${i}" data-k="responsibility" rows="2" maxlength="1000" placeholder="Responsibilities, written as must/shall" ${ro()}>${r.responsibility}</textarea>
          ${editable() ? html`<button class="icon-btn" data-del-role="${i}" title="Remove role">${icon('trash')}</button>` : html`<span></span>`}
        </div>`)}</div>
        ${editable() ? html`<div class="card-b row"><button class="btn sm" id="add-role">${icon('plus')} Add role</button><button class="btn sm ghost" id="std-roles">Add missing standard roles</button></div>` : ''}`)}

      ${sectionCard('enforcement', html`<div class="card-b"><textarea data-f="enforcement" rows="5" maxlength="5000" placeholder="Describe how compliance is verified, consequences of violation, and the exception process." ${ro()}>${p.enforcement}</textarea>
        ${editable() && !p.enforcement ? html`<button class="btn sm mt" id="std-enf">${icon('wand')} Insert standard enforcement clause</button>` : ''}</div>`)}

      ${sectionCard('references', html`<div class="card-b stack">
        ${refGroups.length ? refGroups.map((g) => html`<div><div class="section-label">${fwName(g.code)}</div><div class="chips">${g.items.map((it) => html`<span class="chip" title="${it.c.title}${it.via.length ? ' · mapped by ' + it.via.join(', ') : ' · policy-level reference'}"><b>${it.c.ref}</b> ${it.c.title}${!it.via.length && editable() ? html`<button data-unref="${it.c.id}" aria-label="Remove">×</button>` : ''}</span>`)}</div></div>`)
          : html`<div class="notice warn">No framework references yet. Map statements to controls (section 4) or add policy-level references. Mapping is what makes a policy GRC-grade.</div>`}
        ${editable() ? html`<div><button class="btn sm" id="add-ref">${icon('link')} Add policy-level reference</button></div>` : ''}
        <label class="f"><span>Related documents <em>(standards, procedures, guidelines)</em></span><textarea data-f="related_docs" rows="2" maxlength="2000" placeholder="e.g. STD-012 Password Standard; PRC-004 User Access Review Procedure" ${ro()}>${p.related_docs || ''}</textarea></label>
      </div>`)}

      ${sectionCard('history', html`<div class="table-wrap"><table class="t"><thead><tr><th>Version</th><th>Date</th><th>Change</th><th>Summary</th><th>Author</th><th>Approved by</th><th></th></tr></thead><tbody>
        ${p.status !== 'published' && p.status !== 'approved' && p.status !== 'retired' ? html`<tr><td class="mono">${p.version === '0.0' ? '1.0' : 'next'} <span class="muted">(pending)</span></td><td>${ago(p.updated_at)}</td><td>${p.pending_change_type || '—'}</td><td class="dim">${p.pending_change_summary || 'Work in progress'}</td><td>${p.updated_by_name || '—'}</td><td>—</td><td>${p.revisions.length ? html`<button class="btn xs" data-diff-current="${p.revisions[0].id}">${icon('diff')} Diff vs v${p.revisions[0].version}</button>` : ''}</td></tr>` : ''}
        ${p.revisions.map((r, i) => html`<tr><td class="mono">v${r.version}</td><td>${fmtDate(r.created_at)}</td><td>${pill(r.change_type === 'major' ? 'high' : 'info', r.change_type)}</td><td>${r.change_summary}</td><td>${r.author || '—'}</td><td>${r.approver || '—'}</td>
          <td class="nowrap"><button class="btn xs" data-view-rev="${r.id}">View</button>${p.revisions[i + 1] ? html` <button class="btn xs" data-diff="${p.revisions[i + 1].id}:${r.id}">Diff vs v${p.revisions[i + 1].version}</button>` : ''}</td></tr>`)}
      </tbody></table></div>${!p.revisions.length ? html`<div class="card-b muted small">No approved versions yet. The first approval records v1.0 here with the approver's name and a full snapshot.</div>` : ''}`)}

      ${(p.exceptions.length || p.risks.length) ? html`<section class="card"><div class="card-h"><h2>Linked risks & exceptions</h2></div><div class="card-b stack">
        ${p.risks.map((r) => html`<div class="row"><span class="tag">${r.code}</span><a href="#/risks">${r.title}</a><span class="muted small right">Residual ${r.residual} · ${r.status}</span></div>`)}
        ${p.exceptions.map((x) => html`<div class="row"><span class="tag">${x.code}</span><a href="#/exceptions">${x.title}</a><span class="right">${pill(x.status)}</span><span class="muted small">to ${fmtDate(x.expires_at)}</span></div>`)}
      </div></section>` : ''}
    `);
  }

  // ---------- Lint (runs on every keystroke, no server round-trip) ----------
  let lastReview = null;
  const openCats = new Set();
  function refreshLint() {
    const rv = reviewPolicy({ ...p, approved_at: p.approved_at }, { controlsById: controlsIndex(), today: todayStr(), peers: p.peers || [] });
    lastReview = rv;
    const l = rv.lint;
    drawReview(rv);
    const counts = (k) => l.sections[k];
    mount($('#anatomy', el), html`
      <div class="score">${ring(l.score, { size: 'sm' })}<div class="g"><b>Grade ${l.grade}</b><br>${l.errors} blocking · ${l.warnings} warnings<br><span class="muted">${l.stats.mapped} controls · ${l.stats.frameworks} frameworks</span></div></div>
      <ol>${SECTIONS.map((s) => { const c = counts(s.key); const cls = c.errors ? 'err' : c.warnings ? 'warn' : 'ok'; return html`<li><a href="#sec-${s.key}" data-jump="sec-${s.key}"><span class="n ${cls}">${c.errors || c.warnings ? s.n : '✓'}</span>${s.title}</a></li>`; })}</ol>`);
    mount($('#lint', el), html`
      <div class="card-h"><h3>Policy linter</h3><span class="right small ${l.errors ? '' : 'muted'}">${l.errors ? html`<span class="pill s-error">${l.errors} blocking</span>` : (l.warnings ? html`<span class="pill s-medium">No blocking issues</span>` : html`<span class="pill s-ok">${p.status === 'draft' ? 'Ready for review' : 'Passes all rules'}</span>`)}</span></div>
      <div class="list">${l.issues.length ? l.issues.map((i) => html`<button class="item ${i.severity}" data-goto="${i.statementId ? 'st-' + i.statementId : 'sec-' + i.section}">${i.message}${i.tip ? html`<small>${i.tip}</small>` : ''}</button>`) : html`<div class="empty"><b>Clean</b>This policy follows every rule.</div>`}</div>
      <div class="rules"><b>Golden rules</b><br>1. Use “must” and “shall”, never “should” or “we try to”.<br>2. Keep statements specific and measurable.<br>3. Map each policy to a framework.</div>`);
    // Per-statement findings with one-click fixes.
    p.statements.forEach((s) => {
      const box = el.querySelector(`[data-findings="${s.id}"]`);
      if (!box) return;
      const f = s.text ? analyzeStatement(s.text) : [];
      if (s.text && !(s.controls || []).length) f.push({ severity: 'warning', message: 'Not mapped to any framework control.', tip: 'Use “Map controls” to link it to ISO 27001, NIST, SOC 2 …' });
      mount(box, html`${f.map((x, k) => html`<div class="finding ${x.severity}"><div><b>${x.message}</b> <span class="tip">${x.tip || ''}</span></div>${x.fix && editable() ? html`<button class="btn xs" data-fix="${s.id}:${k}">Fix: “${x.fix.to}”</button>` : ''}</div>`)}`);
      box._findings = f;
    });
    const words = (p.purpose || '').trim().split(/\s+/).filter(Boolean).length;
    const pm = $('#purpose-meta', el);
    if (pm) pm.textContent = `${words} words · ${(p.purpose || '').split(/\n\s*\n/).filter((x) => x.trim()).length || 0} paragraph(s). Aim for one paragraph that explains why.`;
    const save = $('#save', el);
    if (save) { const d = dirty(); save.disabled = !d; save.textContent = d ? 'Save changes' : 'Saved'; }
  }

  function drawReview(rv) {
    const box = $('#review', el);
    if (!box) return;
    if (!openCats.size && !box.dataset.init) {
      box.dataset.init = '1';
      rv.checklist.forEach((c) => { if (c.pass === false) openCats.add(c.cat); });
    }
    mount(box, reviewCard(rv, { editable: editable(), openCats }));
  }
  el.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches?.('details[data-cat]')) d.open ? openCats.add(d.dataset.cat) : openCats.delete(d.dataset.cat);
  }, true);
  on(el, 'click', '[data-insert]', (e, b) => {
    const r = lastReview?.requirements.find((x) => x.id === b.dataset.insert);
    if (!r || !editable()) return;
    const st = { id: uid(), text: r.suggest, controls: r.controlIds || [] };
    p.statements.push(st);
    restructure();
    toast(`Added statement 4.${p.statements.length}. Tailor the numbers to your organization.`);
    document.getElementById(`st-${st.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- Persistence ----------
  async function save() {
    if (!dirty()) return true;
    try {
      p = await PUT(`/api/policies/${p.id}`, { ...content(), updated_at: p.updated_at });
      snapshotSaved();
      toast('Policy saved.');
      $('#h-title', el).textContent = p.title;
      refreshLint();
      return true;
    } catch (e) { fail(e); return false; }
  }
  async function reload() { p = await GET(`/api/policies/${p.id}`); snapshotSaved(); drawAll(); }

  // ---------- Events ----------
  drawAll();

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (!editable()) return;
    if (t.dataset.f) {
      p[t.dataset.f] = t.dataset.f === 'review_cycle_months' ? Number(t.value) : t.value;
      if (t.dataset.f === 'effective_date' || t.dataset.f === 'review_cycle_months') {
        const nr = $('#next-review', el);
        if (nr) nr.value = p.effective_date ? fmtDate(addMonthsLocal(p.effective_date, p.review_cycle_months)) : 'Set an effective date';
      }
    } else if (t.dataset.stmt) {
      const s = p.statements.find((x) => x.id === t.dataset.stmt);
      if (s) s.text = t.value;
    } else if (t.dataset.role) {
      p.roles[Number(t.dataset.role)][t.dataset.k] = t.value;
    }
    refreshLint();
  });
  el.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

  const restructure = () => { drawSections(); refreshLint(); };
  on(el, 'click', '#add-stmt', () => {
    const s = { id: uid(), text: '', controls: [] };
    p.statements.push(s);
    restructure();
    el.querySelector(`[data-stmt="${s.id}"]`)?.focus();
  });
  on(el, 'click', '[data-del-stmt]', async (e, b) => {
    const s = p.statements.find((x) => x.id === b.dataset.delStmt);
    if (s.text && !(await confirmDialog({ title: 'Delete statement?', message: s.text.slice(0, 200), confirm: 'Delete', danger: true }))) return;
    p.statements = p.statements.filter((x) => x.id !== s.id);
    restructure();
  });
  on(el, 'click', '[data-move]', (e, b) => {
    const [sid, dir] = b.dataset.move.split(':');
    const i = p.statements.findIndex((x) => x.id === sid), j = i + Number(dir);
    if (j < 0 || j >= p.statements.length) return;
    [p.statements[i], p.statements[j]] = [p.statements[j], p.statements[i]];
    restructure();
  });
  on(el, 'click', '[data-unmap]', (e, b) => {
    const [sid, cid] = b.dataset.unmap.split(':');
    const s = p.statements.find((x) => x.id === sid);
    s.controls = s.controls.filter((c) => c !== Number(cid));
    restructure();
  });
  on(el, 'click', '[data-map]', (e, b) => {
    const s = p.statements.find((x) => x.id === b.dataset.map);
    controlPicker({ text: s.text, selected: s.controls, title: `Map statement 4.${p.statements.indexOf(s) + 1}`, onSave: (ids) => { s.controls = ids; restructure(); } });
  });
  on(el, 'click', '#add-ref', () => {
    const text = [p.title, p.purpose, p.scope].join(' ');
    controlPicker({ text, selected: p.ref_controls, title: 'Policy-level references', onSave: (ids) => { p.ref_controls = ids; restructure(); } });
  });
  on(el, 'click', '[data-unref]', (e, b) => { p.ref_controls = p.ref_controls.filter((c) => c !== Number(b.dataset.unref)); restructure(); });
  on(el, 'click', '[data-fix]', (e, b) => {
    const [sid, k] = b.dataset.fix.split(':');
    const box = el.querySelector(`[data-findings="${sid}"]`);
    const f = box._findings[Number(k)];
    const s = p.statements.find((x) => x.id === sid);
    s.text = applyFix(s.text, f.fix);
    const ta = el.querySelector(`[data-stmt="${sid}"]`);
    if (ta) ta.value = s.text;
    refreshLint();
  });
  on(el, 'click', '#add-role', () => { p.roles.push({ role: '', responsibility: '' }); restructure(); });
  on(el, 'click', '[data-del-role]', (e, b) => { p.roles.splice(Number(b.dataset.delRole), 1); restructure(); });
  on(el, 'click', '#std-roles', () => {
    const std = [
      ['Policy Owner', /owner/i, 'Owns this policy, approves changes and ensures it is reviewed at least annually.'],
      ['Custodian', /custodian|administrator|operations|\bIT\b/i, 'Implements and operates the technical and procedural controls required by this policy.'],
      ['Users', /user|personnel|employee|staff/i, 'All in-scope personnel must read, acknowledge and comply with this policy, and must report violations.'],
      ['Management', /manage|leadership|executive/i, 'Managers must ensure their teams comply with this policy and complete required acknowledgements.'],
    ];
    std.forEach(([role, re, resp]) => { if (!p.roles.some((r) => re.test(r.role))) p.roles.push({ role, responsibility: resp }); });
    restructure();
  });
  on(el, 'click', '#std-enf', () => {
    p.enforcement = `Compliance with the ${p.title} shall be verified through quarterly control testing, internal audit and continuous monitoring. `
      + 'Any violation must be reported to the Information Security Office within 24 hours of discovery. Personnel found in violation shall be subject to disciplinary action up to and including termination of employment or contract. '
      + 'Deviations from this policy must be requested through the formal Policy Exception process and approved before the deviation occurs.';
    restructure();
  });
  on(el, 'click', '[data-jump],[data-goto]', (e, b) => {
    e.preventDefault();
    const target = document.getElementById(b.dataset.jump || b.dataset.goto);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.querySelector('textarea,input')?.focus({ preventScroll: true });
  });
  on(el, 'click', '#save', save);
  const keyHandler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && document.body.contains(el) && editable()) { e.preventDefault(); save(); } };
  document.addEventListener('keydown', keyHandler);

  on(el, 'click', '#export', () => exportDialog(p));
  on(el, 'click', '[data-view-rev]', async (e, b) => {
    const r = await GET(`/api/policies/${p.id}/revisions/${b.dataset.viewRev}`).catch(fail);
    if (!r) return;
    modal({ title: `${p.code} v${r.version}, approved snapshot`, wide: true, body: html`<div class="doc">${docBody({ ...p, ...r.snapshot, status: 'published', revisions: [] }, { compact: true })}</div>` });
  });
  on(el, 'click', '[data-diff]', async (e, b) => {
    const [a, c] = b.dataset.diff.split(':');
    const [ra, rc] = await Promise.all([GET(`/api/policies/${p.id}/revisions/${a}`), GET(`/api/policies/${p.id}/revisions/${c}`)]).catch((x) => { fail(x); return []; });
    if (ra) diffDialog(`v${ra.version}`, ra.snapshot, `v${rc.version}`, rc.snapshot);
  });
  on(el, 'click', '[data-diff-current]', async (e, b) => {
    const r = await GET(`/api/policies/${p.id}/revisions/${b.dataset.diffCurrent}`).catch(fail);
    if (r) diffDialog(`v${r.version}`, r.snapshot, 'Working draft', content());
  });

  // ---------- Workflow actions ----------
  on(el, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    try {
      if (act === 'submit') {
        if (!(await save())) return;
        const rv = reviewPolicy(p, { controlsById: controlsIndex(), today: todayStr(), peers: p.peers || [] });
        if (rv.lint.errors) { toast(`The review says "Not ready": resolve ${rv.lint.errors} blocking issue(s) first. See the Review report and linter.`, 'err'); return; }
        submitDialog(p, reload);
      } else if (act === 'approve') {
        approveDialog(p, reviewPolicy(p, { controlsById: controlsIndex(), today: todayStr(), peers: p.peers || [] }), reload);
      } else if (act === 'reject') {
        const note = await confirmDialog({ title: 'Return for rework', message: 'The policy goes back to draft. Tell the author what to change.', confirm: 'Return to author', input: { label: 'Reason', required: true } });
        if (!note) return;
        await POST(`/api/policies/${p.id}/reject`, { note }); toast('Returned to author.'); await reload();
      } else if (act === 'publish') {
        publishDialog(p, reload);
      } else if (act === 'revise') {
        if (!(await confirmDialog({ title: 'Start a revision?', message: `The policy returns to draft for editing. ${p.published_version ? `v${p.published_version} stays in force until the revision is approved and published.` : 'It has not been published yet.'}`, confirm: 'Start revision' }))) return;
        await POST(`/api/policies/${p.id}/revise`); await reload();
      } else if (act === 'retire') {
        const note = await confirmDialog({ title: `Retire ${p.code}?`, message: 'Retired policies are kept for the record but no longer apply and are removed from coverage.', confirm: 'Retire policy', danger: true, input: { label: 'Reason', required: true } });
        if (!note) return;
        await POST(`/api/policies/${p.id}/retire`, { note }); toast('Policy retired.'); await reload();
      } else if (act === 'delete') {
        if (!(await confirmDialog({ title: 'Delete this draft?', message: 'This draft has never been approved, so it can be deleted. The deletion is recorded in the audit trail.', confirm: 'Delete', danger: true }))) return;
        snapshotSaved();
        await DEL(`/api/policies/${p.id}`); toast('Draft deleted.'); location.hash = '#/policies';
      } else if (act === 'attest') {
        await POST(`/api/policies/${p.id}/attest`); toast('Acknowledged.'); window.dispatchEvent(new Event('mandate:badges')); await reload();
      }
    } catch (err) { fail(err); }
  });

  return {
    dirty,
    leave: () => {
      if (dirty() && !window.confirm('You have unsaved changes to this policy. Leave without saving?')) return false;
      document.removeEventListener('keydown', keyHandler);
      return true;
    },
  };
}

// =====================================================================
// Review report rendering (editor card, approve dialog, document appendix)
// =====================================================================
const aTypeName = (n) => `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;
const VERDICT_PILL = { ready: 'ok', needs_work: 'medium', not_ready: 'critical' };
const CAT_LABEL = Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c.key, c.label]));

function scoreBars(rv) {
  return html`<div class="rv-scores">${REVIEW_CATEGORIES.map((c) => {
    const v = rv.scores[c.key];
    return html`<div class="rv-score"><span>${c.label}</span><div class="bar"><i class="${v == null ? '' : v >= 85 ? 'ok' : v >= 60 ? 'warn' : 'bad'}" data-w="${v ?? 0}"></i></div><b>${v == null ? 'n/a' : v}</b></div>`;
  })}</div>`;
}

export function reviewCard(rv, { editable = false, openCats = new Set() } = {}) {
  const byCat = (cat) => rv.checklist.filter((c) => c.cat === cat);
  const mark = (pass) => (pass === true ? html`<span class="rv-mark ok">✓</span>` : pass === false ? html`<span class="rv-mark bad">✕</span>` : html`<span class="rv-mark na">–</span>`);
  return html`
    <div class="card-h"><h2>${icon('audit')} Review report</h2>
      <span class="right row">${pill(VERDICT_PILL[rv.verdict], rv.verdictLabel)}<b class="rv-overall" title="Overall review score">${rv.overall}</b></span></div>
    <div class="card-b">
      <div class="rv-top">
        <div class="rv-type">${rv.type ? html`Checked as <b>${rv.type.name}</b> policy · ${rv.requirements.filter((r) => r.met).length}/${rv.requirements.length} must-have topics covered`
          : html`Policy type not recognised, so coverage isn't assessed. Name it like "Access Control Policy" to get a checklist.`}</div>
        ${scoreBars(rv)}
      </div>
      ${REVIEW_CATEGORIES.map((c) => {
        const items = byCat(c.key);
        const fails = items.filter((i) => i.pass === false).length;
        return html`<details class="rv-cat" data-cat="${c.key}" ${openCats.has(c.key) ? 'open' : ''}>
          <summary><b>${c.label}</b><span class="muted small">${items.length ? `${items.filter((i) => i.pass === true).length}/${items.filter((i) => i.pass !== null).length} passed` : ''}</span>${fails ? html`<span class="pill s-high plain">${fails} to fix</span>` : ''}</summary>
          <ul class="rv-list">${items.map((it) => {
            const req = c.key === 'coverage' && it.pass === false ? rv.requirements.find((r) => r.topic === it.label) : null;
            return html`<li class="${it.pass === false ? 'fail' : ''}">${mark(it.pass)}<div><span>${it.label}</span>${it.detail ? html`<small>${it.detail}</small>` : ''}
              ${req ? html`<div class="rv-suggest"><i>“${req.suggest}”</i>${editable ? html`<button class="btn xs" data-insert="${req.id}">${icon('plus')} Insert suggested statement</button>` : ''}</div>` : ''}</div></li>`;
          })}</ul></details>`;
      })}
      <div class="muted small rv-foot">${icon('lock')} Rule-based review against published baselines (PCI DSS, NIST, ISO/IEC 27001, GDPR, CIS). It runs in your browser and on your MandateGRC server only: no AI, no third parties.</div>
    </div>`;
}

function approveDialog(p, rv, done) {
  const gaps = rv.gaps;
  modal({
    title: `Approve ${p.code}?`, wide: true,
    body: html`<div class="stack">
      <div class="row">${pill(VERDICT_PILL[rv.verdict], rv.verdictLabel)}<span class="dim">Overall review score <b>${rv.overall}</b>/100${rv.type ? ` · checked as ${aTypeName(rv.type.name)} policy` : ''}</span></div>
      ${scoreBars(rv)}
      ${rv.metrics.filter((m) => !m.pass).length ? html`<div class="notice warn small"><div><b>Weaker than baseline:</b> ${rv.metrics.filter((m) => !m.pass).map((m) => `${m.num} ${m.metric} (${m.shown} vs ${m.baseline})`).join('; ')}</div></div>` : ''}
      ${gaps.length ? html`<div class="notice bad small"><div><b>${gaps.length} unresolved coverage gap${gaps.length === 1 ? '' : 's'}</b>. This policy does not address:
          <ul class="rv-gaps">${gaps.map((g) => html`<li>${g.topic}</li>`)}</ul></div></div>
        <label class="row rv-ack"><input type="checkbox" id="ack-gaps"> I have reviewed these gaps and accept them for this version (recorded in the audit trail).</label>` : html`<div class="notice good small">${icon('check')} Covers every must-have topic for its policy type.</div>`}
      <label class="f"><span>Approval note (optional)</span><textarea id="ap-note" maxlength="1000" rows="3" placeholder="e.g. Reviewed against the Q4 access audit findings."></textarea></label>
      <div class="muted small">Your approval is recorded in the revision history and the tamper-evident audit trail. The version number is assigned automatically.</div>
    </div>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn ok" data-go ${gaps.length ? raw('disabled') : ''}>${icon('check')} Approve</button>`,
    onMount: ({ el, close }) => {
      const go = $('[data-go]', el);
      $('#ack-gaps', el)?.addEventListener('change', (e) => { go.disabled = !e.target.checked; });
      on(el, 'click', '[data-go]', async () => {
        try {
          const r = await POST(`/api/policies/${p.id}/approve`, { note: $('#ap-note', el).value.trim(), acknowledge_gaps: gaps.length ? $('#ack-gaps', el).checked : false });
          close(); toast(`Approved as v${r.version}.`); await done();
        } catch (e) { fail(e); }
      });
    },
  });
}

function reviewForDoc(p) {
  if (!can.read() || !state.meta.controls.length) return null;
  return reviewPolicy(p, { controlsById: controlsIndex(), today: todayStr(), peers: p.peers || [] });
}

function submitDialog(p, done) {
  const first = p.version === '0.0';
  modal({
    title: `Submit ${p.code} for review`,
    body: html`<form class="stack" id="sf">
      ${first ? html`<div class="notice info">This is the first release. It will be approved as <b>&nbsp;v1.0</b>.</div>` : html`
        <label class="f"><span>Change type</span><select name="change_type">
          <option value="minor">Minor (clarification, wording, mapping): v${p.version} → v${bump(p.version, 'minor')}</option>
          <option value="major">Major (new or changed requirements): v${p.version} → v${bump(p.version, 'major')}</option></select></label>`}
      <label class="f"><span>Change summary <em>(appears in the revision history)</em></span><textarea name="change_summary" required minlength="10" maxlength="1000" placeholder="e.g. Added MFA requirement for privileged access; mapped to ISO 27001 8.5."></textarea></label>
      <div class="muted small">An approver other than you must sign off (separation of duties).</div>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Submit</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-go]', async () => {
      const d = formData($('#sf', el));
      try { await POST(`/api/policies/${p.id}/submit`, d); close(); toast('Submitted for review.'); await done(); } catch (e) { fail(e); }
    }),
  });
}

function publishDialog(p, done) {
  modal({
    title: `Publish ${p.code} v${p.version}`,
    body: html`<div class="stack"><p class="dim">Publishing puts the policy in force, opens attestation for all active users and schedules the next review.</p>
      <label class="f"><span>Effective date</span><input type="date" name="eff" value="${p.effective_date || todayStr()}"></label></div>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Publish</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-go]', async () => {
      try { await POST(`/api/policies/${p.id}/publish`, { effective_date: $('[name=eff]', el).value }); close(); toast('Published. Attestation is open.'); await done(); } catch (e) { fail(e); }
    }),
  });
}

function bump(v, type) {
  const [a, b] = v.split('.').map(Number);
  return type === 'major' ? `${a + 1}.0` : `${a}.${b + 1}`;
}
function addMonthsLocal(dateStr, m) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Number(m));
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function groupRefs(p, cmap) {
  const byId = new Map();
  p.statements.forEach((s, i) => (s.controls || []).forEach((cid) => {
    if (!byId.has(cid)) byId.set(cid, []);
    byId.get(cid).push(`4.${i + 1}`);
  }));
  (p.ref_controls || []).forEach((cid) => { if (!byId.has(cid)) byId.set(cid, []); });
  const groups = new Map();
  for (const [cid, via] of byId) {
    const c = cmap.get(cid);
    if (!c) continue;
    if (!groups.has(c.framework_code)) groups.set(c.framework_code, []);
    groups.get(c.framework_code).push({ c, via });
  }
  const order = state.meta.frameworks.map((f) => f.code);
  return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([code, items]) => ({ code, items: items.sort((a, b) => a.c.id - b.c.id) }));
}

// =====================================================================
// Control picker with crosswalk suggestions
// =====================================================================
export function controlPicker({ text = '', selected = [], title, onSave }) {
  const sel = new Set(selected);
  const all = state.meta.controls;
  let fw = 'suggested', q = '';
  const themesFromText = suggestThemes(text);
  const themesFromSel = new Set([...sel].flatMap((id) => (all.find((c) => c.id === id)?.themes || '').split(',').filter(Boolean)));
  const wanted = new Set([...themesFromText, ...themesFromSel]);
  const suggested = all.filter((c) => !sel.has(c.id) && c.themes.split(',').some((t) => wanted.has(t)))
    .map((c) => ({ c, score: c.themes.split(',').filter((t) => wanted.has(t)).length + (themesFromText.some((t) => c.themes.split(',')[0] === t) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 40).map((x) => x.c);

  modal({
    title, wide: true,
    body: html`<div class="stack">
      ${text ? html`<div class="notice info small">Detected themes: ${themesFromText.length ? themesFromText.map((t) => THEME_LABELS[t]).join(', ') : 'none. Search or browse by framework.'}${themesFromSel.size ? '. Crosswalk includes controls equivalent to those already mapped.' : ''}</div>` : ''}
      <div class="row"><select id="fw">${[['suggested', `Suggested & crosswalk (${suggested.length})`], ['selected', 'Selected'], ...state.meta.frameworks.map((f) => [f.code, f.name])].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
        <div class="search right"><span>${icon('search')}</span><input id="cq" placeholder="Search ref or title"></div></div>
      <div class="pick-list" id="pl"></div>
      <div class="muted small" id="pcount"></div>
    </div>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Apply mappings</button>`,
    onMount: ({ el, close }) => {
      const draw = () => {
        let rows;
        if (q) rows = all.filter((c) => (fw === 'suggested' || fw === 'selected' || c.framework_code === fw) && `${c.framework_code} ${c.ref} ${c.title} ${c.family}`.toLowerCase().includes(q));
        else if (fw === 'suggested') rows = suggested;
        else if (fw === 'selected') rows = all.filter((c) => sel.has(c.id));
        else rows = all.filter((c) => c.framework_code === fw);
        mount($('#pl', el), rows.length ? html`${rows.slice(0, 300).map((c) => html`<label class="pick ${fw === 'suggested' && !q ? 'sug' : ''}"><input type="checkbox" data-c="${c.id}" ${sel.has(c.id) ? 'checked' : ''}><span class="ref">${c.framework_code} ${c.ref}</span><span>${c.title}<small>${c.family}${c.themes ? ' · ' + c.themes.split(',').map((t) => THEME_LABELS[t] || t).join(', ') : ''}</small></span></label>`)}`
          : html`<div class="empty">No controls match.</div>`);
        $('#pcount', el).textContent = `${sel.size} control(s) selected across ${new Set([...sel].map((id) => all.find((c) => c.id === id)?.framework_code)).size} framework(s)`;
      };
      draw();
      $('#fw', el).addEventListener('change', (e) => { fw = e.target.value; draw(); });
      $('#cq', el).addEventListener('input', (e) => { q = e.target.value.toLowerCase().trim(); draw(); });
      on(el, 'change', '[data-c]', (e, cb) => { const id = Number(cb.dataset.c); cb.checked ? sel.add(id) : sel.delete(id); $('#pcount', el).textContent = `${sel.size} control(s) selected`; });
      on(el, 'click', '[data-save]', () => { onSave([...sel]); close(); });
    },
  });
}

// =====================================================================
// Document view (reading / printing / attestation)
// =====================================================================
// In drafts, weak or unmeasurable words are highlighted in the document view.
const WEAK = /\b(should|may|try to|attempt to|where possible|as appropriate|appropriate|adequate|reasonable|periodically|regularly|timely|promptly|as soon as possible|best effort|ideally|etc\.?|and\/or)\b/gi;
function highlightWeak(text, on) {
  if (!on) return text;
  return raw(esc(text).replace(WEAK, (m) => `<span class="mark" title="Non-mandatory or unmeasurable wording">${m}</span>`));
}

export function docBody(p, { compact = false } = {}) {
  const cmap = controlsIndex();
  const groups = state.meta.controls.length ? groupRefs(p, cmap) : [];
  return html`
    <div class="eyebrow">${state.org} · ${p.classification || 'Internal'}</div>
    <h1>${p.title}</h1>
    <div class="row"><span class="stamp">${p.status === 'published' ? 'In force' : statusLabel(p.status)}</span></div>
    <h2>1. Header</h2>
    <table><tbody>
      <tr><th>Policy name</th><td>${p.title}</td><th>Policy ID</th><td>${p.code}</td></tr>
      <tr><th>Version</th><td>${p.version === '0.0' ? 'Draft' : p.version}</td><th>Owner</th><td>${p.owner || '—'}</td></tr>
      <tr><th>Effective date</th><td>${fmtDate(p.effective_date)}</td><th>Review cycle</th><td>${p.review_cycle_months === 12 ? 'Annually' : `Every ${p.review_cycle_months} months`}</td></tr>
      <tr><th>Next review</th><td>${fmtDate(p.next_review_date || (p.effective_date ? addMonthsLocal(p.effective_date, p.review_cycle_months) : null))}</td><th>Approval</th><td>${p.approved_at ? `${p.approved_by_name || 'Approved'}, ${fmtDate(p.approved_at)}` : 'Pending'}</td></tr>
    </tbody></table>
    <h2>2. Purpose</h2><p class="pre">${p.purpose}</p>
    <h2>3. Scope</h2><p class="pre">${p.scope}</p>
    <h2>4. Policy Statements</h2>
    <ol class="statements">${p.statements.map((s, i) => html`<li><span class="k">4.${i + 1}</span><div>${highlightWeak(s.text, p.status === 'draft')}
      ${s.controls?.length && cmap.size ? html`<div class="refs">${s.controls.map((id) => ctrlLabel(cmap.get(id))).join(' · ')}</div>` : ''}</div></li>`)}</ol>
    <h2>5. Roles & Responsibilities</h2>
    <table><thead><tr><th>Role</th><th>Responsibility</th></tr></thead><tbody>${p.roles.map((r) => html`<tr><td><b>${r.role}</b></td><td>${r.responsibility}</td></tr>`)}</tbody></table>
    <h2>6. Compliance & Enforcement</h2><p class="pre">${p.enforcement}</p>
    <h2>7. References</h2>
    ${groups.length ? html`<table><thead><tr><th>Framework</th><th>Controls</th></tr></thead><tbody>${groups.map((g) => html`<tr><td>${fwName(g.code)}</td><td>${g.items.map((it) => `${it.c.ref} ${it.c.title}`).join('; ')}</td></tr>`)}</tbody></table>`
      : html`<p>${p.ref_summary || 'See statement references.'}</p>`}
    ${p.related_docs ? html`<p><b>Related documents:</b> ${p.related_docs}</p>` : ''}
    ${compact ? '' : html`<h2>8. Revision History</h2>
    ${p.revisions?.length ? html`<table><thead><tr><th>Version</th><th>Date</th><th>Description of change</th><th>Author</th><th>Approved by</th></tr></thead><tbody>
      ${p.revisions.map((r) => html`<tr><td>${r.version}</td><td>${fmtDate(r.created_at)}</td><td>${r.change_summary}</td><td>${r.author || '—'}</td><td>${r.approver || '—'}</td></tr>`)}</tbody></table>`
      : html`<p>Version ${p.version === '0.0' ? 'draft' : p.version}${p.in_revision ? ' (a revision is in progress)' : ''}.</p>`}`}
    ${compact ? '' : docReview(reviewForDoc(p))}`;
}

function docReview(rv) {
  if (!rv) return '';
  return html`<section class="doc-review">
    <h2>Appendix: Review report</h2>
    <p><b>Verdict: ${rv.verdictLabel}</b> · overall ${rv.overall}/100${rv.type ? ` · checked as ${aTypeName(rv.type.name)} policy` : ''}. Generated by MandateGRC's rule-based review; not part of the policy text.</p>
    <table><thead><tr><th>Area</th><th>Score</th><th>Passed</th></tr></thead><tbody>
      ${REVIEW_CATEGORIES.map((c) => { const items = rv.checklist.filter((i) => i.cat === c.key && i.pass !== null); return html`<tr><td>${c.label}</td><td>${rv.scores[c.key] ?? 'n/a'}</td><td>${items.filter((i) => i.pass).length}/${items.length}</td></tr>`; })}
    </tbody></table>
    ${rv.gaps.length ? html`<p><b>Coverage gaps:</b> ${rv.gaps.map((g) => g.topic).join('; ')}.</p>` : ''}
    ${rv.metrics.length ? html`<table><thead><tr><th>Measured value</th><th>Policy</th><th>Baseline</th><th>Result</th></tr></thead><tbody>
      ${rv.metrics.map((m) => html`<tr><td>${m.metric} (${m.num})</td><td>${m.shown}</td><td>${m.baseline}</td><td>${m.pass ? 'Meets' : 'Weaker'}</td></tr>`)}</tbody></table>` : ''}
    ${rv.checklist.filter((c) => c.cat === 'consistency' && c.pass === false).map((c) => html`<p><b>Consistency:</b> ${c.label}${c.detail ? ` (${c.detail})` : ''}.</p>`)}
  </section>`;
}

export async function policyDocView(el, id) {
  const p = await GET(`/api/policies/${id}`);
  const draw = () => mount(el, html`
    <div class="doc-bar">
      <a class="btn ghost" href="${can.read() ? `#/policies/${p.id}` : '#/policies'}">← ${can.read() ? 'Back to editor' : 'All policies'}</a>
      <span class="right"></span>
      ${p.status === 'published' && !p.attested_at ? html`<button class="btn ok" id="attest">${icon('check')} I have read and will comply</button>` : ''}
      ${p.attested_at ? html`<span class="pill s-ok">Acknowledged ${fmtDate(p.attested_at)}</span>` : ''}
      <button class="btn" id="md">${icon('download')} Markdown</button>
      <button class="btn primary" id="print">${icon('print')} Print / PDF</button>
    </div>
    <article class="doc">${docBody(p)}</article>`);
  draw();
  on(el, 'click', '#print', () => window.print());
  on(el, 'click', '#md', () => download(`${p.code}-v${p.version}.md`, toMarkdown(p), 'text/markdown'));
  on(el, 'click', '#attest', async () => {
    try { await POST(`/api/policies/${p.id}/attest`); p.attested_at = new Date().toISOString(); toast('Thank you. Your acknowledgement is recorded.'); window.dispatchEvent(new Event('mandate:badges')); draw(); } catch (e) { fail(e); }
  });
}

function exportDialog(p) {
  modal({
    title: `Export ${p.code}`,
    body: html`<div class="stack"><p class="dim">Exports are generated in your browser from the current view.</p>
      <div class="row"><button class="btn" data-x="md">${icon('download')} Markdown (.md)</button><button class="btn" data-x="json">${icon('download')} Structured JSON</button><a class="btn" href="#/policies/${p.id}/doc" data-close>${icon('print')} Print / PDF</a></div></div>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-x]', (e, b) => {
      if (b.dataset.x === 'md') download(`${p.code}-v${p.version}.md`, toMarkdown(p), 'text/markdown');
      else {
        const cmap = controlsIndex();
        const out = { ...p, statements: p.statements.map((s, i) => ({ number: `4.${i + 1}`, text: s.text, controls: s.controls.map((c) => ctrlLabel(cmap.get(c))) })), lint: undefined, risks: undefined };
        download(`${p.code}-v${p.version}.json`, JSON.stringify(out, null, 2), 'application/json');
      }
      close();
    }),
  });
}

export function toMarkdown(p) {
  const cmap = controlsIndex();
  const L = [];
  L.push(`# ${p.title}`, '', `| Field | Value |`, `|---|---|`,
    `| Policy ID | ${p.code} |`, `| Version | ${p.version} |`, `| Owner | ${p.owner} |`, `| Classification | ${p.classification} |`,
    `| Effective date | ${p.effective_date || 'TBD'} |`, `| Review cycle | ${p.review_cycle_months} months |`, `| Next review | ${p.next_review_date || 'TBD'} |`,
    `| Approval | ${p.approved_at ? `${p.approved_by_name || ''} ${p.approved_at.slice(0, 10)}` : 'Pending'} |`, '');
  L.push('## 2. Purpose', '', p.purpose, '', '## 3. Scope', '', p.scope, '', '## 4. Policy Statements', '');
  p.statements.forEach((s, i) => { L.push(`**4.${i + 1}** ${s.text}`); if (s.controls?.length) L.push(`  *Maps to: ${s.controls.map((c) => ctrlLabel(cmap.get(c))).join(', ')}*`); L.push(''); });
  L.push('## 5. Roles & Responsibilities', '', '| Role | Responsibility |', '|---|---|', ...p.roles.map((r) => `| ${r.role} | ${r.responsibility.replace(/\|/g, '\\|')} |`), '');
  L.push('## 6. Compliance & Enforcement', '', p.enforcement, '', '## 7. References', '');
  groupRefs(p, cmap).forEach((g) => { L.push(`**${fwName(g.code)}**`); g.items.forEach((it) => L.push(`- ${it.c.ref} ${it.c.title}`)); L.push(''); });
  if (p.related_docs) L.push(`Related documents: ${p.related_docs}`, '');
  L.push('## 8. Revision History', '', '| Version | Date | Change | Author | Approved by |', '|---|---|---|---|---|');
  (p.revisions || []).forEach((r) => L.push(`| ${r.version} | ${r.created_at.slice(0, 10)} | ${r.change_summary.replace(/\|/g, '\\|')} | ${r.author || ''} | ${r.approver || ''} |`));
  const rv = reviewForDoc(p);
  if (rv) {
    L.push('', '---', '', '## Appendix: Review report', '', `**Verdict: ${rv.verdictLabel}** (overall ${rv.overall}/100)${rv.type ? `, checked as ${aTypeName(rv.type.name)} policy` : ''}. Generated by MandateGRC's rule-based review.`, '',
      '| Area | Score |', '|---|---|', ...REVIEW_CATEGORIES.map((c) => `| ${c.label} | ${rv.scores[c.key] ?? 'n/a'} |`), '');
    if (rv.gaps.length) L.push('**Coverage gaps:**', ...rv.gaps.map((g) => `- ${g.topic}`), '');
    if (rv.metrics.length) L.push('| Measured value | Policy | Baseline | Result |', '|---|---|---|---|', ...rv.metrics.map((m) => `| ${m.metric} (${m.num}) | ${m.shown} | ${m.baseline} | ${m.pass ? 'Meets' : 'Weaker'} |`), '');
    rv.checklist.filter((c) => c.cat === 'consistency' && c.pass === false).forEach((c) => L.push(`- Consistency: ${c.label}${c.detail ? ` (${c.detail})` : ''}`));
  }
  return L.join('\n');
}

// =====================================================================
// Version diff (line-level LCS)
// =====================================================================
function toLines(s) {
  const cmap = controlsIndex();
  const L = [`Title: ${s.title}`, `Owner: ${s.owner}`, `Classification: ${s.classification}`, `Effective: ${s.effective_date || ''}`, `Review cycle: ${s.review_cycle_months} months`,
    '## Purpose', ...String(s.purpose || '').split('\n'), '## Scope', ...String(s.scope || '').split('\n'), '## Policy Statements'];
  (s.statements || []).forEach((st, i) => L.push(`4.${i + 1} ${st.text}`, `    ↳ ${(st.controls || []).map((c) => ctrlLabel(cmap.get(c))).join(', ') || 'unmapped'}`));
  L.push('## Roles & Responsibilities', ...(s.roles || []).map((r) => `${r.role}: ${r.responsibility}`), '## Compliance & Enforcement', ...String(s.enforcement || '').split('\n'));
  return L;
}
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(['ctx', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['del', a[i++]]); else out.push(['add', b[j++]]);
  }
  while (i < n) out.push(['del', a[i++]]);
  while (j < m) out.push(['add', b[j++]]);
  return out;
}
function diffDialog(la, a, lb, b) {
  const d = diffLines(toLines(a), toLines(b));
  const adds = d.filter((x) => x[0] === 'add').length, dels = d.filter((x) => x[0] === 'del').length;
  modal({
    title: `Compare ${la} → ${lb}`, wide: true,
    body: html`<div class="row small mt"><span class="pill s-ok plain">+${adds} added</span><span class="pill s-critical plain">−${dels} removed</span></div>
      <div class="diff mt">${d.map(([k, t]) => html`<div class="${t.startsWith('## ') ? 'hd' : k}">${k === 'add' ? '+ ' : k === 'del' ? '− ' : '  '}${t}</div>`)}</div>`,
  });
}
