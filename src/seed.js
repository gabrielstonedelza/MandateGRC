// Bootstrap: global control catalogues, plus optional sample data for a new workspace.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, run, tx, nextCode, DATA_DIR, LEGACY_BACKUP } from './db.js';
import { FRAMEWORKS } from './frameworks.js';
import { TEMPLATES } from './templates.js';
import { today, addMonths, addDays, newId, nowIso } from './util.js';

export function seedFrameworks() {
  tx(() => {
    for (const fw of FRAMEWORKS) {
      run(`INSERT INTO frameworks(scope, code, name, version, description) VALUES ('global',?,?,?,?)
           ON CONFLICT(scope, code) DO UPDATE SET name = excluded.name, version = excluded.version, description = excluded.description`,
        fw.code, fw.name, fw.version, fw.description);
      const { id } = get("SELECT id FROM frameworks WHERE scope = 'global' AND code = ?", fw.code);
      for (const [ref, title, family, themes] of fw.controls) {
        run(`INSERT INTO controls(framework_id, ref, title, family, themes) VALUES (?,?,?,?,?)
             ON CONFLICT(framework_id, ref) DO UPDATE SET title = excluded.title, family = excluded.family, themes = excluded.themes`,
          id, ref, title, family, themes);
      }
    }
  });
}

export function resolveRefs(refs) {
  return refs.map((r) => {
    const i = r.indexOf(':');
    const c = get("SELECT c.id FROM controls c JOIN frameworks f ON f.id = c.framework_id WHERE f.scope = 'global' AND f.code = ? AND c.ref = ?", r.slice(0, i), r.slice(i + 1));
    return c?.id;
  }).filter(Boolean);
}

export function templateToPolicy(t) {
  return {
    title: t.title,
    owner: t.owner,
    purpose: t.purpose,
    scope: t.scope,
    statements: t.statements.map(([text, refs]) => ({ id: newId(), text, controls: resolveRefs(refs) })),
    roles: t.roles.map((r) => ({ ...r })),
    enforcement: t.enforcement,
  };
}

function insertPolicy(orgId, p, extra) {
  const code = nextCode('policies', 'POL', orgId);
  const r = run(`INSERT INTO policies(org_id, code, title, owner, classification, effective_date, review_cycle_months, next_review_date,
      purpose, scope, statements, roles, enforcement, ref_controls, status, version, created_by, updated_by,
      submitted_by, approved_by, approved_at, published_at, pending_change_type, pending_change_summary, published_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    orgId, code, p.title, p.owner, 'Internal', extra.effective_date ?? null, 12, extra.next_review_date ?? null,
    p.purpose, p.scope, JSON.stringify(p.statements), JSON.stringify(p.roles), p.enforcement, '[]',
    extra.status, extra.version, extra.by, extra.by, extra.submitted_by ?? null, extra.approved_by ?? null,
    extra.approved_at ?? null, extra.published_at ?? null, extra.change_type ?? null, extra.change_summary ?? null,
    extra.status === 'published' ? extra.version : null);
  return Number(r.lastInsertRowid);
}

export async function bootstrap() {
  seedFrameworks();
  // Files from the single-workspace version are obsolete.
  for (const f of ['SETUP_CODE.txt', 'INITIAL_ADMIN_CREDENTIALS.txt']) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch { /* not present */ }
  }
  return { legacyBackup: LEGACY_BACKUP };
}

// Fills a brand-new workspace with realistic sample content so every feature can be explored.
// Two inactive demo colleagues author some of it, so separation-of-duties flows can be tried.
export function seedSampleData(orgId, adminId) {
  const tag = crypto.randomBytes(3).toString('hex');
  const mkDemo = (slug, name, role) => Number(run(`INSERT INTO users(org_id, username, name, role, active) VALUES (?,?,?,?,0)`,
    orgId, `demo-${slug}-${tag}`, name, role).lastInsertRowid);
  const analystId = mkDemo('analyst', 'Ama Mensah (demo)', 'analyst');
  const approverId = mkDemo('approver', 'Kwame Owusu, CISO (demo)', 'approver');
  const insertPolicy_ = (p, extra) => insertPolicy(orgId, p, extra);

  {
    const t = Object.fromEntries(TEMPLATES.map((x) => [x.key, x]));
    const eff = addDays(today(), -200);

    // 1) Published, approved policy with revision history.
    const ac = templateToPolicy(t['access-control']);
    const acId = insertPolicy_(ac, {
      status: 'published', version: '1.1', by: analystId, submitted_by: analystId, approved_by: approverId,
      approved_at: addDays(today(), -40) + 'T10:00:00.000Z', published_at: addDays(today(), -40) + 'T12:00:00.000Z',
      effective_date: eff, next_review_date: addMonths(eff, 12),
    });
    run(`INSERT INTO policy_revisions(policy_id, version, change_type, change_summary, author_id, approver_id, snapshot, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      acId, '1.0', 'major', 'Initial release of the Access Control Policy.', analystId, approverId,
      JSON.stringify({ ...ac, statements: ac.statements.slice(0, 6), version: '1.0' }), eff + 'T09:00:00.000Z');
    run(`INSERT INTO policy_revisions(policy_id, version, change_type, change_summary, author_id, approver_id, snapshot, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      acId, '1.1', 'minor', 'Added termination SLA and session lock statements after internal audit finding IA-2024-07.', analystId, approverId,
      JSON.stringify({ ...ac, version: '1.1' }), addDays(today(), -40) + 'T10:00:00.000Z');

    // 2) Published policy whose review is overdue — shows up in the action queue.
    const bk = templateToPolicy(t['backup-recovery']);
    const bkEff = addDays(today(), -400);
    const bkId = insertPolicy_(bk, {
      status: 'published', version: '1.0', by: analystId, submitted_by: analystId, approved_by: approverId,
      approved_at: bkEff + 'T10:00:00.000Z', published_at: bkEff + 'T11:00:00.000Z',
      effective_date: bkEff, next_review_date: addMonths(bkEff, 12),
    });
    run(`INSERT INTO policy_revisions(policy_id, version, change_type, change_summary, author_id, approver_id, snapshot, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      bkId, '1.0', 'major', 'Initial release.', analystId, approverId, JSON.stringify({ ...bk, version: '1.0' }), bkEff + 'T10:00:00.000Z');

    // 3) Submitted for review by the demo analyst — the admin can approve it (separation of duties satisfied).
    const ir = templateToPolicy(t['incident-response']);
    insertPolicy_(ir, {
      status: 'in_review', version: '0.0', by: analystId, submitted_by: analystId,
      change_type: 'major', change_summary: 'Initial release of the Incident Response Policy aligned to NIST CSF 2.0 Respond function.',
      effective_date: addDays(today(), 14),
    });

    // 4) A weak draft, written the way many first policies are — the linter shows what to fix.
    insertPolicy_({
      title: 'Remote Working Policy',
      owner: '',
      purpose: 'Remote work is becoming more common.',
      scope: 'Remote workers.',
      statements: [
        { id: newId(), text: 'Employees should use the company VPN when working remotely where possible.', controls: resolveRefs(['ISO27001:6.7']) },
        { id: newId(), text: 'Staff will try to keep their laptops secure.', controls: [] },
        { id: newId(), text: 'Home Wi-Fi networks must use strong encryption.', controls: [] },
        { id: newId(), text: 'Security incidents must be reported promptly.', controls: resolveRefs(['ISO27001:6.8']) },
      ],
      roles: [{ role: 'IT', responsibility: 'Supports remote users.' }],
      enforcement: 'Violations will be looked into.',
    }, { status: 'draft', version: '0.0', by: adminId });

    // Risks
    const ctl = (refs) => JSON.stringify(resolveRefs(refs));
    const risks = [
      ['Ransomware encrypts production file servers', 'Operational', 'Head of IT Infrastructure', 4, 5, 2, 4, 'Mitigate', 'Immutable off-site backups, EDR on all servers, quarterly restore tests.', 'In Treatment', 180000, 0.3, [bkId], ['ISO27001:8.13', 'ISO27001:8.7', 'CIS:10']],
      ['Compromised credentials used for remote access', 'Information Security', 'CISO', 4, 4, 2, 3, 'Mitigate', 'Enforce MFA for all remote and privileged access; impossible-travel alerting.', 'In Treatment', 95000, 0.5, [acId], ['ISO27001:8.5', 'NIST80053:IA-2']],
      ['Critical SaaS vendor suffers data breach', 'Third Party', 'Head of Procurement & Vendor Risk', 3, 4, 3, 3, 'Transfer', 'Cyber insurance; contractual breach-notification clauses; annual vendor reassessment.', 'Open', 250000, 0.1, [], ['ISO27001:5.19', 'SOC2:CC9.2']],
      ['Unpatched internet-facing VPN appliance exploited', 'Information Security', 'Network Engineering Lead', 3, 5, 3, 5, 'Mitigate', 'Weekly external scanning; 7-day SLA for KEV-listed vulnerabilities.', 'Open', 300000, 0.2, [], ['ISO27001:8.8', 'CIS:7']],
      ['Personal data breach not reported within 72 hours', 'Compliance', 'Data Protection Officer', 2, 5, 1, 4, 'Mitigate', 'Incident Response Policy with GDPR notification workflow; annual tabletop.', 'Open', 400000, 0.05, [], ['GDPR:Art. 33']],
      ['Leavers retain access to SaaS applications', 'Information Security', 'IT Operations Manager', 3, 3, 1, 3, 'Mitigate', 'HRIS-driven automated deprovisioning; quarterly access recertification.', 'Closed', 40000, 0.4, [acId], ['ISO27001:6.5', 'NIST80053:PS-4']],
      ['Office flooding damages on-premise comms room', 'Physical', 'Facilities Manager', 1, 3, 1, 2, 'Accept', 'Risk accepted by COO: equipment raised and insured; workloads in cloud.', 'Accepted', 30000, 0.02, [], ['ISO27001:7.5']],
    ];
    for (const r of risks) {
      run(`INSERT INTO risks(org_id, code, title, category, owner, likelihood, impact, res_likelihood, res_impact, treatment, treatment_plan, status, due_date, sle, aro, policy_ids, control_ids, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orgId, nextCode('risks', 'RSK', orgId), r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], addDays(today(), 60), r[10], r[11], JSON.stringify(r[12]), ctl(r[13]), adminId);
    }

    // Exceptions
    run(`INSERT INTO exceptions(org_id, code, policy_id, statement_ref, title, justification, compensating, likelihood, impact, status, expires_at, requested_by, decided_by, decided_at, decision_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orgId, nextCode('exceptions', 'EXC', orgId), acId, '4.3', 'Legacy payroll system cannot enforce MFA',
      'Vendor-hosted payroll platform v7 does not support SAML/MFA; upgrade to v9 scheduled for Q1.',
      'Access restricted to 3 named users via IP allow-list from office network; weekly log review by SOC.',
      3, 4, 'Approved', addDays(today(), 21), analystId, approverId, nowIso(), 'Approved until vendor upgrade; must not be renewed beyond 6 months.');
    run(`INSERT INTO exceptions(org_id, code, policy_id, statement_ref, title, justification, compensating, likelihood, impact, status, expires_at, requested_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      orgId, nextCode('exceptions', 'EXC', orgId), acId, '4.6', 'Delay quarterly privileged access review for ERP migration',
      'ERP cut-over freeze prevents role changes during November.', 'Change freeze enforced; all privileged sessions recorded.',
      2, 3, 'Requested', addDays(today(), 75), analystId);

    // Evidence
    const ev = [
      ['ISO27001:8.13', 'Backup job success report (Veeam)', 'Monthly export of all backup job results for Tier 1 systems.', 'https://intranet.example.com/it/backups/report-latest', 'Infrastructure team', -20, 31],
      ['ISO27001:8.5', 'IdP MFA enforcement configuration', 'Screenshot of conditional access policy requiring MFA for all users.', 'GRC-EVID-0042', 'IAM team', -100, 90],
      ['ISO27001:5.18', 'Q3 privileged access recertification', 'Signed recertification of all admin accounts by system owners.', 'GRC-EVID-0051', 'IT Operations', -30, 90],
      ['ISO27001:6.3', 'Security awareness training completion', 'LMS export showing 97% completion for annual training.', 'https://lms.example.com/reports/security-2026', 'HR', -60, 365],
      ['ISO27001:8.8', 'External vulnerability scan results', 'Weekly authenticated scan of internet-facing assets.', 'GRC-EVID-0063', 'Security Engineering', -12, 7],
    ];
    for (const e of ev) {
      const [cid] = resolveRefs([e[0]]);
      run(`INSERT INTO evidence(org_id, control_id, title, description, location, owner, collected_on, valid_days, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
        orgId, cid, e[1], e[2], e[3], e[4], addDays(today(), e[5]), e[6], adminId);
    }
  }
}
