// Guided onboarding: an animated welcome, a role-aware spotlight tour across the app,
// and a finale with suggested first actions. Re-playable from the "?" button in the top bar.
import { html, mount, raw, state, can, GET, POST, icon } from './core.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

const ANIMATED_LOGO = raw(`<svg class="ob-logo" viewBox="0 0 40 40" aria-hidden="true">
  <rect class="ob-draw r" x="1" y="1" width="38" height="38" rx="9" fill="none" stroke="#e2b457" stroke-width="1.5"/>
  <path class="ob-draw m" d="M10 29V11l10 11 10-11v18" fill="none" stroke="#e2b457" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="ob-draw u" d="M14 33h12" stroke="#e2b457" stroke-width="2" stroke-linecap="round" opacity=".5"/></svg>`);

const ANATOMY = ['Header', 'Purpose', 'Scope', 'Statements', 'Roles', 'Enforcement', 'References', 'History'];

// ---------- Tour scripts per role ----------
function steps(role, ctx) {
  const S = {
    posture: { route: '#/', target: '.posture', title: 'Your GRC posture at a glance', body: 'One explainable score built from policy quality, framework coverage, evidence freshness, risk within appetite and attestation. Every bar is a lever you can pull.' },
    queue: { route: '#/', target: '[data-tour=queue]', title: 'Your action queue', body: 'MandateGRC tells you what needs attention right now: overdue reviews, approvals waiting on you, expiring exceptions, stale evidence and risks above appetite. Start every day here.' },
    policies: { route: '#/policies', target: '[data-tour=policy-table]', title: 'The policy library', body: 'Every policy carries a live quality score from the linter, its status in the approval workflow, mapped frameworks, next review date and attestation progress.' },
    templates: { route: '#/templates', target: '.tpl', title: 'Start from a template', body: 'These templates already follow the 8-part anatomy and pass every rule. Pick one, then tailor the owner, scope and statements to your organization.' },
    anatomy: { route: ctx.draftId ? `#/policies/${ctx.draftId}` : '#/policies', target: '#anatomy', title: 'The 8-part anatomy', body: 'Header, Purpose, Scope, Statements, Roles, Enforcement, References, History, always in this order. Sections turn green as they meet the professional standard.', place: 'right' },
    linter: { route: ctx.draftId ? `#/policies/${ctx.draftId}` : '#/policies', target: '#lint', title: 'The policy linter', body: 'It checks the golden rules as you type: "must"/"shall" instead of "should", measurable criteria instead of "regularly", and a framework mapping for every statement. Blocking issues must be fixed before review.', place: 'left' },
    statements: { route: ctx.draftId ? `#/policies/${ctx.draftId}` : '#/policies', target: '#sec-statements', title: 'Statements, mapped to controls', body: 'Write one rule per statement. Use "Map controls" to link it to ISO 27001, NIST, SOC 2 and more. MandateGRC suggests related controls in other frameworks automatically, and one-click fixes clean up weak wording.' },
    workflow: { route: ctx.draftId ? `#/policies/${ctx.draftId}` : '#/policies', target: '#workflow', title: 'Draft → Review → Approve → Publish', body: 'Submit for review when the linter is clean. A different person must approve (separation of duties). Approval stamps the version and records a snapshot in the revision history.' },
    frameworks: { route: '#/frameworks', target: '[data-tour=fw-grid]', title: 'Coverage you can prove', body: 'Coverage per framework, computed from statement-level mappings. Open any control to see the exact statement that satisfies it, its evidence, and the equivalent controls in other frameworks.' },
    risks: { route: '#/risks', target: '[data-tour=heat]', title: 'Risk register', body: 'Score likelihood × impact before and after controls. Dashed cells show your risk appetite; anything outside it lands in the action queue. Add SLE and ARO to put a dollar value on the exposure.' },
    exceptions: { route: '#/exceptions', target: '[data-tour=exceptions]', title: 'Exceptions, time-boxed', body: 'When a rule cannot be met, request an exception against the specific statement, with compensating controls and an expiry date of 365 days or less. Expired exceptions are flagged automatically.' },
    audit: { route: '#/audit', target: '#verify', title: 'Tamper-evident audit trail', body: 'Every action is hash-chained and cannot be edited or deleted. Click "Verify integrity" before an audit to prove nothing has been altered.', place: 'bottom' },
    attest: { route: '#/attestations', target: '[data-tour=mine]', title: 'Your acknowledgements', body: 'These are the policies in force that you are expected to follow. Open each one, read it, and click "I have read and will comply". New versions will appear here automatically.' },
    readPolicies: { route: '#/policies', target: '.card', title: 'Policies in force', body: 'Browse every policy that applies to you, in a clean, printable format.' },
    help: { route: null, target: '#help', title: 'Help is always here', body: 'Replay this tour any time from the "?" button.', place: 'bottom' },
  };
  if (role === 'employee') return [S.attest, S.readPolicies, S.help];
  if (role === 'auditor') return [S.posture, S.policies, S.frameworks, S.risks, S.audit, S.help];
  if (role === 'approver') return [S.posture, S.queue, S.policies, S.workflow, S.exceptions, S.risks, S.audit, S.help];
  return [S.posture, S.queue, S.templates, S.anatomy, S.linter, S.statements, S.workflow, S.frameworks, S.risks, S.exceptions, S.audit, S.help];
}

// ---------- Engine ----------
let active = null;

export async function startOnboarding({ intro = true } = {}) {
  if (active) return;
  const ctx = {};
  if (can.read()) {
    try {
      const list = await GET('/api/policies');
      ctx.draftId = (list.find((p) => p.status === 'draft' && p.errors) || list.find((p) => p.status === 'draft') || list[0])?.id;
    } catch { /* tour still works without a draft */ }
  }
  const root = document.createElement('div');
  root.className = 'ob-root';
  document.body.appendChild(root);
  active = { root, step: 0, steps: steps(state.me.role, ctx), returnTo: location.hash || '#/' };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  if (intro) welcome(); else tour(0);
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') finish('skipped');
  else if (e.key === 'ArrowRight' && active.mode === 'tour') tour(active.step + 1);
  else if (e.key === 'ArrowLeft' && active.mode === 'tour' && active.step > 0) tour(active.step - 1);
}
let resizeT;
function onResize() { clearTimeout(resizeT); resizeT = setTimeout(() => active?.mode === 'tour' && place(active.target, active.cur, true), 120); }

function welcome() {
  active.mode = 'welcome';
  const who = state.me.name.replace(/\s*\(.*\)$/, '');
  const roleLine = {
    admin: 'You administer this workspace: people, settings and the full GRC programme.',
    analyst: 'You author policies, manage risk and keep the evidence fresh.',
    approver: 'You sign off on policies and exceptions. Separation of duties is built in.',
    auditor: 'You have read-only access to everything, including the tamper-evident audit trail.',
    employee: 'You read the policies that apply to you and acknowledge them.',
  }[state.me.role];
  mount(active.root, html`<div class="ob-welcome" role="dialog" aria-modal="true" aria-labelledby="ob-h">
    <div class="ob-glow"></div>
    <div class="ob-w-inner">
      ${ANIMATED_LOGO}
      <div class="ob-eyebrow ob-in" data-d="1">Welcome to MandateGRC</div>
      <h1 id="ob-h" class="ob-in" data-d="2">Hello, ${who}. Let's write security policies that <em>stand up to an audit.</em></h1>
      <p class="ob-in" data-d="3">${roleLine}</p>
      <div class="ob-anat">${ANATOMY.map((a, i) => html`<div class="ob-tile" data-d="${4 + i}"><b>0${i + 1}</b>${a}</div>`)}</div>
      <div class="ob-rules ob-in" data-d="12">
        <span><i>1</i>Use “must” and “shall”</span><span><i>2</i>Be specific &amp; measurable</span><span><i>3</i>Map to a framework</span>
      </div>
      <div class="ob-actions ob-in" data-d="13">
        <button class="btn primary" data-ob="start">Take the tour <span class="muted-ink">· ${active.steps.length} stops, about 2 min</span></button>
        <button class="btn ghost" data-ob="skip">Skip for now</button>
      </div>
    </div></div>`);
  stagger(active.root);
  active.root.querySelector('[data-ob=start]').focus();
  active.root.addEventListener('click', onRootClick);
}

// Applies staggered animation delays without inline style attributes (CSP).
function stagger(scope) {
  scope.querySelectorAll('[data-d]').forEach((el) => {
    el.style.animationDelay = reducedMotion() ? '0ms' : `${Number(el.dataset.d) * 90 + 250}ms`;
  });
}

function onRootClick(e) {
  const b = e.target.closest('[data-ob]');
  if (!b) return;
  const a = b.dataset.ob;
  if (a === 'start') tour(0);
  else if (a === 'skip') finish('skipped');
  else if (a === 'next') tour(active.step + 1);
  else if (a === 'back') tour(active.step - 1);
  else if (a === 'done') finish('completed');
  else if (a === 'go') { const href = b.dataset.href; finish('completed', href); }
}

async function waitFor(selector, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = document.querySelector(selector);
    if (el && el.getBoundingClientRect().width > 0) return el;
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

async function tour(i) {
  if (!active) return;
  if (i >= active.steps.length) return finale();
  if (i < 0) return;
  const first = active.mode !== 'tour';
  active.mode = 'tour';
  active.step = i;
  const s = active.steps[i];
  active.cur = s;

  if (first) {
    active.root.querySelector('.ob-welcome')?.classList.add('ob-out');
    await sleep(380);
    mount(active.root, html`<div class="ob-blocker"></div><div class="ob-spot"></div><div class="ob-card" role="dialog" aria-live="polite"></div>`);
  }
  const card = active.root.querySelector('.ob-card');
  card.classList.add('ob-swap');

  if (s.route && location.hash !== s.route && !(s.route === '#/' && (location.hash === '' || location.hash === '#'))) {
    location.hash = s.route;
    await sleep(150);
  }
  let target = await waitFor(s.target);
  if (!target && s.target === '#help') target = null;
  if (target) {
    target.scrollIntoView({ block: window.innerWidth < 700 ? 'start' : 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    await sleep(420);
  }
  if (!active || active.step !== i) return;
  active.target = target;

  const n = active.steps.length;
  mount(card, html`
    <div class="ob-progress"><i data-w="${((i + 1) / n) * 100}"></i></div>
    <div class="ob-step">Step ${i + 1} of ${n}</div>
    <h3>${s.title}</h3>
    <p>${s.body}</p>
    <div class="ob-nav">
      <button class="btn ghost sm" data-ob="skip">Skip tour</button>
      <span class="ob-dots">${active.steps.map((_, k) => html`<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`)}</span>
      ${i > 0 ? html`<button class="btn sm" data-ob="back">Back</button>` : ''}
      <button class="btn primary sm" data-ob="next">${i === n - 1 ? 'Finish' : 'Next'} ${icon('check')}</button>
    </div>`);
  place(target, s);
  requestAnimationFrame(() => card.classList.remove('ob-swap'));
  card.querySelector('[data-ob=next]').focus({ preventScroll: true });
}

function place(target, s, instant = false) {
  if (!active) return;
  const spot = active.root.querySelector('.ob-spot');
  const card = active.root.querySelector('.ob-card');
  if (!spot || !card) return;
  if (instant) { spot.classList.add('ob-instant'); setTimeout(() => spot.classList.remove('ob-instant'), 50); }
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 16;
  const cw = Math.min(360, vw - 32);
  card.style.width = cw + 'px';
  if (!target) {
    spot.classList.add('ob-none');
    card.style.left = `${(vw - cw) / 2}px`;
    card.style.top = `${vh / 2 - card.offsetHeight / 2}px`;
    return;
  }
  spot.classList.remove('ob-none');
  const r = target.getBoundingClientRect();
  const top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad);
  const w = Math.min(vw - left - 6, r.width + pad * 2), h = Math.min(vh - top - 6, r.height + pad * 2);
  Object.assign(spot.style, { top: `${top}px`, left: `${left}px`, width: `${w}px`, height: `${h}px` });

  const ch = card.offsetHeight;
  const room = { right: vw - (left + w), left, bottom: vh - (top + h), top };
  let side = s.place;
  if (!side || room[side] < (side === 'left' || side === 'right' ? cw + gap : ch + gap)) {
    side = room.right >= cw + gap ? 'right' : room.left >= cw + gap ? 'left' : room.bottom >= ch + gap ? 'bottom' : room.top >= ch + gap ? 'top' : 'inside';
  }
  let x, y;
  if (side === 'right') { x = left + w + gap; y = top; }
  else if (side === 'left') { x = left - cw - gap; y = top; }
  else if (side === 'bottom') { x = left; y = top + h + gap; }
  else if (side === 'top') { x = left; y = top - ch - gap; }
  else { x = vw - cw - 16; y = vh - ch - 16; }
  x = Math.max(16, Math.min(x, vw - cw - 16));
  y = Math.max(16, Math.min(y, vh - ch - 16));
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.dataset.side = side;
}

function finale() {
  active.mode = 'finale';
  const role = state.me.role;
  const actions = role === 'employee'
    ? [['#/attestations', 'Acknowledge my policies', 'attest']]
    : can.write()
      ? [['#/templates', 'Draft a policy from a template', 'template'], ['#/frameworks', 'Find coverage gaps', 'framework'], ['#/risks', 'Add a risk to the register', 'risk']]
      : [['#/', 'Open my action queue', 'dashboard'], ['#/audit', 'Verify the audit trail', 'audit']];
  mount(active.root, html`<div class="ob-welcome ob-final" role="dialog" aria-modal="true">
    <div class="ob-glow"></div>
    <div class="ob-burst">${Array.from({ length: 28 }, (_, k) => html`<i data-k="${k}"></i>`)}</div>
    <div class="ob-w-inner">
      <div class="ob-check ob-in" data-d="0">${icon('check')}</div>
      <h1 class="ob-in" data-d="1">You're ready.</h1>
      <p class="ob-in" data-d="2">Here's a good first move. You can replay the tour any time from the <b>?</b> button in the top bar.</p>
      <div class="ob-next">${actions.map(([href, label, ic], k) => html`<button class="ob-next-item ob-in" data-d="${3 + k}" data-ob="go" data-href="${href}">${icon(ic)}<span>${label}</span><b>→</b></button>`)}</div>
      <div class="ob-actions ob-in" data-d="7"><button class="btn primary" data-ob="done">Go to workspace</button></div>
    </div></div>`);
  stagger(active.root);
  active.root.querySelectorAll('.ob-burst i').forEach((p, k) => {
    const angle = (k / 28) * Math.PI * 2, dist = 160 + (k % 5) * 40;
    p.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(angle) * dist}px`);
    p.style.animationDelay = `${(k % 7) * 30}ms`;
  });
  active.root.querySelector('[data-ob=done]').focus();
}

async function finish(outcome, href) {
  if (!active) return;
  const { root, step, returnTo } = active;
  active = null;
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  root.classList.add('ob-leave');
  setTimeout(() => root.remove(), reducedMotion() ? 0 : 320);
  try { await POST('/api/auth/onboarded', { outcome, step }); } catch { /* non-critical */ }
  location.hash = href || (outcome === 'skipped' ? returnTo : (state.me.role === 'employee' ? '#/attestations' : '#/'));
}
