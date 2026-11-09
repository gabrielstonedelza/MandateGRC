// Audit evidence package: one action produces a dated ZIP, scoped to a framework, containing the
// approved policies (at their approved versions), the control register with test results, the SoA,
// risks, exceptions, findings, attestations, an evidence index, the full audit trail, and a
// hash-chain verification report. A manifest lists the SHA-256 of every file, and a dependency-free
// script lets an auditor re-verify the files and the audit chain independently.
import crypto from 'node:crypto';
import { all, get, orgSettings } from './db.js';
import { audit, verifyChain } from './audit.js';
import { bad, today, nowIso, parseJson } from './util.js';
import { PdfDoc } from './pdf.js';
import { zip } from './zip.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const DISCLAIMER = 'Control mappings are guidance, not a substitute for your auditor\'s judgment.';
const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const csv = (head, rows) => '﻿' + [head.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// Shipped inside every package. Re-checks file hashes against the manifest and recomputes the
// audit hash chain exactly as the server does (SHA-256 of previous hash + canonical entry).
const VERIFY_SCRIPT = `// Independent verification of a MandateGRC audit package. Node.js 18+, no dependencies.
// Usage: unzip the package, then run:  node verify-package.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
let ok = true;

const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const f of manifest.files) {
  const actual = sha(readFileSync(path.join(dir, f.path)));
  if (actual !== f.sha256) { ok = false; console.error('MODIFIED  ' + f.path); }
}
console.log((ok ? 'OK' : 'FAILED') + '  ' + manifest.files.length + ' files checked against manifest.json');

const lines = readFileSync(path.join(dir, 'audit', 'audit-trail.jsonl'), 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l));
let prev = '0'.repeat(64), broken = null;
for (const e of lines) {
  const canonical = JSON.stringify([e.org_id, e.ts, e.user_id, e.username, e.action, e.entity, e.entity_id, e.details]);
  const h = createHash('sha256').update(prev + '|' + canonical).digest('hex');
  if (e.prev_hash !== prev || h !== e.hash) { broken = e.id; break; }
  prev = e.hash;
}
if (broken != null) { ok = false; console.error('FAILED  audit chain broken at entry ' + broken); }
else if (prev !== manifest.audit_chain.head) { ok = false; console.error('FAILED  audit chain head does not match the manifest'); }
else console.log('OK  ' + lines.length + ' audit entries; chain intact; head ' + prev);
process.exit(ok ? 0 : 1);
`;

export function registerPackageRoutes({ route, R, controlsMap, userName, hydratePolicy, riskView, exceptionView, evidenceView, visibleFrameworks, soaApi }) {
  function scopeOf(org, scope) {
    const fws = visibleFrameworks(org);
    if (scope !== 'all' && !fws.some((f) => f.code === scope)) return null;
    const cmap = controlsMap(org);
    const inScope = (id) => scope === 'all' || cmap.get(id)?.framework_code === scope;
    const fw = fws.find((f) => f.code === scope);
    return { scope, cmap, inScope, label: scope === 'all' ? 'All frameworks' : `${fw.name}${fw.version ? ` (${fw.version})` : ''}`, fw };
  }

  // Everything the package would contain, without rendering files (also used for the preview).
  function collect(org, scope) {
    const s = scopeOf(org, scope);
    const { cmap, inScope } = s;
    // Approved policies at their latest approved version.
    const policies = [];
    for (const p of all("SELECT id, code, title, status FROM policies WHERE org_id = ? ORDER BY code", org)) {
      const rev = get('SELECT * FROM policy_revisions WHERE policy_id = ? ORDER BY id DESC LIMIT 1', p.id);
      if (!rev) continue;
      const snap = parseJson(rev.snapshot, {});
      const ids = [...(snap.statements || []).flatMap((x) => x.controls || []), ...(snap.ref_controls || [])];
      if (scope !== 'all' && !ids.some(inScope)) continue;
      const history = all('SELECT version, change_type, change_summary, author_id, approver_id, created_at FROM policy_revisions WHERE policy_id = ? AND id <= ? ORDER BY id', p.id, rev.id);
      policies.push({ ...p, rev, snap, history });
    }
    const policyIds = new Set(policies.map((p) => p.id));
    const controls = all('SELECT * FROM org_controls WHERE org_id = ? ORDER BY code', org)
      .map((c) => ({ ...c, framework_ids: parseJson(c.framework_ids, []), statement_refs: parseJson(c.statement_refs, []), evidence_ids: parseJson(c.evidence_ids, []) }))
      .filter((c) => scope === 'all' || c.framework_ids.some(inScope));
    const controlIds = new Set(controls.map((c) => c.id));
    const tests = controls.length ? all(`SELECT * FROM control_tests WHERE control_id IN (${[...controlIds].join(',')}) ORDER BY control_id, tested_on, id`) : [];
    const evIds = new Set([...controls.flatMap((c) => c.evidence_ids), ...tests.flatMap((t) => parseJson(t.evidence_ids, []))]);
    const evidence = all('SELECT * FROM evidence WHERE org_id = ? ORDER BY collected_on DESC', org).map(evidenceView).filter((e) => evIds.has(e.id) || inScope(e.control_id));
    const risks = all('SELECT * FROM risks WHERE org_id = ? ORDER BY code', org).map((r) => riskView(r));
    const exceptions = all('SELECT * FROM exceptions WHERE org_id = ? ORDER BY code', org).map(exceptionView).filter((e) => scope === 'all' || policyIds.has(e.policy_id));
    const findings = all('SELECT * FROM findings WHERE org_id = ? ORDER BY code', org)
      .filter((f) => scope === 'all' || controlIds.has(f.control_id) || policyIds.has(f.policy_id));
    const attestations = policies.length ? all(`SELECT a.policy_id, a.version, a.attested_at, u.name, u.username, u.role FROM attestations a JOIN users u ON u.id = a.user_id
      WHERE a.policy_id IN (${[...policyIds].join(',')}) ORDER BY a.policy_id, a.version, a.attested_at`) : [];
    const withSoa = scope === 'all' || scope === 'ISO27001';
    return { ...s, policies, controls, tests, evidence, risks, exceptions, findings, attestations, withSoa };
  }

  function policyPdf(org, p, s) {
    const { snap, rev } = p;
    const orgName = orgSettings(org).name;
    const doc = new PdfDoc({ title: `${p.code} ${snap.title} v${rev.version}`, footer: (n, t) => [`${orgName} · ${p.code} v${rev.version} · approved ${rev.created_at.slice(0, 10)} by ${userName(rev.approver_id) || 'unknown'}`, `Page ${n} of ${t}`] });
    const ref = (id) => { const c = s.cmap.get(id); return c ? `${c.framework_code} ${c.ref}` : null; };
    doc.heading(snap.title, { size: 18 });
    doc.paragraph(`${p.code} · version ${rev.version} · ${snap.classification || 'Internal'}`, { size: 10, color: '#4b5563' });
    doc.rule();
    doc.keyValues([['Policy owner', snap.owner], ['Effective date', snap.effective_date || 'Not set'], ['Review cycle', `${snap.review_cycle_months} months`], ['Next review', snap.next_review_date || ''],
      ['Approved', `${rev.created_at.slice(0, 10)} by ${userName(rev.approver_id) || 'unknown'} (${rev.change_type} change: ${rev.change_summary})`], ['Current status', p.status.replace('_', ' ')]]);
    doc.heading('2. Purpose', { size: 12 }); doc.paragraph(snap.purpose || '');
    doc.heading('3. Scope', { size: 12 }); doc.paragraph(snap.scope || '');
    doc.heading('4. Policy statements', { size: 12 });
    doc.table([{ label: 'No.', width: 0.5, bold: true }, { label: 'Statement', width: 5 }, { label: 'Maps to', width: 2.2 }],
      (snap.statements || []).map((st, i) => [`4.${i + 1}`, st.text, (st.controls || []).map(ref).filter(Boolean).join(', ') || '—']), { size: 8.5 });
    doc.heading('5. Roles & responsibilities', { size: 12 });
    doc.table([{ label: 'Role', width: 1.6, bold: true }, { label: 'Responsibility', width: 5 }], (snap.roles || []).map((r) => [r.role, r.responsibility]), { size: 8.5 });
    doc.heading('6. Compliance & enforcement', { size: 12 }); doc.paragraph(snap.enforcement || '');
    doc.heading('7. References', { size: 12 });
    const refs = [...new Set([...(snap.statements || []).flatMap((x) => x.controls || []), ...(snap.ref_controls || [])])].map((id) => s.cmap.get(id)).filter(Boolean);
    doc.paragraph(refs.map((c) => `${c.framework_code} ${c.ref} ${c.title}`).join('; ') || 'None', { size: 8.5 });
    doc.paragraph(DISCLAIMER, { size: 7.5, color: '#6b7280' });
    doc.heading('8. Revision history', { size: 12 });
    doc.table([{ label: 'Version', width: 0.8 }, { label: 'Date', width: 1 }, { label: 'Change', width: 0.8 }, { label: 'Summary', width: 3.4 }, { label: 'Author', width: 1.3 }, { label: 'Approved by', width: 1.3 }],
      p.history.map((h) => [h.version, h.created_at.slice(0, 10), h.change_type, h.change_summary, userName(h.author_id) || '', userName(h.approver_id) || '']), { size: 8 });
    return doc.toBuffer();
  }

  function build(org, scope, actor) {
    const c = collect(org, scope);
    const orgName = orgSettings(org).name;
    const d = today(), generatedAt = nowIso();
    const files = [];
    const add = (path, data, description) => files.push({ path, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), description });
    const ref = (id) => { const x = c.cmap.get(id); return x ? `${x.framework_code} ${x.ref}` : ''; };
    const scopedRefs = (ids) => ids.filter(c.inScope).map(ref).filter(Boolean).join('; ');

    // Policies at their approved versions.
    for (const p of c.policies) add(`policies/${p.code}-v${p.rev.version}-${slug(p.snap.title)}.pdf`, policyPdf(org, p, c), `${p.code} ${p.snap.title}, approved version ${p.rev.version}`);

    // Control register and tests.
    const testsBy = new Map();
    c.tests.forEach((t) => { if (!testsBy.has(t.control_id)) testsBy.set(t.control_id, []); testsBy.get(t.control_id).push(t); });
    const findingByTest = new Map(c.findings.filter((f) => f.control_test_id).map((f) => [f.control_test_id, f]));
    const stmtLabel = (r) => { const p = hydratePolicy(get('SELECT code, statements FROM policies WHERE id = ?', r.policy_id)); const i = p ? p.statements.findIndex((x) => x.id === r.statement_id) : -1; return p && i >= 0 ? `${p.code} 4.${i + 1}` : ''; };
    const t = today();
    add('controls/control-register.csv', csv(
      ['Control', 'Name', 'Description', 'Owner', 'Status', 'Design', 'Design approved by', 'Design approved on', 'Test frequency', 'Framework requirements (in scope)', 'All framework requirements', 'Policy statements', 'Last tested', 'Next due', 'Overdue', 'Result', 'Operating effectiveness', 'Tests', 'Evidence items'],
      c.controls.map((k) => [k.code, k.name, k.description, userName(k.owner_id) || '', k.status, k.design_status, userName(k.design_approved_by) || '', (k.design_approved_at || '').slice(0, 10), k.frequency,
        scopedRefs(k.framework_ids), k.framework_ids.map(ref).filter(Boolean).join('; '), k.statement_refs.map(stmtLabel).filter(Boolean).join('; '), k.last_tested_on || '', k.next_due || '',
        k.status === 'active' && k.next_due && k.next_due < t ? 'Yes' : 'No', k.result, k.effectiveness || '', (testsBy.get(k.id) || []).length, k.evidence_ids.length])),
    'Control register: owners, frequencies, framework requirements, policy statements, latest results');
    add('controls/control-tests.csv', csv(
      ['Control', 'Test date', 'Tester', 'Result', 'Operating effectiveness', 'Methodology', 'Notes', 'Evidence ids', 'Finding', 'Finding status', 'Recorded at'],
      c.tests.map((x) => { const k = c.controls.find((y) => y.id === x.control_id); const f = findingByTest.get(x.id); return [k?.code, x.tested_on, userName(x.tester_id) || '', x.result, x.effectiveness, x.methodology, x.notes, parseJson(x.evidence_ids, []).join(' '), f?.code || '', f?.status || '', x.created_at]; })),
    'Every control test performed (immutable records)');
    const cdoc = new PdfDoc({ landscape: true, title: 'Control register', footer: (n, tt) => [`${orgName} · Control register · ${c.label} · ${d}`, `Page ${n} of ${tt}`] });
    cdoc.heading('Control register', { size: 16 });
    cdoc.paragraph(`${c.controls.length} controls · scope: ${c.label} · generated ${d}`, { color: '#4b5563' });
    cdoc.table([{ label: 'Control', width: 0.7, bold: true }, { label: 'Name', width: 2.2 }, { label: 'Owner', width: 1.1 }, { label: 'Frequency', width: 0.8 }, { label: 'Framework requirements', width: 2 },
      { label: 'Last tested', width: 0.8 }, { label: 'Next due', width: 0.8 }, { label: 'Result', width: 0.7 }, { label: 'Effectiveness', width: 1 }],
    c.controls.map((k) => [k.code, `${k.name}${k.status === 'retired' ? ' (retired)' : ''}`, userName(k.owner_id) || '', k.frequency, k.framework_ids.map(ref).filter(Boolean).join(', '), k.last_tested_on || 'Never',
      `${k.next_due || ''}${k.status === 'active' && k.next_due && k.next_due < t ? ' (overdue)' : ''}`, k.result.replace('_', ' '), (k.effectiveness || '').replace('_', ' ')]), { size: 7.5 });
    cdoc.paragraph(DISCLAIMER, { size: 7.5, color: '#6b7280' });
    add('controls/control-register.pdf', cdoc.toBuffer(), 'Control register summary with latest test results');

    // Statement of Applicability.
    if (c.withSoa) {
      const pdf = soaApi.exportSoa(org, 'pdf'), sv = soaApi.exportSoa(org, 'csv');
      add(`soa/${pdf.filename}`, pdf.body, `ISO/IEC 27001 Statement of Applicability, version ${pdf.version}`);
      add(`soa/${sv.filename}`, sv.body, 'Statement of Applicability as CSV');
    }

    // Risk register, exceptions, findings, attestations, evidence index.
    const findingsByRisk = (id) => c.findings.filter((f) => f.risk_id === id).map((f) => `${f.code} (${f.status})`).join('; ');
    add('risks/risk-register.csv', csv(
      ['Risk', 'Title', 'Category', 'Owner', 'Inherent', 'Residual', 'Above appetite', 'Treatment', 'Treatment plan', 'Status', 'Due', 'ALE', 'Linked policies', 'Linked framework controls', 'Findings'],
      c.risks.map((r) => [r.code, r.title, r.category, r.owner, r.inherent, r.residual, r.above_appetite ? 'Yes' : 'No', r.treatment, r.treatment_plan, r.status, r.due_date || '', r.ale ?? '',
        r.policy_ids.map((id) => get('SELECT code FROM policies WHERE id = ?', id)?.code).filter(Boolean).join('; '), r.control_ids.map(ref).filter(Boolean).join('; '), findingsByRisk(r.id)])),
    'Risk register (organization-wide) with inherent and residual scores');
    add('exceptions/exceptions.csv', csv(
      ['Exception', 'Policy', 'Statement', 'Title', 'Justification', 'Compensating controls', 'Risk score', 'Status', 'Expires', 'Requested by', 'Decided by', 'Decided on', 'Decision note'],
      c.exceptions.map((e) => [e.code, get('SELECT code FROM policies WHERE id = ?', e.policy_id)?.code, e.statement_ref, e.title, e.justification, e.compensating, e.score, e.status, e.expires_at,
        userName(e.requested_by) || '', userName(e.decided_by) || '', (e.decided_at || '').slice(0, 10), e.decision_note || ''])),
    'Policy exceptions, open and closed');
    add('findings/findings.csv', csv(
      ['Finding', 'Title', 'Source', 'Severity', 'Status', 'Owner', 'Identified', 'Due', 'Overdue', 'Control', 'Policy', 'Risk', 'Exception', 'Remediation plan', 'Closure note', 'Closed by', 'Closed on'],
      c.findings.map((f) => [f.code, f.title, f.source, f.severity, f.status, userName(f.owner_id) || '', f.identified_on, f.due_date || '',
        ['Open', 'In Progress', 'Remediated'].includes(f.status) && f.due_date && f.due_date < t ? 'Yes' : 'No',
        f.control_id ? get('SELECT code FROM org_controls WHERE id = ?', f.control_id)?.code : '', f.policy_id ? get('SELECT code FROM policies WHERE id = ?', f.policy_id)?.code : '',
        f.risk_id ? get('SELECT code FROM risks WHERE id = ?', f.risk_id)?.code : '', f.exception_id ? get('SELECT code FROM exceptions WHERE id = ?', f.exception_id)?.code : '',
        f.remediation_plan, f.closure_note || '', userName(f.closed_by) || '', (f.closed_at || '').slice(0, 10)])),
    'Findings and corrective actions (CAP / POA&M)');
    add('attestations/attestations.csv', csv(['Policy', 'Version', 'Name', 'Username', 'Role', 'Acknowledged at'],
      c.attestations.map((a) => [c.policies.find((p) => p.id === a.policy_id)?.code, a.version, a.name, a.username, a.role, a.attested_at])),
    'Policy acknowledgement records per user and version');
    const ctlByEv = new Map();
    c.controls.forEach((k) => k.evidence_ids.forEach((id) => { if (!ctlByEv.has(id)) ctlByEv.set(id, []); ctlByEv.get(id).push(k.code); }));
    add('evidence/evidence-index.csv', csv(['Evidence', 'Title', 'Description', 'Location', 'Owner', 'Collected', 'Valid until', 'Status', 'Framework requirement', 'Controls'],
      c.evidence.map((e) => [e.id, e.title, e.description, e.location, e.owner, e.collected_on, e.expires_on, e.fresh ? 'Current' : 'Expired', ref(e.control_id), (ctlByEv.get(e.id) || []).join('; ')])),
    'Evidence index: what exists, where it is kept, and whether it is current (files stay at their locations)');

    // Audit trail and its verification.
    const chain = verifyChain(org);
    const rows = all('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id ASC', org);
    add('audit/audit-trail.jsonl', rows.map((r) => JSON.stringify({ id: r.id, org_id: r.org_id, ts: r.ts, user_id: r.user_id, username: r.username, action: r.action, entity: r.entity, entity_id: r.entity_id, details: r.details, prev_hash: r.prev_hash, hash: r.hash })).join('\n') + '\n',
      'Complete audit trail, one JSON entry per line, exactly as hashed');
    add('audit/audit-trail.csv', csv(['id', 'ts', 'username', 'action', 'entity', 'entity_id', 'details', 'prev_hash', 'hash'], rows.map((r) => [r.id, r.ts, r.username, r.action, r.entity, r.entity_id, r.details, r.prev_hash, r.hash])),
      'Complete audit trail as CSV (for reading)');
    const vdoc = new PdfDoc({ title: 'Audit trail verification', footer: (n, tt) => [`${orgName} · Audit trail verification · ${d}`, `Page ${n} of ${tt}`] });
    vdoc.heading('Audit trail hash-chain verification', { size: 16 });
    vdoc.rule();
    vdoc.keyValues([
      ['Result', chain.ok ? 'INTACT: every entry links to the previous one and its hash recomputes exactly.' : `BROKEN at entry ${chain.brokenAt}: the trail has been altered.`],
      ['Entries verified', String(chain.entries)], ['First entry', rows[0]?.ts || ''], ['Last entry', rows.at(-1)?.ts || ''], ['Chain head (SHA-256)', chain.head || rows.at(-1)?.hash || ''],
      ['Verified at', generatedAt], ['Algorithm', 'hash = SHA-256(previous hash + "|" + JSON[org_id, ts, user_id, username, action, entity, entity_id, details]); the first entry links to 64 zeros.'],
    ], { keyWidth: 140 });
    vdoc.paragraph('How to check this yourself: unzip the package and run "node verify-package.mjs" (Node.js 18 or later, no other software). It recomputes every hash in audit/audit-trail.jsonl, confirms the chain head matches manifest.json, and checks every file in the package against its SHA-256 in manifest.json.', { size: 9 });
    vdoc.paragraph('The audit trail is append-only: database triggers reject any update or deletion, and any edit made outside the application breaks the chain from that entry onward.', { size: 9 });
    add('audit/hash-chain-verification.pdf', vdoc.toBuffer(), 'Hash-chain verification report');
    add('verify-package.mjs', VERIFY_SCRIPT, 'Independent verification script (Node.js 18+, no dependencies)');
    add('README.txt', [
      `MandateGRC audit evidence package`, `Organization: ${orgName}`, `Scope: ${c.label}`, `Generated: ${generatedAt} by ${actor.username}`, '',
      'Start with 00-index.pdf. Every file is listed in manifest.json with its SHA-256.',
      'To verify the package and the audit trail independently: node verify-package.mjs', '', DISCLAIMER, '',
    ].join('\r\n'), 'How to use this package');

    // Index PDF, then the manifest (which also covers the index).
    const counts = [['Approved policies', c.policies.length], ['Controls', c.controls.length], ['Control tests', c.tests.length], ['Risks', c.risks.length], ['Exceptions', c.exceptions.length],
      ['Findings', c.findings.length], ['Attestation records', c.attestations.length], ['Evidence items', c.evidence.length], ['Audit entries', rows.length]];
    const idoc = new PdfDoc({ landscape: true, title: `Audit package ${c.label} ${d}`, footer: (n, tt) => [`${orgName} · Audit evidence package · ${c.label} · ${d}`, `Page ${n} of ${tt}`] });
    idoc.heading('Audit evidence package', { size: 20 });
    idoc.paragraph(`${orgName} · ${c.label}`, { size: 12, color: '#4b5563' });
    idoc.rule();
    idoc.keyValues([['Generated', `${generatedAt} by ${actor.username}`], ['Scope', c.label], ['Audit trail', chain.ok ? `Intact: ${chain.entries} entries verified; head ${chain.head}` : `BROKEN at entry ${chain.brokenAt}`],
      ['Contents', counts.map(([k, v]) => `${k}: ${v}`).join(' · ')]], { keyWidth: 110 });
    idoc.paragraph('Each file below is listed with its SHA-256 hash, also recorded in manifest.json. Run "node verify-package.mjs" to confirm nothing was altered. This package is itself recorded in the audit trail (action audit.package_generated) with the SHA-256 of manifest.json.', { size: 8.5 });
    idoc.paragraph(DISCLAIMER, { size: 8, color: '#6b7280' });
    idoc.space(4);
    idoc.table([{ label: 'File', width: 2.6, bold: true }, { label: 'Contents', width: 3.2 }, { label: 'Size', width: 0.6 }, { label: 'SHA-256', width: 3.3 }],
      files.map((f) => [f.path, f.description, `${Math.max(1, Math.round(f.data.length / 1024))} KB`, sha256(f.data)]), { size: 7 });
    files.unshift({ path: '00-index.pdf', data: idoc.toBuffer(), description: 'Index: scope, contents, hashes and verification summary' });
    const manifest = {
      format: 'mandategrc-audit-package/1', organization: orgName, scope: c.scope, scope_label: c.label, generated_at: generatedAt, generated_by: actor.username,
      audit_chain: { ok: chain.ok, entries: chain.entries, head: chain.head || null, broken_at: chain.brokenAt ?? null },
      counts: Object.fromEntries(counts.map(([k, v]) => [slug(k).replace(/-/g, '_'), v])),
      files: files.map((f) => ({ path: f.path, bytes: f.data.length, sha256: sha256(f.data), description: f.description })),
      disclaimer: DISCLAIMER,
    };
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const out = zip([...files.map((f) => ({ name: f.path, data: f.data })), { name: 'manifest.json', data: manifestBuf }], { comment: `MandateGRC audit package · ${orgName} · ${c.label} · ${generatedAt}` });
    return { zip: out, manifest, manifestSha: sha256(manifestBuf), zipSha: sha256(out), filename: `mandategrc-audit-package-${slug(c.scope)}-${d}.zip` };
  }

  route('GET', '/api/audit-package/preview', R.AUDIT, (ctx) => {
    const scope = String(ctx.query.get('scope') || 'all');
    const s = scopeOf(ctx.user.org_id, scope);
    if (!s) throw bad('Unknown framework.');
    const c = collect(ctx.user.org_id, scope);
    const chain = verifyChain(ctx.user.org_id);
    return {
      scope, label: c.label, soa: c.withSoa, chain: { ok: chain.ok, entries: chain.entries },
      counts: { policies: c.policies.length, controls: c.controls.length, tests: c.tests.length, risks: c.risks.length, exceptions: c.exceptions.length, findings: c.findings.length, attestations: c.attestations.length, evidence: c.evidence.length },
      policies: c.policies.map((p) => ({ code: p.code, title: p.snap.title, version: p.rev.version })),
    };
  });

  route('GET', '/api/audit-package/history', R.AUDIT, (ctx) => all("SELECT id, ts, username, details FROM audit_log WHERE org_id = ? AND action = 'audit.package_generated' ORDER BY id DESC LIMIT 50", ctx.user.org_id)
    .map((r) => ({ ...r, details: parseJson(r.details, {}) })));

  route('POST', '/api/audit-package', R.AUDIT, (ctx) => {
    const scope = String(ctx.body.scope || 'all');
    if (!scopeOf(ctx.user.org_id, scope)) throw bad('Unknown framework.');
    const p = build(ctx.user.org_id, scope, ctx.actor);
    // Recorded after building, with the manifest and ZIP hashes, so the package can later be matched to this entry.
    audit(ctx.actor, 'audit.package_generated', 'audit_package', null, {
      scope, files: p.manifest.files.length + 1, manifest_sha256: p.manifestSha, package_sha256: p.zipSha, chain_ok: p.manifest.audit_chain.ok,
      chain_entries: p.manifest.audit_chain.entries, chain_head: p.manifest.audit_chain.head, filename: p.filename,
    });
    return { __raw: p.zip, contentType: 'application/zip', filename: p.filename };
  });

  return { build, collect };
}
