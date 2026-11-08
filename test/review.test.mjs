// Phase 0: review scoring, categories, measurability, owner resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewPolicy, lintPolicy, categoryScore, gradeOf, analyzeStatement, ownerRoleIndex } from '../public/js/lint.js';
import { opts, templatePolicy, TEMPLATE_KEYS, ctl } from './helpers.mjs';

const item = (cat, label) => (rv) => rv.checklist.find((c) => c.cat === cat && c.label === label);

// ---------------- 0.1 Proportional category scores
test('0.1 category score is proportional to checks passed', () => {
  assert.equal(categoryScore([{ pass: true }, { pass: true }, { pass: false }]), 67);
  assert.equal(categoryScore([{ pass: true }, { pass: false }]), 50);
  assert.equal(categoryScore([{ pass: false }]), 0);
  assert.equal(categoryScore([{ pass: true }, { pass: null }]), 100, 'checks that do not apply are left out');
  assert.equal(categoryScore([{ pass: null }]), null);
});

test('0.1 one failing structure check does not zero the category', () => {
  const p = templatePolicy('incident-response');
  p.effective_date = null; // fails "Owner, effective date and an annual review cycle are set"
  p.scope = 'All systems.'; // structure warnings (no WHO) must not drag the score to 0
  const rv = reviewPolicy(p, opts);
  const structure = rv.checklist.filter((c) => c.cat === 'structure');
  const passed = structure.filter((c) => c.pass).length;
  assert.equal(rv.scores.structure, Math.round((passed / structure.length) * 100));
  assert.ok(rv.scores.structure > 0, `structure scored ${rv.scores.structure}`);
});

// ---------------- 0.2 One authoritative score
test('0.2 the headline score, the grade and the review report agree', () => {
  for (const key of TEMPLATE_KEYS) {
    const p = templatePolicy(key);
    p.statements[0].text = 'Staff should try to follow this policy where possible.';
    const rv = reviewPolicy(p, opts);
    const lint = lintPolicy(p, opts);
    assert.equal(lint.score, rv.overall, key);
    assert.equal(rv.lint.score, rv.overall, key);
    assert.equal(lint.grade, gradeOf(rv.overall), key);
    assert.equal(rv.grade, lint.grade, key);
  }
});

// ---------------- 0.3 Mapping completeness is Coverage & mapping, not Structure
test('0.3 the mapping check sits in coverage, and unmapped issues are coverage issues', () => {
  const p = templatePolicy('access-control');
  p.statements[2].controls = [];
  const rv = reviewPolicy(p, opts);
  const mapping = rv.checklist.find((c) => c.label === 'Every statement is mapped to a framework control');
  assert.equal(mapping.cat, 'coverage');
  assert.equal(mapping.pass, false);
  assert.ok(!rv.checklist.some((c) => c.cat === 'structure' && /mapped/i.test(c.label)));
  assert.ok(rv.lint.issues.filter((i) => i.section === 'references' && i.statementId).every((i) => i.cat === 'coverage'));
});

// ---------------- 0.4 Measurability: precise, dismissible, never blocking
test('0.4 qualitative mandates are not flagged as unmeasurable', () => {
  for (const t of [
    'The root cause shall be identified and removed.',
    'An out-of-band communication channel shall be designated and provisioned in advance.',
    'Security monitoring tooling shall be maintained to detect and alert on suspicious activity.',
    'ConnectDevs shall maintain an Incident Response Plan documenting response procedures and contact information.',
  ]) assert.ok(!analyzeStatement(t).some((f) => f.kind === 'measurable'), t);
});

test('0.4 time-bound statements without a number are flagged as info, with the triggering word', () => {
  for (const [t, word] of [['Access rights shall be reviewed.', 'reviewed'], ['Passwords must be rotated.', 'rotated'], ['Logs shall be retained.', 'retained']]) {
    const f = analyzeStatement(t).find((x) => x.kind === 'measurable');
    assert.ok(f, t);
    assert.equal(f.severity, 'info');
    assert.match(f.message, new RegExp(word));
  }
  assert.ok(!analyzeStatement('Access rights shall be reviewed quarterly.').some((f) => f.kind === 'measurable'));
});

test('0.4 "Qualitative: accepted" dismisses the note; strong wording checks stay warnings', () => {
  assert.ok(!analyzeStatement('Access rights shall be reviewed.', { qualitative: true }).some((f) => f.kind === 'measurable'));
  const p = templatePolicy('access-control');
  p.statements.push({ id: 'q1', text: 'Exceptions to this policy shall be reviewed.', controls: [ctl('ISO27001 5.36')] });
  const before = reviewPolicy(p, opts).lint.issues.filter((i) => i.statementId === 'q1' && i.kind === 'measurable');
  assert.equal(before.length, 1);
  assert.equal(before[0].severity, 'info');
  p.statements.at(-1).qualitative = { reason: 'Event-driven obligation.' };
  assert.equal(reviewPolicy(p, opts).lint.issues.filter((i) => i.statementId === 'q1' && i.kind === 'measurable').length, 0);
  const weak = analyzeStatement('Users should lock their screens where possible.');
  assert.ok(weak.some((f) => f.severity === 'warning' && /should/.test(f.message)));
  assert.ok(weak.some((f) => f.severity === 'warning' && /where possible/.test(f.message)));
});

test('0.4 measurability notes never block (no error, verdict unaffected)', () => {
  const p = templatePolicy('access-control');
  p.statements.push({ id: 'm1', text: 'Firewall rules shall be reviewed.', controls: [ctl('ISO27001 8.20')] });
  const rv = reviewPolicy(p, opts);
  assert.ok(rv.lint.issues.some((i) => i.kind === 'measurable'));
  assert.ok(!rv.lint.issues.some((i) => i.kind === 'measurable' && i.severity !== 'info'));
  assert.equal(rv.lint.errors, 0);
});

// ---------------- 0.5 Owner synonyms and owner tag
test('0.5 owner role resolves from synonyms, the document owner, or a tag', () => {
  assert.equal(ownerRoleIndex([{ role: 'Users' }, { role: 'Security Lead' }], 'Security Lead'), 1);
  assert.equal(ownerRoleIndex([{ role: 'CISO' }]), 0);
  assert.equal(ownerRoleIndex([{ role: 'Head of Information Security' }]), 0);
  assert.equal(ownerRoleIndex([{ role: 'Platform Team' }, { role: 'Users' }], 'Platform Team'), 0, 'row naming the document owner');
  assert.equal(ownerRoleIndex([{ role: 'Platform Team' }, { role: 'Ops', owner: true }]), 1, 'tag wins');
  assert.equal(ownerRoleIndex([{ role: 'Users' }, { role: 'Custodian' }], 'Someone Else'), -1);
});

test('0.5 no "Owner" warning when a Security Lead owns the policy; warning only when unresolved', () => {
  const p = templatePolicy('incident-response');
  p.owner = 'Security Lead';
  p.roles = [{ role: 'Security Lead', responsibility: 'Owns this policy and approves exceptions.' }, { role: 'IT Operations', responsibility: 'Operates controls.' },
    { role: 'Users', responsibility: 'Must report incidents.' }, { role: 'Management', responsibility: 'Must enforce it.' }];
  const has = (pp) => reviewPolicy(pp, opts).lint.issues.some((i) => i.slot === 'Owner');
  assert.equal(has(p), false);
  p.roles[0].role = 'Response Coordinator';
  p.owner = 'Jane Doe';
  assert.equal(has(p), true);
  p.roles[0].owner = true;
  assert.equal(has(p), false);
});

// ---------------- Phase 0 acceptance
test('acceptance: complete, fully mapped, tightly worded policies score in the A range', () => {
  for (const key of TEMPLATE_KEYS) {
    const rv = reviewPolicy(templatePolicy(key), opts);
    assert.ok(rv.overall >= 90, `${key} scored ${rv.overall} (${JSON.stringify(rv.scores)}): ${rv.checklist.filter((c) => c.pass === false).map((c) => c.label).join('; ')}`);
    assert.equal(rv.grade, 'A', key);
    assert.equal(rv.lint.errors, 0, key);
  }
});

test('acceptance: removing mappings lowers coverage & mapping, not structure', () => {
  const p = templatePolicy('access-control');
  const full = reviewPolicy(p, opts);
  p.statements.forEach((s) => { s.controls = []; });
  const none = reviewPolicy(p, opts);
  assert.equal(none.scores.structure, full.scores.structure);
  assert.ok(none.scores.coverage < full.scores.coverage);
  assert.ok(item('coverage', 'Every statement is mapped to a framework control')(none).pass === false);
});
