// Audit evidence package: choose a scope, preview what goes in, generate a verifiable ZIP.
import { html, mount, $, on, state, GET, toast, fail, fmtDateTime, icon, pill } from '../core.js';

const ITEMS = [
  ['policies', 'Approved policies', 'Each as a PDF at its approved version, with revision history'],
  ['controls', 'Controls', 'Control register (PDF and CSV) with latest results'],
  ['tests', 'Control tests', 'Every test performed (immutable records)'],
  ['risks', 'Risks', 'Risk register with inherent and residual scores'],
  ['exceptions', 'Exceptions', 'Open and closed exceptions'],
  ['findings', 'Findings', 'Corrective actions and their status'],
  ['attestations', 'Attestations', 'Who acknowledged which policy version, and when'],
  ['evidence', 'Evidence items', 'Index of evidence: where it is and whether it is current'],
];

export async function packageView(el) {
  let scope = 'all';
  let [preview, history] = await Promise.all([GET('/api/audit-package/preview?scope=all'), GET('/api/audit-package/history')]);
  let busy = false;
  const draw = () => mount(el, html`
    <div class="page-head">
      <div><h1>Audit evidence package</h1><div class="sub">One click produces a dated ZIP for your auditor: approved policies, the control register with test results, the SoA, risks, exceptions, findings, attestations, an evidence index, and the full audit trail with a verification report. Every file is fingerprinted, and the package can be verified independently.</div></div>
    </div>
    <div class="grid g3">
      <section class="card span2" aria-labelledby="pk-h">
        <div class="card-h"><h3 id="pk-h">What goes in</h3>
          <label class="right f-inline"><span class="visually-hidden">Scope</span><select id="scope" aria-label="Package scope">
            <option value="all" ${scope === 'all' ? 'selected' : ''}>All frameworks</option>
            ${state.meta.frameworks.map((f) => html`<option value="${f.code}" ${scope === f.code ? 'selected' : ''}>${f.name} package</option>`)}
          </select></label></div>
        <div class="card-b stack">
          <ul class="pkg-list">${ITEMS.map(([k, label, d]) => html`<li><b class="pkg-n">${preview.counts[k]}</b><span><b>${label}</b><small>${d}</small></span></li>`)}
            <li><b class="pkg-n">${preview.soa ? icon('check') : '—'}</b><span><b>Statement of Applicability</b><small>${preview.soa ? 'ISO/IEC 27001 SoA as PDF and CSV' : 'Included in ISO/IEC 27001 and all-framework packages'}</small></span></li>
            <li><b class="pkg-n">${preview.chain.entries}</b><span><b>Audit trail entries</b><small>${preview.chain.ok ? 'Chain intact. Full trail, verification report and a script to re-check it.' : 'WARNING: the chain is broken. The report will show where.'}</small></span></li>
          </ul>
          ${preview.policies.length ? html`<div class="muted small">Policies: ${preview.policies.map((p) => `${p.code} v${p.version}`).join(', ')}</div>` : html`<div class="notice warn small">No policy in this scope has an approved version yet, so no policy documents will be included.</div>`}
          <p class="small dim">Scoped packages include the policies, controls, evidence, exceptions and findings linked to the chosen framework. The risk register and the audit trail are always complete.</p>
          <div><button class="btn primary lg" id="gen" ${busy ? 'disabled' : ''}>${icon('download')} ${busy ? 'Generating…' : `Generate ${preview.label} package`}</button></div>
        </div>
      </section>
      <section class="card" aria-labelledby="pv-h"><div class="card-h"><h3 id="pv-h">How an auditor verifies it</h3></div>
        <div class="card-b stack small">
          <ol class="link-steps">
            <li>Open <b>00-index.pdf</b>: scope, contents and the SHA-256 of every file.</li>
            <li>Run <b>node verify-package.mjs</b> in the unzipped folder (Node.js 18+, nothing else).</li>
            <li>It checks every file against <b>manifest.json</b> and recomputes every audit-trail hash. Any change is reported.</li>
            <li>The export is logged here with the manifest's hash, so the package can be matched to this record.</li>
          </ol>
          <p class="map-disclaimer">Control mappings are guidance, not a substitute for your auditor's judgment.</p>
        </div></section>
    </div>
    <section class="card" aria-labelledby="ph-h"><div class="card-h"><h3 id="ph-h">Packages generated</h3><span class="muted small">From the audit trail</span></div>
      ${history.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Generated</th><th>By</th><th>Scope</th><th>Files</th><th>Audit trail</th><th>Manifest SHA-256</th></tr></thead><tbody>
        ${history.map((h) => html`<tr><td class="nowrap">${fmtDateTime(h.ts)}</td><td>${h.username}</td><td>${h.details.scope === 'all' ? 'All frameworks' : h.details.scope}</td><td>${h.details.files}</td>
          <td>${h.details.chain_ok ? pill('ok', `Intact (${h.details.chain_entries})`) : pill('critical', 'Broken')}</td><td class="mono small hash">${h.details.manifest_sha256}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty small"><b>No packages yet</b>Generate one above.</div>`}
    </section>`);
  draw();
  on(el, 'change', '#scope', async (e, s) => {
    scope = s.value;
    try { preview = await GET(`/api/audit-package/preview?scope=${encodeURIComponent(scope)}`); draw(); } catch (err) { fail(err); }
  });
  on(el, 'click', '#gen', async () => {
    busy = true; draw();
    try {
      const res = await fetch('/api/audit-package', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify({ scope }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not generate the package');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'audit-package.zip';
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast(`Downloaded ${name}.`);
      history = await GET('/api/audit-package/history');
    } catch (err) { fail(err); }
    busy = false; draw();
  });
}
