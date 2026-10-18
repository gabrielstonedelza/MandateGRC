// MandateGRC Policy Linter — shared by the browser (live feedback) and the server
// (workflow gate). Encodes the anatomy of a professional security policy and its
// golden rules: use "must"/"shall", be specific and measurable, map to frameworks.
// On top of form, it reviews substance: coverage of must-have topics per policy type,
// numeric benchmarks, and consistency (see criteria.js). Everything runs locally.
import { POLICY_TYPES, BENCHMARKS, ANTI_PATTERNS, ACTORS } from './criteria.js';

export const SECTIONS = [
  { key: 'header', n: 1, title: 'Header', hint: 'Policy name, version, owner, effective date, review cycle, approval' },
  { key: 'purpose', n: 2, title: 'Purpose', hint: 'One paragraph: why this policy exists' },
  { key: 'scope', n: 3, title: 'Scope', hint: 'Who and what it applies to (employees, systems, contractors)' },
  { key: 'statements', n: 4, title: 'Policy Statements', hint: 'The numbered rules, written as "must / shall" statements' },
  { key: 'roles', n: 5, title: 'Roles & Responsibilities', hint: 'Who does what (owner, custodian, users, management)' },
  { key: 'enforcement', n: 6, title: 'Compliance & Enforcement', hint: 'What happens if someone violates it' },
  { key: 'references', n: 7, title: 'References', hint: 'The frameworks it maps to (NIST, ISO 27001, etc.)' },
  { key: 'history', n: 8, title: 'Revision History', hint: 'Version table' },
];

// Words that make a rule optional rather than mandatory. Each rule offers one-click
// replacements (`fixes`): `to: ''` removes the phrase. `fixes` may be a function of the
// matched text and the whole statement, so suggestions fit the context.
const REMOVE = (label = 'Remove it') => [{ to: '', label }];
const NON_MANDATORY = [
  { re: /\bshould not\b/i, word: 'should not', fixes: [{ to: 'must not' }] },
  { re: /\bshould\b/i, word: 'should', fixes: [{ to: 'must' }, { to: 'shall' }] },
  { re: /\bought to\b/i, word: 'ought to', fixes: [{ to: 'must' }] },
  { re: /\b(?:will |shall |must |should )?(?:try|tries|attempt|attempts|strive|strives|endeavou?r|endeavou?rs|aim|aims) to\b/i, word: 'try to', tip: 'State the requirement outright.', fixes: [{ to: 'must' }] },
  { re: /\b(?:is|are) (?:encouraged|recommended|advised|expected) to\b/i, word: 'encouraged/recommended', tip: 'Recommendations are guidance, not policy.', fixes: [{ to: 'must' }] },
  { re: /\b(?:on a )?best[- ]efforts?(?: basis)?\b/i, word: 'best effort', tip: 'Define the required outcome instead of effort.', fixes: REMOVE() },
  { re: /\bideally,?\s*/i, word: 'ideally', tip: 'State what is required, not what is ideal.', fixes: REMOVE() },
  { re: /\bwe hope(?: that)?\s*/i, word: 'we hope', tip: 'Policies mandate; they do not hope.', fixes: REMOVE() },
  { re: /\bmay\b(?! (?:not|only))/i, word: 'may', tip: '"May" is permissive. Use "must" for a requirement, or "may only … when …" for a controlled permission.', fixes: [{ to: 'must' }, { to: 'may only', label: 'may only … (then add the condition)' }] },
];
// Weak verbs that only matter when the statement has no "must"/"shall" at all.
const WEAK_MANDATE = { re: /\b(?:will|need to|needs to|has to|have to|(?:is|are) required to)\b/i, word: 'will / need to' };

// Context-aware replacements for "adequate", "appropriate" and similar.
function standardFor(text) {
  if (/encrypt|cipher|crypto/i.test(text)) return [{ to: 'AES-256' }, { to: 'TLS 1.2 or higher' }];
  if (/password|passphrase|credential/i.test(text)) return [{ to: 'at least 14-character' }];
  if (/access|permission|privilege|rights/i.test(text)) return [{ to: 'least-privilege, role-based' }];
  if (/approv|authori[sz]/i.test(text)) return [{ to: 'documented, written' }];
  if (/train|awareness/i.test(text)) return [{ to: 'annual' }];
  if (/log|monitor/i.test(text)) return [{ to: 'centrally collected, tamper-evident' }];
  if (/backup|retain|retention/i.test(text)) return [{ to: 'encrypted, off-site' }];
  return [{ to: 'documented and approved' }];
}
// Words that cannot be measured or audited.
const VAGUE = [
  { re: /\b(?:periodically|regularly|from time to time|routinely|frequently|on a regular basis|occasionally)\b/i, word: 'periodically/regularly', tip: 'Specify a frequency.',
    fixes: [{ to: 'quarterly' }, { to: 'monthly' }, { to: 'annually' }, { to: 'every 90 days' }] },
  { re: /\b(?:in a timely (?:manner|fashion)|promptly|as soon as (?:possible|practical|practicable)|asap|quickly|immediately|without delay|without undue delay)\b/i, word: 'timely/promptly', tip: 'Specify a deadline.',
    fixes: [{ to: 'within 24 hours' }, { to: 'within 1 hour' }, { to: 'within 72 hours' }] },
  { re: /\btimely\b/i, word: 'timely', tip: 'Specify the deadline, e.g. "within 24 hours of discovery".' },
  { re: /\b(?<!(?:when|if|where|as) )(?:reasonable|adequate|sufficient|appropriate|appropriately|proper|properly|suitable|necessary)\b/i, word: 'adequate/appropriate', tip: 'Define the measurable standard (e.g. "AES-256", "14 characters", "TLS 1.2+").',
    fixes: (m, text) => (/ly$/i.test(m) ? REMOVE() : [...standardFor(text), ...REMOVE()]) },
  { re: /,?\s*\b(?:where possible|if possible|whenever possible|where practical|where practicable|where feasible|as needed|when necessary|if necessary|as required|as appropriate|when appropriate|if appropriate|where appropriate|when needed|if needed)\b,?/i, word: 'where possible', tip: 'Escape clauses make rules unenforceable. Route deviations through the exception process.', fixes: REMOVE() },
  { re: /\b(?:generally|normally|typically|usually|mostly|in most cases|in principle),?\s*/i, word: 'generally/usually', tip: 'A rule applies or it does not.', fixes: REMOVE() },
  { re: /,?\s*\b(?:etc\.?|and so on|and so forth)/i, word: 'etc.', tip: 'List the items explicitly so the rule is testable.', fixes: REMOVE('Remove it, then list every item') },
  { re: /\band\/or\b/i, word: 'and/or', tip: 'Say which one you mean.', fixes: [{ to: 'and' }, { to: 'or' }] },
  { re: /\b(?:strong|secure|robust|complex|good) (?:passwords?|encryption|authentication)\b/i, word: 'strong/secure', tip: 'Define "strong": length, algorithm or standard.',
    fixes: (m) => (/password/i.test(m) ? [{ to: 'passwords of at least 14 characters' }] : /encrypt/i.test(m) ? [{ to: 'AES-256 encryption' }] : [{ to: 'multi-factor authentication' }]) },
];

const MEASURABLE = /\d|\b(?:annually|yearly|quarterly|monthly|weekly|daily|hourly|every|within|before|prior to|no later than|at least|at most|minimum|maximum|each|all|never|only|unique|before)\b/i;
const MANDATORY = /\b(?:must|shall)\b/i;
const PROHIBITION = /\b(?:must not|shall not|must never|shall never|prohibited)\b/i;

// Build the replacement options for a matched phrase. `from` is the regex that applyFix replaces.
function fixesFor(rule, t) {
  const m = (t.match(rule.re) || [''])[0];
  const list = typeof rule.fixes === 'function' ? rule.fixes(m, t) : rule.fixes || [];
  return list.map((f) => ({ from: rule.re.source, to: f.to, label: f.label || (f.to ? `“${f.to}”` : f.label) }));
}

export function analyzeStatement(text = '') {
  const t = String(text || '').trim();
  const findings = [];
  if (!t) {
    findings.push({ severity: 'error', message: 'Empty statement.' });
    return findings;
  }
  if (!MANDATORY.test(t)) {
    // If a non-mandatory phrase ("should", "will try to") is flagged below, its fix covers this too.
    const weak = NON_MANDATORY.some((w) => w.re.test(t)) ? null : t.match(WEAK_MANDATE.re);
    findings.push({ severity: 'error', message: 'No "must" or "shall". Every policy statement has to be mandatory.', tip: weak ? `Replace "${weak[0]}" with "must".` : 'Rewrite as "[Who] must [do what] [by when / how often]."',
      fixes: weak ? [{ from: WEAK_MANDATE.re.source, to: 'must', label: '“must”', once: true }] : [] });
  }
  for (const w of NON_MANDATORY) {
    if (!w.re.test(t)) continue;
    const fixes = fixesFor(w, t);
    findings.push({ severity: 'warning', word: w.word, message: `Non-mandatory language: "${(t.match(w.re) || [w.word])[0].trim()}".`, tip: w.tip || `Replace with "${fixes[0].to}".`, fixes });
  }
  for (const w of VAGUE) {
    if (!w.re.test(t)) continue;
    findings.push({ severity: 'warning', word: w.word, message: `Not measurable: "${(t.match(w.re) || [w.word])[0].replace(/^[,\s]+|[,\s]+$/g, '')}".`, tip: w.tip, fixes: fixesFor(w, t) });
  }
  if (MANDATORY.test(t) && !PROHIBITION.test(t) && !MEASURABLE.test(t)) {
    findings.push({ severity: 'info', message: 'No measurable criterion found.', tip: 'Add a frequency, deadline, threshold or standard so an auditor can test it.' });
  }
  const words = t.split(/\s+/).length;
  if (words > 60) findings.push({ severity: 'info', message: `Long statement (${words} words).`, tip: 'Split into separate numbered statements. One rule per statement.' });
  if ((t.match(/\b(?:must|shall)\b/gi) || []).length > 3) findings.push({ severity: 'info', message: 'Several requirements in one statement.', tip: 'Split so each can be mapped and tested separately.' });
  // Keep the first fix as `fix` for older callers.
  for (const f of findings) f.fix = f.fixes?.[0] || null;
  return findings;
}

// Replace the matched phrase, then tidy spacing, punctuation and capitalisation.
export function applyFix(text, fix) {
  const re = new RegExp(fix.from, fix.once ? 'i' : 'gi');
  let out = text.replace(re, (m, ...args) => {
    const at = args[args.length - 2];
    if (!fix.to) {
      if (m.startsWith(',') && m.endsWith(',')) return ',';
      // Keep a sentence-ending full stop that the removed phrase (e.g. "etc.") swallowed.
      return m.endsWith('.') && !text.slice(at + m.length).trim() ? '.' : ' ';
    }
    const lead = m.match(/^[,\s]*/)[0];
    const core = m.slice(lead.length);
    return lead + (core[0] && core[0] === core[0].toUpperCase() && core[0] !== core[0].toLowerCase() ? fix.to[0].toUpperCase() + fix.to.slice(1) : fix.to);
  });
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.').replace(/^[\s,]+/, '').trimEnd();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const WHO = /\b(?:employees?|staff|personnel|workforce|contractors?|consultants?|third[- ]part(?:y|ies)|vendors?|suppliers?|users?|everyone|temporary|interns?|members?)\b/i;
const WHAT = /\b(?:systems?|data|information|assets?|devices?|applications?|networks?|services?|facilit(?:y|ies)|records?|endpoints?|infrastructure|cloud|platforms?|databases?)\b/i;
const WHY = /\b(?:to|so that|in order to|ensure|protect|reduce|minimi[sz]e|establish|prevent|defines?|meet|comply)\b/i;
const CONSEQUENCE = /\b(?:disciplinary|termination|terminate|sanction|consequence|dismissal|penalt(?:y|ies)|legal action|revocation|revoke)\b/i;

const ROLE_SLOTS = [
  { key: 'Owner', re: /owner/i },
  { key: 'Custodian', re: /custodian|administrator|operations|\bIT\b|engineer|team|soc\b|center/i },
  { key: 'Users', re: /\busers?\b|personnel|employees?|staff|workforce/i },
  { key: 'Management', re: /management|managers?|leadership|executive|board/i },
];

export function lintPolicy(p, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const controlsById = opts.controlsById || null;
  const issues = [];
  // Every issue has a review category: structure | language | coverage | benchmarks | consistency.
  const add = (section, severity, message, extra = {}) => issues.push({
    section, severity, message, cat: extra.cat || (section === 'statements' ? 'language' : 'structure'), ...extra,
  });

  // 1. Header
  if (!p.title || p.title.trim().length < 4) add('header', 'error', 'Policy name is missing.', { field: 'title' });
  else if (!/\b(policy|standard)\b/i.test(p.title)) add('header', 'info', 'Policy names conventionally end with "Policy".', { field: 'title' });
  if (!p.owner || !p.owner.trim()) add('header', 'error', 'Policy owner is missing. Accountability needs one named owner.', { field: 'owner' });
  if (!p.effective_date) add('header', p.status === 'published' ? 'error' : 'warning', 'Effective date is not set.', { field: 'effective_date' });
  const cycle = Number(p.review_cycle_months || 0);
  if (!cycle) add('header', 'error', 'Review cycle is not set.', { field: 'review_cycle_months' });
  else if (cycle > 12) add('header', 'warning', `Review cycle is ${cycle} months. The professional standard is annual review (12 months).`, { field: 'review_cycle_months' });
  if (p.status === 'published' && p.next_review_date && p.next_review_date < today) add('header', 'error', `Review overdue since ${p.next_review_date}.`, { field: 'next_review_date' });
  if ((p.status === 'approved' || p.status === 'published') && !p.approved_at) add('header', 'error', 'Approval record is missing.');

  // 2. Purpose
  const purpose = (p.purpose || '').trim();
  if (!purpose) add('purpose', 'error', 'Purpose is empty. State why this policy exists in one paragraph.', { field: 'purpose' });
  else {
    const paras = purpose.split(/\n\s*\n/).filter(Boolean).length;
    const words = purpose.split(/\s+/).length;
    if (paras > 1) add('purpose', 'warning', `Purpose has ${paras} paragraphs; it should be one.`, { field: 'purpose' });
    if (words > 150) add('purpose', 'warning', `Purpose is ${words} words. Keep it to one focused paragraph (≤150 words).`, { field: 'purpose' });
    if (words < 12) add('purpose', 'warning', 'Purpose is too thin to explain why the policy exists.', { field: 'purpose' });
    if (!WHY.test(purpose)) add('purpose', 'info', 'Purpose does not clearly state the "why" (e.g. "to protect…", "to ensure…").', { field: 'purpose' });
  }

  // 3. Scope
  const scope = (p.scope || '').trim();
  if (!scope) add('scope', 'error', 'Scope is empty. Define who and what this policy applies to.', { field: 'scope' });
  else {
    if (!WHO.test(scope)) add('scope', 'warning', 'Scope does not say WHO it applies to (employees, contractors, third parties…).', { field: 'scope' });
    if (!WHAT.test(scope)) add('scope', 'warning', 'Scope does not say WHAT it applies to (systems, data, devices…).', { field: 'scope' });
  }

  // 4. Statements
  const statements = Array.isArray(p.statements) ? p.statements : [];
  if (!statements.length) add('statements', 'error', 'No policy statements. This is the body of the policy.', { cat: 'structure' });
  else if (statements.length < 3) add('statements', 'info', 'Fewer than 3 statements. Most policies need more rules than this.', { cat: 'structure' });
  const seen = new Map();
  statements.forEach((s, i) => {
    const num = `4.${i + 1}`;
    for (const f of analyzeStatement(s.text)) add('statements', f.severity, `${num}: ${f.message}`, { statementId: s.id, tip: f.tip, fix: f.fix, fixes: f.fixes, num });
    const norm = String(s.text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (norm && seen.has(norm)) add('statements', 'warning', `${num} duplicates ${seen.get(norm)}.`, { statementId: s.id, num, cat: 'consistency' });
    else if (norm) seen.set(norm, num);
  });

  // 5. Roles
  const roles = Array.isArray(p.roles) ? p.roles.filter((r) => (r.role || '').trim()) : [];
  if (!roles.length) add('roles', 'error', 'No roles defined. State who does what.');
  else {
    for (const slot of ROLE_SLOTS) {
      if (!roles.some((r) => slot.re.test(r.role))) add('roles', 'warning', `No "${slot.key}" role defined.`);
    }
    roles.forEach((r) => { if (!(r.responsibility || '').trim()) add('roles', 'warning', `Role "${r.role}" has no responsibility described.`); });
  }

  // 6. Enforcement
  const enf = (p.enforcement || '').trim();
  if (!enf) add('enforcement', 'error', 'Compliance & Enforcement is empty. State what happens on violation.', { field: 'enforcement' });
  else {
    if (!CONSEQUENCE.test(enf)) add('enforcement', 'warning', 'Enforcement does not state consequences (e.g. disciplinary action).', { field: 'enforcement' });
    if (!/exception/i.test(enf)) add('enforcement', 'info', 'Mention how exceptions are requested and approved.', { field: 'enforcement' });
    if (!/(monitor|audit|review|verif|test)/i.test(enf)) add('enforcement', 'info', 'State how compliance is verified (audit, monitoring, testing).', { field: 'enforcement' });
  }

  // 7. References
  const mapped = new Set(Array.isArray(p.ref_controls) ? p.ref_controls : []);
  statements.forEach((s, i) => {
    const c = Array.isArray(s.controls) ? s.controls : [];
    c.forEach((id) => mapped.add(id));
    if (s.text && !c.length) add('references', 'warning', `4.${i + 1} is not mapped to any framework control.`, { statementId: s.id, num: `4.${i + 1}` });
  });
  if (!mapped.size) add('references', 'error', 'Not mapped to any framework. Mapping is what makes a policy GRC-grade.');
  let frameworks = new Set();
  if (controlsById) {
    mapped.forEach((id) => { const c = controlsById.get ? controlsById.get(id) : controlsById[id]; if (c) frameworks.add(c.framework_code); });
    if (mapped.size && frameworks.size === 1) add('references', 'info', 'Mapped to only one framework. Use crosswalk suggestions to map to others you report against.');
  }

  // 8. History: informational only.
  if ((!p.version || p.version === '0.0') && p.status === 'draft') add('history', 'info', 'No approved versions yet. First approval creates v1.0.');

  // Substance: coverage, benchmarks and consistency.
  const substance = substanceChecks(p, statements, roles, opts, add);

  const weights = { error: 12, warning: 4, info: 1 };
  const penalty = issues.reduce((a, i) => a + weights[i.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const sections = {};
  for (const s of SECTIONS) {
    const si = issues.filter((i) => i.section === s.key);
    sections[s.key] = {
      errors: si.filter((i) => i.severity === 'error').length,
      warnings: si.filter((i) => i.severity === 'warning').length,
      infos: si.filter((i) => i.severity === 'info').length,
    };
    sections[s.key].complete = sections[s.key].errors === 0;
  }
  return {
    score,
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F',
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues,
    sections,
    substance,
    stats: { statements: statements.length, mapped: mapped.size, frameworks: frameworks.size },
  };
}

// =====================================================================
// Substance review
// =====================================================================
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, thirty: 30, 'twenty-four': 24, 'forty-eight': 48, 'seventy-two': 72, ninety: 90 };
const UNIT_HOURS = { minute: 1 / 60, min: 1 / 60, hour: 1, hr: 1, day: 24, week: 168, month: 730, year: 8760 };
const ADVERB_HOURS = [
  [/\bhourly\b/i, 1], [/\bdaily\b|\bevery day\b|\bonce a day\b/i, 24], [/\bweekly\b|\bevery week\b|\bonce a week\b/i, 168],
  [/\bfortnightly\b/i, 336], [/\bmonthly\b|\bevery month\b|\bonce a month\b/i, 730], [/\bquarterly\b|\bevery quarter\b/i, 2190],
  [/\bsemi-?annual(ly)?\b|\bbi-?annual(ly)?\b|\btwice a year\b|\bevery six months\b/i, 4380],
  [/\bannual(ly)?\b|\byearly\b|\bonce a year\b|\bevery year\b/i, 8760],
];
const DURATION_RE = /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|thirty|ninety|twenty-four|forty-eight|seventy-two)\s*-?\s*(business |working |calendar )?(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi;

const toNum = (v) => (/^\d/.test(v) ? Number(v) : NUMBER_WORDS[v.toLowerCase()]);

// All durations in a clause, in hours. `freq` marks intervals ("every 90 days", "quarterly").
export function parseDurations(text) {
  const out = [];
  for (const m of String(text).matchAll(DURATION_RE)) {
    const n = toNum(m[1]);
    if (n == null) continue;
    const unit = m[3].toLowerCase().replace(/s$/, '').replace(/^mins?$/, 'min').replace(/^hrs?$/, 'hr');
    let hours = n * UNIT_HOURS[unit];
    if (m[2] && /business|working/i.test(m[2]) && unit === 'day') hours *= 7 / 5;
    const before = String(text).slice(Math.max(0, m.index - 22), m.index);
    out.push({ hours, index: m.index, text: m[0], freq: /(every|each|once (a|per|every))\s*$/i.test(before) });
  }
  for (const [re, hours] of ADVERB_HOURS) {
    const m = re.exec(text);
    if (m) out.push({ hours, index: m.index, text: m[0], freq: true });
  }
  return out.sort((a, b) => a.index - b.index);
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
export const formatHours = (h) => {
  if (h < 1) return plural(Math.round(h * 60), 'minute');
  if (h <= 72) return plural(+h.toFixed(1), 'hour');
  if (h >= 8760 && h % 8760 < 24) return plural(Math.round(h / 8760), 'year');
  return plural(Math.round(h / 24), 'day');
};

const clausesOf = (text) => String(text).split(/;|,\s*(?:and|but|while|whereas)\s+|\.\s+(?=[A-Z])/).map((c) => c.trim()).filter(Boolean);

function measure(b, clause) {
  if (b.kind === 'duration') {
    const ds = parseDurations(clause);
    if (!ds.length) return null;
    const pick = (b.prefer === 'frequency' && ds.find((d) => d.freq)) || ds[0];
    return { value: pick.hours, shown: pick.text };
  }
  if (b.kind === 'count') {
    const m = new RegExp('(\\d+)\\s+' + b.unit.source, 'i').exec(clause);
    return m ? { value: Number(m[1]), shown: m[0].replace(/\s+/g, ' ') } : null;
  }
  if (b.kind === 'version') {
    const m = /\btls\s*v?(\d\.\d)/i.exec(clause);
    return m ? { value: Number(m[1]), shown: `TLS ${m[1]}` } : null;
  }
  if (b.kind === 'bits') {
    const m = /\baes[- ]?(\d{3})\b/i.exec(clause);
    return m ? { value: Number(m[1]), shown: `AES-${m[1]}` } : null;
  }
  return null;
}

const FREQUENCY_BENCHMARKS = new Set(['privileged-review', 'access-review', 'backup-frequency', 'pentest-frequency', 'external-scan', 'training-frequency', 'review-cycle']);
// Metrics that must have one value per policy, and must agree across published policies.
// (Password length and review intervals are excluded: different account types and populations
// legitimately have different values, e.g. longer passwords for service accounts.)
export const SINGLE_VALUE_METRICS = new Set(['lockout-attempts', 'lockout-duration', 'session-timeout', 'critical-patch', 'high-patch', 'kev-patch', 'tls-version', 'breach-notification']);

// Every measurable value found in the statements, by benchmark.
export function extractMetrics(statements) {
  const found = [];
  (statements || []).forEach((s, i) => {
    if (!s?.text) return;
    for (const b of BENCHMARKS) {
      if (!b.stmt.test(s.text)) continue;
      for (const clause of clausesOf(s.text)) {
        if (!b.clause.test(clause)) continue;
        const m = measure(FREQUENCY_BENCHMARKS.has(b.id) ? { ...b, prefer: 'frequency' } : b, clause);
        if (!m) continue;
        found.push({ id: b.id, b, value: m.value, shown: m.shown, statementId: s.id, num: `4.${i + 1}` });
        break;
      }
    }
  });
  return found;
}

const display = (b, v) => (b.kind === 'duration' ? formatHours(v) : b.kind === 'version' ? `TLS ${v}` : b.kind === 'bits' ? `AES-${v}` : String(v));

// An explicitly chosen type wins; 'other' means "no checklist"; otherwise detect from the name.
export function detectPolicyType(p) {
  if (p.policy_type === 'other') return null;
  if (p.policy_type) return POLICY_TYPES.find((t) => t.key === p.policy_type) || null;
  return POLICY_TYPES.find((t) => t.detect.test(p.title || '')) || null;
}
export const POLICY_TYPE_OPTIONS = POLICY_TYPES.map((t) => ({ key: t.key, name: t.name, topics: t.requirements.map((r) => r.topic) }));

function resolveRefs(refs, controlsById) {
  if (!controlsById) return [];
  const values = controlsById.values ? [...controlsById.values()] : Object.values(controlsById);
  return refs.map((r) => { const i = r.indexOf(':'); return values.find((c) => c.framework_code === r.slice(0, i) && c.ref === r.slice(i + 1))?.id; }).filter(Boolean);
}

function substanceChecks(p, statements, roles, opts, add) {
  const texts = statements.map((s) => String(s.text || ''));
  const out = { type: null, requirements: [], metrics: [], anti: [], actors: [], conflicts: [] };

  // ---- Coverage of must-have topics for the detected policy type
  const type = detectPolicyType(p);
  if (type) {
    out.type = { key: type.key, name: type.name };
    for (const r of type.requirements) {
      const hit = texts.findIndex((t) => r.test.every((re) => re.test(t)));
      out.requirements.push({ ...r, test: undefined, met: hit >= 0, num: hit >= 0 ? `4.${hit + 1}` : null, statementId: hit >= 0 ? statements[hit].id : null, controlIds: resolveRefs(r.controls, opts.controlsById) });
      if (hit < 0) add('statements', 'warning', `Coverage gap: no statement covers "${r.topic}".`, { cat: 'coverage', reqId: r.id, tip: `${/^[AEIOU]/.test(type.name) ? 'An' : 'A'} ${type.name} policy is expected to address this. Insert the suggested statement from the Review report.` });
    }
    const met = out.requirements.filter((r) => r.met).length;
    if (statements.length && met / type.requirements.length < 0.5) {
      add('statements', 'error', `Covers only ${met} of ${type.requirements.length} must-have topics for ${/^[AEIOU]/.test(type.name) ? 'an' : 'a'} ${type.name} policy.`, { cat: 'coverage', tip: 'A policy of this type is not ready until it covers at least half of its core topics.' });
    }
  }

  // ---- Benchmarks
  for (const m of extractMetrics(statements)) {
    const { b } = m;
    const weaker = b.direction === 'max' ? m.value > b.baseline + 1e-9 : m.value < b.baseline - 1e-9;
    const soft = !weaker && b.soft != null && (b.direction === 'max' ? m.value > b.soft : m.value < b.soft);
    const shown = m.shown;
    out.metrics.push({ id: m.id, metric: b.metric, value: m.value, shown, baseline: b.display, source: b.source, num: m.num, statementId: m.statementId, pass: !weaker, soft });
    if (weaker) add('statements', 'warning', `${m.num}: ${b.metric} is ${shown}, weaker than the baseline (${b.display}).`, { cat: 'benchmarks', statementId: m.statementId, num: m.num, tip: `Source: ${b.source}. Tighten it, or document why in an approved exception.` });
    else if (soft) add('statements', 'info', `${m.num}: ${b.metric} is ${shown}; ${b.display} is acceptable but tighter is common practice.`, { cat: 'benchmarks', statementId: m.statementId, num: m.num, tip: `Source: ${b.source}.` });
  }
  statements.forEach((s, i) => {
    for (const a of ANTI_PATTERNS) {
      if (a.test.test(s.text || '')) {
        out.anti.push({ id: a.id, message: a.message, source: a.source, num: `4.${i + 1}`, statementId: s.id });
        add('statements', 'warning', `4.${i + 1}: ${a.message}`, { cat: 'benchmarks', statementId: s.id, num: `4.${i + 1}`, tip: `${a.tip} Source: ${a.source}.` });
      }
    }
  });

  // ---- Consistency
  const roleText = roles.map((r) => `${r.role} ${r.responsibility || ''}`).join(' \n ');
  const owner = String(p.owner || '').trim();
  if (owner) {
    const acronym = owner.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('');
    const ownerNamed = roleText.toLowerCase().includes(owner.toLowerCase()) || (acronym.length >= 2 && new RegExp(`\\b${acronym}\\b`).test(roleText));
    out.ownerInRoles = ownerNamed;
    if (roles.length && !ownerNamed) add('roles', 'warning', `The policy owner ("${owner}") is not described in Roles & Responsibilities.`, { cat: 'consistency', tip: 'Name the owner in the "Policy Owner" role so accountability is unambiguous.' });
  }
  for (const a of ACTORS) {
    const idx = texts.findIndex((t) => a.test.test(t));
    if (idx < 0) continue;
    const defined = roles.some((r) => a.role.test(r.role) || a.role.test(r.responsibility || ''));
    out.actors.push({ name: a.name, num: `4.${idx + 1}`, defined });
    if (!defined) add('roles', 'warning', `4.${idx + 1} assigns duties to "${a.name}", but no role describes them.`, { cat: 'consistency', statementId: statements[idx].id, num: `4.${idx + 1}`, tip: `Add a "${a.name}" role in section 5 with their responsibilities.` });
  }
  const byMetric = new Map();
  for (const m of out.metrics) {
    if (!SINGLE_VALUE_METRICS.has(m.id)) continue;
    if (!byMetric.has(m.id)) byMetric.set(m.id, []);
    byMetric.get(m.id).push(m);
  }
  for (const [, list] of byMetric) {
    const first = list[0];
    const other = list.find((x) => x.num !== first.num && Math.abs(x.value - first.value) > 1e-9);
    if (other) {
      out.conflicts.push({ metric: first.metric, a: `${first.num}: ${first.shown}`, b: `${other.num}: ${other.shown}` });
      add('statements', 'warning', `${first.num} and ${other.num} disagree on ${first.metric.toLowerCase()} (${first.shown} vs ${other.shown}).`, { cat: 'consistency', statementId: other.statementId, num: other.num, tip: 'Use one value so the rule can be tested unambiguously.' });
    }
  }
  for (const peer of opts.peers || []) {
    if (peer.id === p.id) continue;
    for (const [id, list] of byMetric) {
      const theirs = peer.metrics?.[id];
      if (theirs == null || Math.abs(theirs - list[0].value) < 1e-9) continue;
      const b = BENCHMARKS.find((x) => x.id === id);
      out.conflicts.push({ metric: b.metric, a: `${list[0].num}: ${list[0].shown}`, b: `${peer.code}: ${display(b, theirs)}` });
      add('statements', 'warning', `${list[0].num}: ${b.metric.toLowerCase()} (${list[0].shown}) conflicts with ${peer.code} ${peer.title} (${display(b, theirs)}).`, { cat: 'consistency', statementId: list[0].statementId, num: list[0].num, tip: 'Published policies must not set different rules for the same thing. Align the values or reference one policy from the other.' });
    }
  }
  return out;
}

// Single value per metric for a policy, used to compare policies with each other.
export function metricSummary(statements) {
  const out = {};
  for (const m of extractMetrics(statements)) if (SINGLE_VALUE_METRICS.has(m.id) && out[m.id] == null) out[m.id] = m.value;
  return out;
}

// =====================================================================
// Review report: verdict, five scores and a checklist, built from the lint result.
// =====================================================================
export const REVIEW_CATEGORIES = [
  { key: 'structure', label: 'Structure', weight: 0.2 },
  { key: 'language', label: 'Language', weight: 0.2 },
  { key: 'coverage', label: 'Coverage', weight: 0.25 },
  { key: 'benchmarks', label: 'Benchmarks', weight: 0.2 },
  { key: 'consistency', label: 'Consistency', weight: 0.15 },
];

export function reviewPolicy(p, opts = {}) {
  const lint = lintPolicy(p, opts);
  const sub = lint.substance;
  const of = (cat, sev) => lint.issues.filter((i) => i.cat === cat && (!sev || i.severity === sev));
  const penalty = (cat, w) => Math.max(0, 100 - of(cat, 'error').length * w[0] - of(cat, 'warning').length * w[1] - of(cat, 'info').length * w[2]);
  const reqs = sub.requirements;
  const scores = {
    structure: penalty('structure', [15, 5, 1]),
    language: penalty('language', [15, 5, 1]),
    coverage: sub.type ? Math.round((reqs.filter((r) => r.met).length / reqs.length) * 100) : null,
    benchmarks: penalty('benchmarks', [25, 20, 5]),
    consistency: penalty('consistency', [25, 20, 5]),
  };
  const active = REVIEW_CATEGORIES.filter((c) => scores[c.key] != null);
  const wsum = active.reduce((a, c) => a + c.weight, 0);
  const overall = Math.round(active.reduce((a, c) => a + scores[c.key] * c.weight, 0) / wsum);
  const substanceWarnings = lint.issues.filter((i) => ['coverage', 'benchmarks', 'consistency'].includes(i.cat) && i.severity !== 'info').length;
  const verdict = lint.errors ? 'not_ready' : (substanceWarnings || overall < 85) ? 'needs_work' : 'ready';

  const checklist = [];
  // refs: where in the policy each check applies, so the report can link straight to it.
  const refsOf = (issues) => {
    const seen = new Map();
    for (const i of issues) {
      const target = i.statementId ? `st-${i.statementId}` : i.section ? `sec-${i.section}` : null;
      if (target && !seen.has(target)) seen.set(target, { target, label: i.num || SECTIONS.find((s) => s.key === i.section)?.title || i.section });
    }
    return [...seen.values()];
  };
  const push = (cat, label, pass, detail = '', refs = []) => checklist.push({ cat, label, pass, detail, refs });
  const unmapped = lint.issues.filter((i) => i.section === 'references' && i.statementId);
  const headerIssues = lint.issues.filter((i) => i.section === 'header' && i.severity !== 'info');
  push('structure', 'All eight sections are complete', !of('structure', 'error').length, of('structure', 'error').map((i) => i.message).join(' '), refsOf(of('structure', 'error')));
  push('structure', 'Owner, effective date and an annual review cycle are set', !headerIssues.length, headerIssues.map((i) => i.message).join(' '), refsOf(headerIssues));
  push('structure', 'Every statement is mapped to a framework control', !unmapped.length, unmapped.length ? `Not mapped: ${unmapped.map((i) => i.num).join(', ')}. Use “Map controls” under each statement.` : '', refsOf(unmapped));
  push('language', 'Every statement uses "must" or "shall"', !of('language', 'error').length, of('language', 'error').map((i) => i.message).join(' '), refsOf(of('language', 'error')));
  push('language', 'No non-mandatory or unmeasurable wording', !of('language', 'warning').length, of('language', 'warning').map((i) => i.message).join(' '), refsOf(of('language', 'warning')));
  if (sub.type) reqs.forEach((r) => push('coverage', r.topic, r.met, r.met ? `Covered by ${r.num}` : 'Not covered', r.met ? [{ target: `st-${r.statementId}`, label: r.num }] : []));
  else push('coverage', 'Policy type recognised for a coverage checklist', null, 'No checklist for this policy type: coverage not assessed.');
  sub.metrics.forEach((m) => push('benchmarks', `${m.metric}: ${m.shown} (${m.num})`, m.pass, `Baseline ${m.baseline}. ${m.source}`, [{ target: `st-${m.statementId}`, label: m.num }]));
  sub.anti.forEach((a) => push('benchmarks', `${a.num}: ${a.message}`, false, a.source, [{ target: `st-${a.statementId}`, label: a.num }]));
  if (!sub.metrics.length && !sub.anti.length) push('benchmarks', 'Measurable values compared with baselines', null, 'No benchmarked values (lengths, deadlines, intervals) found in the statements.');
  if (p.owner) push('consistency', 'Policy owner is described in Roles', sub.ownerInRoles !== false);
  push('consistency', 'Everyone given duties in statements has a defined role', sub.actors.every((a) => a.defined), sub.actors.filter((a) => !a.defined).map((a) => a.name).join(', '));
  push('consistency', 'Statements do not contradict each other', !sub.conflicts.some((c) => !/^POL-/.test(c.b)), '');
  push('consistency', 'Consistent with other published policies', !sub.conflicts.some((c) => /^POL-/.test(c.b)), sub.conflicts.filter((c) => /^POL-/.test(c.b)).map((c) => `${c.metric}: ${c.a} vs ${c.b}`).join('; '));

  return {
    verdict,
    verdictLabel: { ready: 'Ready', needs_work: 'Needs work', not_ready: 'Not ready' }[verdict],
    overall, scores, checklist,
    type: sub.type,
    gaps: reqs.filter((r) => !r.met),
    requirements: reqs,
    metrics: sub.metrics,
    lint,
  };
}

// ---------- Crosswalk helpers ----------
const THEME_KEYWORDS = {
  access: /access|account|privilege|authenticat|\bmfa\b|multi-factor|password|credential|log ?in|logon|least privilege|provision|deprovision|revok/i,
  crypto: /encrypt|cryptograph|\btls\b|\baes\b|key management|certificate/i,
  logging: /\blogs?\b|logging|monitor|siem|alert|audit trail/i,
  vuln: /vulnerab|patch|scan|penetration|cvss|\bcve\b|remediat/i,
  incident: /incident|breach|forensic|escalat|triage/i,
  backup: /backup|back up|restore|\brpo\b/i,
  continuity: /continuity|disaster|\brto\b|resilien|recovery/i,
  supplier: /vendor|supplier|third[- ]part|service provider|outsourc/i,
  training: /training|awareness|phishing simulation/i,
  hr: /employ|hire|onboard|terminat|screening|background check|disciplin|separation/i,
  physical: /physical|badge|facilit|visitor|premises|cctv/i,
  asset: /inventory|asset|hardware|device register/i,
  data: /classif|label|confidential|restricted|data loss|\bdlp\b|retention|dispos|sanitiz|destroy/i,
  change: /change management|change request|deploy|release|approval before/i,
  sdlc: /code|develop|sdlc|software development|application security/i,
  network: /network|firewall|segment|vpn|perimeter|wi-?fi/i,
  malware: /malware|anti-?virus|\bedr\b|ransomware|malicious/i,
  endpoint: /laptop|workstation|endpoint|screen|mobile device|byod/i,
  privacy: /personal data|\bpii\b|privacy|data subject|gdpr|\bphi\b/i,
  gov: /policy|governance|review(ed)? annually|oversight|accountab/i,
  config: /configuration|hardening|baseline|cis benchmark/i,
  risk: /risk assessment|risk register|risk tier|risk/i,
  legal: /legal|regulat|statut|contract|law\b/i,
};

export function suggestThemes(text = '') {
  return Object.entries(THEME_KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
}

export const THEME_LABELS = {
  access: 'Identity & Access', crypto: 'Cryptography', logging: 'Logging & Monitoring', vuln: 'Vulnerability Mgmt',
  incident: 'Incident Response', backup: 'Backup', continuity: 'Continuity & Resilience', supplier: 'Third-Party Risk',
  training: 'Awareness & Training', hr: 'People Security', physical: 'Physical Security', asset: 'Asset Management',
  data: 'Data Protection', change: 'Change Management', sdlc: 'Secure Development', network: 'Network Security',
  malware: 'Malware Defense', endpoint: 'Endpoint Security', privacy: 'Privacy', gov: 'Governance',
  config: 'Secure Configuration', risk: 'Risk Management', legal: 'Legal & Regulatory',
};

// ---------- Risk scoring (5x5) ----------
export function riskLevel(score) {
  if (score >= 20) return { label: 'Critical', key: 'critical' };
  if (score >= 12) return { label: 'High', key: 'high' };
  if (score >= 6) return { label: 'Medium', key: 'medium' };
  return { label: 'Low', key: 'low' };
}
