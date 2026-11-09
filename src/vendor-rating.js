// Vendor questionnaire and risk rating. Pure: no database access, so it is safe to unit-test.
// A concise questionnaire covering what a SOC 2 / ISO 27001 reviewer checks first.
export const QUESTIONS = [
  ['cert', 'Holds a current SOC 2 Type II report or ISO/IEC 27001 certificate', 3],
  ['enc_rest', 'Encrypts our data at rest (AES-256 or equivalent)', 2],
  ['enc_transit', 'Encrypts our data in transit (TLS 1.2 or higher)', 2],
  ['mfa', 'Enforces multi-factor authentication for staff access to our data', 3],
  ['incident', 'Notifies us of security incidents affecting our data within 72 hours', 3],
  ['pentest', 'Has an independent penetration test at least annually', 2],
  ['irp', 'Maintains a documented, tested incident response plan', 2],
  ['screening', 'Background-checks staff who can access our data', 1],
  ['subprocessors', 'Uses subprocessors only with notice to us and equivalent obligations', 2],
  ['exit', 'Returns or securely deletes our data when the contract ends', 2],
  ['bcp', 'Tests business continuity and disaster recovery at least annually', 2],
  ['patching', 'Patches critical vulnerabilities within 30 days', 2],
];
export const ANSWERS = ['yes', 'partial', 'no', 'na'];
export const CRIT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
export const DATA = { restricted: 4, confidential: 3, internal: 2, none: 1 };
// Reassess more often the more critical the vendor (months).
export const REASSESS_MONTHS = { Critical: 6, High: 12, Medium: 12, Low: 24 };

// Risk rating = exposure (criticality × data sensitivity) × control gaps from the questionnaire.
export function rateVendor(criticality, dataAccess, answers) {
  let gap = 0, max = 0;
  for (const [k, , w] of QUESTIONS) {
    const a = answers?.[k];
    if (!a || a === 'na') continue;
    max += w * 2;
    gap += w * (a === 'no' ? 2 : a === 'partial' ? 1 : 0);
  }
  const answered = QUESTIONS.filter(([k]) => answers?.[k]).length;
  const gapPct = max ? gap / max : 1;
  const exposure = (CRIT[criticality] + DATA[dataAccess]) / 2; // 1..4
  const gapLevel = gapPct >= 0.5 ? 4 : gapPct >= 0.25 ? 3 : gapPct > 0.05 ? 2 : 1; // 1..4
  const score = exposure * gapLevel;
  return { rating: score >= 10 ? 'Critical' : score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low', gap_pct: Math.round(gapPct * 100), exposure, answered };
}
