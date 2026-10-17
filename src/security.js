// Sessions, one-time codes, rate limiting and HTTP hardening.
// There are no passwords in MandateGRC: users authenticate with passkeys (see webauthn.js).
import crypto from 'node:crypto';
import { get, run } from './db.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- One-time codes (invites, recovery, first-run setup) ----------
// 20 Crockford base32 characters ≈ 100 bits of entropy, grouped for readability.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateCode() {
  const chars = Array.from(crypto.randomBytes(20), (b) => B32[b & 31]).join('');
  return chars.match(/.{5}/g).join('-');
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[ILO]/g, (m) => ({ I: '1', L: '1', O: '0' }[m]));
export const codeHash = (c) => sha256('mandate-code:' + normalizeCode(c));

// ---------- Sessions ----------
export const COOKIE_NAME = 'mandate_sid';
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;

// Sessions hold no IP address or device fingerprint: only a hashed token and timestamps.
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO sessions(token_hash, user_id, csrf, created_at, last_seen) VALUES (?,?,?,?,?)', sha256(token), userId, csrf, now, now);
  return { token, csrf };
}

export function loadSession(token) {
  if (!token) return null;
  const s = get(`SELECT s.*, u.username, u.name, u.role, u.active, u.org_id, o.session_idle_minutes
                 FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id WHERE s.token_hash = ?`, sha256(token));
  if (!s) return null;
  const now = Date.now();
  if (!s.active || now - s.last_seen > s.session_idle_minutes * 60_000 || now - s.created_at > ABSOLUTE_MS) {
    run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash);
    return null;
  }
  if (now - s.last_seen > 15_000) run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now, s.token_hash);
  return s;
}

export const destroySession = (token) => token && run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
export const destroyUserSessions = (userId) => run('DELETE FROM sessions WHERE user_id = ?', userId);

export function purgeExpiredSessions() {
  const now = Date.now();
  run(`DELETE FROM sessions WHERE ? - created_at > ? OR token_hash IN (
         SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id
         WHERE ? - s.last_seen > o.session_idle_minutes * 60000)`, now, ABSOLUTE_MS, now);
}

export function sessionCookie(token, secure, clear = false) {
  const parts = [`${COOKIE_NAME}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${ABSOLUTE_MS / 1000}`);
  return parts.join('; ');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ }
    }
  }
  return out;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Rate limiting (fixed window, in memory only; never written to disk) ----------
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const k = sha256(key); // keys (which may include an IP) are hashed even in memory
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.count++;
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref();

// ---------- Security headers ----------
export function securityHeaders(secure) {
  const h = {
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
      "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
      "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
