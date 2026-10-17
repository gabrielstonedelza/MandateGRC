import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, details) => new HttpError(400, msg, details);

export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();

export function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
export const newId = () => crypto.randomBytes(6).toString('hex');

// ---------- Input validation ----------
export function str(v, { name, max = 500, min = 0, required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const s = v.replace(/\u0000/g, '').trim();
  if (s.length < min) throw bad(`${name} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
}
export function int(v, { name, min = -Infinity, max = Infinity, required = true, fallback } = {}) {
  if (v == null || v === '') {
    if (!required) return fallback ?? null;
    throw bad(`${name} is required`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}`);
  return n;
}
export function num(v, { name, min = 0, max = 1e12 } = {}) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}`);
  return n;
}
export function date(v, { name, required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date (YYYY-MM-DD)`);
  return v;
}
export function oneOf(v, list, { name, fallback } = {}) {
  if ((v == null || v === '') && fallback !== undefined) return fallback;
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}
export function idList(v, { name, max = 500 } = {}) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every((x) => Number.isInteger(x) && x > 0)) throw bad(`${name} must be a list of ids`);
  return [...new Set(v)];
}
// Only http(s) links or plain references (ticket ids, file paths) — never javascript:/data: URLs.
export function safeLocation(v) {
  const s = str(v, { name: 'Location', max: 1000 });
  if (!s) return s;
  if (/^\s*(?:javascript|data|vbscript|file|blob):/i.test(s)) throw bad('Location must be an http(s) URL or a plain reference');
  return s;
}
