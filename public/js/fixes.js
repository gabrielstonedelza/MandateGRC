// Plain-language explanations and multiple-choice fixes for every failed review check.
// Pure functions: given the review result and the policy, return what is wrong, why it
// matters, and two or more concrete fixes with a preview of the result. The editor applies
// the chosen fix; nothing here changes the policy itself.
import { SECTIONS, applyFix } from './lint.js';
import { suggestMappings, defaultFrameworks } from './automap.js';

// ---------------------------------------------------------------- Alternative wordings
// A second, differently scoped wording for every coverage requirement, so authors can choose.
const ALT = {
  'access-control:least-privilege': ['Lighter, for small teams', 'Access must be limited to what each person needs for their job and must be approved by their manager before it is granted.'],
  'access-control:unique-ids': ['Stricter, no exceptions', 'Every account must belong to exactly one named person; shared and generic accounts are prohibited.'],
  'access-control:mfa': ['Everywhere, simplest to audit', 'Multi-factor authentication must be enabled for every user account on every system that supports it.'],
  'access-control:authenticators': ['Baseline (PCI DSS)', 'Passwords must be at least 12 characters long and must not be reused across the last 4 passwords.'],
  'access-control:lockout': ['Stricter', 'Accounts must be locked for at least 30 minutes after 5 consecutive failed login attempts.'],
  'access-control:access-review': ['One cycle for everything', 'All user access, including privileged access, must be reviewed and recertified by system owners every 90 days.'],
  'access-control:privileged': ['Adds just-in-time access', 'Administrative rights must be granted only for the time needed to perform a task and must use a separate privileged account.'],
  'access-control:leavers': ['Simpler', 'All access for departing personnel must be removed by the end of their last working day.'],
  'access-control:session-lock': ['Stricter', 'Devices and sessions must lock automatically after 10 minutes of inactivity and require re-authentication.'],
  'acceptable-use:business-use': ['Stricter, business use only', 'Organizational devices, accounts and data must be used only for authorized business purposes.'],
  'acceptable-use:software': ['Request-based', 'Users must request new software through the Service Desk; only software approved by IT shall be installed.'],
  'acceptable-use:clear-screen': ['Screen only', 'Users must lock their screen every time they leave their device unattended.'],
  'acceptable-use:data-transfer': ['Stricter, no exceptions', 'Confidential data must never be sent to personal email, personal cloud storage or removable media.'],
  'acceptable-use:reporting': ['Same-day', 'Suspected phishing, lost devices and security incidents must be reported to the Service Desk on the same day they are noticed.'],
  'acceptable-use:training': ['Twice a year', 'All personnel must complete security awareness training within 30 days of joining and every 6 months thereafter.'],
  'acceptable-use:return': ['On the last day', 'All organizational devices and data must be returned on or before the employee\'s last working day.'],
  'incident-response:ir-plan': ['Named owner', 'The Head of Security Operations must own the Incident Response Plan and shall review and update it at least annually.'],
  'incident-response:reporting': ['Simpler, same day', 'All staff must report suspected security incidents to the Service Desk as soon as they notice them and no later than 24 hours after discovery.'],
  'incident-response:triage': ['Faster triage', 'Every reported security event must be triaged and assigned a severity rating within 1 hour of receipt.'],
  'incident-response:escalation': ['Includes leadership', 'High-severity incidents must be escalated to the CISO and the executive team within 1 hour of being classified.'],
  'incident-response:notification': ['Covers customers too', 'Personal data breaches must be notified to the supervisory authority within 72 hours and to affected customers without undue delay where required by law or contract.'],
  'incident-response:evidence': ['With retention period', 'Incident evidence and logs must be preserved for at least 12 months with a documented chain of custody.'],
  'incident-response:lessons': ['Every incident', 'A lessons-learned review must be completed within 10 business days of closing every security incident.'],
  'incident-response:testing': ['Twice a year', 'The Incident Response Plan must be tested at least every 6 months through a tabletop exercise or simulation.'],
  'data-classification:levels': ['Three levels', 'All information must be classified by its owner as Public, Internal or Confidential.'],
  'data-classification:labelling': ['All levels', 'All documents and systems must be labelled with their classification level.'],
  'data-classification:encryption': ['Stricter', 'All Internal, Confidential and Restricted information must be encrypted at rest with AES-256 and in transit with TLS 1.2 or higher.'],
  'data-classification:storage': ['Stricter, never on devices', 'Restricted information must only be stored on approved, encrypted organizational systems and never on removable media or personal devices.'],
  'data-classification:retention': ['Annual purge', 'Information past its retention period must be identified and securely deleted at least annually.'],
  'data-classification:disposal': ['With approved vendor', 'Storage media must be destroyed by an approved disposal vendor, and a certificate of destruction shall be kept for 3 years.'],
  'backup:frequency': ['More frequent', 'Production databases must be backed up at least every 4 hours and all other production data every 24 hours.'],
  'backup:objectives': ['Simpler, one target', 'Critical systems must be restorable within 24 hours with no more than 24 hours of data loss.'],
  'backup:offsite': ['3-2-1 rule', 'Backups must follow the 3-2-1 rule: three copies, on two different media, with at least one copy offline or immutable.'],
  'backup:encryption': ['In transit too', 'Backups must be encrypted at rest with AES-256 and in transit with TLS 1.2 or higher.'],
  'backup:restore-test': ['One cycle for all', 'A restore test must be performed for every critical system at least every 6 months and the results shall be documented.'],
  'backup:monitoring': ['Faster', 'Failed backup jobs must alert the on-call engineer immediately and be rerun successfully within 8 hours.'],
  'vulnerability:scanning': ['Simpler', 'All systems must be scanned for vulnerabilities at least monthly, and internet-facing systems at least weekly.'],
  'vulnerability:sla': ['Baseline (PCI DSS)', 'Critical vulnerabilities must be remediated within 30 days and High vulnerabilities within 90 days.'],
  'vulnerability:kev': ['Faster', 'Actively exploited vulnerabilities must be remediated within 7 days of being listed by CISA or the vendor.'],
  'vulnerability:exceptions': ['With expiry', 'Any vulnerability not fixed within its deadline must have an approved exception with compensating controls and an expiry of no more than 90 days.'],
  'vulnerability:pentest': ['Twice a year', 'External penetration tests must be performed at least every 6 months by an independent tester.'],
  'third-party:due-diligence': ['Risk-based', 'Vendors that will access Confidential data or systems must pass a security assessment before any contract is signed.'],
  'third-party:tiering': ['Two tiers', 'Each vendor shall be classified as Critical or Standard based on the data it handles and the impact of its failure.'],
  'third-party:contracts': ['All vendors', 'All vendor contracts must include confidentiality, security and breach-notification clauses.'],
  'third-party:breach-notice': ['Faster', 'Vendors must notify the organization of any security breach affecting its data within 24 hours of discovery.'],
  'third-party:reassessment': ['One cycle', 'All vendors with access to Confidential data must be reassessed at least annually.'],
  'third-party:offboarding': ['On termination day', 'All vendor access must be removed on the day the contract ends.'],
};

// Baseline and stricter values for weak measurable values, as numbers in the benchmark's unit.
const BENCH_TARGETS = {
  'password-length': [{ n: 12, unit: 'characters', label: 'Baseline: 12 characters' }, { n: 14, unit: 'characters', label: 'Stricter: 14 characters' }],
  'lockout-attempts': [{ n: 10, unit: 'count', label: 'Baseline: 10 attempts' }, { n: 5, unit: 'count', label: 'Stricter: 5 attempts' }],
  'lockout-duration': [{ h: 0.5, label: 'Baseline: 30 minutes' }, { h: 1, label: 'Stricter: 1 hour' }],
  'session-timeout': [{ h: 0.25, label: 'Baseline: 15 minutes' }, { h: 10 / 60, label: 'Stricter: 10 minutes' }],
  'critical-patch': [{ h: 30 * 24, label: 'Baseline: 30 days' }, { h: 15 * 24, label: 'Stricter: 15 days' }],
  'high-patch': [{ h: 90 * 24, label: 'Baseline: 90 days' }, { h: 30 * 24, label: 'Stricter: 30 days' }],
  'kev-patch': [{ h: 14 * 24, label: 'Baseline: 14 days' }, { h: 7 * 24, label: 'Stricter: 7 days' }],
  'leaver-revocation': [{ h: 24, label: 'Baseline: 24 hours' }, { h: 4, label: 'Stricter: 4 hours' }],
  'privileged-review': [{ h: 90 * 24, label: 'Baseline: every 90 days' }, { h: 30 * 24, label: 'Stricter: every 30 days' }],
  'access-review': [{ h: 180 * 24, label: 'Baseline: every 6 months' }, { h: 90 * 24, label: 'Stricter: every 90 days' }],
  'backup-frequency': [{ h: 7 * 24, label: 'Baseline: weekly' }, { h: 24, label: 'Recommended: daily' }],
  'breach-notification': [{ h: 72, label: 'Baseline: 72 hours' }, { h: 48, label: 'Stricter: 48 hours' }],
  'incident-reporting': [{ h: 24, label: 'Baseline: 24 hours' }, { h: 1, label: 'Stricter: 1 hour' }],
  'log-retention': [{ h: 365 * 24, label: 'Baseline: 12 months' }, { h: 730 * 24, label: 'Stricter: 24 months' }],
  'pentest-frequency': [{ h: 365 * 24, label: 'Baseline: annually' }, { h: 182 * 24, label: 'Stricter: every 6 months' }],
  'external-scan': [{ h: 91 * 24, label: 'Baseline: quarterly' }, { h: 30 * 24, label: 'Stricter: monthly' }],
  'training-frequency': [{ h: 365 * 24, label: 'Baseline: annually' }, { h: 182 * 24, label: 'Stricter: every 6 months' }],
  'review-cycle': [{ h: 365 * 24, label: 'Baseline: annually' }, { h: 182 * 24, label: 'Stricter: every 6 months' }],
  'tls-version': [{ v: '1.2', label: 'Baseline: TLS 1.2' }, { v: '1.3', label: 'Stricter: TLS 1.3' }],
  'aes-bits': [{ v: '128', label: 'Baseline: AES-128' }, { v: '256', label: 'Recommended: AES-256' }],
};
const ADVERB = { 24: 'daily', 168: 'weekly', [30 * 24]: 'monthly', [91 * 24]: 'quarterly', [182 * 24]: 'every 6 months', [365 * 24]: 'annually' };

// Swap a measured value ("5 days", "quarterly", "every 6 months") for a new phrase, without doubling "every".
function replaceValue(text, shown, phrase) {
  const i = text.indexOf(shown);
  if (i < 0) return text;
  let start = i, to = phrase;
  const before = text.slice(0, i);
  const adverb = /^(daily|weekly|monthly|quarterly|annually|yearly)$/i.test(phrase);
  if (/\b(every|each)\s+$/i.test(before)) {
    if (adverb) start = before.search(/\b(every|each)\s+$/i); // "every 24 months" → "annually"
    else to = phrase.replace(/^every\s+/i, '');
  } else if (/\bwithin\s+$/i.test(before) && /^every\s+/i.test(phrase)) to = phrase.replace(/^every\s+/i, '');
  return text.slice(0, start) + to + text.slice(i + shown.length);
}
function phraseForHours(h, shown) {
  const adverbial = /^(daily|weekly|monthly|quarterly|annually|yearly|semi-?annually|hourly)$/i.test(shown.trim());
  if (adverbial && ADVERB[Math.round(h)]) return ADVERB[Math.round(h)];
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h < 24 || h % 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = h / 24;
  if (/month/i.test(shown) && d % 30 === 0 && d >= 60) return `${d / 30} months`;
  if (/month/i.test(shown) && Math.abs(d - 182) < 2) return '6 months';
  if (/month/i.test(shown) && Math.abs(d - 365) < 2) return '12 months';
  if (/year/i.test(shown) && Math.abs(d - 365) < 2) return '1 year';
  return `${d} day${d === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------- Plain-language "why"
const WHY = {
  sections: {
    purpose: 'Readers and auditors need one paragraph that says why this policy exists. Without it, the rules have no context.',
    scope: 'Without a scope, nobody can tell who has to follow the policy or which systems it covers, so it cannot be enforced.',
    statements: 'The statements are the actual rules. Without them there is nothing to comply with or audit.',
    roles: 'Auditors check that someone is accountable for the policy and for the controls it requires.',
    enforcement: 'A rule with no consequence and no exception route is very hard to enforce consistently.',
    references: 'Linking to frameworks (ISO 27001, NIST, SOC 2…) shows exactly which requirements this policy satisfies.',
    header: 'The header is how auditors identify the policy and check it is current: owner, effective date and review cycle.',
  },
  mapping: 'Auditors trace each framework requirement to the rule that satisfies it. An unmapped statement counts for nothing in that trace, and coverage reports miss it.',
  noModal: 'Without "must" or "shall", a statement reads as a description or a suggestion, not a requirement. Nobody can be held to it.',
  wording: 'Words like "should", "may", "regularly" or "where possible" make a rule optional or impossible to test. An auditor cannot say whether it was followed.',
  coverage: (type) => `Every ${type} policy is expected to address this topic. Auditors look for it, and leaving it out is a common finding.`,
  bench: (m) => `The value is weaker than the common baseline (${m.baseline}), so the control may fail an audit. Source: ${m.source}.`,
  owner: 'The person or role named as owner must also appear in Roles & Responsibilities, with what they are accountable for.',
  actors: 'Statements give duties to people who are not listed in Roles & Responsibilities, so nobody has formally accepted those duties.',
  conflicts: 'Two rules set different values for the same thing, so people cannot follow both and auditors will flag the contradiction.',
};

// ---------------------------------------------------------------- Helpers
const RISK = {
  'access-control': 'unauthorized access to systems and data', 'acceptable-use': 'misuse of company devices, accounts and data',
  'incident-response': 'harm from security incidents through slow or inconsistent response', 'data-classification': 'disclosure or loss of sensitive information',
  backup: 'permanent data loss and long outages', vulnerability: 'attackers exploiting known weaknesses', 'third-party': 'security failures at suppliers and service providers',
};
const OWNER = {
  'access-control': 'Chief Information Security Officer', 'acceptable-use': 'Chief Information Security Officer', 'incident-response': 'Head of Security Operations',
  'data-classification': 'Chief Data Officer', backup: 'Head of IT Infrastructure', vulnerability: 'Chief Information Security Officer', 'third-party': 'Head of Procurement & Vendor Risk',
};
const SUBJECT = {
  'access-control': 'controlling access to information systems', 'acceptable-use': 'the acceptable use of information assets',
  'incident-response': 'detecting, reporting and responding to security incidents', 'data-classification': 'classifying and handling information',
  backup: 'backing up and recovering data', vulnerability: 'identifying and remediating technical vulnerabilities', 'third-party': 'managing security risk from suppliers and service providers',
};
const subjectOf = (title, type) => SUBJECT[type] || (title || 'information security').replace(/\s*(policy|standard)\s*$/i, '').trim().toLowerCase() || 'information security';
const short = (t, n = 90) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const nextMonthFirst = (today) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 10); };

// Rewrite a statement without "must"/"shall" into a mandatory one, if its shape allows.
function mandatoryRewrite(text, modal = 'must') {
  let t = text.trim().replace(/\.$/, '');
  let m;
  if ((m = /\b(should|ought to|could|might|may)\b/i.exec(t))) return `${t.slice(0, m.index)}${modal}${t.slice(m.index + m[0].length)}.`;
  if ((m = /\b(will|is to|are to|need to|needs to|have to|has to|is expected to|are expected to|is required to|are required to)\b/i.exec(t))) return `${t.slice(0, m.index)}${modal}${t.slice(m.index + m[0].length)}.`;
  if ((m = /\b(is|are)\s+(?!responsible\b)/i.exec(t)) && m.index > 0) return `${t.slice(0, m.index)}${modal} be ${t.slice(m.index + m[0].length)}.`;
  if ((m = /\b(is|are) responsible for (\w+)ing\b/i.exec(t))) return `${t.slice(0, m.index)}${modal} ${m[2]}${t.slice(m.index + m[0].length)}.`.replace(/\s+/g, ' ');
  // Subject + third-person verb: "IT disables accounts…" → "IT must disable accounts…"
  const words = t.split(' ');
  const SUBJECT_WORD = /^([A-Z][\w&/-]*|the|a|an|all|each|every|our|its|their|security|it|team|teams|staff|users?|employees?|managers?|personnel|owners?|vendors?|contractors?|administrators?|data|system|systems|information|operations)$/;
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    if (!words.slice(0, i).every((w) => SUBJECT_WORD.test(w))) break;
    const w = words[i];
    if (!/^[a-z]+s$/.test(w) || /^(is|was|has|does|this|its|us|as|always|access|process|address|business|plus)$/.test(w)) continue;
    const base = w === 'has' ? 'have' : /(ss|sh|ch|x|z|o)es$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? w.slice(0, -3) + 'y' : w.slice(0, -1);
    return `${words.slice(0, i).join(' ')} ${modal} ${base} ${words.slice(i + 1).join(' ')}`.trim() + '.';
  }
  // Plural subject + base verb: "Staff report incidents…" → "Staff must report incidents…"
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    if (!words.slice(0, i).every((w) => SUBJECT_WORD.test(w))) break;
    const w = words[i];
    if (/^[a-z]+$/.test(w) && !SUBJECT_WORD.test(w) && !/^(and|or|of|to|in|on|for|at|by|with|from|not|only|also|who|that|which)$/.test(w)) {
      return `${words.slice(0, i).join(' ')} ${modal} ${words.slice(i).join(' ')}`.trim() + '.';
    }
  }
  return null;
}

// Controls for a statement come from the shared auto-mapper, so the review and the editor agree.
// Strong matches first; if there are none, the single best possible match.
function suggestControls(s, controls, frameworks) {
  const list = suggestMappings(s.text, controls, { frameworks, exclude: [...(s.controls || []), ...(s.dismissed || [])] });
  const strong = list.filter((x) => x.confidence === 'high');
  return (strong.length ? strong : list.slice(0, 1)).map((x) => x.control);
}

// ---------------------------------------------------------------- Main
// Returns, for each failed checklist item (by index), { why, problems: [{ what, ref, options }], bulk? }.
// options: { label, preview, recommended?, action } where action is a plain object the editor applies.
export function explainReview(rv, p, { controls = [], frameworks = null, org = 'the organization', today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = new Map();
  const stmt = (sid) => p.statements.find((s) => s.id === sid);
  const numOf = (sid) => `4.${p.statements.findIndex((s) => s.id === sid) + 1}`;
  const issues = rv.lint.issues;
  const typeKey = rv.type?.key;
  const subject = subjectOf(p.title, typeKey);
  const preferFw = frameworks?.length ? frameworks : defaultFrameworks(p, controls, [...new Set(controls.map((c) => c.framework_code))]);
  const ctlLabel = (c) => `${c.framework_code} ${c.ref} · ${c.title}`;

  rv.checklist.forEach((item, idx) => {
    if (item.pass !== false) return;
    const help = { why: '', problems: [] };

    // ---------------- Structure: sections and header
    if (item.label === 'All eight sections are complete') {
      const missing = [...new Set(issues.filter((i) => i.cat === 'structure' && i.severity === 'error' && i.section !== 'header').map((i) => i.section))];
      help.why = missing.length === 1 ? WHY.sections[missing[0]] : 'A professional policy has all eight sections. Each missing one is something an auditor or reader will ask about.';
      for (const sec of missing) {
        const name = SECTIONS.find((s) => s.key === sec)?.title || sec;
        const target = `sec-${sec}`;
        const what = `The ${name} section is ${sec === 'statements' ? 'missing its rules' : sec === 'references' ? 'not linked to any framework yet' : 'empty'}.`;
        const opts = [];
        if (sec === 'purpose') {
          opts.push({ label: 'Standard wording', recommended: true, preview: `This policy establishes the requirements for ${subject} in order to protect the confidentiality, integrity and availability of ${org} information and to meet legal, regulatory and contractual obligations.` });
          opts.push({ label: 'Risk-focused, shorter', preview: `This policy reduces the risk of ${RISK[typeKey] || 'security incidents and data loss'} by setting the minimum requirements for ${subject} that everyone at ${org} must follow.` });
          opts.forEach((o) => { o.action = { type: 'field', field: 'purpose', value: o.preview }; });
        } else if (sec === 'scope') {
          opts.push({ label: 'Broad: everyone and every system', recommended: true, preview: `This policy applies to all employees, contractors, consultants and third parties who access ${org} information or systems, and to all systems, applications, devices and data owned or managed by ${org}, on premises or in the cloud.` });
          opts.push({ label: 'Narrower: staff and work systems', preview: `This policy applies to all employees and contractors of ${org} and to the information systems and data they use for work.` });
          opts.forEach((o) => { o.action = { type: 'field', field: 'scope', value: o.preview }; });
        } else if (sec === 'enforcement') {
          opts.push({ label: 'Standard clause', recommended: true, preview: `Compliance with this policy shall be verified through internal audit and continuous monitoring. Violations must be reported to the policy owner and may result in disciplinary action up to and including termination of employment or contract. Deviations must be approved in advance through the policy exception process.` });
          opts.push({ label: 'Concise', preview: 'Non-compliance may result in disciplinary action. Any deviation requires an approved exception before it occurs, and compliance is checked during internal audits.' });
          opts.forEach((o) => { o.action = { type: 'field', field: 'enforcement', value: o.preview }; });
        } else if (sec === 'roles') {
          const owner = p.owner || OWNER[typeKey] || 'Policy Owner';
          const four = [
            { role: owner, responsibility: 'Owns this policy, approves changes and exceptions, and ensures it is reviewed at least annually.' },
            { role: 'Custodian (IT / Security Operations)', responsibility: 'Implements and operates the controls this policy requires and keeps evidence that they work.' },
            { role: 'Users', responsibility: 'All in-scope personnel must read, acknowledge and follow this policy, and must report suspected violations.' },
            { role: 'Management', responsibility: 'Managers must ensure their teams follow this policy and complete required acknowledgements.' },
          ];
          opts.push({ label: 'Add the four standard roles', recommended: true, preview: four.map((r) => r.role).join(' · '), action: { type: 'roles', roles: four } });
          opts.push({ label: 'Add owner and users only', preview: `${four[0].role} · Users`, action: { type: 'roles', roles: [four[0], four[2]] } });
        } else if (sec === 'references') {
          const items = p.statements.filter((x) => x.text && !(x.controls || []).length).map((x) => ({ sid: x.id, best: suggestControls(x, controls, preferFw) })).filter((x) => x.best.length);
          if (items.length) opts.push({ label: `Map ${items.length === 1 ? 'the statement' : `all ${items.length} statements`} to the suggested controls`, recommended: true, preview: items.slice(0, 3).map((x) => `${numOf(x.sid)} → ${x.best.map((c) => `${c.framework_code} ${c.ref}`).join(', ')}`).join(' · ') + (items.length > 3 ? ' …' : ''), action: { type: 'mapMany', items: items.map((x) => ({ sid: x.sid, ids: x.best.map((c) => c.id) })) } });
        } else if (sec === 'statements') {
          const reqs = (rv.requirements || []).filter((r) => !r.met).slice(0, 3);
          if (reqs.length) opts.push({ label: `Insert ${reqs.length} recommended statements`, recommended: true, preview: reqs.map((r) => r.suggest).join(' '), action: { type: 'insertMany', items: reqs.map((r) => ({ text: r.suggest, controls: r.controlIds || [] })) } });
        }
        opts.push({ label: 'I\'ll write it myself', preview: `Jump to section ${SECTIONS.find((s) => s.key === sec)?.n}`, action: { type: 'goto', target } });
        help.problems.push({ what, ref: { target, label: name }, options: opts });
      }
    } else if (item.label === 'Owner, effective date and an annual review cycle are set') {
      help.why = WHY.sections.header;
      for (const i of issues.filter((x) => x.section === 'header' && x.severity !== 'info')) {
        const opts = [];
        let what = i.message;
        if (i.field === 'owner') {
          what = 'No one is named as the policy owner.';
          const cands = [...new Set([OWNER[typeKey], 'Chief Information Security Officer', 'Head of IT'].filter(Boolean))].slice(0, 2);
          cands.forEach((c, k) => opts.push({ label: c, recommended: !k, preview: `Owner: ${c}`, action: { type: 'field', field: 'owner', value: c } }));
        } else if (i.field === 'effective_date') {
          what = 'The policy has no effective date, so nobody knows when it takes effect or when it is due for review.';
          opts.push({ label: 'From today', recommended: true, preview: `Effective ${today}`, action: { type: 'field', field: 'effective_date', value: today } });
          opts.push({ label: 'From the 1st of next month', preview: `Effective ${nextMonthFirst(today)}`, action: { type: 'field', field: 'effective_date', value: nextMonthFirst(today) } });
        } else if (i.field === 'review_cycle_months') {
          what = `The review cycle is ${p.review_cycle_months} months. Policies are expected to be reviewed at least once a year.`;
          opts.push({ label: 'Review annually', recommended: true, preview: 'Review cycle: 12 months', action: { type: 'field', field: 'review_cycle_months', value: 12 } });
          opts.push({ label: 'Review every 6 months', preview: 'Review cycle: 6 months', action: { type: 'field', field: 'review_cycle_months', value: 6 } });
        }
        opts.push({ label: 'Edit the header', preview: 'Jump to section 1', action: { type: 'goto', target: 'sec-header' } });
        help.problems.push({ what, ref: { target: 'sec-header', label: 'Header' }, options: opts });
      }
    } else if (item.label === 'Every statement is mapped to a framework control') {
      help.why = WHY.mapping;
      const unmapped = issues.filter((i) => i.section === 'references' && i.statementId);
      const bulk = [];
      for (const i of unmapped) {
        const s = stmt(i.statementId);
        if (!s) continue;
        const best = suggestControls(s, controls, preferFw);
        const opts = [];
        if (best.length) {
          opts.push({ label: best.length === 1 ? `Map to ${best[0].framework_code} ${best[0].ref}` : `Keep the ${best.length} suggested controls`, recommended: true, preview: best.map((c) => best.length === 1 ? ctlLabel(c) : `${c.framework_code} ${c.ref}`).join(' · '), action: { type: 'map', sid: s.id, ids: best.map((c) => c.id) } });
          bulk.push({ sid: s.id, ids: best.map((c) => c.id) });
          if (best.length > 1) opts.push({ label: `Only ${best[0].framework_code} ${best[0].ref}`, preview: ctlLabel(best[0]), action: { type: 'map', sid: s.id, ids: [best[0].id] } });
        }
        opts.push({ label: 'Choose controls myself', preview: 'Open the control picker with suggestions', action: { type: 'pick', sid: s.id } });
        help.problems.push({ what: `${numOf(s.id)} “${short(s.text)}” is not linked to any framework control.`, ref: { target: `st-${s.id}`, label: numOf(s.id) }, options: opts });
      }
      if (bulk.length > 1) help.bulk = { label: `Map all ${bulk.length} statements to their suggested controls`, action: { type: 'mapMany', items: bulk } };
    } else if (item.label === 'Every statement uses "must" or "shall"') {
      help.why = WHY.noModal;
      for (const i of issues.filter((x) => x.cat === 'language' && x.severity === 'error' && x.statementId)) {
        const s = stmt(i.statementId);
        if (!s) continue;
        const opts = [];
        const must = mandatoryRewrite(s.text, 'must'), shall = mandatoryRewrite(s.text, 'shall');
        if (must) opts.push({ label: 'Rewrite with “must”', recommended: true, preview: must, action: { type: 'rewrite', sid: s.id, text: must } });
        if (shall && shall !== must) opts.push({ label: 'Rewrite with “shall”', preview: shall, action: { type: 'rewrite', sid: s.id, text: shall } });
        opts.push({ label: 'It\'s context, not a rule: move it to Purpose', preview: 'Removes it from the statements and adds it to section 2', action: { type: 'toPurpose', sid: s.id } });
        opts.push({ label: 'Delete this statement', preview: 'Removes it from the policy', action: { type: 'remove', sid: s.id } });
        help.problems.push({ what: `${numOf(s.id)} “${short(s.text)}” describes something but doesn't require it.`, ref: { target: `st-${s.id}`, label: numOf(s.id) }, options: opts });
      }
    } else if (item.label === 'No non-mandatory or unmeasurable wording') {
      help.why = WHY.wording;
      for (const i of issues.filter((x) => x.cat === 'language' && x.severity === 'warning' && x.statementId)) {
        const s = stmt(i.statementId);
        if (!s) continue;
        const opts = (i.fixes || []).slice(0, 3).map((fx, k) => ({
          label: fx.to ? `Use “${fx.to}”` : (fx.label || 'Remove it'), recommended: !k,
          preview: applyFix(s.text, fx), action: { type: 'wording', sid: s.id, fix: fx },
        }));
        opts.push({ label: 'Rephrase it myself', preview: `Jump to statement ${numOf(s.id)}`, action: { type: 'goto', target: `st-${s.id}` } });
        const word = /"([^"]+)"/.exec(i.message)?.[1];
        help.problems.push({ what: `${numOf(s.id)} uses ${word ? `“${word}”` : 'wording'} — ${i.tip || 'it makes the rule optional or untestable.'}`, ref: { target: `st-${s.id}`, label: numOf(s.id) }, options: opts });
      }
    } else if (item.cat === 'coverage') {
      const r = (rv.requirements || []).find((x) => x.topic === item.label);
      if (r) {
        help.why = WHY.coverage(rv.type?.name || 'policy of this type');
        const alt = ALT[`${typeKey}:${r.id}`];
        const opts = [{ label: 'Recommended wording', recommended: true, preview: r.suggest, action: { type: 'insert', text: r.suggest, controls: r.controlIds || [] } }];
        if (alt) opts.push({ label: alt[0], preview: alt[1], action: { type: 'insert', text: alt[1], controls: r.controlIds || [] } });
        opts.push({ label: 'Write my own', preview: 'Adds an empty statement, already mapped to the matching controls', action: { type: 'insert', text: '', controls: r.controlIds || [], focus: true } });
        help.problems.push({ what: `Nothing in this policy covers “${r.topic.toLowerCase()}”.`, options: opts });
      }
    } else if (item.cat === 'benchmarks') {
      const m = rv.metrics.find((x) => !x.pass && item.label.startsWith(`${x.metric}: ${x.shown}`));
      const s = m && stmt(m.statementId);
      if (m && s) {
        help.why = WHY.bench(m);
        const opts = (BENCH_TARGETS[m.id] || []).map((t, k) => {
          const to = t.v ? (m.id === 'tls-version' ? `TLS ${t.v}` : `AES-${t.v}`) : t.unit === 'characters' ? `${t.n} characters` : t.unit === 'count' ? m.shown.replace(/^\d+/, String(t.n)) : t.label.split(': ')[1];
          const text = replaceValue(s.text, m.shown, to);
          return { label: t.label, recommended: !k, preview: text, action: { type: 'rewrite', sid: s.id, text } };
        }).filter((o) => o.preview !== s.text);
        opts.push({ label: 'Keep it and record an exception', preview: 'Opens Exceptions to document why this value is acceptable', action: { type: 'href', href: '#/exceptions' } });
        help.problems.push({ what: `${m.num} sets ${m.metric.toLowerCase()} to ${m.shown}, weaker than the ${m.baseline} baseline.`, ref: { target: `st-${s.id}`, label: m.num }, options: opts });
      }
    } else if (item.label === 'Policy owner is described in Roles') {
      help.why = WHY.owner;
      const opts = [{ label: `Add “${p.owner}” as a role`, recommended: true, preview: `${p.owner}: owns this policy, approves changes and exceptions, and ensures it is reviewed at least annually.`, action: { type: 'roles', roles: [{ role: p.owner, responsibility: 'Owns this policy, approves changes and exceptions, and ensures it is reviewed at least annually.' }] } }];
      const ownerRole = p.roles.findIndex((r) => /owner/i.test(r.role));
      if (ownerRole >= 0) opts.push({ label: `Rename “${p.roles[ownerRole].role}” to “${p.owner}”`, preview: `${p.owner}: ${short(p.roles[ownerRole].responsibility || '', 70)}`, action: { type: 'renameRole', index: ownerRole, role: p.owner } });
      const named = p.roles.find((r) => r.role && !/^(users?|management|custodian)|owner/i.test(r.role));
      if (named && named.role !== p.owner) opts.push({ label: `Make “${named.role}” the owner`, preview: `Owner: ${named.role}`, action: { type: 'field', field: 'owner', value: named.role } });
      help.problems.push({ what: `“${p.owner}” is named as the owner in the header but is not listed in Roles & Responsibilities.`, ref: { target: 'sec-roles', label: 'Roles' }, options: opts });
    } else if (item.label === 'Everyone given duties in statements has a defined role') {
      help.why = WHY.actors;
      const names = (item.detail || '').split(',').map((x) => x.trim()).filter(Boolean);
      const all = names.map((n) => ({ role: n, responsibility: 'Carries out the duties assigned to them in the policy statements.' }));
      for (const n of names) {
        help.problems.push({ what: `“${n}” is given duties in the statements but has no role defined.`, ref: { target: 'sec-roles', label: 'Roles' }, options: [
          { label: `Add “${n}” as a role`, recommended: true, preview: `${n}: carries out the duties assigned to them in the policy statements.`, action: { type: 'roles', roles: [{ role: n, responsibility: 'Carries out the duties assigned to them in the policy statements.' }] } },
          { label: 'Edit roles myself', preview: 'Jump to section 5', action: { type: 'goto', target: 'sec-roles' } },
        ] });
      }
      if (names.length > 1) help.bulk = { label: `Add all ${names.length} as roles`, action: { type: 'roles', roles: all } };
    } else if (item.cat === 'consistency') {
      help.why = WHY.conflicts;
      help.problems.push({ what: item.detail ? `Conflicting values: ${item.detail}.` : 'Two statements set different values for the same thing.', options: (item.refs || []).map((r) => ({ label: `Go to ${r.label}`, preview: 'Change one so both agree', action: { type: 'goto', target: r.target } })) });
    }
    if (help.problems.length || help.why) out.set(idx, help);
  });
  return out;
}
