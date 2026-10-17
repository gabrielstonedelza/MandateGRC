// MandateGRC SPA bootstrap: authentication, shell, and hash router.
import { html, mount, $, on, state, can, api, GET, POST, toast, icon, LOGO, initials, closeAllModals } from './core.js';
import { dashboardView } from './views/dashboard.js';
import { policiesView, policyEditorView, policyDocView, templatesView } from './views/policies.js';
import { risksView } from './views/risks.js';
import { exceptionsView } from './views/exceptions.js';
import { frameworksView } from './views/frameworks.js';
import { evidenceView } from './views/evidence.js';
import { attestationsView } from './views/attestations.js';
import { auditView } from './views/audit.js';
import { usersView, settingsView, accountView } from './views/admin.js';
import { startOnboarding } from './onboarding.js';
import { PUBLIC_ROUTES, landingPage, loginPage, registerPage, legalPage, docsPage, privacyContent, termsContent } from './public.js';
import { renderDocs } from './docs.js';

const app = document.getElementById('app');

const NAV = [
  { group: 'Overview', items: [{ href: '#/', label: 'Dashboard', icon: 'dashboard', show: can.read }] },
  { group: 'Govern', items: [
    { href: '#/policies', label: 'Policies', icon: 'policy', show: () => true },
    { href: '#/templates', label: 'Template Library', icon: 'template', show: can.write },
    { href: '#/attestations', label: 'Attestations', icon: 'attest', show: () => true, badge: 'attest' },
  ] },
  { group: 'Risk', items: [
    { href: '#/risks', label: 'Risk Register', icon: 'risk', show: can.read },
    { href: '#/exceptions', label: 'Exceptions', icon: 'exception', show: can.read },
  ] },
  { group: 'Comply', items: [
    { href: '#/frameworks', label: 'Frameworks & Controls', icon: 'framework', show: can.read },
    { href: '#/evidence', label: 'Evidence', icon: 'evidence', show: can.read },
  ] },
  { group: 'Assure', items: [{ href: '#/audit', label: 'Audit Trail', icon: 'audit', show: can.audit }] },
  { group: 'Help', items: [{ href: '#/docs', label: 'Documentation', icon: 'book', show: () => true }] },
  { group: 'Administer', items: [
    { href: '#/users', label: 'Users & Roles', icon: 'users', show: can.admin },
    { href: '#/settings', label: 'Settings', icon: 'settings', show: can.admin },
  ] },
];

const ROUTES = [
  [/^\/$/, dashboardView, 'Dashboard', can.read],
  [/^\/policies$/, policiesView, 'Policies'],
  [/^\/policies\/(\d+)$/, policyEditorView, 'Policies', can.read],
  [/^\/policies\/(\d+)\/doc$/, policyDocView, 'Policies'],
  [/^\/templates$/, templatesView, 'Template Library', can.write],
  [/^\/attestations$/, attestationsView, 'Attestations'],
  [/^\/risks$/, risksView, 'Risk Register', can.read],
  [/^\/exceptions$/, exceptionsView, 'Exceptions', can.read],
  [/^\/frameworks(?:\/([A-Za-z0-9_-]+))?$/, frameworksView, 'Frameworks & Controls', can.read],
  [/^\/evidence$/, evidenceView, 'Evidence', can.read],
  [/^\/audit$/, auditView, 'Audit Trail', can.audit],
  [/^\/users$/, usersView, 'Users & Roles', can.admin],
  [/^\/settings$/, settingsView, 'Settings', can.admin],
  [/^\/account$/, accountView, 'My Account'],
  [/^\/docs(?:\/([a-z0-9-]+))?$/, (el, id) => renderDocs(el, id, { embedded: true }), 'Documentation'],
  [/^\/privacy$/, (el) => mount(el, html`<div class="legal-in-app">${privacyContent()}</div>`), 'Privacy policy'],
  [/^\/terms$/, (el) => mount(el, html`<div class="legal-in-app">${termsContent()}</div>`), 'Terms of service'],
];

const ROLE_LABEL = { admin: 'Administrator', analyst: 'GRC Analyst', approver: 'Approver', auditor: 'Auditor (read-only)', employee: 'Employee' };

let current = null; // { leave?: () => boolean }
let lastHash = location.hash;

// ---------------- Public site (signed out) ----------------
let returnTo = null;
function publicRoute(message) {
  closeAllModals();
  const path = (location.hash.slice(1) || '/').split('?')[0];
  document.body.classList.add('public');
  const signedIn = async () => { document.body.classList.remove('public'); await start(); const t = returnTo; returnTo = null; if (t) location.hash = t; };
  if (path === '/login') { document.title = 'Sign in · MandateGRC'; return loginPage(app, { message, onSignedIn: signedIn }); }
  if (path === '/register') { document.title = 'Get started · MandateGRC'; return registerPage(app, { onSignedIn: signedIn }); }
  if (path === '/privacy') { document.title = 'Privacy policy · MandateGRC'; return legalPage(app, 'privacy'); }
  if (path === '/terms') { document.title = 'Terms of service · MandateGRC'; return legalPage(app, 'terms'); }
  const docs = /^\/docs(?:\/([a-z0-9-]+))?$/.exec(path);
  if (docs) return docsPage(app, docs[1]);
  if (!PUBLIC_ROUTES.includes(path)) { returnTo = location.hash; history.replaceState(null, '', '#/login'); return loginPage(app, { message: message || 'Please sign in to continue.', onSignedIn: signedIn }); }
  document.title = 'MandateGRC: policy-first GRC';
  return landingPage(app);
}

async function logout() {
  try { await POST('/api/auth/logout'); } catch { /* already gone */ }
  state.me = null; state.csrf = null;
  current = null;
  history.replaceState(null, '', '#/');
  publicRoute();
}

// ---------------- Shell ----------------
// Sidebar preferences are per-browser conveniences; the app works the same without them.
const prefs = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('mg.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('mg.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

function setRail(collapsed) {
  const shellEl = $('.shell');
  if (!shellEl) return;
  shellEl.classList.toggle('collapsed', collapsed);
  const t = $('#rail-toggle');
  if (t) {
    t.setAttribute('aria-expanded', String(!collapsed));
    t.title = collapsed ? 'Expand sidebar  [' : 'Collapse sidebar  [';
    t.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
  prefs.set('railCollapsed', collapsed);
}

function shell() {
  const me = state.me;
  const closed = new Set(prefs.get('closedGroups', []));
  mount(app, html`<div class="shell ${prefs.get('railCollapsed', false) ? 'collapsed' : ''}">
    <aside class="sidebar" id="sidebar">
      <div class="brand">${LOGO}<div class="brand-text"><div class="brand-name">MANDATE<b class="wm-grc">GRC</b></div><div class="brand-sub">GRC Workbench</div></div>
        <button class="rail-toggle" id="rail-toggle" type="button" aria-controls="sidebar" aria-label="Collapse sidebar">${icon('panel')}</button></div>
      <nav class="nav" aria-label="Main">
        ${NAV.map((g) => {
          const items = g.items.filter((i) => i.show());
          if (!items.length) return '';
          const isClosed = closed.has(g.group);
          return html`<div class="nav-group ${isClosed ? 'closed' : ''}" data-group="${g.group}">
            <button class="nav-label" type="button" aria-expanded="${!isClosed}" title="${isClosed ? 'Show' : 'Hide'} ${g.group}">${g.group}<span class="chev">${icon('down')}</span></button>
            <div class="nav-items">${items.map((i) => html`<a href="${i.href}" data-nav="${i.href}" title="${i.label}">${icon(i.icon)}<span class="nav-text">${i.label}</span>${i.badge ? html`<span class="badge gold hidden" data-badge="${i.badge}"></span>` : ''}</a>`)}</div></div>`;
        })}
      </nav>
      <div class="sidebar-foot">
        <div class="user-chip">
          <div class="avatar">${initials(me.name)}</div>
          <div class="who"><b>${me.name}</b><span>${ROLE_LABEL[me.role]}</span></div>
          <a class="icon-btn right" href="#/account" title="My account" aria-label="My account">${icon('key')}</a>
          <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button>
        </div>
      </div>
    </aside>
    <div class="main" id="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu" aria-label="Menu">${icon('menu')}</button>
        <div class="crumbs" id="crumbs"></div>
        <div class="spacer"></div>
        <a class="btn ghost sm" href="#/docs">${icon('book')} Docs</a>
        <button class="icon-btn help-btn" id="help" title="Product tour" aria-label="Replay the product tour">?</button>
        <span class="org">${state.org}</span>
      </header>
      <div class="content" id="view"></div>
    </div>
  </div>`);
  $('#logout').addEventListener('click', logout);
  $('#help').addEventListener('click', () => startOnboarding({ intro: true }));
  $('#menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  on($('#sidebar'), 'click', 'a', () => $('#sidebar').classList.remove('open'));
  setRail(prefs.get('railCollapsed', false));
  $('#rail-toggle').addEventListener('click', () => setRail(!$('.shell').classList.contains('collapsed')));
  on($('#sidebar'), 'click', '.nav-label', (e, b) => {
    const g = b.closest('.nav-group');
    const isClosed = g.classList.toggle('closed');
    b.setAttribute('aria-expanded', String(!isClosed));
    b.title = `${isClosed ? 'Show' : 'Hide'} ${g.dataset.group}`;
    const set = new Set(prefs.get('closedGroups', []));
    isClosed ? set.add(g.dataset.group) : set.delete(g.dataset.group);
    prefs.set('closedGroups', [...set]);
  });
  refreshBadges();
}

export async function refreshBadges() {
  try {
    const r = await GET('/api/attestations');
    const n = r.mine.filter((p) => !p.attested_at).length;
    const b = document.querySelector('[data-badge=attest]');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  } catch { /* non-critical */ }
}

async function route() {
  if (!state.me) return publicRoute();
  const p0 = (location.hash.slice(1) || '/').split('?')[0];
  if (p0 === '/login' || p0 === '/register') { history.replaceState(null, '', '#/'); }
  if (!$('#view')) shell();
  const hash = location.hash || '#/';
  if (current?.leave && hash !== lastHash && !current.leave()) {
    history.replaceState(null, '', lastHash);
    return;
  }
  lastHash = hash;
  closeAllModals();
  const path = hash.slice(1) || '/';
  const old = $('#view');
  if (!old) return;
  // A fresh container per route drops every event listener the previous view attached.
  const view = old.cloneNode(false);
  old.replaceWith(view);
  let match = null;
  for (const [re, fn, title, guard] of ROUTES) {
    const m = re.exec(path);
    if (m) { match = { fn, title, guard, params: m.slice(1) }; break; }
  }
  if (!match) {
    if (path === '/' && !can.read()) { location.hash = '#/attestations'; return; }
    mount(view, html`<div class="empty"><b>Page not found</b><a href="#/">Go to dashboard</a></div>`);
    return;
  }
  if (match.guard && !match.guard()) {
    if (path === '/') { location.hash = '#/attestations'; return; }
    mount(view, html`<div class="empty"><b>Access restricted</b>Your role (${ROLE_LABEL[state.me.role]}) cannot view this page.</div>`);
    return;
  }
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const href = a.dataset.nav;
    a.classList.toggle('active', href === '#/' ? path === '/' : path.startsWith(href.slice(1)));
  });
  mount($('#crumbs'), html`<span>${state.org}</span> / <b>${match.title}</b>`);
  document.title = `${match.title} · MandateGRC`;
  current = null;
  mount(view, html`<div class="empty muted">Loading…</div>`);
  try {
    current = (await match.fn(view, ...match.params)) || null;
  } catch (e) {
    if (e.status === 401) return;
    mount(view, html`<div class="empty"><b>Could not load this page</b>${e.message}</div>`);
  }
  $('#main')?.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
// "[" toggles the sidebar rail (ignored while typing).
document.addEventListener('keydown', (e) => {
  if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey || !state.me) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (!$('.shell') || document.querySelector('.overlay, .drawer, .ob-root')) return;
  setRail(!$('.shell').classList.contains('collapsed'));
});
window.addEventListener('beforeunload', (e) => { if (current?.dirty?.()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('mandate:logout', () => { current = null; returnTo = location.hash; history.replaceState(null, '', '#/login'); publicRoute('Your session has ended. Please sign in again.'); });
window.addEventListener('mandate:badges', refreshBadges);

async function start() {
  const me = await GET('/api/auth/me');
  state.me = me.user; state.csrf = me.csrf; state.org = me.org;
  document.body.classList.remove('public');
  state.meta = await GET('/api/meta');
  shell();
  await route();
  if (!me.onboarded) startOnboarding({ intro: true });
}

(async () => {
  try { await start(); } catch { state.me = null; publicRoute(); }
})();

