// REST API. Every route declares the roles allowed to call it; authorization is enforced server-side.
import { all, get, run, tx, nextCode, orgSettings } from './db.js';
import crypto from 'node:crypto';
import {
  createSession, destroySession, destroyUserSessions, sessionCookie, rateLimit, generateCode, codeHash,
} from './security.js';
import { relyingParty, issueChallenge, consumeChallenge, verifyRegistration, verifyAssertion, b64url } from './webauthn.js';
import { audit, verifyChain } from './audit.js';
import { registerControlRoutes } from './controls.js';
import { registerFindingRoutes } from './findings.js';
import { registerSoaRoutes } from './soa.js';
import { registerPackageRoutes } from './package.js';
import { registerTraceRoutes } from './trace.js';
import { registerVendorRoutes } from './vendors.js';
import { registerAssetRoutes } from './assets.js';
import { TEMPLATES } from './templates.js';
import { templateToPolicy, seedSampleData } from './seed.js';
import { lintPolicy, reviewPolicy, metricSummary, riskLevel, POLICY_TYPE_OPTIONS } from '../public/js/lint.js';
import {
  HttpError, bad, today, nowIso, addMonths, addDays, parseJson, newId,
  str, int, num, date, oneOf, idList, safeLocation,
} from './util.js';

const ROLES = ['admin', 'analyst', 'approver', 'auditor', 'employee'];
const R = {
  ANY: ROLES,
  READ: ['admin', 'analyst', 'approver', 'auditor'],
  WRITE: ['admin', 'analyst'],
  APPROVE: ['admin', 'approver'],
  STEWARD: ['admin', 'analyst', 'approver'],
  AUDIT: ['admin', 'analyst', 'auditor'],
  ADMIN: ['admin'],
};

// ---------------- Router ----------------
const routes = [];
function route(method, pattern, roles, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, roles, handler, opts });
}
export function matchRoute(method, pathname) {
  let methodMismatch = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    if (r.method !== method) { methodMismatch = true; continue; }
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return methodMismatch ? { methodMismatch } : null;
}

const pid = (v) => int(v, { name: 'id', min: 1, max: 2 ** 31 });
const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg);

// ---------------- Caches / helpers ----------------
// Controls visible to a workspace: the built-in catalogues plus its own custom frameworks.
const CONTROL_COLS = `c.id, c.ref, c.title, c.family, c.themes, f.code framework_code, f.name framework_name, f.id framework_id`;
let globalControls = null;
const orgControls = new Map();
function controlsMap(org) {
  if (!globalControls) {
    globalControls = new Map();
    for (const c of all(`SELECT ${CONTROL_COLS} FROM controls c JOIN frameworks f ON f.id = c.framework_id WHERE f.scope = 'global'`)) globalControls.set(c.id, c);
  }
  let m = orgControls.get(org);
  if (!m) {
    m = new Map(globalControls);
    for (const c of all(`SELECT ${CONTROL_COLS} FROM controls c JOIN frameworks f ON f.id = c.framework_id WHERE f.org_id = ?`, org)) m.set(c.id, c);
    orgControls.set(org, m);
  }
  return m;
}
const invalidateControls = (org) => orgControls.delete(org);
const visibleFrameworks = (org) => all("SELECT * FROM frameworks WHERE scope = 'global' OR org_id = ? ORDER BY custom, id", org);

const userName = (id) => (id ? get('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);

function hydratePolicy(row) {
  if (!row) return null;
  return {
    ...row,
    statements: parseJson(row.statements, []),
    roles: parseJson(row.roles, []),
    ref_controls: parseJson(row.ref_controls, []),
  };
}
// Other published policies in the same workspace, summarised to the values the review compares
// (lockout thresholds, patch deadlines…) so conflicting rules across policies are caught.
function peersOf(p) {
  return all("SELECT id, code, title, statements FROM policies WHERE org_id = ? AND status = 'published' AND id != ?", p.org_id, p.id)
    .map((r) => ({ id: r.id, code: r.code, title: r.title, metrics: metricSummary(parseJson(r.statements, [])) }));
}
const reviewOpts = (p) => ({ controlsById: controlsMap(p.org_id), today: today(), peers: peersOf(p) });
const lintOf = (p) => lintPolicy(p, reviewOpts(p));
const reviewOf = (p) => reviewPolicy(p, reviewOpts(p));
const reviewSummary = (r) => ({ verdict: r.verdict, overall: r.overall, scores: r.scores, gaps: r.gaps.map((g) => g.topic) });

function policyControlIds(p) {
  const s = new Set(p.ref_controls || []);
  for (const st of p.statements || []) for (const c of st.controls || []) s.add(c);
  return s;
}

function activeUserCount(org) {
  return get('SELECT COUNT(*) n FROM users WHERE active = 1 AND org_id = ?', org).n;
}
function attestationStats(policyId, version, org) {
  const n = get('SELECT COUNT(*) n FROM attestations a JOIN users u ON u.id = a.user_id WHERE a.policy_id = ? AND a.version = ? AND u.active = 1 AND u.org_id = ?', policyId, version, org).n;
  const total = activeUserCount(org);
  return { attested: n, total, rate: total ? Math.round((n / total) * 100) : 0 };
}

function exceptionView(e) {
  const t = today();
  const status = e.status === 'Approved' && e.expires_at < t ? 'Expired' : e.status;
  return { ...e, status, score: e.likelihood * e.impact, level: riskLevel(e.likelihood * e.impact).key };
}

function riskView(r, appetite = orgSettings(r.org_id).risk_appetite) {
  const inherent = r.likelihood * r.impact;
  const residual = r.res_likelihood * r.res_impact;
  return {
    ...r,
    policy_ids: parseJson(r.policy_ids, []),
    control_ids: parseJson(r.control_ids, []),
    org_control_ids: parseJson(r.org_control_ids, []),
    inherent, residual,
    inherent_level: riskLevel(inherent).key,
    residual_level: riskLevel(residual).key,
    above_appetite: residual > appetite && r.status !== 'Closed',
    ale: r.sle != null && r.aro != null ? Math.round(r.sle * r.aro) : null,
  };
}

function evidenceView(e) {
  const expires = addDays(e.collected_on, e.valid_days);
  const t = today();
  return { ...e, expires_on: expires, fresh: expires >= t, due_soon: expires >= t && expires <= addDays(t, 14) };
}

// Coverage: which controls are addressed by published vs. any active policy.
function coverage(org) {
  const pub = new Set(), any = new Set();
  for (const row of all("SELECT statements, ref_controls, status FROM policies WHERE status != 'retired' AND org_id = ?", org)) {
    const ids = policyControlIds(hydratePolicy(row));
    ids.forEach((id) => { any.add(id); if (row.status === 'published') pub.add(id); });
  }
  return { pub, any };
}

// ---------------- Auth: passkeys only (no passwords, no email) ----------------
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
const PUBKEY_PARAMS = [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }];
const SELECTION = { residentKey: 'required', requireResidentKey: true, userVerification: 'required' };

function loadInvite(code) {
  const inv = get('SELECT * FROM invites WHERE code_hash = ?', codeHash(code));
  if (!inv || inv.used_at || inv.expires_at < nowIso()) throw new HttpError(400, 'This invite or recovery code is invalid or has expired. Ask your administrator for a new one.');
  return inv;
}
const credsFor = (userId) => all('SELECT id, transports FROM credentials WHERE user_id = ?', userId)
  .map((c) => ({ type: 'public-key', id: c.id, transports: parseJson(c.transports, []) }));
function ensureHandle(u) {
  if (u.user_handle) return u.user_handle;
  const h = b64url(crypto.randomBytes(16));
  run('UPDATE users SET user_handle = ? WHERE id = ?', h, u.id);
  return h;
}
const actorOf = (u) => ({ user_id: u.id, username: u.username, org_id: u.org_id });
function startSession(ctx, u, action, details) {
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), u.id);
  const { token, csrf } = createSession(u.id);
  ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  audit(actorOf(u), action, 'user', u.id, details);
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)), csrf };
}
const credentialLabel = (v) => str(v, { name: 'Passkey name', max: 60 }) || 'Passkey';
function storeCredential(userId, cred, label) {
  run('INSERT INTO credentials(id, user_id, public_key, alg, sign_count, transports, label, backed_up) VALUES (?,?,?,?,?,?,?,?)',
    cred.id, userId, cred.publicKey, cred.alg, cred.signCount, JSON.stringify(cred.transports), label, cred.backedUp ? 1 : 0);
}
function checkNewUsername(v) {
  const username = str(v, { name: 'Username', required: true, max: 32 });
  if (!USERNAME_RE.test(username)) throw bad('Username must be 3–32 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.');
  if (/^demo-/i.test(username)) throw bad('Usernames starting with "demo-" are reserved.');
  if (get('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken. Choose another.');
  return username;
}
const limit = (ctx, key, n, label = 'attempts') => {
  const rl = rateLimit(key + ':' + ctx.ip, n, 15 * 60_000);
  if (!rl.ok) throw new HttpError(429, `Too many ${label}. Try again in ${rl.retryAfter}s.`);
};
// Options are fetched before the user's click (browsers only show the passkey prompt inside the click),
// so the username and workspace name are validated again when the passkey is submitted.
function creationOptions(ctx, purpose, data, user, exclude = []) {
  const rp = relyingParty(ctx.req, ctx.secure);
  const c = issueChallenge(purpose, { ...data, handle: user.id });
  return {
    challengeId: c.challengeId,
    publicKey: {
      challenge: c.challenge, rp: { id: rp.id, name: rp.name }, user,
      pubKeyCredParams: PUBKEY_PARAMS, timeout: 120_000, attestation: 'none', authenticatorSelection: SELECTION, excludeCredentials: exclude,
    },
  };
}

route('POST', '/api/auth/username', null, (ctx) => {
  limit(ctx, 'uname', 60);
  return { ok: true, username: checkNewUsername(ctx.body.username) };
}, { public: true });

// ----- Open sign-up: creates a new private workspace with the new user as its administrator -----
route('POST', '/api/auth/signup/options', null, (ctx) => {
  limit(ctx, 'signup-opts', 40);
  return creationOptions(ctx, 'signup', {}, { id: b64url(crypto.randomBytes(16)), name: 'new-user', displayName: 'New MandateGRC user' });
}, { public: true });

route('POST', '/api/auth/signup/verify', null, (ctx) => {
  limit(ctx, 'signup', 10, 'sign-ups');
  const ch = consumeChallenge(ctx.body.challengeId, 'signup');
  const username = checkNewUsername(ctx.body.username);
  const name = str(ctx.body.name, { name: 'Display name', max: 80 }) || username;
  const orgName = str(ctx.body.org_name, { name: 'Organization name', min: 2, max: 120, required: true });
  const sample = ctx.body.sample !== false;
  const cred = verifyRegistration(ctx.body.credential || {}, ch.challenge, relyingParty(ctx.req, ctx.secure));
  if (get('SELECT id FROM credentials WHERE id = ?', cred.id)) throw new HttpError(409, 'This passkey is already registered.');
  const label = credentialLabel(ctx.body.label);
  let user;
  tx(() => {
    if (get('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username was just taken. Choose another.');
    const orgId = Number(run('INSERT INTO orgs(name) VALUES (?)', orgName).lastInsertRowid);
    const userId = Number(run('INSERT INTO users(org_id, username, name, role, user_handle) VALUES (?,?,?,?,?)', orgId, username, name, 'admin', ch.data.handle).lastInsertRowid);
    storeCredential(userId, cred, label);
    if (sample) seedSampleData(orgId, userId);
    user = get('SELECT * FROM users WHERE id = ?', userId);
    audit(actorOf(user), 'workspace.created', 'workspace', orgId, { name: orgName, sample_data: sample });
  });
  return startSession(ctx, user, 'auth.signup', { label });
}, { public: true });

// ----- Joining an existing workspace (invite) or recovering access (recovery code) -----
route('POST', '/api/auth/invite', null, (ctx) => {
  limit(ctx, 'invite', 20);
  const inv = loadInvite(ctx.body.code);
  const u = inv.user_id ? get('SELECT username, name FROM users WHERE id = ?', inv.user_id) : null;
  const org = get('SELECT name FROM orgs WHERE id = ?', inv.org_id);
  const link = inv.purpose === 'recover' && inv.created_by === inv.user_id; // self-issued: adding another browser
  return { purpose: link ? 'link' : inv.purpose, role: inv.role || null, org: org?.name, username: u?.username || null, name: u?.name || null, expires_at: inv.expires_at };
}, { public: true });

route('POST', '/api/auth/register/options', null, (ctx) => {
  limit(ctx, 'reg', 30);
  const inv = loadInvite(ctx.body.code);
  if (inv.purpose === 'join') {
    return creationOptions(ctx, 'register', { invite: inv.code_hash }, { id: b64url(crypto.randomBytes(16)), name: 'new-user', displayName: 'New MandateGRC user' });
  }
  const u = get('SELECT * FROM users WHERE id = ? AND active = 1', inv.user_id);
  if (!u) throw new HttpError(400, 'The account for this code is no longer active.');
  return creationOptions(ctx, 'register', { invite: inv.code_hash }, { id: ensureHandle(u), name: u.username, displayName: u.name }, credsFor(u.id));
}, { public: true });

route('POST', '/api/auth/register/verify', null, (ctx) => {
  const ch = consumeChallenge(ctx.body.challengeId, 'register');
  const cred = verifyRegistration(ctx.body.credential || {}, ch.challenge, relyingParty(ctx.req, ctx.secure));
  if (get('SELECT id FROM credentials WHERE id = ?', cred.id)) throw new HttpError(409, 'This passkey is already registered.');
  const label = credentialLabel(ctx.body.label);
  let userId, purpose;
  tx(() => {
    const inv = get('SELECT * FROM invites WHERE code_hash = ?', ch.data.invite);
    if (!inv || inv.used_at || inv.expires_at < nowIso()) throw new HttpError(400, 'This code has already been used or has expired.');
    purpose = inv.purpose === 'recover' && inv.created_by === inv.user_id ? 'link' : inv.purpose;
    if (inv.purpose === 'join') {
      const username = checkNewUsername(ctx.body.username);
      const name = str(ctx.body.name, { name: 'Display name', max: 80 }) || username;
      userId = Number(run('INSERT INTO users(org_id, username, name, role, user_handle) VALUES (?,?,?,?,?)', inv.org_id, username, name, inv.role, ch.data.handle).lastInsertRowid);
    } else {
      userId = inv.user_id;
    }
    storeCredential(userId, cred, label);
    run('UPDATE invites SET used_at = ? WHERE code_hash = ?', nowIso(), inv.code_hash);
  });
  return startSession(ctx, get('SELECT * FROM users WHERE id = ?', userId), `auth.passkey_registered_${purpose}`, { label });
}, { public: true });

// ----- Sign-in: usernameless (discoverable passkey) or with a username hint -----
route('POST', '/api/auth/login/options', null, (ctx) => {
  limit(ctx, 'login', 60, 'sign-in attempts');
  const rp = relyingParty(ctx.req, ctx.secure);
  const c = issueChallenge('login');
  let allow = [];
  const username = typeof ctx.body.username === 'string' ? ctx.body.username.trim().slice(0, 32) : '';
  if (username) {
    const u = get('SELECT id FROM users WHERE username = ? AND active = 1', username);
    if (u) allow = credsFor(u.id);
  }
  return { challengeId: c.challengeId, publicKey: { challenge: c.challenge, rpId: rp.id, timeout: 120_000, userVerification: 'required', allowCredentials: allow } };
}, { public: true });

route('POST', '/api/auth/login/verify', null, (ctx) => {
  const ch = consumeChallenge(ctx.body.challengeId, 'login');
  const body = ctx.body.credential || {};
  const cred = get('SELECT * FROM credentials WHERE id = ?', String(body.id || '').slice(0, 1400));
  const generic = new HttpError(401, 'This passkey is not recognised. Use a passkey registered with MandateGRC.');
  if (!cred) throw generic;
  const u = get('SELECT * FROM users WHERE id = ?', cred.user_id);
  if (!u || !u.active) { if (u) audit(actorOf(u), 'auth.login_failed', 'user', u.id, { reason: 'inactive' }); throw generic; }
  if (body.userHandle && u.user_handle && body.userHandle !== u.user_handle) throw generic;
  let res;
  try { res = verifyAssertion(body, ch.challenge, relyingParty(ctx.req, ctx.secure), cred); } catch (e) {
    audit(actorOf(u), 'auth.login_failed', 'user', u.id, { reason: e.message });
    throw e;
  }
  run('UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE id = ?', res.signCount, nowIso(), cred.id);
  return startSession(ctx, u, 'auth.login', { passkey: cred.label });
}, { public: true });

route('POST', '/api/auth/logout', R.ANY, (ctx) => {
  destroySession(ctx.token);
  ctx.setHeader('Set-Cookie', sessionCookie('', ctx.secure, true));
  audit(ctx.actor, 'auth.logout', 'user', ctx.user.id);
  return { ok: true };
});

route('GET', '/api/auth/me', R.ANY, (ctx) => {
  const u = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
  return { user: publicUser(u), csrf: ctx.session.csrf, onboarded: !!u.onboarded_at, org: orgSettings(u.org_id).name };
});

route('POST', '/api/auth/onboarded', R.ANY, (ctx) => {
  const outcome = oneOf(ctx.body.outcome, ['completed', 'skipped'], { name: 'Outcome' });
  run('UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?', nowIso(), ctx.user.id);
  audit(ctx.actor, `onboarding.${outcome}`, 'user', ctx.user.id, { step: int(ctx.body.step, { name: 'Step', min: 0, max: 100, required: false, fallback: 0 }) });
  return { ok: true };
});

// ----- Add another browser or device -----
// Passkeys live in the browser or password manager that created them, so a new browser has none.
// A signed-in user can issue a short-lived, single-use code for themselves and redeem it in the new
// browser to create a passkey there. It reuses the recovery-code mechanism (stored hashed, one use).
const LINK_MINUTES = 15;
route('POST', '/api/auth/link-code', R.ANY, (ctx) => {
  limit(ctx, 'link-code', 10, 'code requests');
  const code = generateCode();
  const expires = new Date(Date.now() + LINK_MINUTES * 60_000).toISOString();
  tx(() => {
    run("DELETE FROM invites WHERE user_id = ? AND created_by = ? AND purpose = 'recover' AND used_at IS NULL", ctx.user.id, ctx.user.id);
    run('INSERT INTO invites(code_hash, org_id, purpose, user_id, created_by, expires_at) VALUES (?,?,?,?,?,?)', codeHash(code), ctx.user.org_id, 'recover', ctx.user.id, ctx.user.id, expires);
  });
  audit(ctx.actor, 'auth.link_code_issued', 'user', ctx.user.id, { minutes: LINK_MINUTES });
  return { code, expires_at: expires, minutes: LINK_MINUTES };
});
route('DELETE', '/api/auth/link-code', R.ANY, (ctx) => {
  run("DELETE FROM invites WHERE user_id = ? AND created_by = ? AND purpose = 'recover' AND used_at IS NULL", ctx.user.id, ctx.user.id);
  return { ok: true };
});

// ----- My passkeys -----
route('GET', '/api/auth/passkeys', R.ANY, (ctx) => all('SELECT id, label, transports, backed_up, created_at, last_used_at FROM credentials WHERE user_id = ? ORDER BY created_at', ctx.user.id)
  .map((c) => ({ ...c, transports: parseJson(c.transports, []), backed_up: !!c.backed_up, current: false })));
route('POST', '/api/auth/passkeys/options', R.ANY, (ctx) => {
  const u = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
  const rp = relyingParty(ctx.req, ctx.secure);
  const c = issueChallenge('add-passkey', { userId: u.id });
  return { challengeId: c.challengeId, publicKey: {
    challenge: c.challenge, rp: { id: rp.id, name: rp.name }, user: { id: ensureHandle(u), name: u.username, displayName: u.name },
    pubKeyCredParams: PUBKEY_PARAMS, timeout: 120_000, attestation: 'none',
    authenticatorSelection: SELECTION,
    excludeCredentials: credsFor(u.id),
  } };
});
route('POST', '/api/auth/passkeys/verify', R.ANY, (ctx) => {
  const ch = consumeChallenge(ctx.body.challengeId, 'add-passkey');
  if (ch.data.userId !== ctx.user.id) throw forbidden();
  const cred = verifyRegistration(ctx.body.credential || {}, ch.challenge, relyingParty(ctx.req, ctx.secure));
  if (get('SELECT id FROM credentials WHERE id = ?', cred.id)) throw new HttpError(409, 'This passkey is already registered.');
  const label = credentialLabel(ctx.body.label);
  storeCredential(ctx.user.id, cred, label);
  audit(ctx.actor, 'auth.passkey_added', 'user', ctx.user.id, { label });
  return { ok: true };
});
route('DELETE', '/api/auth/passkeys/:cid', R.ANY, (ctx) => {
  const c = get('SELECT id, label FROM credentials WHERE id = ? AND user_id = ?', ctx.params.cid, ctx.user.id);
  if (!c) throw notFound('Passkey');
  if (get('SELECT COUNT(*) n FROM credentials WHERE user_id = ?', ctx.user.id).n <= 1) throw bad('You cannot remove your only passkey. Add another one first.');
  run('DELETE FROM credentials WHERE id = ?', c.id);
  audit(ctx.actor, 'auth.passkey_removed', 'user', ctx.user.id, { label: c.label });
  return { ok: true };
});

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active, last_login_at: u.last_login_at, created_at: u.created_at,
    passkeys: get('SELECT COUNT(*) n FROM credentials WHERE user_id = ?', u.id).n,
  };
}

// ---------------- Meta ----------------
route('GET', '/api/meta', R.ANY, (ctx) => {
  const isEmployee = ctx.user.role === 'employee';
  return {
    org: orgSettings(ctx.user.org_id).name,
    risk_appetite: orgSettings(ctx.user.org_id).risk_appetite,
    sample_count: ['policies', 'risks', 'exceptions', 'evidence'].reduce((n, t) => n + get(`SELECT COUNT(*) n FROM ${t} WHERE org_id = ? AND sample = 1`, ctx.user.org_id).n, 0),
    frameworks: visibleFrameworks(ctx.user.org_id).map(({ id, code, name, version, description, custom }) => ({ id, code, name, version, description, custom })),
    controls: isEmployee ? [] : [...controlsMap(ctx.user.org_id).values()],
    templates: isEmployee ? [] : TEMPLATES.map((t) => {
      const fws = new Set();
      t.statements.forEach(([, refs]) => refs.forEach((r) => fws.add(r.split(':')[0])));
      return { key: t.key, type: t.type, title: t.title, summary: t.summary, statements: t.statements.length, frameworks: [...fws] };
    }),
  };
});

// ---------------- Dashboard ----------------
route('GET', '/api/dashboard', R.READ, (ctx) => {
  const org = ctx.user.org_id;
  const appetite = orgSettings(org).risk_appetite;
  const t = today();
  const soon = addDays(t, 30);
  const policies = all('SELECT * FROM policies WHERE org_id = ?', org).map(hydratePolicy);
  const active = policies.filter((p) => p.status !== 'retired');
  const scores = active.map((p) => lintOf(p).score);
  const byStatus = Object.fromEntries(['draft', 'in_review', 'approved', 'published', 'retired'].map((s) => [s, policies.filter((p) => p.status === s).length]));
  const published = policies.filter((p) => p.status === 'published');
  const overdue = published.filter((p) => p.next_review_date && p.next_review_date < t);
  const upcoming = published.filter((p) => p.next_review_date && p.next_review_date >= t && p.next_review_date <= addDays(t, 60));

  const risks = all('SELECT * FROM risks WHERE org_id = ?', org).map((r) => riskView(r, appetite));
  const openRisks = risks.filter((r) => r.status !== 'Closed');
  const heat = { inherent: Array.from({ length: 5 }, () => Array(5).fill(0)), residual: Array.from({ length: 5 }, () => Array(5).fill(0)) };
  openRisks.forEach((r) => { heat.inherent[r.likelihood - 1][r.impact - 1]++; heat.residual[r.res_likelihood - 1][r.res_impact - 1]++; });

  const exceptions = all('SELECT * FROM exceptions WHERE org_id = ?', org).map(exceptionView);
  const evidence = all('SELECT * FROM evidence WHERE org_id = ?', org).map(evidenceView);
  const cov = coverage(org);
  const frameworks = visibleFrameworks(org).map(({ id, code, name }) => ({ id, code, name })).map((f) => {
    const ids = all('SELECT id FROM controls WHERE framework_id = ?', f.id).map((c) => c.id);
    const total = ids.length;
    const pub = ids.filter((id) => cov.pub.has(id)).length;
    const any = ids.filter((id) => cov.any.has(id)).length;
    return { ...f, total, published: pub, planned: any, pct: total ? Math.round((pub / total) * 100) : 0, plannedPct: total ? Math.round((any / total) * 100) : 0 };
  });

  const att = published.map((p) => attestationStats(p.id, p.version, org));
  const attRate = att.length ? Math.round(att.reduce((a, s) => a + s.rate, 0) / att.length) : 0;
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const fwInUse = frameworks.filter((f) => f.planned > 0);
  const avgCov = fwInUse.length ? Math.round(fwInUse.reduce((a, f) => a + f.pct, 0) / fwInUse.length) : 0;
  const evFresh = evidence.length ? Math.round((evidence.filter((e) => e.fresh).length / evidence.length) * 100) : 0;
  const riskOk = openRisks.length ? Math.round((openRisks.filter((r) => !r.above_appetite).length / openRisks.length) * 100) : 100;
  const posture = Math.round(0.25 * avgScore + 0.25 * avgCov + 0.2 * evFresh + 0.2 * riskOk + 0.1 * attRate);

  // Personal action queue.
  const me = ctx.user;
  const actions = [];
  if (R.APPROVE.includes(me.role)) {
    policies.filter((p) => p.status === 'in_review').forEach((p) => actions.push({
      kind: 'approve', severity: p.submitted_by === me.id ? 'info' : 'high',
      title: `${p.code} ${p.title} awaits approval`, detail: p.submitted_by === me.id ? 'You submitted this, so another approver must approve it.' : `Submitted by ${userName(p.submitted_by) || 'unknown'}`, link: `#/policies/${p.id}` }));
    exceptions.filter((e) => e.status === 'Requested').forEach((e) => actions.push({
      kind: 'exception', severity: 'medium', title: `${e.code} exception request: ${e.title}`, detail: `Expires ${e.expires_at}`, link: '#/exceptions' }));
  }
  overdue.forEach((p) => actions.push({ kind: 'review', severity: 'critical', title: `${p.code} ${p.title} review overdue`, detail: `Was due ${p.next_review_date}`, link: `#/policies/${p.id}` }));
  upcoming.forEach((p) => actions.push({ kind: 'review', severity: 'medium', title: `${p.code} ${p.title} review due`, detail: `Due ${p.next_review_date}`, link: `#/policies/${p.id}` }));
  exceptions.filter((e) => e.status === 'Approved' && e.expires_at <= soon).forEach((e) => actions.push({ kind: 'exception', severity: 'high', title: `${e.code} exception expires ${e.expires_at}`, detail: e.title, link: '#/exceptions' }));
  exceptions.filter((e) => e.status === 'Expired').forEach((e) => actions.push({ kind: 'exception', severity: 'critical', title: `${e.code} exception has expired`, detail: 'Close it, or remediate the underlying gap.', link: '#/exceptions' }));
  evidence.filter((e) => !e.fresh).forEach((e) => actions.push({ kind: 'evidence', severity: 'high', title: `Stale evidence: ${e.title}`, detail: `Expired ${e.expires_on}`, link: '#/evidence' }));
  risks.filter((r) => r.above_appetite).forEach((r) => actions.push({ kind: 'risk', severity: r.residual_level === 'critical' ? 'critical' : 'high', title: `${r.code} above risk appetite (residual ${r.residual})`, detail: r.title, link: '#/risks' }));
  policies.filter((p) => p.status === 'draft' && p.review_note).forEach((p) => actions.push({ kind: 'rework', severity: 'medium', title: `${p.code} returned for rework`, detail: p.review_note, link: `#/policies/${p.id}` }));
  const ctlSummary = controlsApi.summary(org, me);
  const fndSummary = findingsApi.summary(org, me);
  const vndSummary = vendorsApi.summary(org, me);
  actions.push(...ctlSummary.actions, ...fndSummary.actions, ...vndSummary.actions);
  const sevOrder = { critical: 0, high: 1, medium: 2, info: 3 };
  actions.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return {
    posture: { score: posture, parts: { policyQuality: avgScore, coverage: avgCov, evidenceFresh: evFresh, riskWithinAppetite: riskOk, attestation: attRate } },
    policies: { total: policies.length, byStatus, avgScore, overdue: overdue.length, upcoming: upcoming.length },
    risks: { open: openRisks.length, aboveAppetite: openRisks.filter((r) => r.above_appetite).length, critical: openRisks.filter((r) => r.residual_level === 'critical').length, ale: openRisks.reduce((a, r) => a + (r.ale || 0), 0), heat, appetite },
    exceptions: { active: exceptions.filter((e) => e.status === 'Approved').length, requested: exceptions.filter((e) => e.status === 'Requested').length, expiring: exceptions.filter((e) => e.status === 'Approved' && e.expires_at <= soon).length, expired: exceptions.filter((e) => e.status === 'Expired').length },
    evidence: { total: evidence.length, stale: evidence.filter((e) => !e.fresh).length, dueSoon: evidence.filter((e) => e.due_soon).length },
    controls: ctlSummary.stats,
    findings: fndSummary.stats,
    vendors: vndSummary.stats,
    frameworks,
    actions: actions.slice(0, 25),
    recent: all('SELECT id, ts, username, action, entity, entity_id FROM audit_log WHERE org_id = ? ORDER BY id DESC LIMIT 8', org),
  };
});

// ---------------- Policies ----------------
function loadPolicy(id, org) {
  const p = hydratePolicy(get('SELECT * FROM policies WHERE id = ? AND org_id = ?', id, org));
  if (!p) throw notFound('Policy');
  return p;
}

function policyDetail(p) {
  const revisions = all(`SELECT r.id, r.version, r.change_type, r.change_summary, r.created_at, a.name author, ap.name approver
                         FROM policy_revisions r LEFT JOIN users a ON a.id = r.author_id LEFT JOIN users ap ON ap.id = r.approver_id
                         WHERE r.policy_id = ? ORDER BY r.id DESC`, p.id);
  return {
    ...p,
    created_by_name: userName(p.created_by), updated_by_name: userName(p.updated_by),
    submitted_by_name: userName(p.submitted_by), approved_by_name: userName(p.approved_by),
    revisions,
    lint: lintOf(p),
    peers: peersOf(p),
    attestation: p.status === 'published' ? attestationStats(p.id, p.version, p.org_id) : null,
    exceptions: all('SELECT * FROM exceptions WHERE policy_id = ? AND org_id = ? ORDER BY id DESC', p.id, p.org_id).map(exceptionView),
    risks: all('SELECT id, code, title, res_likelihood, res_impact, status, policy_ids FROM risks WHERE org_id = ?', p.org_id).map((r) => ({ ...r, policy_ids: parseJson(r.policy_ids, []) }))
      .filter((r) => r.policy_ids.includes(p.id)).map(({ policy_ids, ...r }) => ({ ...r, residual: r.res_likelihood * r.res_impact })),
  };
}

// For employees: the version currently in force (published, or the last approved snapshot during a revision).
function inForce(p) {
  if (p.status === 'published') return p;
  if (p.status === 'retired' || !p.published_version) return null;
  const rev = get('SELECT snapshot FROM policy_revisions WHERE policy_id = ? AND version = ? ORDER BY id DESC LIMIT 1', p.id, p.published_version);
  if (!rev) return null;
  return { ...p, ...parseJson(rev.snapshot, {}), version: p.published_version, status: 'published', in_revision: true };
}

route('GET', '/api/policies', R.ANY, (ctx) => {
  const rows = all('SELECT * FROM policies WHERE org_id = ? ORDER BY code', ctx.user.org_id).map(hydratePolicy);
  if (ctx.user.role === 'employee') {
    return rows.map(inForce).filter(Boolean).map((p) => ({ id: p.id, code: p.code, title: p.title, owner: p.owner, version: p.version, status: p.status, effective_date: p.effective_date, next_review_date: p.next_review_date }));
  }
  const cmap = controlsMap(ctx.user.org_id);
  return rows.map((p) => {
    const l = lintOf(p);
    const fws = new Set([...policyControlIds(p)].map((id) => cmap.get(id)?.framework_code).filter(Boolean));
    return {
      id: p.id, code: p.code, title: p.title, owner: p.owner, version: p.version, status: p.status,
      classification: p.classification, effective_date: p.effective_date, next_review_date: p.next_review_date,
      updated_at: p.updated_at, statements: p.statements.length, sample: !!p.sample, score: l.score, grade: l.grade, errors: l.errors, warnings: l.warnings,
      frameworks: [...fws], attestation: p.status === 'published' ? attestationStats(p.id, p.version, p.org_id) : null,
    };
  });
});

route('POST', '/api/policies', R.WRITE, (ctx) => {
  const title = str(ctx.body.title, { name: 'Policy name', max: 200 });
  const owner = str(ctx.body.owner, { name: 'Owner', max: 200 });
  let policyType = policyTypeOf(ctx.body.policy_type);
  let base;
  if (ctx.body.template) {
    // A template is a deliberate choice: its wording is copied in for the author to tailor.
    const t = TEMPLATES.find((x) => x.key === ctx.body.template);
    if (!t) throw bad('Unknown template');
    base = templateToPolicy(t);
    policyType = t.type;
    if (title) base.title = title;
    if (owner) base.owner = owner;
  } else {
    // A blank policy is genuinely empty: only the name and owner the author typed.
    if (!title) throw bad('Give the policy a name.');
    base = { title, owner, purpose: '', scope: '', statements: [{ id: newId(), text: '', controls: [] }], roles: [{ role: '', responsibility: '' }], enforcement: '' };
  }
  const code = nextCode('policies', 'POL', ctx.user.org_id);
  const r = run(`INSERT INTO policies(org_id, code, title, owner, purpose, scope, statements, roles, enforcement, created_by, updated_by, policy_type)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, ctx.user.org_id, code, base.title, base.owner, base.purpose, base.scope,
    JSON.stringify(base.statements), JSON.stringify(base.roles), base.enforcement, ctx.user.id, ctx.user.id, policyType);
  const id = Number(r.lastInsertRowid);
  audit(ctx.actor, 'policy.created', 'policy', id, { code, template: ctx.body.template || null });
  return { id };
});

// Import: the browser has already read the uploaded file and split it into the anatomy
// (the file itself never reaches the server). Content is validated exactly like a normal save
// and always lands as a fresh, unversioned draft.
route('POST', '/api/policies/import', R.WRITE, (ctx) => {
  const b = ctx.body;
  const v = validatePolicyContent({
    ...b,
    review_cycle_months: [3, 6, 12, 18, 24, 36].includes(Number(b.review_cycle_months)) ? Number(b.review_cycle_months) : 12,
    statements: Array.isArray(b.statements) ? b.statements.slice(0, 200) : [],
    roles: Array.isArray(b.roles) ? b.roles.slice(0, 30) : [],
  }, ctx.user.org_id);
  const source = {
    filename: str(b.source?.filename, { name: 'File name', max: 200 }),
    format: oneOf(b.source?.format, ['docx', 'pdf', 'markdown', 'text', 'html', 'paste'], { name: 'Format', fallback: 'text' }),
    confidence: Math.max(0, Math.min(100, Math.round(Number(b.source?.confidence) || 0))),
  };
  // Optionally complete missing sections with the matching template's professional wording.
  const filled = [];
  if (b.fill_from_template && v.policy_type && v.policy_type !== 'other') {
    const t = TEMPLATES.find((x) => x.type === v.policy_type);
    if (t) {
      const tp = templateToPolicy(t);
      for (const k of ['purpose', 'scope', 'enforcement']) if (!v[k]) { v[k] = tp[k]; filled.push(k); }
      if (!v.owner) { v.owner = tp.owner; filled.push('owner'); }
      if (!v.roles.some((r) => r.role)) { v.roles = tp.roles; filled.push('roles'); }
    }
  }
  if (!v.statements.length) v.statements = [{ id: newId(), text: '', controls: [] }];
  if (!v.roles.length) v.roles = [{ role: '', responsibility: '' }];
  const next = v.effective_date ? addMonths(v.effective_date, v.review_cycle_months) : null;
  const code = nextCode('policies', 'POL', ctx.user.org_id);
  const r = run(`INSERT INTO policies(org_id, code, title, owner, classification, effective_date, review_cycle_months, next_review_date, purpose, scope,
                 statements, roles, enforcement, ref_controls, related_docs, policy_type, created_by, updated_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.user.org_id, code, v.title, v.owner, v.classification, v.effective_date, v.review_cycle_months, next, v.purpose, v.scope,
    JSON.stringify(v.statements), JSON.stringify(v.roles), v.enforcement, JSON.stringify(v.ref_controls), v.related_docs, v.policy_type, ctx.user.id, ctx.user.id);
  const id = Number(r.lastInsertRowid);
  audit(ctx.actor, 'policy.imported', 'policy', id, { code, ...source, policy_type: v.policy_type, statements: v.statements.length, filled_from_template: filled });
  return { id, code, filled };
});

route('GET', '/api/policies/:id', R.ANY, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (ctx.user.role === 'employee') {
    const f = inForce(p);
    if (!f) throw notFound('Policy');
    const mine = get('SELECT attested_at FROM attestations WHERE policy_id = ? AND version = ? AND user_id = ?', f.id, f.version, ctx.user.id);
    return { ...f, approved_by_name: userName(p.approved_by), revisions: [], attested_at: mine?.attested_at || null };
  }
  const d = policyDetail(p);
  const mine = get('SELECT attested_at FROM attestations WHERE policy_id = ? AND version = ? AND user_id = ?', p.id, p.version, ctx.user.id);
  d.attested_at = mine?.attested_at || null;
  return d;
});

route('GET', '/api/policies/:id/revisions/:rid', R.READ, (ctx) => {
  const r = get(`SELECT r.* FROM policy_revisions r JOIN policies p ON p.id = r.policy_id
                 WHERE r.id = ? AND r.policy_id = ? AND p.org_id = ?`, pid(ctx.params.rid), pid(ctx.params.id), ctx.user.org_id);
  if (!r) throw notFound('Revision');
  return { ...r, snapshot: parseJson(r.snapshot, {}) };
});

// '' / null = detect the type from the policy name; 'other' = no coverage checklist.
const POLICY_TYPE_KEYS = POLICY_TYPE_OPTIONS.map((t) => t.key);
function policyTypeOf(v) {
  if (v == null || v === '') return null;
  return oneOf(v, [...POLICY_TYPE_KEYS, 'other'], { name: 'Policy type' });
}

function validatePolicyContent(b, org) {
  const cmap = controlsMap(org);
  const validControls = (ids) => idList(ids, { name: 'Controls' }).filter((id) => cmap.has(id));
  if (!Array.isArray(b.statements) || b.statements.length > 200) throw bad('Statements must be a list (max 200)');
  if (!Array.isArray(b.roles) || b.roles.length > 30) throw bad('Roles must be a list (max 30)');
  return {
    title: str(b.title, { name: 'Policy name', max: 200, required: true }),
    owner: str(b.owner, { name: 'Owner', max: 200 }),
    classification: oneOf(b.classification, ['Public', 'Internal', 'Confidential', 'Restricted'], { name: 'Classification', fallback: 'Internal' }),
    effective_date: date(b.effective_date, { name: 'Effective date' }),
    review_cycle_months: oneOf(Number(b.review_cycle_months), [3, 6, 12, 18, 24, 36], { name: 'Review cycle' }),
    purpose: str(b.purpose, { name: 'Purpose', max: 5000 }),
    scope: str(b.scope, { name: 'Scope', max: 5000 }),
    statements: b.statements.map((s, i) => ({
      id: /^[a-z0-9]{1,20}$/i.test(String(s?.id || '')) ? String(s.id) : newId(),
      text: str(s?.text, { name: `Statement 4.${i + 1}`, max: 2000 }),
      controls: validControls(s?.controls || []),
      // Auto-map suggestions the analyst rejected, so they are not offered again.
      dismissed: validControls(Array.isArray(s?.dismissed) ? s.dismissed.slice(0, 60) : []),
      // "Qualitative: accepted": the analyst's reason why no number applies. Who and when are stamped by the server.
      ...(s?.qualitative?.reason ? { qualitative: { reason: str(s.qualitative.reason, { name: `Reason for statement 4.${i + 1}`, min: 3, max: 300 }) } } : {}),
    })),
    // `owner: true` tags the row that holds the policy-owner role (at most one).
    roles: b.roles.map((r) => ({ role: str(r?.role, { name: 'Role', max: 120 }), responsibility: str(r?.responsibility, { name: 'Responsibility', max: 1000 }), ...(r?.owner === true ? { owner: true } : {}) }))
      .map((r, i, all) => (r.owner && all.findIndex((x) => x.owner) !== i ? { role: r.role, responsibility: r.responsibility } : r)),
    enforcement: str(b.enforcement, { name: 'Compliance & Enforcement', max: 5000 }),
    ref_controls: validControls(b.ref_controls || []),
    related_docs: str(b.related_docs, { name: 'Related documents', max: 2000 }),
    policy_type: policyTypeOf(b.policy_type),
  };
}

route('PUT', '/api/policies/:id', R.WRITE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'draft') throw new HttpError(409, `Only drafts can be edited. This policy is ${p.status.replace('_', ' ')}. Use "Revise" to start a new version.`);
  if (ctx.body.updated_at && ctx.body.updated_at !== p.updated_at) throw new HttpError(409, 'This policy was changed by someone else since you opened it. Reload to see the latest version.');
  const v = validatePolicyContent(ctx.body, p.org_id);
  const next = v.effective_date ? addMonths(v.effective_date, v.review_cycle_months) : null;
  const ts = nowIso();
  const qualitativeEvents = stampQualitative(v.statements, p.statements, ctx.user, ts);
  run(`UPDATE policies SET title=?, owner=?, classification=?, effective_date=?, review_cycle_months=?, next_review_date=?, purpose=?, scope=?,
       statements=?, roles=?, enforcement=?, ref_controls=?, related_docs=?, policy_type=?, updated_by=?, updated_at=? WHERE id=?`,
    v.title, v.owner, v.classification, v.effective_date, v.review_cycle_months, next, v.purpose, v.scope,
    JSON.stringify(v.statements), JSON.stringify(v.roles), v.enforcement, JSON.stringify(v.ref_controls), v.related_docs, v.policy_type, ctx.user.id, ts, p.id);
  audit(ctx.actor, 'policy.updated', 'policy', p.id, { code: p.code, statements: v.statements.length });
  for (const e of qualitativeEvents) audit(ctx.actor, e.action, 'policy', p.id, { code: p.code, ...e.details });
  return policyDetail(loadPolicy(p.id, p.org_id));
});

// Keep who/when for qualitative acceptances that did not change; stamp new ones. Returns audit events.
function stampQualitative(next, prev, user, ts) {
  const before = new Map((prev || []).map((s) => [s.id, s]));
  const events = [];
  next.forEach((s, i) => {
    const old = before.get(s.id)?.qualitative;
    const num = `4.${i + 1}`;
    if (s.qualitative) {
      if (old && old.reason === s.qualitative.reason) s.qualitative = old;
      else {
        s.qualitative = { reason: s.qualitative.reason, by: user.username, at: ts };
        events.push({ action: 'policy.statement_qualitative_accepted', details: { statement: num, reason: s.qualitative.reason } });
      }
    } else if (old) events.push({ action: 'policy.statement_qualitative_cleared', details: { statement: num } });
  });
  return events;
}

route('POST', '/api/policies/:id/submit', R.WRITE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'draft') throw new HttpError(409, 'Only drafts can be submitted for review.');
  const review = reviewOf(p);
  const l = review.lint;
  if (l.errors) throw bad(`The review says "Not ready": resolve ${l.errors} blocking issue(s) before submitting.`, l.issues.filter((i) => i.severity === 'error'));
  const changeType = p.version === '0.0' ? 'major' : oneOf(ctx.body.change_type, ['minor', 'major'], { name: 'Change type' });
  const summary = str(ctx.body.change_summary, { name: 'Change summary', min: 10, max: 1000, required: true });
  run(`UPDATE policies SET status='in_review', submitted_by=?, pending_change_type=?, pending_change_summary=?, review_note=NULL, updated_at=? WHERE id=?`,
    ctx.user.id, changeType, summary, nowIso(), p.id);
  audit(ctx.actor, 'policy.submitted', 'policy', p.id, { code: p.code, change_type: changeType, score: l.score, review: reviewSummary(review) });
  return { ok: true };
});

route('POST', '/api/policies/:id/approve', R.APPROVE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'in_review') throw new HttpError(409, 'Only policies in review can be approved.');
  if (p.submitted_by === ctx.user.id || p.updated_by === ctx.user.id) {
    audit(ctx.actor, 'policy.approval_blocked_sod', 'policy', p.id, { code: p.code });
    throw forbidden('Separation of duties: you cannot approve a policy you authored or submitted.');
  }
  const review = reviewOf(p);
  if (review.lint.errors) throw bad('The review says "Not ready": this policy has blocking issues and cannot be approved.');
  // Approvers must explicitly accept any must-have topic the policy still does not cover.
  if (review.gaps.length && ctx.body.acknowledge_gaps !== true) {
    throw Object.assign(bad(`This policy has ${review.gaps.length} unresolved coverage gap(s). Acknowledge them to approve, or return it for rework.`, review.gaps.map((g) => g.topic)), { code: 'GAPS_UNACKNOWLEDGED' });
  }
  const [maj, min] = p.version.split('.').map(Number);
  const version = p.version === '0.0' ? '1.0' : p.pending_change_type === 'major' ? `${maj + 1}.0` : `${maj}.${min + 1}`;
  const ts = nowIso();
  const snapshot = { title: p.title, owner: p.owner, classification: p.classification, effective_date: p.effective_date, review_cycle_months: p.review_cycle_months, next_review_date: p.next_review_date, purpose: p.purpose, scope: p.scope, statements: p.statements, roles: p.roles, enforcement: p.enforcement, ref_controls: p.ref_controls, related_docs: p.related_docs, policy_type: p.policy_type, version };
  tx(() => {
    run(`UPDATE policies SET status='approved', version=?, approved_by=?, approved_at=?, review_note=NULL, updated_at=? WHERE id=?`, version, ctx.user.id, ts, ts, p.id);
    run(`INSERT INTO policy_revisions(policy_id, version, change_type, change_summary, author_id, approver_id, snapshot, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      p.id, version, p.pending_change_type || 'major', p.pending_change_summary || 'Approved', p.submitted_by, ctx.user.id, JSON.stringify(snapshot), ts);
  });
  audit(ctx.actor, 'policy.approved', 'policy', p.id, { code: p.code, version, note: str(ctx.body.note, { name: 'Note', max: 1000 }) || null, review: reviewSummary(review), gaps_acknowledged: review.gaps.map((g) => g.topic) });
  return { ok: true, version };
});

route('POST', '/api/policies/:id/reject', R.APPROVE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'in_review') throw new HttpError(409, 'Only policies in review can be returned.');
  const note = str(ctx.body.note, { name: 'Reason', min: 5, max: 1000, required: true });
  run(`UPDATE policies SET status='draft', review_note=?, updated_at=? WHERE id=?`, note, nowIso(), p.id);
  audit(ctx.actor, 'policy.returned', 'policy', p.id, { code: p.code, note });
  return { ok: true };
});

route('POST', '/api/policies/:id/publish', R.STEWARD, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'approved') throw new HttpError(409, 'Only approved policies can be published.');
  const eff = date(ctx.body.effective_date, { name: 'Effective date' }) || p.effective_date || today();
  const next = addMonths(eff, p.review_cycle_months);
  const ts = nowIso();
  run(`UPDATE policies SET status='published', published_version=version, effective_date=?, next_review_date=?, published_at=?, pending_change_type=NULL, pending_change_summary=NULL, updated_at=? WHERE id=?`, eff, next, ts, ts, p.id);
  audit(ctx.actor, 'policy.published', 'policy', p.id, { code: p.code, version: p.version, effective_date: eff });
  return { ok: true };
});

route('POST', '/api/policies/:id/revise', R.WRITE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (!['approved', 'published'].includes(p.status)) throw new HttpError(409, 'Only approved or published policies can be revised.');
  run(`UPDATE policies SET status='draft', updated_by=?, updated_at=? WHERE id=?`, ctx.user.id, nowIso(), p.id);
  audit(ctx.actor, 'policy.revision_started', 'policy', p.id, { code: p.code, from_version: p.version });
  return { ok: true };
});

route('POST', '/api/policies/:id/retire', R.STEWARD, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status === 'retired') throw new HttpError(409, 'Policy is already retired.');
  if (p.version === '0.0') throw new HttpError(409, 'Never-approved drafts should be deleted, not retired.');
  const note = str(ctx.body.note, { name: 'Reason', min: 5, max: 1000, required: true });
  run(`UPDATE policies SET status='retired', updated_at=? WHERE id=?`, nowIso(), p.id);
  audit(ctx.actor, 'policy.retired', 'policy', p.id, { code: p.code, note });
  return { ok: true };
});

route('DELETE', '/api/policies/:id', R.WRITE, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  if (p.status !== 'draft' || p.version !== '0.0') throw new HttpError(409, 'Only never-approved drafts can be deleted. Approved policies must be retired to preserve the record.');
  run('DELETE FROM policies WHERE id = ?', p.id);
  audit(ctx.actor, 'policy.deleted', 'policy', p.id, { code: p.code, title: p.title });
  return { ok: true };
});

route('POST', '/api/policies/:id/attest', R.ANY, (ctx) => {
  const p = loadPolicy(pid(ctx.params.id), ctx.user.org_id);
  const f = inForce(p);
  if (!f) throw new HttpError(409, 'Only policies in force can be acknowledged.');
  run('INSERT OR IGNORE INTO attestations(policy_id, version, user_id) VALUES (?,?,?)', p.id, f.version, ctx.user.id);
  audit(ctx.actor, 'policy.attested', 'policy', p.id, { code: p.code, version: f.version });
  return { ok: true };
});

route('GET', '/api/attestations', R.ANY, (ctx) => {
  const org = ctx.user.org_id;
  const rows = all("SELECT * FROM policies WHERE status != 'retired' AND org_id = ? ORDER BY code", org).map(hydratePolicy).map(inForce).filter(Boolean);
  const mine = rows.map((p) => {
    const a = get('SELECT attested_at FROM attestations WHERE policy_id = ? AND version = ? AND user_id = ?', p.id, p.version, ctx.user.id);
    return { id: p.id, code: p.code, title: p.title, version: p.version, effective_date: p.effective_date, attested_at: a?.attested_at || null };
  });
  const stats = R.READ.includes(ctx.user.role) ? rows.map((p) => ({ id: p.id, code: p.code, title: p.title, version: p.version, ...attestationStats(p.id, p.version, org),
    pending: all(`SELECT u.name, u.role FROM users u WHERE u.active = 1 AND u.org_id = ? AND u.id NOT IN (SELECT user_id FROM attestations WHERE policy_id = ? AND version = ?) ORDER BY u.name`, org, p.id, p.version) })) : null;
  return { mine, stats };
});

// ---------------- Risks ----------------
function validateRisk(b, org) {
  const cmap = controlsMap(org);
  return {
    title: str(b.title, { name: 'Title', max: 200, required: true }),
    description: str(b.description, { name: 'Description', max: 4000 }),
    category: str(b.category, { name: 'Category', max: 80 }) || 'Information Security',
    owner: str(b.owner, { name: 'Owner', max: 120, required: true }),
    likelihood: int(b.likelihood, { name: 'Likelihood', min: 1, max: 5 }),
    impact: int(b.impact, { name: 'Impact', min: 1, max: 5 }),
    res_likelihood: int(b.res_likelihood, { name: 'Residual likelihood', min: 1, max: 5 }),
    res_impact: int(b.res_impact, { name: 'Residual impact', min: 1, max: 5 }),
    treatment: oneOf(b.treatment, ['Mitigate', 'Accept', 'Transfer', 'Avoid'], { name: 'Treatment' }),
    treatment_plan: str(b.treatment_plan, { name: 'Treatment plan', max: 4000 }),
    status: oneOf(b.status, ['Open', 'In Treatment', 'Accepted', 'Closed'], { name: 'Status' }),
    due_date: date(b.due_date, { name: 'Due date' }),
    sle: num(b.sle, { name: 'Single loss expectancy' }),
    aro: num(b.aro, { name: 'Annual rate of occurrence', max: 365 }),
    policy_ids: idList(b.policy_ids, { name: 'Policies' }).filter((id) => get('SELECT id FROM policies WHERE id = ? AND org_id = ?', id, org)),
    control_ids: idList(b.control_ids, { name: 'Controls' }).filter((id) => cmap.has(id)),
    // Controls from the control register that mitigate this risk.
    org_control_ids: idList(b.org_control_ids || [], { name: 'Mitigating controls' }).filter((id) => get('SELECT id FROM org_controls WHERE id = ? AND org_id = ?', id, org)),
  };
}
route('GET', '/api/risks', R.READ, (ctx) => {
  const appetite = orgSettings(ctx.user.org_id).risk_appetite;
  return all('SELECT * FROM risks WHERE org_id = ? ORDER BY id', ctx.user.org_id).map((r) => riskView(r, appetite));
});
route('POST', '/api/risks', R.WRITE, (ctx) => {
  const v = validateRisk(ctx.body, ctx.user.org_id);
  if (v.res_likelihood * v.res_impact > v.likelihood * v.impact) throw bad('Residual risk cannot exceed inherent risk.');
  const code = nextCode('risks', 'RSK', ctx.user.org_id);
  const r = run(`INSERT INTO risks(org_id, code, title, description, category, owner, likelihood, impact, res_likelihood, res_impact, treatment, treatment_plan, status, due_date, sle, aro, policy_ids, control_ids, org_control_ids, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ctx.user.org_id, code, v.title, v.description, v.category, v.owner, v.likelihood, v.impact,
    v.res_likelihood, v.res_impact, v.treatment, v.treatment_plan, v.status, v.due_date, v.sle, v.aro, JSON.stringify(v.policy_ids), JSON.stringify(v.control_ids), JSON.stringify(v.org_control_ids), ctx.user.id);
  audit(ctx.actor, 'risk.created', 'risk', Number(r.lastInsertRowid), { code, title: v.title, inherent: v.likelihood * v.impact });
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/risks/:id', R.WRITE, (ctx) => {
  const id = pid(ctx.params.id);
  const old = get('SELECT * FROM risks WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!old) throw notFound('Risk');
  const v = validateRisk(ctx.body, ctx.user.org_id);
  if (v.res_likelihood * v.res_impact > v.likelihood * v.impact) throw bad('Residual risk cannot exceed inherent risk.');
  run(`UPDATE risks SET title=?, description=?, category=?, owner=?, likelihood=?, impact=?, res_likelihood=?, res_impact=?, treatment=?, treatment_plan=?, status=?, due_date=?, sle=?, aro=?, policy_ids=?, control_ids=?, org_control_ids=?, updated_at=? WHERE id=?`,
    v.title, v.description, v.category, v.owner, v.likelihood, v.impact, v.res_likelihood, v.res_impact, v.treatment, v.treatment_plan, v.status, v.due_date, v.sle, v.aro,
    JSON.stringify(v.policy_ids), JSON.stringify(v.control_ids), JSON.stringify(v.org_control_ids), nowIso(), id);
  const changes = {};
  for (const k of ['likelihood', 'impact', 'res_likelihood', 'res_impact', 'status', 'treatment', 'owner']) if (old[k] !== v[k]) changes[k] = [old[k], v[k]];
  for (const k of ['policy_ids', 'control_ids', 'org_control_ids']) if (old[k] !== JSON.stringify(v[k])) changes[k] = [parseJson(old[k], []).length, v[k].length];
  audit(ctx.actor, 'risk.updated', 'risk', id, { code: old.code, changes });
  return { ok: true };
});
route('DELETE', '/api/risks/:id', R.ADMIN, (ctx) => {
  const id = pid(ctx.params.id);
  const old = get('SELECT code, title FROM risks WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!old) throw notFound('Risk');
  run('DELETE FROM risks WHERE id = ?', id);
  audit(ctx.actor, 'risk.deleted', 'risk', id, old);
  return { ok: true };
});

// ---------------- Exceptions ----------------
route('GET', '/api/exceptions', R.READ, (ctx) => all(`SELECT e.*, p.code policy_code, p.title policy_title, rq.name requested_by_name, dc.name decided_by_name
  FROM exceptions e JOIN policies p ON p.id = e.policy_id LEFT JOIN users rq ON rq.id = e.requested_by LEFT JOIN users dc ON dc.id = e.decided_by
  WHERE e.org_id = ? ORDER BY e.id DESC`, ctx.user.org_id).map(exceptionView));
route('POST', '/api/exceptions', R.STEWARD, (ctx) => {
  const b = ctx.body;
  const policyId = int(b.policy_id, { name: 'Policy', min: 1 });
  const p = get('SELECT id, code, status FROM policies WHERE id = ? AND org_id = ?', policyId, ctx.user.org_id);
  if (!p) throw notFound('Policy');
  if (p.status === 'retired') throw bad('Exceptions cannot be raised against retired policies.');
  const expires = date(b.expires_at, { name: 'Expiry date', required: true });
  if (expires <= today()) throw bad('Expiry date must be in the future.');
  if (expires > addDays(today(), 365)) throw bad('Exceptions must expire within 365 days. Permanent deviations require a policy change.');
  const code = nextCode('exceptions', 'EXC', ctx.user.org_id);
  const r = run(`INSERT INTO exceptions(org_id, code, policy_id, statement_ref, title, justification, compensating, likelihood, impact, expires_at, requested_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.user.org_id, code, policyId, str(b.statement_ref, { name: 'Statement', max: 20 }), str(b.title, { name: 'Title', max: 200, required: true }),
    str(b.justification, { name: 'Business justification', min: 10, max: 4000, required: true }),
    str(b.compensating, { name: 'Compensating controls', max: 4000 }),
    int(b.likelihood, { name: 'Likelihood', min: 1, max: 5 }), int(b.impact, { name: 'Impact', min: 1, max: 5 }), expires, ctx.user.id);
  audit(ctx.actor, 'exception.requested', 'exception', Number(r.lastInsertRowid), { code, policy: p.code });
  return { id: Number(r.lastInsertRowid) };
});
route('POST', '/api/exceptions/:id/decide', R.APPROVE, (ctx) => {
  const id = pid(ctx.params.id);
  const e = get('SELECT * FROM exceptions WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!e) throw notFound('Exception');
  if (e.status !== 'Requested') throw new HttpError(409, 'This exception has already been decided.');
  if (e.requested_by === ctx.user.id) throw forbidden('Separation of duties: you cannot decide on an exception you requested.');
  const decision = oneOf(ctx.body.decision, ['Approved', 'Rejected'], { name: 'Decision' });
  const note = str(ctx.body.note, { name: 'Decision note', max: 1000, required: decision === 'Rejected' });
  if (decision === 'Approved' && !e.compensating) throw bad('Exceptions must document compensating controls before approval.');
  run('UPDATE exceptions SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?', decision, ctx.user.id, nowIso(), note, id);
  audit(ctx.actor, `exception.${decision.toLowerCase()}`, 'exception', id, { code: e.code, note });
  return { ok: true };
});
route('POST', '/api/exceptions/:id/close', R.STEWARD, (ctx) => {
  const id = pid(ctx.params.id);
  const e = get('SELECT * FROM exceptions WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!e) throw notFound('Exception');
  if (e.status === 'Closed') throw new HttpError(409, 'Already closed.');
  run("UPDATE exceptions SET status='Closed' WHERE id=?", id);
  audit(ctx.actor, 'exception.closed', 'exception', id, { code: e.code });
  return { ok: true };
});

// ---------------- Frameworks & controls ----------------
route('GET', '/api/frameworks', R.READ, (ctx) => {
  const org = ctx.user.org_id;
  const cov = coverage(org);
  const evid = all('SELECT * FROM evidence WHERE org_id = ?', org).map(evidenceView);
  return visibleFrameworks(org).map(({ scope, org_id, ...f }) => f).map((f) => {
    const controls = all('SELECT id, ref, title, family, themes FROM controls WHERE framework_id = ? ORDER BY id', f.id).map((c) => {
      const ev = evid.filter((e) => e.control_id === c.id);
      return { ...c, published: cov.pub.has(c.id), planned: cov.any.has(c.id), evidence: ev.length, evidenceFresh: ev.filter((e) => e.fresh).length };
    });
    return { ...f, controls };
  });
});

route('GET', '/api/controls/:id', R.READ, (ctx) => {
  const org = ctx.user.org_id;
  const c = controlsMap(org).get(pid(ctx.params.id));
  if (!c) throw notFound('Control');
  const mappings = [];
  for (const p of all("SELECT * FROM policies WHERE status != 'retired' AND org_id = ?", org).map(hydratePolicy)) {
    p.statements.forEach((s, i) => { if ((s.controls || []).includes(c.id)) mappings.push({ policy_id: p.id, code: p.code, title: p.title, status: p.status, num: `4.${i + 1}`, text: s.text }); });
    if (p.ref_controls.includes(c.id)) mappings.push({ policy_id: p.id, code: p.code, title: p.title, status: p.status, num: '7', text: 'Policy-level reference' });
  }
  const themes = c.themes.split(',').filter(Boolean);
  const crosswalk = [...controlsMap(org).values()].filter((x) => x.framework_id !== c.framework_id && x.themes.split(',').some((t) => themes.includes(t)))
    .map((x) => ({ ...x, overlap: x.themes.split(',').filter((t) => themes.includes(t)).length }))
    .sort((a, b) => b.overlap - a.overlap).slice(0, 40);
  return {
    ...c, mappings, crosswalk,
    evidence: all('SELECT * FROM evidence WHERE control_id = ? AND org_id = ? ORDER BY collected_on DESC', c.id, org).map(evidenceView),
    risks: all('SELECT * FROM risks WHERE org_id = ?', org).map((r) => riskView(r)).filter((r) => r.control_ids.includes(c.id)).map((r) => ({ id: r.id, code: r.code, title: r.title, residual: r.residual, residual_level: r.residual_level })),
  };
});

route('POST', '/api/frameworks', R.WRITE, (ctx) => {
  const code = str(ctx.body.code, { name: 'Code', max: 24, min: 2, required: true }).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw bad('Code must contain letters or digits');
  const org = ctx.user.org_id;
  if (get("SELECT id FROM frameworks WHERE (scope = 'global' OR org_id = ?) AND code = ?", org, code)) throw new HttpError(409, 'A framework with that code already exists.');
  const r = run('INSERT INTO frameworks(scope, org_id, code, name, version, description, custom) VALUES (?,?,?,?,?,?,1)', `org:${org}`, org, code,
    str(ctx.body.name, { name: 'Name', max: 160, required: true }), str(ctx.body.version, { name: 'Version', max: 40 }), str(ctx.body.description, { name: 'Description', max: 1000 }));
  invalidateControls(org);
  audit(ctx.actor, 'framework.created', 'framework', Number(r.lastInsertRowid), { code });
  return { id: Number(r.lastInsertRowid) };
});

route('POST', '/api/frameworks/:id/controls', R.WRITE, (ctx) => {
  const fid = pid(ctx.params.id);
  const f = get("SELECT * FROM frameworks WHERE id = ? AND (scope = 'global' OR org_id = ?)", fid, ctx.user.org_id);
  if (!f) throw notFound('Framework');
  if (!f.custom) throw forbidden('Built-in catalogues are read-only. Create a custom framework to add your own controls.');
  const list = ctx.body.controls;
  if (!Array.isArray(list) || !list.length || list.length > 2000) throw bad('Provide 1–2000 controls');
  let added = 0, updated = 0;
  tx(() => {
    for (const c of list) {
      const ref = str(c.ref, { name: 'Control ref', max: 40, required: true });
      const title = str(c.title, { name: `Title for ${ref}`, max: 300, required: true });
      const family = str(c.family, { name: 'Family', max: 120 });
      const themes = String(c.themes || '').split(',').map((t) => t.trim()).filter((t) => /^[a-z]{2,12}$/.test(t)).join(',');
      const exists = get('SELECT id FROM controls WHERE framework_id = ? AND ref = ?', fid, ref);
      run(`INSERT INTO controls(framework_id, ref, title, family, themes) VALUES (?,?,?,?,?)
           ON CONFLICT(framework_id, ref) DO UPDATE SET title = excluded.title, family = excluded.family, themes = excluded.themes`, fid, ref, title, family, themes);
      exists ? updated++ : added++;
    }
  });
  invalidateControls(ctx.user.org_id);
  audit(ctx.actor, 'framework.controls_imported', 'framework', fid, { code: f.code, added, updated });
  return { added, updated };
});

route('DELETE', '/api/frameworks/:id', R.ADMIN, (ctx) => {
  const fid = pid(ctx.params.id);
  const f = get("SELECT * FROM frameworks WHERE id = ? AND (scope = 'global' OR org_id = ?)", fid, ctx.user.org_id);
  if (!f) throw notFound('Framework');
  if (!f.custom) throw forbidden('Built-in catalogues cannot be deleted.');
  const ids = new Set(all('SELECT id FROM controls WHERE framework_id = ?', fid).map((c) => c.id));
  const inUse = all('SELECT statements, ref_controls FROM policies WHERE org_id = ?', ctx.user.org_id).map(hydratePolicy).some((p) => [...policyControlIds(p)].some((id) => ids.has(id)));
  if (inUse) throw new HttpError(409, 'Controls in this framework are mapped by policies. Remove the mappings first.');
  run('DELETE FROM frameworks WHERE id = ?', fid);
  invalidateControls(ctx.user.org_id);
  audit(ctx.actor, 'framework.deleted', 'framework', fid, { code: f.code });
  return { ok: true };
});

// ---------------- Evidence ----------------
function validateEvidence(b, org) {
  const control_id = int(b.control_id, { name: 'Control', min: 1 });
  if (!controlsMap(org).has(control_id)) throw bad('Unknown control');
  const collected = date(b.collected_on, { name: 'Collected on', required: true });
  if (collected > today()) throw bad('Collection date cannot be in the future.');
  return {
    control_id, collected_on: collected,
    title: str(b.title, { name: 'Title', max: 200, required: true }),
    description: str(b.description, { name: 'Description', max: 2000 }),
    location: safeLocation(b.location),
    owner: str(b.owner, { name: 'Owner', max: 120 }),
    valid_days: int(b.valid_days, { name: 'Validity (days)', min: 1, max: 1095 }),
  };
}
route('GET', '/api/evidence', R.READ, (ctx) => {
  const cmap = controlsMap(ctx.user.org_id);
  return all('SELECT * FROM evidence WHERE org_id = ? ORDER BY collected_on DESC', ctx.user.org_id).map(evidenceView).map((e) => {
    const c = cmap.get(e.control_id);
    return { ...e, control_ref: c?.ref, control_title: c?.title, framework_code: c?.framework_code };
  });
});
route('POST', '/api/evidence', R.STEWARD, (ctx) => {
  const v = validateEvidence(ctx.body, ctx.user.org_id);
  const r = run('INSERT INTO evidence(org_id, control_id, title, description, location, owner, collected_on, valid_days, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    ctx.user.org_id, v.control_id, v.title, v.description, v.location, v.owner, v.collected_on, v.valid_days, ctx.user.id);
  audit(ctx.actor, 'evidence.added', 'evidence', Number(r.lastInsertRowid), { title: v.title, control_id: v.control_id });
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/evidence/:id', R.WRITE, (ctx) => {
  const id = pid(ctx.params.id);
  if (!get('SELECT id FROM evidence WHERE id = ? AND org_id = ?', id, ctx.user.org_id)) throw notFound('Evidence');
  const v = validateEvidence(ctx.body, ctx.user.org_id);
  run('UPDATE evidence SET control_id=?, title=?, description=?, location=?, owner=?, collected_on=?, valid_days=? WHERE id=?',
    v.control_id, v.title, v.description, v.location, v.owner, v.collected_on, v.valid_days, id);
  audit(ctx.actor, 'evidence.updated', 'evidence', id, { title: v.title, collected_on: v.collected_on });
  return { ok: true };
});
route('DELETE', '/api/evidence/:id', R.WRITE, (ctx) => {
  const id = pid(ctx.params.id);
  const e = get('SELECT title FROM evidence WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!e) throw notFound('Evidence');
  run('DELETE FROM evidence WHERE id = ?', id);
  audit(ctx.actor, 'evidence.deleted', 'evidence', id, e);
  return { ok: true };
});

// ---------------- Audit trail ----------------
route('GET', '/api/audit', R.AUDIT, (ctx) => {
  const limit = int(ctx.query.get('limit'), { name: 'limit', min: 1, max: 500, required: false, fallback: 100 });
  const offset = int(ctx.query.get('offset'), { name: 'offset', min: 0, max: 1e9, required: false, fallback: 0 });
  const q = (ctx.query.get('q') || '').slice(0, 100);
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const where = 'WHERE org_id = ?' + (q ? " AND (action LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR entity LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\')" : '');
  const params = [ctx.user.org_id, ...(q ? [like, like, like, like] : [])];
  return {
    total: get(`SELECT COUNT(*) n FROM audit_log ${where}`, ...params).n,
    rows: all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
  };
});
route('GET', '/api/audit/verify', R.AUDIT, (ctx) => {
  const r = verifyChain(ctx.user.org_id);
  audit(ctx.actor, 'audit.chain_verified', 'audit_log', null, { ok: r.ok, entries: r.entries });
  return r;
});
route('GET', '/api/audit/export', R.AUDIT, (ctx) => {
  const rows = all('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id ASC', ctx.user.org_id);
  // Prefix cells that spreadsheet apps would treat as formulas (CSV injection).
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const cols = ['id', 'ts', 'username', 'action', 'entity', 'entity_id', 'details', 'prev_hash', 'hash'];
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  audit(ctx.actor, 'audit.exported', 'audit_log', null, { rows: rows.length });
  return { __raw: csv, contentType: 'text/csv; charset=utf-8', filename: `mandategrc-audit-${today()}.csv` };
});

// ---------------- Users, invites & settings ----------------
const INVITE_DAYS = 7;
route('GET', '/api/users', R.ADMIN, (ctx) => all('SELECT * FROM users WHERE org_id = ? ORDER BY name', ctx.user.org_id).map(publicUser));
route('GET', '/api/invites', R.ADMIN, (ctx) => all(`SELECT i.code_hash id, i.purpose, i.role, i.expires_at, i.created_at, u.username target, c.name created_by_name
  FROM invites i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN users c ON c.id = i.created_by
  WHERE i.org_id = ? AND i.used_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`, ctx.user.org_id, nowIso()));
route('POST', '/api/invites', R.ADMIN, (ctx) => {
  const role = oneOf(ctx.body.role, ROLES, { name: 'Role' });
  const days = int(ctx.body.days, { name: 'Valid for (days)', min: 1, max: 14, required: false, fallback: INVITE_DAYS });
  const code = generateCode();
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  run('INSERT INTO invites(code_hash, org_id, purpose, role, created_by, expires_at) VALUES (?,?,?,?,?,?)', codeHash(code), ctx.user.org_id, 'join', role, ctx.user.id, expires);
  audit(ctx.actor, 'invite.created', 'invite', null, { role, expires });
  return { code, expires_at: expires };
});
route('DELETE', '/api/invites/:id', R.ADMIN, (ctx) => {
  const r = run('DELETE FROM invites WHERE code_hash = ? AND org_id = ? AND used_at IS NULL', String(ctx.params.id).slice(0, 64), ctx.user.org_id);
  if (!r.changes) throw notFound('Invite');
  audit(ctx.actor, 'invite.revoked', 'invite', null);
  return { ok: true };
});
route('PUT', '/api/users/:id', R.ADMIN, (ctx) => {
  const id = pid(ctx.params.id);
  const u = get('SELECT * FROM users WHERE id = ? AND org_id = ?', id, ctx.user.org_id);
  if (!u) throw notFound('User');
  const role = oneOf(ctx.body.role, ROLES, { name: 'Role' });
  const active = ctx.body.active ? 1 : 0;
  if (id === ctx.user.id && (role !== 'admin' || !active)) throw bad('You cannot demote or deactivate your own account.');
  if (u.role === 'admin' && (role !== 'admin' || !active) && get("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND org_id = ?", ctx.user.org_id).n <= 1) throw bad('At least one active administrator is required.');
  run('UPDATE users SET name=?, role=?, active=? WHERE id=?', str(ctx.body.name, { name: 'Display name', max: 80, required: true }), role, active, id);
  if (!active || role !== u.role) destroyUserSessions(id);
  audit(ctx.actor, 'user.updated', 'user', id, { username: u.username, role: [u.role, role], active: [!!u.active, !!active] });
  return { ok: true };
});
// Lost device: issue a one-time recovery code so the user can enrol a new passkey.
route('POST', '/api/users/:id/recovery', R.ADMIN, (ctx) => {
  const id = pid(ctx.params.id);
  const u = get('SELECT * FROM users WHERE id = ? AND active = 1 AND org_id = ?', id, ctx.user.org_id);
  if (!u) throw notFound('Active user');
  const revoke = !!ctx.body.revokeExisting;
  const code = generateCode();
  const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
  tx(() => {
    run("DELETE FROM invites WHERE user_id = ? AND purpose = 'recover' AND used_at IS NULL", id);
    run('INSERT INTO invites(code_hash, org_id, purpose, user_id, created_by, expires_at) VALUES (?,?,?,?,?,?)', codeHash(code), ctx.user.org_id, 'recover', id, ctx.user.id, expires);
    if (revoke) { run('DELETE FROM credentials WHERE user_id = ?', id); destroyUserSessions(id); }
  });
  audit(ctx.actor, 'user.recovery_issued', 'user', id, { username: u.username, revoked_existing: revoke });
  return { code, expires_at: expires, username: u.username };
});
route('GET', '/api/users/:id/passkeys', R.ADMIN, (ctx) => all(`SELECT c.id, c.label, c.backed_up, c.created_at, c.last_used_at FROM credentials c JOIN users u ON u.id = c.user_id
  WHERE c.user_id = ? AND u.org_id = ? ORDER BY c.created_at`, pid(ctx.params.id), ctx.user.org_id));
route('DELETE', '/api/users/:id/passkeys/:cid', R.ADMIN, (ctx) => {
  const id = pid(ctx.params.id);
  const c = get('SELECT c.id, c.label FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.user_id = ? AND u.org_id = ?', ctx.params.cid, id, ctx.user.org_id);
  if (!c) throw notFound('Passkey');
  if (id === ctx.user.id && get('SELECT COUNT(*) n FROM credentials WHERE user_id = ?', id).n <= 1) throw bad('You cannot remove your own last passkey.');
  run('DELETE FROM credentials WHERE id = ?', c.id);
  destroyUserSessions(id);
  audit(ctx.actor, 'user.passkey_revoked', 'user', id, { label: c.label });
  return { ok: true };
});

// Removes the demo content seeded when the workspace was created. The user's own work is untouched.
route('POST', '/api/workspace/clear-sample', R.ADMIN, (ctx) => {
  const org = ctx.user.org_id;
  const removed = {};
  tx(() => {
    const samplePolicyIds = all('SELECT id FROM policies WHERE org_id = ? AND sample = 1', org).map((r) => r.id);
    for (const t of ['exceptions', 'evidence', 'risks', 'policies']) removed[t] = run(`DELETE FROM ${t} WHERE org_id = ? AND sample = 1`, org).changes;
    // Drop links from the user's own risks to sample policies that no longer exist.
    if (samplePolicyIds.length) {
      for (const r of all('SELECT id, policy_ids FROM risks WHERE org_id = ?', org)) {
        const ids = parseJson(r.policy_ids, []);
        const kept = ids.filter((id) => !samplePolicyIds.includes(id));
        if (kept.length !== ids.length) run('UPDATE risks SET policy_ids = ? WHERE id = ?', JSON.stringify(kept), r.id);
      }
    }
    removed.demo_users = run("DELETE FROM users WHERE org_id = ? AND username LIKE 'demo-%' AND active = 0 AND id NOT IN (SELECT created_by FROM policies WHERE created_by IS NOT NULL UNION SELECT updated_by FROM policies WHERE updated_by IS NOT NULL UNION SELECT submitted_by FROM policies WHERE submitted_by IS NOT NULL UNION SELECT approved_by FROM policies WHERE approved_by IS NOT NULL)", org).changes;
  });
  audit(ctx.actor, 'workspace.sample_data_removed', 'workspace', org, removed);
  return removed;
});

route('GET', '/api/settings', R.ADMIN, (ctx) => {
  const o = orgSettings(ctx.user.org_id);
  return { org_name: o.name, risk_appetite: o.risk_appetite, session_idle_minutes: o.session_idle_minutes };
});
route('PUT', '/api/settings', R.ADMIN, (ctx) => {
  const v = {
    org_name: str(ctx.body.org_name, { name: 'Organization name', max: 120, required: true }),
    risk_appetite: int(ctx.body.risk_appetite, { name: 'Risk appetite', min: 1, max: 25 }),
    session_idle_minutes: int(ctx.body.session_idle_minutes, { name: 'Session idle timeout', min: 5, max: 240 }),
  };
  run('UPDATE orgs SET name = ?, risk_appetite = ?, session_idle_minutes = ? WHERE id = ?', v.org_name, v.risk_appetite, v.session_idle_minutes, ctx.user.org_id);
  audit(ctx.actor, 'settings.updated', 'settings', null, v);
  return v;
});

// ---------------- Control register & testing (src/controls.js) ----------------
const controlsApi = registerControlRoutes({ route, R, pid, notFound, forbidden, controlsMap, userName, evidenceView, hydratePolicy });
const findingsApi = registerFindingRoutes({ route, R, pid, notFound, forbidden, controlsMap, userName, hydratePolicy, evidenceView });
const soaApi = registerSoaRoutes({ route, R, controlsMap, userName, hydratePolicy, evidenceView });
registerPackageRoutes({ route, R, controlsMap, userName, hydratePolicy, riskView, exceptionView, evidenceView, visibleFrameworks, soaApi });
registerTraceRoutes({ route, R, pid, notFound, controlsMap, userName, hydratePolicy, riskView, evidenceView });
const vendorsApi = registerVendorRoutes({ route, R, pid, notFound, forbidden, userName });
const assetsApi = registerAssetRoutes({ route, R, pid, notFound, userName, visibleFrameworks });
