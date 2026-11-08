// Phase 0.6: crosswalk equivalents across frameworks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crosswalkFor, suggestMappings } from '../public/js/automap.js';
import { CONTROLS, ctl } from './helpers.mjs';

const keys = (list) => list.map((x) => `${x.control.framework_code} ${x.control.ref}`);

test('0.6 an ISO 27001 mapping offers equivalents in the other frameworks', () => {
  const xw = crosswalkFor([ctl('ISO27001 5.24')], CONTROLS, { text: 'The organization shall maintain an incident response plan.' });
  const fws = new Set(xw.map((x) => x.control.framework_code));
  for (const fw of ['NISTCSF', 'NIST80053', 'SOC2', 'CIS']) assert.ok(fws.has(fw), `missing ${fw}: ${keys(xw)}`);
  assert.ok(!fws.has('ISO27001'), 'frameworks already mapped are not offered again');
  assert.equal(fws.size, xw.length, 'one equivalent per framework');
  assert.ok(keys(xw).includes('NIST80053 IR-8'));
});

test('0.6 equivalents work from any framework, and skip controls already mapped or rejected', () => {
  const xw = crosswalkFor([ctl('NIST80053 CP-9')], CONTROLS, { text: 'Backups must be tested quarterly.', exclude: [ctl('ISO27001 8.13')] });
  assert.ok(!keys(xw).includes('ISO27001 8.13'));
  assert.ok(keys(xw).includes('CIS 11'));
  const mfa = crosswalkFor([ctl('ISO27001 8.5')], CONTROLS, { text: 'Multi-factor authentication must be enforced for remote access.' });
  for (const k of ['NIST80053 IA-2', 'PCIDSS 8', 'SOC2 CC6.1', 'HIPAA 164.312(d)']) assert.ok(keys(mfa).includes(k), `${k} not in ${keys(mfa)}`);
});

test('0.6 privacy topics reach GDPR; unrelated topics do not', () => {
  const breach = crosswalkFor([ctl('NISTCSF RS.CO')], CONTROLS, { text: 'Personal data breaches must be notified to the supervisory authority within 72 hours.' });
  assert.ok(keys(breach).some((k) => k.startsWith('GDPR')), keys(breach).join(', '));
  const backup = crosswalkFor([ctl('ISO27001 8.13')], CONTROLS, { text: 'Backups must be taken daily.' });
  assert.ok(!keys(backup).some((k) => k.startsWith('GDPR')));
});

test('suggestions cover every selected framework, not only one', () => {
  const s = suggestMappings('Multi-factor authentication must be enforced for all remote access.', CONTROLS, { frameworks: ['ISO27001', 'NISTCSF', 'NIST80053', 'SOC2', 'PCIDSS', 'HIPAA', 'CIS'] });
  assert.ok(new Set(s.map((x) => x.control.framework_code)).size >= 6);
});
