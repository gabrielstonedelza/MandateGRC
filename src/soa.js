// ISO/IEC 27001:2022 Statement of Applicability, generated from data the workspace already holds:
// policy statements mapped to each Annex A control, the controls that operate it (with their latest
// test) and the evidence. Applicability and justification are the analyst's decisions; every change
// creates a new SoA version (append-only revision log) and is written to the audit trail.
import { all, get, run, tx, orgSettings } from './db.js';
import { audit } from './audit.js';
import { bad, today, nowIso, parseJson, str } from './util.js';
import { PdfDoc } from './pdf.js';

export const IMPL = {
  implemented: 'Implemented',
  partial: 'Partially implemented',
  planned: 'Planned',
  not_implemented: 'Not implemented',
  not_applicable: 'Not applicable',
};
const DISCLAIMER = 'Control mappings are guidance, not a substitute for your auditor\'s judgment.';
const refKey = (ref) => ref.split('.').map((n) => n.padStart(3, '0')).join('.');

export function registerSoaRoutes({ route, R, controlsMap, userName, hydratePolicy, evidenceView }) {
  const annexOf = (org) => [...controlsMap(org).values()].filter((c) => c.framework_code === 'ISO27001').sort((a, b) => refKey(a.ref).localeCompare(refKey(b.ref)));
  const versionOf = (org) => get('SELECT MAX(version) v FROM soa_revisions WHERE org_id = ?', org).v || 0;

  // Build every SoA row for a workspace.
  function build(org) {
    const annex = annexOf(org);
    const ids = new Set(annex.map((c) => c.id));
    const t = today();
    const entries = new Map(all('SELECT * FROM soa_entries WHERE org_id = ?', org).map((e) => [e.control_id, e]));
    const stmts = new Map(), ctls = new Map(), evs = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const p of all("SELECT id, code, title, status, statements FROM policies WHERE org_id = ? AND status != 'retired' ORDER BY code", org).map(hydratePolicy)) {
      p.statements.forEach((s, i) => (s.controls || []).forEach((cid) => { if (ids.has(cid)) push(stmts, cid, { policy_id: p.id, policy_code: p.code, status: p.status, num: `4.${i + 1}`, text: s.text }); }));
    }
    for (const c of all("SELECT * FROM org_controls WHERE org_id = ? AND status = 'active' ORDER BY code", org)) {
      const due = c.next_due;
      const v = { id: c.id, code: c.code, name: c.name, design_status: c.design_status, result: c.result, last_tested_on: c.last_tested_on, overdue: !!due && due < t, evidence_ids: parseJson(c.evidence_ids, []) };
      parseJson(c.framework_ids, []).forEach((cid) => { if (ids.has(cid)) push(ctls, cid, v); });
    }
    const evById = new Map(all('SELECT * FROM evidence WHERE org_id = ?', org).map((e) => [e.id, evidenceView(e)]));
    for (const e of evById.values()) if (ids.has(e.control_id)) push(evs, e.control_id, e);

    const rows = annex.map((c) => {
      const e = entries.get(c.id);
      const applicable = e ? !!e.applicable : true;
      const statements = stmts.get(c.id) || [];
      const controls = ctls.get(c.id) || [];
      const evidence = [...(evs.get(c.id) || [])];
      for (const k of controls) for (const id of k.evidence_ids) { const ev = evById.get(id); if (ev && !evidence.some((x) => x.id === id)) evidence.push(ev); }
      const tested = controls.filter((k) => k.design_status === 'approved' && k.result !== 'not_tested');
      const operating = tested.filter((k) => (k.result === 'pass' || k.result === 'exception') && !k.overdue);
      const published = statements.some((s) => s.status === 'published');
      const status = !applicable ? 'not_applicable'
        : operating.length ? 'implemented'
          : controls.length || published ? 'partial'
            : statements.length ? 'planned' : 'not_implemented';
      const auto = applicable && !(e?.justification);
      const justification = e?.justification || (applicable
        ? (statements.length || controls.length
          ? `Included: addressed by ${[...new Set(statements.map((s) => `${s.policy_code} ${s.num}`))].slice(0, 4).join(', ') || 'no policy statement yet'}${controls.length ? `; operated by ${controls.map((k) => k.code).join(', ')}` : ''}.`
          : 'Included by default; no policy statement or control is linked yet.')
        : '');
      return {
        control_id: c.id, ref: c.ref, title: c.title, family: c.family, applicable, justification, justification_auto: auto,
        status, status_label: IMPL[status], statements, controls, evidence: evidence.map((x) => ({ id: x.id, title: x.title, fresh: x.fresh, collected_on: x.collected_on })),
        tested: tested.length > 0, updated_at: e?.updated_at || null, updated_by_name: e ? userName(e.updated_by) : null,
      };
    });
    const applicableRows = rows.filter((r) => r.applicable);
    const covered = applicableRows.filter((r) => r.tested).length;
    const counts = Object.fromEntries(Object.keys(IMPL).map((k) => [k, rows.filter((r) => r.status === k).length]));
    return {
      rows,
      coverage: {
        total: rows.length, applicable: applicableRows.length, excluded: rows.length - applicableRows.length,
        covered, pct: applicableRows.length ? Math.round((covered / applicableRows.length) * 100) : 0,
        with_control: applicableRows.filter((r) => r.controls.length).length, counts,
        unjustified_exclusions: rows.filter((r) => !r.applicable && !r.justification).length,
      },
    };
  }

  route('GET', '/api/soa', R.READ, (ctx) => {
    const org = ctx.user.org_id;
    const last = get('SELECT created_at, created_by FROM soa_revisions WHERE org_id = ? ORDER BY version DESC LIMIT 1', org);
    return { version: versionOf(org), updated_at: last?.created_at || null, updated_by_name: last ? userName(last.created_by) : null, disclaimer: DISCLAIMER, ...build(org) };
  });

  route('GET', '/api/soa/revisions', R.READ, (ctx) => all('SELECT * FROM soa_revisions WHERE org_id = ? ORDER BY version DESC', ctx.user.org_id)
    .map((r) => ({ ...r, changes: parseJson(r.changes, []), created_by_name: userName(r.created_by) })));

  // One save = one new version, containing only the decisions that actually changed.
  route('PUT', '/api/soa', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const annex = new Map(annexOf(org).map((c) => [c.id, c]));
    const list = Array.isArray(ctx.body.changes) ? ctx.body.changes.slice(0, 200) : [];
    if (!list.length) throw bad('No changes to save.');
    const note = str(ctx.body.note, { name: 'Change note', max: 500 });
    const changes = [];
    for (const ch of list) {
      const c = annex.get(Number(ch.control_id));
      if (!c) throw bad('Only ISO/IEC 27001 Annex A controls belong in the Statement of Applicability.');
      const applicable = ch.applicable !== false;
      const justification = str(ch.justification, { name: `Justification for ${c.ref}`, max: 2000 });
      if (!applicable && justification.length < 10) throw bad(`Excluding ${c.ref} needs a justification (at least 10 characters): ISO/IEC 27001 requires every exclusion to be justified.`);
      const cur = get('SELECT applicable, justification FROM soa_entries WHERE org_id = ? AND control_id = ?', org, c.id) || { applicable: 1, justification: '' };
      if (!!cur.applicable === applicable && cur.justification === justification) continue;
      changes.push({ control_id: c.id, ref: c.ref, applicable: [!!cur.applicable, applicable], justification: [cur.justification, justification] });
    }
    if (!changes.length) return { version: versionOf(org), changed: 0 };
    let version;
    tx(() => {
      version = versionOf(org) + 1;
      const ts = nowIso();
      for (const ch of changes) {
        run(`INSERT INTO soa_entries(org_id, control_id, applicable, justification, updated_by, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(org_id, control_id) DO UPDATE SET applicable = excluded.applicable, justification = excluded.justification, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        org, ch.control_id, ch.applicable[1] ? 1 : 0, ch.justification[1], ctx.user.id, ts);
      }
      run('INSERT INTO soa_revisions(org_id, version, changes, note, created_by, created_at) VALUES (?,?,?,?,?,?)', org, version, JSON.stringify(changes), note, ctx.user.id, ts);
      audit(ctx.actor, 'soa.updated', 'soa', version, {
        version, note, changed: changes.map((c) => c.ref),
        excluded: changes.filter((c) => !c.applicable[1]).map((c) => c.ref), included: changes.filter((c) => c.applicable[1] && !c.applicable[0]).map((c) => c.ref),
      });
    });
    return { version, changed: changes.length };
  });

  // CSV and PDF, stamped with the version and date. Exporting is itself audited.
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const listStatements = (r) => r.statements.map((s) => `${s.policy_code} ${s.num}${s.status !== 'published' ? ` (${s.status.replace('_', ' ')})` : ''}`).join('; ');
  const listControls = (r) => r.controls.map((k) => `${k.code} ${k.name} (${k.result === 'not_tested' ? 'not tested' : k.result}${k.overdue ? ', overdue' : ''})`).join('; ');
  const listEvidence = (r) => r.evidence.map((e) => `${e.title}${e.fresh ? '' : ' (expired)'}`).join('; ');

  // Exposed for the audit package (Phase 4).
  function exportSoa(org, format) {
    const data = build(org);
    const version = versionOf(org);
    const d = today();
    const orgName = orgSettings(org).name;
    const stamp = `v${version}${version ? '' : ' (not yet reviewed)'}`;
    if (format === 'csv') {
      const head = ['Annex A control', 'Title', 'Theme', 'Applicable', 'Justification', 'Implementation status', 'Policy statements', 'Controls (latest result)', 'Evidence', 'SoA version', 'Generated'];
      const lines = [head.map(cell).join(','), ...data.rows.map((r) => [r.ref, r.title, r.family, r.applicable ? 'Yes' : 'No', r.justification, r.status_label, listStatements(r), listControls(r), listEvidence(r), stamp, d].map(cell).join(','))];
      lines.push('', cell(DISCLAIMER));
      return { body: '﻿' + lines.join('\r\n'), contentType: 'text/csv; charset=utf-8', filename: `soa-v${version}-${d}.csv`, version };
    }
    const doc = new PdfDoc({ landscape: true, title: `Statement of Applicability ${stamp}`, footer: (p, n) => [`${orgName} · Statement of Applicability ${stamp} · generated ${d} by MandateGRC`, `Page ${p} of ${n}`] });
    doc.heading('Statement of Applicability', { size: 18 });
    doc.paragraph(`ISO/IEC 27001:2022 Annex A · ${orgName}`, { size: 11, color: '#4b5563' });
    doc.rule();
    const c = data.coverage;
    doc.keyValues([
      ['SoA version', `${stamp}, generated ${d}`],
      ['Applicable controls', `${c.applicable} of ${c.total} (${c.excluded} excluded with justification)`],
      ['Tested-control coverage', `${c.covered} of ${c.applicable} applicable controls (${c.pct}%) have at least one linked, tested control`],
      ['Implementation', Object.entries(c.counts).filter(([, n]) => n).map(([k, n]) => `${IMPL[k]}: ${n}`).join(' · ')],
    ]);
    doc.paragraph(DISCLAIMER, { size: 8, color: '#6b7280' });
    doc.space(4);
    doc.table([
      { label: 'Control', width: 0.6, bold: true }, { label: 'Title', width: 1.9 }, { label: 'Applies', width: 0.55 },
      { label: 'Justification', width: 2.6 }, { label: 'Implementation', width: 1.05 }, { label: 'Policy statements', width: 1.3 },
      { label: 'Controls (latest result)', width: 1.7 }, { label: 'Evidence', width: 1.3 },
    ], data.rows.map((r) => [r.ref, r.title, r.applicable ? 'Yes' : 'No', r.justification, r.status_label, listStatements(r) || '—', listControls(r) || '—', listEvidence(r) || '—']), { size: 7.2 });
    return { body: doc.toBuffer(), contentType: 'application/pdf', filename: `soa-v${version}-${d}.pdf`, version };
  }

  route('GET', '/api/soa/export', R.READ, (ctx) => {
    const format = ctx.query.get('format') === 'csv' ? 'csv' : 'pdf';
    const out = exportSoa(ctx.user.org_id, format);
    audit(ctx.actor, 'soa.exported', 'soa', out.version, { format, version: out.version });
    return { __raw: out.body, contentType: out.contentType, filename: out.filename };
  });

  return { build, exportSoa, versionOf };
}
