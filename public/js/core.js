// Core UI toolkit: auto-escaping templates, API client, modals, toasts, icons.

// ---------- Safe HTML templating (every interpolation is escaped unless wrapped in raw()) ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}
export function mount(el, tpl) {
  el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl);
  applyWidths(el);
  return el;
}
// CSP forbids inline style attributes; widths are applied via CSSOM instead.
export function applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w))) + '%'; });
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

// ---------- State ----------
export const state = { me: null, csrf: null, meta: null, org: '' };
export const can = {
  write: () => ['admin', 'analyst'].includes(state.me?.role),
  approve: () => ['admin', 'approver'].includes(state.me?.role),
  steward: () => ['admin', 'analyst', 'approver'].includes(state.me?.role),
  read: () => ['admin', 'analyst', 'approver', 'auditor'].includes(state.me?.role),
  audit: () => ['admin', 'analyst', 'auditor'].includes(state.me?.role),
  admin: () => state.me?.role === 'admin',
};

// ---------- API ----------
export class ApiError extends Error { constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.body = body; } }
export async function api(method, url, body) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  // Every write sends a JSON body (an empty {} for DELETE), so it always passes the server's Content-Type check.
  if (body === undefined && method !== 'GET') body = {};
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (method !== 'GET' && state.csrf) opts.headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    // Only an expired session of a signed-in user triggers the "signed out" flow.
    if (res.status === 401 && state.me && !url.startsWith('/api/auth/login')) { state.me = null; window.dispatchEvent(new Event('mandate:logout')); }
    throw new ApiError(res.status, data);
  }
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b = {}) => api('POST', u, b);
export const PUT = (u, b) => api('PUT', u, b);
export const DEL = (u) => api('DELETE', u);

// ---------- Toasts ----------
export function toast(msg, kind = 'ok') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}
export const fail = (e) => toast(e?.message || String(e), 'err');

// ---------- Modals ----------
let modalStack = [];
export const closeAllModals = () => [...modalStack].reverse().forEach((close) => close());
export function modal({ title, body, footer, wide = false, drawer = false, onMount, onClose }) {
  const wrap = document.createElement('div');
  if (drawer) {
    wrap.innerHTML = '<div class="drawer-overlay"></div><aside class="drawer" role="dialog" aria-modal="true"></aside>';
  } else {
    wrap.innerHTML = `<div class="overlay"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true"></div></div>`;
  }
  const box = wrap.querySelector(drawer ? '.drawer' : '.modal');
  mount(box, html`<div class="modal-h"><h2>${title}</h2><button class="icon-btn right" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-b">${body}</div>${footer ? html`<div class="modal-f">${footer}</div>` : ''}`);
  document.body.appendChild(wrap);
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.remove();
    modalStack = modalStack.filter((m) => m !== close);
    document.removeEventListener('keydown', onKey);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close(); };
  document.addEventListener('keydown', onKey);
  modalStack.push(close);
  wrap.addEventListener('mousedown', (e) => { if (e.target.classList.contains('overlay') || e.target.classList.contains('drawer-overlay')) close(); });
  on(wrap, 'click', '[data-close]', close);
  const ctx = { el: box, close };
  onMount?.(ctx);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input,textarea,select,button.primary'))?.focus(), 30);
  return ctx;
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, input = null }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: html`<p class="dim">${message}</p>${input ? html`<label class="f"><span>${input.label}</span><textarea name="v" maxlength="1000" placeholder="${input.placeholder || ''}" ${input.required ? 'required' : ''}></textarea></label>` : ''}`,
      footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirm}</button>`,
      onMount: ({ el, close }) => {
        on(el, 'click', '[data-ok]', () => {
          const v = input ? el.querySelector('[name=v]').value.trim() : true;
          if (input?.required && v.length < 5) { toast(`${input.label} is required (min 5 characters).`, 'err'); return; }
          done = true; close(); resolve(v);
        });
      },
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.multiple) o[el.name] = [...el.selectedOptions].map((x) => x.value);
    else o[el.name] = el.value;
  }
  return o;
}

// ---------- Formatting ----------
export const fmtDate = (s) => (s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function ago(s) {
  if (!s) return '—';
  const d = (Date.now() - new Date(s).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 86400 * 30) return Math.floor(d / 86400) + 'd ago';
  return fmtDate(s);
}
export const todayStr = () => new Date().toISOString().slice(0, 10);
export function daysUntil(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - new Date(todayStr() + 'T00:00:00Z')) / 86400000);
}
export const money = (n) => (n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n));
export const statusLabel = (s) => ({ in_review: 'In review' }[s] || (s ? s[0].toUpperCase() + s.slice(1).replace('_', ' ') : ''));
export const pill = (status, label) => html`<span class="pill s-${String(status).toLowerCase().replace(/\s+/g, '-')}">${label || statusLabel(status)}</span>`;
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function ring(value, { size = 'lg', label = '', color } = {}) {
  const r = 52, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const col = color || (v >= 80 ? '#3cc685' : v >= 60 ? '#e2b457' : v >= 40 ? '#f2843a' : '#ff2e55');
  return html`<div class="ring ${size === 'sm' ? 'sm' : ''}"><svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#1f2835" stroke-width="${size === 'sm' ? 12 : 10}"></circle>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="${size === 'sm' ? 12 : 10}" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}"></circle>
  </svg><div class="v"><div><b>${Math.round(v)}</b>${label ? html`<small>${label}</small>` : ''}</div></div></div>`;
}

export function download(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Icons (inline SVG, stroke-based) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  policy: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  attest: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  risk: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  exception: '<circle cx="12" cy="12" r="9"/><path d="M4.9 4.9l14.2 14.2"/>',
  framework: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  evidence: '<path d="M21.4 11.6 12.2 20.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  audit: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  doc: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  diff: '<path d="M12 3v14M5 10h14M5 21h14"/>',
  fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .13-5.35 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 9l-3 3 3 3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
  scale: '<path d="M12 3v18M3 7h18M6 7l-3 7a4 4 0 0 0 6 0L6 7zM18 7l-3 7a4 4 0 0 0 6 0l-3-7z"/>',
  control: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7.5 12 3 3 6-6"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
};
export const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);

export const LOGO = raw(`<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="9" fill="#121821" stroke="#e2b457" stroke-width="1.5"/><path d="M10 29V11l10 11 10-11v18" fill="none" stroke="#e2b457" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 33h12" stroke="#e2b457" stroke-width="2" stroke-linecap="round" opacity=".5"/></svg>`);
