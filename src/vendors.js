// Lightweight vendor / third-party risk: a vendor record, a short security questionnaire, SOC 2
// report upload with review, a derived risk rating, and a reassessment date that surfaces in the
// action queue. Every change is audited.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, nextCode, DATA_DIR } from './db.js';
import { audit } from './audit.js';
import { HttpError, bad, today, nowIso, addMonths, addDays, parseJson, str, date, oneOf } from './util.js';

import { QUESTIONS, ANSWERS, CRIT, DATA, REASSESS_MONTHS, rateVendor } from './vendor-rating.js';

export { QUESTIONS, rateVendor, REASSESS_MONTHS };
const REPORT_TYPES = ['SOC 2 Type II', 'SOC 2 Type I', 'ISO 27001 certificate', 'Other'];
const MAX_PDF = 15 * 1024 * 1024;

export function registerVendorRoutes({ route, R, pid, notFound, forbidden, userName }) {
  const uploads = (org) => { const d = path.join(DATA_DIR, 'uploads', String(org)); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
  const row = (id, org) => { const v = get('SELECT * FROM vendors WHERE id = ? AND org_id = ?', id, org); if (!v) throw notFound('Vendor'); return v; };
  const view = (v, t = today()) => {
    const reports = all('SELECT * FROM vendor_reports WHERE vendor_id = ? ORDER BY COALESCE(period_end, uploaded_at) DESC', v.id);
    const latest = reports[0];
    const reportStale = !latest || (latest.period_end ? latest.period_end < addMonths(t, -12) : true);
    return {
      ...v, questionnaire: parseJson(v.questionnaire, {}), owner_name: userName(v.owner_id), assessed_by_name: userName(v.assessed_by),
      reassessment_overdue: v.status === 'active' && !!v.reassessment_due && v.reassessment_due < t,
      reassessment_soon: v.status === 'active' && !!v.reassessment_due && v.reassessment_due >= t && v.reassessment_due <= addDays(t, 30),
      latest_report: latest ? { id: latest.id, report_type: latest.report_type, period_end: latest.period_end, opinion: latest.opinion, reviewed: !!latest.reviewed_at } : null,
      report_stale: v.status === 'active' && ['Critical', 'High'].includes(v.criticality) && reportStale,
      reports_count: reports.length,
    };
  };

  function validate(b, org) {
    const owner = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id);
    if (owner != null && !get("SELECT id FROM users WHERE id = ? AND org_id = ? AND active = 1 AND role != 'employee'", owner, org)) throw bad('Vendor owner must be an active staff member of this workspace.');
    return {
      name: str(b.name, { name: 'Vendor name', min: 2, max: 200, required: true }),
      service: str(b.service, { name: 'Service provided', max: 500 }),
      owner_id: owner,
      criticality: oneOf(b.criticality, Object.keys(CRIT), { name: 'Criticality' }),
      data_access: oneOf(b.data_access, Object.keys(DATA), { name: 'Data access' }),
      reassessment_due: date(b.reassessment_due, { name: 'Reassessment due' }),
      notes: str(b.notes, { name: 'Notes', max: 4000 }),
    };
  }

  route('GET', '/api/vendors', R.READ, (ctx) => { const t = today(); return all('SELECT * FROM vendors WHERE org_id = ? ORDER BY name', ctx.user.org_id).map((v) => view(v, t)); });
  route('GET', '/api/vendors/questions', R.READ, () => QUESTIONS.map(([key, text, weight]) => ({ key, text, weight })));
  route('GET', '/api/vendors/:id', R.READ, (ctx) => {
    const v = view(row(pid(ctx.params.id), ctx.user.org_id));
    const reports = all('SELECT * FROM vendor_reports WHERE vendor_id = ? ORDER BY COALESCE(period_end, uploaded_at) DESC', v.id)
      .map((r) => ({ ...r, uploaded_by_name: userName(r.uploaded_by), reviewed_by_name: userName(r.reviewed_by) }));
    const history = all("SELECT ts, username, action, details FROM audit_log WHERE org_id = ? AND entity = 'vendor' AND entity_id = ? ORDER BY id DESC LIMIT 50", ctx.user.org_id, String(v.id))
      .map((h) => ({ ...h, details: parseJson(h.details, null) }));
    return { ...v, reports, history, rating_basis: v.assessed_on ? rateVendor(v.criticality, v.data_access, v.questionnaire) : null };
  });

  route('POST', '/api/vendors', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = validate(ctx.body, org);
    return tx(() => {
      const code = nextCode('vendors', 'VND', org);
      const id = Number(run(`INSERT INTO vendors(org_id, code, name, service, owner_id, criticality, data_access, reassessment_due, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        org, code, v.name, v.service, v.owner_id, v.criticality, v.data_access, v.reassessment_due || today(), v.notes, ctx.user.id).lastInsertRowid);
      audit(ctx.actor, 'vendor.created', 'vendor', id, { code, name: v.name, criticality: v.criticality, data_access: v.data_access });
      return { id, code };
    });
  });

  route('PUT', '/api/vendors/:id', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const old = row(pid(ctx.params.id), org);
    const v = validate(ctx.body, org);
    // Re-rate when exposure changes after an assessment.
    const rating = old.assessed_on ? rateVendor(v.criticality, v.data_access, parseJson(old.questionnaire, {})).rating : old.risk_rating;
    const changed = ['name', 'service', 'owner_id', 'criticality', 'data_access', 'reassessment_due', 'notes'].filter((k) => String(old[k] ?? '') !== String(v[k] ?? ''));
    tx(() => {
      run('UPDATE vendors SET name=?, service=?, owner_id=?, criticality=?, data_access=?, reassessment_due=?, notes=?, risk_rating=?, updated_at=? WHERE id=?',
        v.name, v.service, v.owner_id, v.criticality, v.data_access, v.reassessment_due, v.notes, rating, nowIso(), old.id);
      audit(ctx.actor, 'vendor.updated', 'vendor', old.id, { code: old.code, changed, ...(rating !== old.risk_rating ? { risk_rating: [old.risk_rating, rating] } : {}) });
    });
    return { ok: true, risk_rating: rating };
  });

  // Complete the questionnaire: rates the vendor and schedules the next reassessment.
  route('POST', '/api/vendors/:id/assess', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = row(pid(ctx.params.id), org);
    if (v.status !== 'active') throw new HttpError(409, 'Offboarded vendors are not assessed.');
    const answers = {};
    for (const [k, text] of QUESTIONS) {
      const a = ctx.body.answers?.[k];
      if (!ANSWERS.includes(a)) throw bad(`Answer every question ("${text}").`);
      answers[k] = a;
    }
    const notes = str(ctx.body.notes, { name: 'Assessment notes', max: 4000 });
    const r = rateVendor(v.criticality, v.data_access, answers);
    const t = today(), due = addMonths(t, REASSESS_MONTHS[v.criticality]);
    tx(() => {
      run('UPDATE vendors SET questionnaire = ?, assessed_on = ?, assessed_by = ?, risk_rating = ?, reassessment_due = ?, notes = CASE WHEN ? = \'\' THEN notes ELSE ? END, updated_at = ? WHERE id = ?',
        JSON.stringify(answers), t, ctx.user.id, r.rating, due, notes, notes, nowIso(), v.id);
      audit(ctx.actor, 'vendor.assessed', 'vendor', v.id, { code: v.code, risk_rating: r.rating, gap_pct: r.gap_pct, gaps: QUESTIONS.filter(([k]) => answers[k] === 'no').map(([k]) => k), reassessment_due: due });
    });
    return { risk_rating: r.rating, gap_pct: r.gap_pct, reassessment_due: due };
  });

  route('POST', '/api/vendors/:id/status', R.WRITE, (ctx) => {
    const v = row(pid(ctx.params.id), ctx.user.org_id);
    const status = oneOf(ctx.body.status, ['active', 'offboarded'], { name: 'Status' });
    if (status === v.status) return { ok: true };
    const reason = str(ctx.body.reason, { name: 'Reason', min: status === 'offboarded' ? 5 : 0, max: 500, required: status === 'offboarded' });
    tx(() => {
      run('UPDATE vendors SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), v.id);
      audit(ctx.actor, status === 'offboarded' ? 'vendor.offboarded' : 'vendor.reactivated', 'vendor', v.id, { code: v.code, reason });
    });
    return { ok: true };
  });

  // SOC 2 report upload (PDF, base64 in JSON). Stored on disk, named by SHA-256; the hash is recorded.
  route('POST', '/api/vendors/:id/reports', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = row(pid(ctx.params.id), org);
    const b = ctx.body;
    const buf = Buffer.from(String(b.content_base64 || ''), 'base64');
    if (!buf.length) throw bad('Choose the report file to upload.');
    if (buf.length > MAX_PDF) throw bad('The report must be 15 MB or smaller.');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad('Only PDF reports can be uploaded.');
    const filename = str(b.filename, { name: 'File name', max: 200, required: true }).replace(/[^\w.\- ()]/g, '_');
    const report_type = oneOf(b.report_type, REPORT_TYPES, { name: 'Report type' });
    const period_end = date(b.period_end, { name: 'Period end' });
    if (period_end && period_end > today()) throw bad('The report period cannot end in the future.');
    const opinion = b.opinion ? oneOf(b.opinion, ['unqualified', 'qualified', 'adverse', 'not_applicable'], { name: 'Opinion' }) : null;
    const exceptions_noted = str(b.exceptions_noted, { name: 'Exceptions noted', max: 4000 });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const file = path.join(uploads(org), `${sha}.pdf`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf, { mode: 0o600 });
    const id = tx(() => {
      const rid = Number(run(`INSERT INTO vendor_reports(org_id, vendor_id, report_type, filename, sha256, bytes, period_end, opinion, exceptions_noted, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        org, v.id, report_type, filename, sha, buf.length, period_end, opinion, exceptions_noted, ctx.user.id).lastInsertRowid);
      audit(ctx.actor, 'vendor.report_uploaded', 'vendor', v.id, { code: v.code, report_id: rid, report_type, filename, sha256: sha, bytes: buf.length, period_end, opinion });
      return rid;
    });
    return { id, sha256: sha };
  }, { maxBody: 21 * 1024 * 1024 });

  route('GET', '/api/vendor-reports/:rid/download', R.READ, (ctx) => {
    const r = get('SELECT * FROM vendor_reports WHERE id = ? AND org_id = ?', pid(ctx.params.rid), ctx.user.org_id);
    if (!r) throw notFound('Report');
    const file = path.join(uploads(ctx.user.org_id), `${r.sha256}.pdf`);
    if (!fs.existsSync(file)) throw notFound('Report file');
    const buf = fs.readFileSync(file);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== r.sha256) throw new HttpError(500, 'The stored report no longer matches its recorded SHA-256.');
    return { __raw: buf, contentType: 'application/pdf', filename: r.filename };
  });

  // Reviewing a report: the reviewer records the outcome; not the person who uploaded it.
  route('POST', '/api/vendor-reports/:rid/review', R.STEWARD, (ctx) => {
    const org = ctx.user.org_id;
    const r = get('SELECT * FROM vendor_reports WHERE id = ? AND org_id = ?', pid(ctx.params.rid), org);
    if (!r) throw notFound('Report');
    if (r.reviewed_at) throw new HttpError(409, 'This report has already been reviewed.');
    if (r.uploaded_by === ctx.user.id) {
      audit(ctx.actor, 'vendor.report_review_blocked_sod', 'vendor', r.vendor_id, { report_id: r.id });
      throw forbidden('Separation of duties: you uploaded this report, so someone else must review it.');
    }
    const note = str(ctx.body.note, { name: 'Review note', min: 10, max: 2000, required: true });
    tx(() => {
      run('UPDATE vendor_reports SET reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?', ctx.user.id, nowIso(), note, r.id);
      audit(ctx.actor, 'vendor.report_reviewed', 'vendor', r.vendor_id, { report_id: r.id, note });
    });
    return { ok: true };
  });

  return {
    summary(org, me) {
      const t = today();
      const list = all("SELECT * FROM vendors WHERE org_id = ? AND status = 'active'", org).map((v) => view(v, t));
      const actions = [];
      list.filter((v) => v.reassessment_overdue).forEach((v) => actions.push({ kind: 'vendor', severity: ['Critical', 'High'].includes(v.criticality) ? 'critical' : 'high', title: `${v.code} ${v.name} reassessment overdue`, detail: `Was due ${v.reassessment_due}${v.owner_name ? ` · owner ${v.owner_name}` : ''}`, link: `#/vendors/${v.id}` }));
      list.filter((v) => v.reassessment_soon).forEach((v) => actions.push({ kind: 'vendor', severity: 'medium', title: `${v.code} ${v.name} reassessment due ${v.reassessment_due}`, detail: v.service || v.criticality, link: `#/vendors/${v.id}` }));
      list.filter((v) => v.report_stale).forEach((v) => actions.push({ kind: 'vendor', severity: 'high', title: `${v.code} ${v.name} has no current SOC 2 report`, detail: `${v.criticality} vendor: request a report covering the last 12 months.`, link: `#/vendors/${v.id}` }));
      if (R.STEWARD.includes(me.role)) {
        all('SELECT vr.id, vr.vendor_id, vr.uploaded_by, v.code, v.name FROM vendor_reports vr JOIN vendors v ON v.id = vr.vendor_id WHERE vr.org_id = ? AND vr.reviewed_at IS NULL', org)
          .filter((r) => r.uploaded_by !== me.id).forEach((r) => actions.push({ kind: 'vendor', severity: 'medium', title: `${r.code} ${r.name}: report awaits review`, detail: 'Read the report and record the outcome.', link: `#/vendors/${r.vendor_id}` }));
      }
      return { stats: { active: list.length, high: list.filter((v) => ['Critical', 'High'].includes(v.risk_rating)).length, overdue: list.filter((v) => v.reassessment_overdue).length, unassessed: list.filter((v) => !v.assessed_on).length, stale_reports: list.filter((v) => v.report_stale).length }, actions };
    },
  };
}
