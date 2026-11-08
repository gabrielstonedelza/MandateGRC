// Import an existing policy document into a fresh, editable draft.
// The file is read in the browser; only the structured result is sent to the server.
import { html, mount, $, on, state, POST, toast, fail, modal, icon, fmtDate } from '../core.js';
import { POLICY_TYPE_OPTIONS } from '../lint.js';
import { ACCEPT, readPolicyFile, readPastedText, analyzePolicy } from '../importer.js';
import { autoMapStatements, defaultFrameworks } from '../automap.js';

const FORMAT_LABEL = { docx: 'Word', pdf: 'PDF', markdown: 'Markdown', text: 'Text', html: 'HTML', paste: 'Pasted text' };
const CYCLES = [3, 6, 12, 18, 24, 36];

export function importPolicyDialog() {
  let result = null;
  modal({
    title: 'Import a policy', wide: true,
    body: html`<div id="imp"></div>`,
    footer: html`<div id="imp-foot" class="row grow-row"></div>`,
    onMount: ({ el, close }) => {
      const body = $('#imp', el), foot = $('#imp-foot', el);

      const pickStep = (error) => {
        result = null;
        mount(body, html`<div class="stack">
          <label class="dropzone" id="dz">
            <input type="file" id="imp-file" accept="${ACCEPT}" class="visually-hidden">
            <span class="dz-ic">${icon('download')}</span>
            <b>Drop your policy here, or click to choose a file</b>
            <span class="muted small">Word (.docx), PDF, Markdown, plain text or HTML · up to 15 MB</span>
          </label>
          ${error ? html`<div class="notice bad small">${error}</div>` : ''}
          <details class="imp-paste"><summary>Or paste the policy text</summary>
            <textarea id="imp-text" rows="8" placeholder="Paste the full policy, including its headings (Purpose, Scope, Policy, Roles…)"></textarea>
            <button class="btn sm mt" type="button" id="imp-analyze">Analyze pasted text</button>
          </details>
          <div class="notice info small">${icon('lock')}<span>The document is read <b>in your browser</b>. The file itself is never uploaded or stored. Only the draft you create is saved to your workspace.</span></div>
          <div class="imp-how">
            <div><b>1</b><span>We read the headings and split the text into the 8-part anatomy.</span></div>
            <div><b>2</b><span>We detect the policy type and match framework references to controls.</span></div>
            <div><b>3</b><span>You review the result, then edit it like any other draft.</span></div>
          </div>
        </div>`);
        mount(foot, html`<span class="muted small">Scanned (image-only) PDFs cannot be read. Use the .docx or paste the text.</span><button class="btn ghost right" data-close>Cancel</button>`);
        const dz = $('#dz', body), input = $('#imp-file', body);
        input.addEventListener('change', () => input.files[0] && analyze(() => readPolicyFile(input.files[0])));
        ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
        dz.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) analyze(() => readPolicyFile(f)); });
        $('#imp-analyze', body).addEventListener('click', () => {
          const t = $('#imp-text', body).value;
          if (t.trim().length < 40) return toast('Paste the full policy text first.', 'err');
          analyze(async () => readPastedText(t));
        });
      };

      const analyze = async (reader) => {
        mount(body, html`<div class="imp-busy"><span class="spinner"></span><b>Reading your policy…</b><span class="muted small">Finding sections, statements, roles and framework references.</span></div>`);
        mount(foot, html``);
        try {
          const read = await reader();
          result = analyzePolicy(read, { controls: state.meta.controls || [] });
          reviewStep();
        } catch (e) { pickStep(e.message || 'This file could not be read.'); }
      };

      const reviewStep = () => {
        const { draft: d, report: r } = result;
        const missing = ['purpose', 'scope', 'enforcement'].filter((k) => !d[k]).concat(d.roles.length ? [] : ['roles'], d.owner ? [] : ['owner']);
        const metaFound = ['owner', 'effective_date', 'review_cycle', 'classification'].filter((k) => r.meta[k]).length;
        const row = (n, name, ok, detail) => html`<li class="${ok === true ? 'ok' : ok === false ? 'miss' : 'info'}"><span class="an-n">${n}</span><b>${name}</b><span class="an-d">${detail}</span></li>`;
        const sugCount = autoMapStatements(d.statements, state.meta.controls || [], { frameworks: defaultFrameworks(d, state.meta.controls || [], state.meta.frameworks || []) }).size;
        const from = (k) => (r.found[k] && !r.found[k].startsWith('(') ? `from “${r.found[k]}”` : r.found[k] ? r.found[k].replace(/[()]/g, '') : '');
        mount(body, html`<div class="imp-review">
          <div class="imp-src">${icon('policy')}<b>${r.filename}</b><span class="tag">${FORMAT_LABEL[r.format] || r.format}</span></div>
          <div class="imp-type ${r.type ? '' : 'none'}">
            <div>
              <div class="kicker-s">Detected policy type</div>
              <div class="imp-type-name">${r.type ? r.type.name : 'Not a recognised type'}${r.type ? html`<span class="pill ${r.type.confidence >= 70 ? 's-ok' : r.type.confidence >= 45 ? 's-medium' : 's-high'}">${r.type.confidence}% confident</span>` : ''}</div>
              <div class="muted small">${r.type ? `Because ${r.type.signals.join(' and ')}.` : 'It will be imported as a custom policy, without a coverage checklist. You can choose a type below.'}</div>
              ${r.alternatives.length ? html`<div class="muted small">Also resembles: ${r.alternatives.map((a) => `${a.name} (${a.confidence}%)`).join(', ')}</div>` : ''}
            </div>
            <label class="f"><span>Policy type <em>(sets the review checklist)</em></span><select id="imp-type">
              ${POLICY_TYPE_OPTIONS.map((t) => html`<option value="${t.key}" ${t.key === d.policy_type ? 'selected' : ''}>${t.name}</option>`)}
              <option value="other" ${d.policy_type === 'other' ? 'selected' : ''}>Other / custom (no coverage checklist)</option></select></label>
          </div>
          <div class="form-grid">
            <label class="f full"><span>Policy name</span><input id="imp-title" maxlength="200" value="${d.title}"></label>
            <label class="f"><span>Policy owner</span><input id="imp-owner" maxlength="200" value="${d.owner}" placeholder="Not found in the document"></label>
            <div class="form-grid inner">
              <label class="f"><span>Effective date</span><input type="date" id="imp-eff" value="${d.effective_date || ''}"></label>
              <label class="f"><span>Review cycle</span><select id="imp-cycle">${CYCLES.map((m) => html`<option value="${m}" ${m === d.review_cycle_months ? 'selected' : ''}>${m === 12 ? 'Annually' : `${m} months`}</option>`)}</select></label>
            </div>
          </div>
          <div class="section-label">What we found, mapped to the 8-part anatomy</div>
          <ol class="anat-check">
            ${row(1, 'Header', metaFound >= 2, `${metaFound} of 4 fields found${r.meta.version ? ` · original version ${r.meta.version} noted` : ''}${r.meta.effective_date ? ` · effective ${fmtDate(d.effective_date)}` : ''}`)}
            ${row(2, 'Purpose', !!d.purpose, d.purpose ? from('purpose') : 'Not found')}
            ${row(3, 'Scope', !!d.scope, d.scope ? from('scope') : 'Not found')}
            ${row(4, 'Policy statements', r.counts.statements > 0, r.counts.statements ? `${r.counts.statements} statements · ${r.counts.mandatory} already use “must/shall”` : 'None recognised')}
            ${row(5, 'Roles & responsibilities', d.roles.length > 0, d.roles.length ? `${d.roles.length} roles: ${d.roles.slice(0, 4).map((x) => x.role).join(', ')}${d.roles.length > 4 ? '…' : ''}` : 'Not found')}
            ${row(6, 'Compliance & enforcement', !!d.enforcement, d.enforcement ? from('enforcement') : 'Not found')}
            ${row(7, 'References', r.counts.mapped > 0 || sugCount > 0 ? true : null, [r.counts.mapped ? `${r.counts.mapped} controls taken from the document's own references` : '', sugCount ? `${sugCount} statement${sugCount === 1 ? '' : 's'} will get suggested controls to confirm` : ''].filter(Boolean).join(' · ') || 'No framework references found. Map statements after import.')}
            ${row(8, 'Revision history', null, 'Starts fresh: MandateGRC records versions when the draft is approved')}
          </ol>
          ${r.unrecognized.length ? html`<div class="muted small">Sub-sections imported as statement topics: ${r.unrecognized.join(' · ')}</div>` : ''}
          ${r.skipped.length ? html`<div class="muted small">Not imported as sections: ${r.skipped.join(' · ')}.</div>` : ''}
          ${r.warnings.map((w) => html`<div class="notice warn small">${w}</div>`)}
          <details class="imp-preview"><summary>Preview the ${r.counts.statements} statements</summary>
            <ol>${d.statements.slice(0, 40).map((s) => html`<li>${s.text}</li>`)}${d.statements.length > 40 ? html`<li class="muted">…and ${d.statements.length - 40} more</li>` : ''}</ol></details>
          <label class="row imp-fill ${missing.length ? '' : 'hidden'}"><input type="checkbox" id="imp-fill" ${missing.length && d.policy_type !== 'other' ? 'checked' : ''}>
            <span>Fill the missing ${missing.join(', ')} with the matching template's professional wording <span class="muted">(you can edit it afterwards)</span></span></label>
        </div>`);
        mount(foot, html`<button class="btn ghost" id="imp-back">${icon('up')} Choose another file</button><span class="right"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="imp-create">${icon('check')} Create draft</button>`);
        const typeSel = $('#imp-type', body), fill = $('#imp-fill', body);
        const syncFill = () => { fill.disabled = typeSel.value === 'other'; if (fill.disabled) fill.checked = false; };
        typeSel.addEventListener('change', syncFill); syncFill();
        $('#imp-back', foot).addEventListener('click', () => pickStep());
        $('#imp-create', foot).addEventListener('click', async (e) => {
          const title = $('#imp-title', body).value.trim();
          if (!title) return toast('Give the policy a name.', 'err');
          e.currentTarget.disabled = true;
          try {
            const res = await POST('/api/policies/import', {
              ...d, title, owner: $('#imp-owner', body).value.trim(), effective_date: $('#imp-eff', body).value || null,
              review_cycle_months: Number($('#imp-cycle', body).value), policy_type: typeSel.value,
              fill_from_template: fill.checked,
              source: { filename: r.filename, format: r.format, confidence: r.type?.confidence || 0 },
            });
            close();
            toast(`Imported ${r.counts.statements} statements as ${res.code}${res.filled.length ? `; filled ${res.filled.join(', ')} from the template` : ''}. Work through the review report to bring it up to standard.`);
            location.hash = `#/policies/${res.id}`;
          } catch (err) { fail(err); e.currentTarget.disabled = false; }
        });
      };

      pickStep();
    },
  });
}
