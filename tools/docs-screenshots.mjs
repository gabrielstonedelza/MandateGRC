// Regenerates the screenshots used by the in-app documentation (public/docs/img).
//
//   node tools/docs-screenshots.mjs
//
// It starts a throwaway MandateGRC instance (separate data folder, port 4399), creates a
// workspace with sample data using a *software* passkey (test-only, never used in the app),
// then drives headless Chrome through the DevTools protocol and captures each step.
// Requires Google Chrome (or set CHROME=/path/to/chrome). No npm dependencies.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'docs', 'img');
const PORT = 4399, BASE = `http://localhost:${PORT}`, CDP_PORT = 9333;
const W = 1360, H = 860;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---------------- Throwaway server ----------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandategrc-docs-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), MANDATEGRC_DATA_DIR: dataDir }, stdio: 'ignore',
});
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'mandategrc-chrome-'));
let chrome;
function cleanup() {
  try { server.kill(); } catch { /* gone */ }
  try { chrome?.kill(); } catch { /* gone */ }
  for (const d of [dataDir, chromeProfile]) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir; the OS cleans it up */ }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

// ---------------- Software passkey (test only) ----------------
const b64u = (b) => Buffer.from(b).toString('base64url');
function cbor(v) {
  const h = (mj, n) => (n < 24 ? Buffer.from([(mj << 5) | n]) : n < 256 ? Buffer.from([(mj << 5) | 24, n]) : Buffer.from([(mj << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? h(0, v) : h(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([h(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([h(2, v.length), v]);
  return Buffer.concat([h(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
function softCredential(pk) {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = kp.publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(32), len = Buffer.alloc(2), cnt = Buffer.alloc(4);
  len.writeUInt16BE(32); cnt.writeUInt32BE(1);
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y, 'base64url')]]);
  const ad = Buffer.concat([crypto.createHash('sha256').update(pk.rp.id).digest(), Buffer.from([0x45]), cnt, Buffer.alloc(16), len, id, cbor(cose)]);
  return {
    id: b64u(id),
    clientDataJSON: b64u(JSON.stringify({ type: 'webauthn.create', challenge: pk.challenge, origin: BASE })),
    attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))),
  };
}
let cookie = '', csrf = '';
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return r.json();
}

// A second, independent session (e.g. a colleague) for separation-of-duties screenshots.
async function apiAs(jar, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: jar.cookie || '', 'X-CSRF-Token': jar.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0];
  return r.json();
}

// ---------------- Minimal Chrome DevTools Protocol client ----------------
let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)} → ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(selector, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; } catch { /* page is navigating */ }
    await sleep(100);
  }
  throw new Error('Timed out waiting for ' + selector);
}
async function go(hash, selector, settle = 700) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}`);
  if (selector) await waitFor(selector);
  await sleep(settle);
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function shot(name, selector, pad = 14, align = 'center') {
  const params = { format: 'jpeg', quality: 82 };
  if (selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: ${JSON.stringify(align)} }); ${align === 'start' ? "document.getElementById('main')?.scrollBy(0, -84)" : ''}`);
    await sleep(250);
    const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    params.clip = { x, y, width: Math.min(W - x, r.w + pad * 2), height: Math.min(H - y, r.h + pad * 2), scale: 1 };
  }
  const { data } = await send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(OUT, name + '.jpg'), Buffer.from(data, 'base64'));
  console.log('  ✓', name);
}
async function fill(selector, value) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}
const closeModals = () => evaluate(`[...document.querySelectorAll('.modal-h [data-close]')].reverse().forEach((b) => b.click())`);

// ---------------- Main ----------------
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/'); break; } catch { await sleep(150); } }

  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeProfile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    // Accept browser dialogs (e.g. "Leave without saving?") so the walkthrough never blocks.
    if (msg.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // Reduced motion makes every animated element render in its final state for crisp screenshots.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });

  console.log('Public pages');
  await send('Page.navigate', { url: BASE + '/#/' });
  await waitFor('.hero h1'); await sleep(800);
  await shot('01-landing');
  await go('#/register', '#pk-form');
  await fill('[name=org_name]', 'Acme Holdings');
  await fill('[name=username]', 'ama.mensah');
  await fill('[name=display_name]', 'Ama Mensah');
  await sleep(900);
  await shot('02-signup', '.auth-card', 24);
  await go('#/login', '#pk-login');
  await shot('03-signin', '.auth-card', 24);

  console.log('Create workspace (software passkey) and sign in');
  const o = await api('POST', '/api/auth/signup/options', {});
  const r = await api('POST', '/api/auth/signup/verify', { challengeId: o.challengeId, credential: softCredential(o.publicKey), username: 'ama.mensah', name: 'Ama Mensah', org_name: 'Acme Holdings', sample: true, label: 'MacBook Pro · Safari' });
  csrf = r.csrf;
  const [name, value] = cookie.split('=');
  await send('Network.enable');
  await send('Network.setCookie', { name, value, url: BASE, path: '/', httpOnly: true, sameSite: 'Strict' });
  await evaluate(`location.hash = '#/'`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);
  await waitFor('.ob-welcome'); await sleep(900);
  await shot('04-welcome');
  await click('[data-ob=start]');
  await waitFor('.ob-card h3'); await sleep(1400);
  await shot('05-tour');
  await evaluate(`document.querySelector('[data-ob=skip]').click()`);
  await sleep(800);

  console.log('Dashboard');
  await go('#/', '.posture', 1000);
  await shot('06-dashboard');
  await shot('07-action-queue', '[data-tour=queue]');

  console.log('Policies');
  const policies = await api('GET', '/api/policies');
  const weak = policies.find((p) => p.title === 'Remote Working Policy');
  const inReview = policies.find((p) => p.status === 'in_review');
  const published = policies.find((p) => p.title === 'Access Control Policy');
  await go('#/policies', '[data-tour=policy-table]');
  await shot('08-policies');
  await click('#new'); await waitFor('#np'); await sleep(400);
  await evaluate(`(() => { const s = document.querySelector('#np [name=type]'); s.value = 'data-classification'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  await shot('09-new-policy', '.modal', 20);
  await closeModals(); await sleep(300);
  await go('#/templates', '.tpl');
  await shot('10-templates');

  // Import an existing policy (a sample Word document from tools/fixtures).
  await go('#/policies', '#import');
  await click('#import'); await waitFor('#imp-file'); await sleep(400);
  await shot('10b-import-pick', '.modal', 20);
  await send('DOM.enable');
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#imp-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'tools', 'fixtures', 'vulnerability-management-policy.docx')] });
  await waitFor('.imp-review', 10000); await sleep(500);
  await shot('10c-import-review');
  await evaluate(`(() => { document.querySelector('.imp-preview').open = true; document.querySelector('.modal-b').scrollTop = 99999; })()`); await sleep(400);
  await shot('10d-import-details', '.modal', 20);
  await click('#imp-create'); await waitFor('#lint', 8000); await sleep(1200);
  await shot('10e-import-draft');

  await go(`#/policies/${weak.id}`, '#lint', 1000);
  await shot('11-editor');
  await shot('12-header', '#sec-header');
  await shot('13-purpose', '#sec-purpose');
  await shot('13b-scope', '#sec-scope');
  await shot('14-statements', '#sec-statements');
  await shot('15-linter', '#lint');
  await click('[data-fix]'); await sleep(1400);
  await shot('16-fix-applied', '.stmt');
  await click('[data-map]'); await waitFor('.pick-list .pick'); await sleep(500);
  await shot('17-map-controls');
  await closeModals(); await sleep(300);
  await shot('18-roles', '#sec-roles');
  await shot('19-enforcement', '#sec-enforcement');
  await shot('20-references', '#sec-references');

  // The review report on a partly written Access Control policy.
  const meta = await api('GET', '/api/meta');
  const ctl = (f, r) => meta.controls.find((c) => c.framework_code === f && c.ref === r).id;
  const partial = await api('POST', '/api/policies', { title: 'Access Control Policy (Contractors)' });
  const pd = await api('GET', `/api/policies/${partial.id}`);
  await api('PUT', `/api/policies/${partial.id}`, { ...pd, owner: 'Chief Information Security Officer', effective_date: '2026-11-01', review_cycle_months: 12,
    purpose: 'This policy establishes access requirements for contractors in order to protect organizational systems and data from unauthorized use.',
    scope: 'This policy applies to all contractors and consultants, and to every system, application and data store they access.',
    statements: [
      { id: 'c1', text: 'Contractor access must be granted on the principle of least privilege and approved by the system owner.', controls: [ctl('ISO27001', '5.15')] },
      { id: 'c2', text: 'Multi-factor authentication must be enforced for all contractor remote access.', controls: [ctl('ISO27001', '8.5')] },
      { id: 'c3', text: 'Contractor passwords must be at least 8 characters.', controls: [ctl('ISO27001', '5.17')] },
      { id: 'c4', text: 'Contractor accounts must lock after 20 failed login attempts.', controls: [ctl('NIST80053', 'AC-7')] },
      { id: 'c5', text: 'Contractor access must be revoked within 5 business days of contract termination.', controls: [ctl('ISO27001', '6.5')] },
    ],
    roles: [{ role: 'Policy Owner', responsibility: 'The Chief Information Security Officer owns this policy.' }, { role: 'Custodian', responsibility: 'IT Operations must operate the access controls.' }, { role: 'Users', responsibility: 'Contractors must comply with this policy.' }, { role: 'Management', responsibility: 'Managers must enforce this policy for their contractors.' }],
    enforcement: 'Compliance shall be verified through quarterly audit. Violations lead to disciplinary action and contract termination. Exceptions must be approved through the policy exception process.', ref_controls: [] });
  await go(`#/policies/${partial.id}`, '#review .rv-cat', 900);
  await evaluate(`document.querySelectorAll('#review details').forEach((d) => { d.open = d.dataset.cat === 'coverage'; })`);
  await sleep(300);
  await shot('20b-review', '#review', 14, 'start');
  await evaluate(`document.querySelectorAll('#review details').forEach((d) => { d.open = ['benchmarks', 'consistency'].includes(d.dataset.cat); })`);
  await sleep(300);
  await shot('20c-review-benchmarks', '#review details[data-cat=benchmarks]', 14, 'start');
  // A failed check explained, with fix choices; then apply the recommended coverage fix.
  await evaluate(`document.querySelectorAll('#review details').forEach((d) => { d.open = d.dataset.cat === 'coverage'; })`);
  await sleep(300);
  await shot('20e-fix-choices', '#review details[data-cat=coverage] li.fail', 14, 'start');
  await evaluate(`document.querySelector('#review details[data-cat=coverage] .rv-opt.rec').click()`); await sleep(700);
  await shot('20d-inserted', '.stmts li:last-child');
  await evaluate(`document.querySelector('#review').scrollIntoView({ block: 'start' })`); await sleep(300);
  await shot('20f-undo', '#review .card-h', 10);
  await evaluate(`document.getElementById('save')?.click()`); await sleep(700);

  // A lint-clean draft from a template, to show submission.
  const created = await api('POST', '/api/policies', { template: 'acceptable-use' });
  await go(`#/policies/${created.id}`, '#lint', 900);
  await shot('21-template-draft');
  await click('[data-act=submit]'); await waitFor('#sf'); await sleep(400);
  await fill('#sf [name=change_summary]', 'Initial release of the Acceptable Use Policy, mapped to ISO 27001 and NIST 800-53.');
  await shot('22-submit', '.modal', 20);
  await closeModals(); await sleep(300);

  await go(`#/policies/${inReview.id}`, '#workflow', 900);
  await shot('23-in-review', '#workflow');
  await click('[data-act=approve]'); await waitFor('.modal [data-go]'); await sleep(400);
  await fill('#ap-note', 'Reviewed against the Q4 incident response exercise findings.');
  await shot('24-approve', '.modal', 20);
  await closeModals(); await sleep(300);
  await click('[data-act=reject]'); await waitFor('.modal [data-ok]'); await sleep(400);
  await shot('25-return', '.modal', 20);
  await closeModals(); await sleep(300);

  // A colleague submits a policy with coverage gaps; the approver must acknowledge them.
  const inv = await api('POST', '/api/invites', { role: 'analyst', days: 1 });
  const efua = {};
  const ro = await apiAs(efua, 'POST', '/api/auth/register/options', { code: inv.code });
  const rr = await apiAs(efua, 'POST', '/api/auth/register/verify', { challengeId: ro.challengeId, credential: softCredential(ro.publicKey), username: 'efua.owusu', name: 'Efua Owusu' });
  efua.csrf = rr.csrf;
  const gp = await apiAs(efua, 'POST', '/api/policies', { template: 'access-control' });
  const gd = await apiAs(efua, 'GET', `/api/policies/${gp.id}`);
  await apiAs(efua, 'PUT', `/api/policies/${gp.id}`, { ...gd, title: 'Access Control Policy (Branch Offices)', effective_date: '2026-11-01', statements: gd.statements.filter((x) => !/unique|Passwords must|locked for|session/i.test(x.text)) });
  await apiAs(efua, 'POST', `/api/policies/${gp.id}/submit`, { change_summary: 'Initial release for branch offices' });
  await go(`#/policies/${gp.id}`, '[data-act=approve]', 900);
  await click('[data-act=approve]'); await waitFor('#ack-gaps'); await sleep(500);
  await shot('24b-approve-gaps', '.modal', 20);
  await closeModals(); await sleep(300);
  await api('POST', `/api/policies/${inReview.id}/approve`, { note: 'Reviewed.' }).catch(() => {});
  // The demo analyst submitted it, so the signed-in admin may approve (separation of duties is satisfied).
  await go('#/policies', '[data-tour=policy-table]', 300);
  await go(`#/policies/${inReview.id}`, '[data-act=publish]', 800);
  await shot('26-approved', '#workflow');
  await click('[data-act=publish]'); await waitFor('.modal [data-go]'); await sleep(400);
  await shot('27-publish', '.modal', 20);
  await closeModals(); await sleep(300);

  await go(`#/policies/${published.id}`, '#sec-history', 900);
  await shot('28-published', '#workflow');
  await shot('29-history', '#sec-history');
  await click('[data-diff]'); await waitFor('.diff'); await sleep(500);
  await shot('30-diff');
  await closeModals(); await sleep(300);
  await click('#export'); await waitFor('[data-x]'); await sleep(300);
  await shot('31-export', '.modal', 20);
  await closeModals(); await sleep(300);
  await go(`#/policies/${published.id}/doc`, '.doc', 900);
  await shot('32-document');
  await go('#/attestations', '[data-tour=mine]', 700);
  await shot('33-attestations');

  console.log('Risk, exceptions, frameworks, evidence');
  await go('#/risks', '[data-tour=heat]', 900);
  await shot('34-risks');
  await click('tr[data-id]'); await waitFor('#rf'); await sleep(500);
  await shot('35-risk-form');
  await closeModals(); await sleep(300);
  await go('#/exceptions', '[data-tour=exceptions]', 700);
  await shot('36-exceptions');
  await click('#new'); await waitFor('#xf'); await sleep(700);
  await shot('37-exception-request');
  await closeModals(); await sleep(300);
  await go('#/frameworks/ISO27001', '[data-tour=fw-grid]', 900);
  await shot('38-frameworks');
  await evaluate(`[...document.querySelectorAll('tr[data-ctrl]')].find((r) => r.textContent.includes('Access control')).click()`);
  await waitFor('.drawer .pick-list'); await sleep(600);
  await shot('39-control');
  await closeModals(); await sleep(300);
  await click('#newfw'); await waitFor('#ff'); await sleep(300);
  await fill('#ff [name=code]', 'NIS2'); await fill('#ff [name=name]', 'NIS2 Directive');
  await shot('40-custom-framework', '.modal', 20);
  await closeModals(); await sleep(300);
  await go('#/evidence', '.card', 700);
  await shot('41-evidence');
  await click('#new'); await waitFor('#ef'); await sleep(500);
  await shot('42-evidence-form');
  await closeModals(); await sleep(300);

  console.log('Assurance & administration');
  await go('#/audit', '#verify', 700);
  await click('#verify'); await waitFor('.notice.good'); await sleep(500);
  await shot('43-audit');
  await go('#/users', '#invite', 700);
  await shot('44-users');
  await click('#invite'); await waitFor('#if'); await sleep(400);
  await shot('45-invite', '.modal', 20);
  await click('.modal [data-go]'); await waitFor('.secret'); await sleep(600);
  await shot('46-invite-code', '.modal', 20);
  await closeModals(); await sleep(300);
  await click('[data-recover]'); await waitFor('#rv'); await sleep(300);
  await shot('47-recovery', '.modal', 20);
  await closeModals(); await sleep(300);
  await go('#/account', '#add', 700);
  await shot('48-account');
  await go('#/settings', '#sf', 600);
  await shot('49-settings');

  console.log(`\nSaved ${fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg')).length} screenshots to ${path.relative(ROOT, OUT)}`);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('\n✖', e.message); process.exit(1); });
