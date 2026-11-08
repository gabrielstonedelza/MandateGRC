// Public site for mandategrc.app: landing page, passkey sign-in and registration, privacy policy, terms.
import { html, raw, mount, $, $$, on, api, state, icon, LOGO, ring } from './core.js';
import { renderDocs } from './docs.js';
import { passkeysSupported, passkeyUnsupportedBrowser, ipHost, createPasskey, getPasskey, passkeyError, refusedInstantly, deviceLabel, prefetcher } from './passkey.js';

export const PUBLIC_ROUTES = ['/', '/login', '/register', '/privacy', '/terms'];
const DOMAIN = 'mandategrc.app';
const UPDATED = 'October 17, 2026';

const NAV = [['features', 'Features'], ['how', 'How it works'], ['frameworks', 'Frameworks'], ['security', 'Security']];

// ---------- Layout ----------
function navbar(active) {
  const authed = !!state.me;
  return html`<header class="site-nav" id="site-nav">
    <div class="site-wrap nav-row">
      <a class="site-brand" href="#/" aria-label="MandateGRC home">${LOGO}<span>MANDATE<b class="wm-grc">GRC</b></span></a>
      <nav class="nav-links" id="nav-links" aria-label="Site">
        ${NAV.map(([id, label]) => html`<button class="nav-link" data-scroll="${id}">${label}</button>`)}
        <a class="nav-link ${active === 'docs' ? 'on' : ''}" href="#/docs">${icon('book')} Docs</a>
        <a class="nav-link ${active === 'privacy' ? 'on' : ''}" href="#/privacy">Privacy</a>
        <a class="nav-link ${active === 'terms' ? 'on' : ''}" href="#/terms">Terms</a>
        <div class="nav-cta-m">${authed ? html`<a class="btn primary" href="#/">Open workspace</a>` : html`<a class="btn" href="#/login">Sign in</a><a class="btn primary" href="#/register">Get started</a>`}</div>
      </nav>
      <div class="nav-cta">
        ${authed ? html`<a class="btn primary" href="#/">Open workspace ${icon('arrow')}</a>`
          : html`<a class="btn ghost ${active === 'login' ? 'on' : ''}" href="#/login">Sign in</a><a class="btn primary" href="#/register">Get started</a>`}
      </div>
      <button class="icon-btn nav-burger" id="burger" aria-label="Menu" aria-expanded="false">${icon('menu')}</button>
    </div>
  </header>`;
}

function footer() {
  return html`<footer class="site-foot"><div class="site-wrap foot-grid">
    <div><a class="site-brand" href="#/">${LOGO}<span>MANDATE<b class="wm-grc">GRC</b></span></a>
      <p class="dim">Policy-first governance, risk &amp; compliance. No passwords, no email, no tracking.</p></div>
    <div><h4>Product</h4><button data-scroll="features">Features</button><button data-scroll="how">How it works</button><button data-scroll="frameworks">Frameworks</button><button data-scroll="security">Security</button></div>
    <div><h4>Account</h4><a href="#/register">Create a workspace</a><a href="#/login">Sign in with passkey</a><a href="#/register?code=">Join with an invite</a></div>
    <div><h4>Learn</h4><a href="#/docs">Documentation</a><a href="#/docs/create-workspace">Getting started</a><a href="#/docs/write-policy">Write a policy</a><a href="#/docs/troubleshooting">Troubleshooting</a></div>
    <div><h4>Legal</h4><a href="#/privacy">Privacy policy</a><a href="#/terms">Terms of service</a><span class="dim small">No cookies beyond sign-in.</span></div>
  </div><div class="site-wrap foot-base"><span>© 2026 MandateGRC · ${DOMAIN}</span><span>Built without trackers, ads or third-party scripts.</span></div></footer>`;
}

function shell(root, active, body) {
  mount(root, html`<div class="site">${navbar(active)}<main class="site-main">${body}</main>${footer()}</div>`);
  const nav = $('#site-nav', root);
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('#burger', root).addEventListener('click', (e) => {
    const open = $('#nav-links', root).classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  on(root, 'click', '[data-scroll]', (e, b) => {
    $('#nav-links', root).classList.remove('open');
    const go = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if ((location.hash || '#/') === '#/' || location.hash === '#') go();
    else { pendingScroll = b.dataset.scroll; location.hash = '#/'; }
  });
  on(root, 'click', '#nav-links a', () => $('#nav-links', root).classList.remove('open'));
  revealOnScroll(root);
  window.scrollTo(0, 0);
}
let pendingScroll = null;

function revealOnScroll(root) {
  const items = $$('.reveal', root);
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { items.forEach((i) => i.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  items.forEach((i) => io.observe(i));
  $$('[data-delay]', root).forEach((el) => { el.style.transitionDelay = `${Number(el.dataset.delay) * 80}ms`; });
}

// ---------- Landing ----------
function productMock() {
  return html`<div class="mock" aria-hidden="true">
    <div class="mock-bar"><i></i><i></i><i></i><span>${DOMAIN}</span></div>
    <div class="mock-body">
      <div class="mock-side">${['dashboard', 'policy', 'risk', 'framework', 'evidence', 'audit'].map((n, i) => html`<span class="${i === 1 ? 'on' : ''}">${icon(n)}</span>`)}</div>
      <div class="mock-main">
        <div class="mock-head"><span class="tag gold">POL-004</span><b>Remote Working Policy</b><span class="pill s-draft">Draft</span></div>
        <div class="mock-grid">
          <div class="mock-card mock-score">${ring(92, { size: 'sm' })}<div><b>Grade A</b><small>0 blocking · 22 controls · 6 frameworks</small></div></div>
          <div class="mock-card mock-lint">
            <div class="mock-label">Statement 4.1</div>
            <div class="mock-stmt">Employees <span class="swap"><span class="bad">should</span><span class="good">must</span></span> connect through the VPN <span class="swap two"><span class="bad">where possible</span><span class="good">at all times</span></span> when working remotely.</div>
            <div class="mock-chips"><span class="chip"><b>ISO27001</b> 6.7</span><span class="chip"><b>NIST</b> AC-17</span><span class="chip"><b>SOC2</b> CC6.6</span></div>
            <div class="mock-fix">${icon('wand')} Linter fix applied: mandatory, measurable, mapped</div>
          </div>
          <div class="mock-card mock-bars">${[['ISO 27001', 82], ['NIST CSF 2.0', 74], ['SOC 2', 68], ['GDPR', 51]].map(([l, v], i) => html`<div class="mb-row"><span>${l}</span><div class="bar"><i class="grow-bar d${i}" data-w="${v}"></i></div><b>${v}%</b></div>`)}</div>
          <div class="mock-card mock-heat">${Array.from({ length: 25 }, (_, k) => { const l = 5 - Math.floor(k / 5), im = (k % 5) + 1, s = l * im; return html`<i class="${s >= 20 ? 'c' : s >= 12 ? 'h' : s >= 6 ? 'm' : 'l'} ${[7, 13, 17].includes(k) ? 'dot' : ''}"></i>`; })}</div>
        </div>
      </div>
    </div>
  </div>`;
}

const FEATURES = [
  ['wand', 'Policy linter', 'Flags “should”, “where possible” and “regularly” as you type, and fixes them in one click. Blocking issues keep weak policies out of review.'],
  ['link', 'Statement-level crosswalk', 'Map each rule to ISO 27001, NIST, SOC 2, PCI DSS, HIPAA, GDPR and CIS. Equivalent controls in other frameworks are suggested for you.'],
  ['users', 'Separation of duties', 'Authors can never approve their own policies or exceptions. The server enforces it and every attempt is recorded.'],
  ['audit', 'Tamper-evident audit trail', 'Every action is SHA-256 hash-chained and append-only. One click proves to an auditor that nothing was altered.'],
  ['risk', 'Risk register with appetite', 'Inherent and residual 5×5 heat maps, a risk appetite line, and optional SLE × ARO for annualized loss in dollars.'],
  ['exception', 'Time-boxed exceptions', 'Deviations are tied to a specific statement, require compensating controls, and expire within 365 days.'],
  ['evidence', 'Evidence that stays fresh', 'Each item has a validity window, and stale evidence surfaces in your action queue before the audit does.'],
  ['attest', 'Version-aware attestation', 'Publishing a new version re-opens acknowledgement automatically, so everyone has always read the current text.'],
  ['zap', 'Guided from day one', 'An animated, role-aware walkthrough shows every new user where to start and what good looks like.'],
];
const ANATOMY = [
  ['Header', 'Name, version, owner, effective date, review cycle, approval'], ['Purpose', 'One paragraph: why the policy exists'],
  ['Scope', 'Who and what it applies to'], ['Policy Statements', 'Numbered “must / shall” rules'],
  ['Roles & Responsibilities', 'Owner, custodian, users, management'], ['Compliance & Enforcement', 'What happens on violation'],
  ['References', 'The frameworks it maps to'], ['Revision History', 'An immutable version table'],
];
const FRAMEWORKS = ['ISO/IEC 27001:2022', 'NIST CSF 2.0', 'NIST SP 800-53 r5', 'SOC 2 TSC', 'PCI DSS v4.0.1', 'HIPAA Security Rule', 'GDPR', 'CIS Controls v8', 'Your custom frameworks'];

export async function landingPage(root) {
  shell(root, 'home', html`
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="site-wrap hero-grid">
        <div class="hero-copy">
          <span class="eyebrow-pill reveal">${icon('fingerprint')} Passwordless · Self-hostable · Zero trackers</span>
          <h1 class="reveal" data-delay="1">Security policies that <em>stand up to an audit.</em></h1>
          <p class="lead reveal" data-delay="2">MandateGRC is the workbench built around the anatomy of a professional security policy. Write in “must” and “shall”, map every statement to the frameworks you report against, and prove it all with a tamper-evident trail.</p>
          <div class="hero-cta reveal" data-delay="3">
            <a class="btn primary lg" href="#/register">Get started ${icon('arrow')}</a>
            <button class="btn lg" data-scroll="how">See how it works</button>
          </div>
          <ul class="hero-trust reveal" data-delay="4">
            <li>${icon('fingerprint')} Sign in with Face ID, Touch ID or Windows Hello</li>
            <li>${icon('eyeoff')} No passwords, no email, no tracking</li>
          </ul>
        </div>
        <div class="hero-visual reveal" data-delay="2">${productMock()}</div>
      </div>
    </section>

    <section class="strip" id="frameworks" aria-label="Supported frameworks">
      <div class="marquee"><div class="marquee-track">${[...FRAMEWORKS, ...FRAMEWORKS].map((f) => html`<span>${f}</span>`)}</div></div>
    </section>

    <section class="site-sec" id="anatomy">
      <div class="site-wrap">
        <div class="sec-head reveal"><span class="kicker">The anatomy</span><h2>Every policy, built in the professional order.</h2>
          <p>MandateGRC's editor is the anatomy itself. Each section turns green when it meets the standard auditors expect.</p></div>
        <div class="anat-grid">${ANATOMY.map(([t, d], i) => html`<div class="anat-card reveal" data-delay="${i}"><span class="anat-n">0${i + 1}</span><h3>${t}</h3><p>${d}</p></div>`)}</div>
        <div class="rules reveal"><span><i>1</i> Use “must” and “shall”, never “should”</span><span><i>2</i> Keep statements specific &amp; measurable</span><span><i>3</i> Map each policy to a framework</span></div>
      </div>
    </section>

    <section class="site-sec alt" id="features">
      <div class="site-wrap">
        <div class="sec-head reveal"><span class="kicker">Features</span><h2>What other GRC tools leave out.</h2>
          <p>Most platforms automate evidence collection and stop there. MandateGRC starts where compliance actually lives: in the wording of your policies.</p></div>
        <div class="feat-grid">${FEATURES.map(([ic, t, d], i) => html`<article class="feat reveal" data-delay="${i % 3}"><span class="feat-ic">${icon(ic)}</span><h3>${t}</h3><p>${d}</p></article>`)}</div>
      </div>
    </section>

    <section class="site-sec" id="how">
      <div class="site-wrap">
        <div class="sec-head reveal"><span class="kicker">How it works</span><h2>From blank page to audit-ready in four steps.</h2></div>
        <ol class="steps">${[
          ['Draft', 'Start from a lint-clean template or a blank anatomy. Statements are numbered for you.'],
          ['Lint & map', 'Fix weak wording in one click and map each statement to controls across frameworks.'],
          ['Approve', 'A different approver signs off. The version is stamped and a snapshot is recorded.'],
          ['Prove', 'Publish, collect acknowledgements, attach evidence, and verify the audit chain.'],
        ].map(([t, d], i) => html`<li class="reveal" data-delay="${i}"><span class="step-n">${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`)}</ol>
      </div>
    </section>

    <section class="site-sec sec-security" id="security">
      <div class="site-wrap sec-split">
        <div class="reveal">
          <span class="kicker">Security &amp; privacy</span>
          <h2>Your fingerprint never leaves your device.</h2>
          <p class="dim">MandateGRC uses passkeys (the FIDO2 / WebAuthn standard behind Apple, Google and Microsoft sign-in). Your biometric check happens inside your phone or laptop's secure hardware. We only ever receive a cryptographic signature, so there is no password to steal, phish or leak.</p>
          <ul class="checks">
            <li>${icon('check')} Phishing-resistant: passkeys only work on ${DOMAIN}</li>
            <li>${icon('check')} No email or phone number, just a username you choose</li>
            <li>${icon('check')} No IP addresses stored, no analytics, no third-party scripts</li>
            <li>${icon('check')} Strict Content-Security-Policy and server-enforced roles</li>
            <li>${icon('check')} Self-host it: your data never has to leave your network</li>
          </ul>
          <a class="btn" href="#/privacy">Read the privacy policy ${icon('arrow')}</a>
        </div>
        <div class="stat-stack reveal" data-delay="2">
          ${[['0', 'passwords stored'], ['0', 'email addresses collected'], ['0', 'trackers or third-party scripts'], ['1', 'cookie, used only to keep you signed in']].map(([n, l]) => html`<div class="stat"><b>${n}</b><span>${l}</span></div>`)}
        </div>
      </div>
    </section>

    <section class="site-sec alt">
      <div class="site-wrap">
        <div class="sec-head reveal"><span class="kicker">Compare</span><h2>Built for the analyst, not the sales demo.</h2></div>
        <div class="compare reveal"><table>
          <thead><tr><th></th><th>Typical compliance SaaS</th><th class="us">MandateGRC</th></tr></thead>
          <tbody>${[
            ['Sign-in', 'Email + password (+ MFA add-on)', 'Passkey only. Nothing to phish.'],
            ['Policy quality', 'Generic templates, no feedback', 'Live linter with one-click fixes'],
            ['Framework mapping', 'Policy-level, often SOC 2-centric', 'Statement-level across 8 frameworks + crosswalk'],
            ['Separation of duties', 'Configurable, often off', 'Always enforced server-side'],
            ['Audit trail', 'Activity log', 'Hash-chained, append-only, verifiable'],
            ['Your data', 'Vendor cloud', 'Self-host or hosted. No trackers either way.'],
            ['Setup', 'Weeks of onboarding', 'One command, guided tour on first sign-in'],
          ].map(([a, b, c]) => html`<tr><th>${a}</th><td>${b}</td><td class="us">${icon('check')} ${c}</td></tr>`)}</tbody></table></div>
      </div>
    </section>

    <section class="cta-band">
      <div class="site-wrap cta-inner reveal">
        <h2>Ready to write policies that hold up in an audit?</h2>
        <p>Create your free workspace in under a minute: a username and a passkey. That's it.</p>
        <div class="hero-cta"><a class="btn primary lg" href="#/register">Get started ${icon('arrow')}</a><a class="btn lg" href="#/login">${icon('fingerprint')} Sign in</a></div>
      </div>
    </section>`);
  if (pendingScroll) { const id = pendingScroll; pendingScroll = null; setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 60); }
}

// ---------- Auth pages ----------
function hostWarning() {
  if (!ipHost()) return '';
  const url = `${location.protocol}//localhost${location.port ? ':' + location.port : ''}/${location.hash}`;
  return html`<div class="notice warn small">Passkeys don't work on IP addresses. Open <a href="${url}">${url}</a> instead.</div>`;
}
function supportWarning() {
  const named = passkeyUnsupportedBrowser();
  if (named) return html`<div class="notice bad small">${named}'s browser doesn't support passkeys yet, so it can't create or use one. Open MandateGRC in Safari, Chrome, Edge or Firefox.</div>`;
  return passkeysSupported() ? '' : html`<div class="notice bad small">This browser doesn't support passkeys. Use a current version of Safari, Chrome, Edge or Firefox.</div>`;
}

// Shown when creating a passkey fails. A refusal within a moment means the browser never showed a
// prompt; a later one means the prompt was closed or timed out.
function createHelp(err) {
  if (!(err instanceof DOMException)) return html`<div class="notice bad small">${err.message}</div>`;
  if (err.name !== 'NotAllowedError') return html`<div class="notice bad small">${passkeyError(err)}</div>`;
  const instant = refusedInstantly(err);
  return html`<div class="auth-help">
    <b>${instant ? 'Your browser refused to create a passkey without showing a prompt.' : 'The passkey prompt was closed before it finished.'}</b>
    <ol>${instant ? html`
      <li><b>Using DuckDuckGo, or another browser without passkey support?</b> Open MandateGRC in Safari, Chrome, Edge or Firefox.</li>
      <li><b>Private or incognito window?</b> Some browsers can't save passkeys there. Use a normal window.</li>
      <li><b>Passkeys turned off?</b> In Chrome, check that the Google Password Manager is on; in Firefox, update to the latest version. Safari and Chrome on a Mac work best.</li>
      <li><b>Click the button itself</b> with this tab and window in front, then wait for the prompt.</li>`
      : html`
      <li>Click <b>Create passkey</b> again and approve with Touch ID, Face ID or Windows Hello.</li>
      <li>If the browser asks <i>where</i> to save it, choose iCloud Keychain, Google Password Manager or “this device”. All work.</li>
      <li>No fingerprint reader? Choose <i>Use a phone or tablet</i> and scan the QR code to save the passkey on your phone.</li>
      <li>The prompt closes itself after two minutes. Approve it promptly.</li>`}
    </ol>
    <small class="muted">Browser said: ${err.name}${err.message ? `: ${err.message}` : ''}${typeof err.elapsedMs === 'number' ? ` (after ${(err.elapsedMs / 1000).toFixed(1)} s)` : ''}</small></div>`;
}

// Shown when the passkey prompt is cancelled or finds no passkey in this browser.
function noPasskeyHelp() {
  return html`<div class="auth-help">
    <b>No passkey came up, or the request was cancelled.</b>
    <p>A passkey is saved by the browser or password manager that created it. If you created yours in another browser (for example Chrome) it will not appear here (for example in Safari or Firefox).</p>
    <ol>
      <li><b>Cancelled by mistake?</b> Click <b>Sign in with passkey</b> again and approve.</li>
      <li><b>Passkey on your phone?</b> Click <b>Sign in with passkey</b>, choose <i>Use a phone or tablet</i> (or <i>another device</i>), and scan the QR code.</li>
      <li><b>Passkey in another browser?</b> Sign in there, open <b>My account → Sign in on another browser</b>, get a one-time code, and <a href="#/register?code=">enter it here</a>. This browser gets its own passkey.</li>
      <li><b>Lost every passkey?</b> Ask your workspace administrator for a recovery code.</li>
    </ol></div>`;
}

export function loginPage(root, { message, onSignedIn } = {}) {
  shell(root, 'login', html`<section class="auth-page"><div class="auth-glow"></div>
    <div class="auth-card reveal">
      <div class="auth-ic">${icon('fingerprint')}</div>
      <h1>Welcome back</h1>
      <p class="dim">Sign in with the passkey saved on this device: Face ID, Touch ID, Windows Hello or a security key.</p>
      ${hostWarning()}${supportWarning()}
      <div id="auth-msg">${message ? html`<div class="notice bad small">${message}</div>` : ''}</div>
      <button class="btn primary lg block" id="pk-login">${icon('fingerprint')} Sign in with passkey</button>
      <details class="auth-more"><summary>Using a security key or another device?</summary>
        <label class="f"><span>Username <em>(optional hint)</em></span><input id="pk-user" autocomplete="username webauthn" maxlength="32" placeholder="your-username"></label>
      </details>
      <p class="auth-alt">New browser or computer? <a href="#/register?code=" id="to-link">Use a one-time code</a></p>
      <p class="auth-alt">New here? <a href="#/register">Create a free workspace</a></p>
      <p class="auth-fine">${icon('lock')} No password is ever created or stored.</p>
    </div></section>`);
  // Options are fetched before the click so WebAuthn runs inside the click itself (required by Safari).
  const userInput = $('#pk-user', root);
  const pf = prefetcher(() => api('POST', '/api/auth/login/options', { username: userInput.value.trim() }), { anchor: root.querySelector('.auth-card') });
  let hintTimer;
  userInput.addEventListener('input', () => { clearTimeout(hintTimer); hintTimer = setTimeout(pf.refresh, 350); });
  const btn = $('#pk-login', root);
  btn.addEventListener('click', () => {
    const opts = pf.take();
    if (!opts) {
      const err = pf.error();
      mount($('#auth-msg', root), html`<div class="notice ${err ? 'bad' : 'info'} small">${err ? err.message : 'Getting ready… click the button again in a moment.'}</div>`);
      if (err) pf.refresh();
      return;
    }
    btn.disabled = true;
    btn.classList.add('busy');
    // No await before this call: it must run synchronously inside the click.
    getPasskey(opts.publicKey)
      .then((credential) => api('POST', '/api/auth/login/verify', { challengeId: opts.challengeId, credential }))
      .then(async (r) => { state.csrf = r.csrf; state.me = r.user; await onSignedIn?.(); })
      .catch((err) => {
        // NotAllowedError also covers "this browser has no passkey for this site", which is what
        // happens in a browser other than the one where the passkey was created.
        const none = err instanceof DOMException && err.name === 'NotAllowedError';
        mount($('#auth-msg', root), none ? noPasskeyHelp() : html`<div class="notice bad small">${err instanceof DOMException ? passkeyError(err) : err.message}</div>`);
        pf.refresh();
      })
      .finally(() => { btn.disabled = false; btn.classList.remove('busy'); });
  });
}

export async function registerPage(root, { onSignedIn } = {}) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const preset = params.get('code') || '';
  // mode: 'signup' (create a new workspace) | 'code' (enter invite/recovery code) | 'redeem' (code accepted)
  let mode = params.has('code') ? 'code' : 'signup', invite = null, code = '';

  const msg = (m, kind = 'bad') => mount($('#auth-msg', root), m ? html`<div class="notice ${kind} small">${m}</div>` : html``);
  const done = async (r) => { state.csrf = r.csrf; state.me = r.user; history.replaceState(null, '', '#/'); await onSignedIn?.(); };

  // Live username availability check (no network call is allowed between the click and the passkey prompt).
  function watchUsername(input, codeForCheck) {
    const st = { ok: false };
    let t;
    input?.addEventListener('input', () => {
      st.ok = false;
      clearTimeout(t);
      const v = input.value.trim();
      if (v.length < 3) { msg(''); return; }
      t = setTimeout(() => api('POST', '/api/auth/username', { username: v, code: codeForCheck })
        .then(() => { if (input.value.trim() === v) { st.ok = true; msg(`@${v} is available.`, 'good'); } })
        .catch((err) => { if (input.value.trim() === v) msg(err.message); }), 350);
    });
    return st;
  }

  const draw = () => {
    if (mode === 'signup') {
      mount($('#reg', root), html`
        <div class="reg-steps"><span class="on">1 · Your workspace</span><i></i><span>2 · Passkey</span></div>
        <h1>Create your workspace</h1>
        <p class="dim">Free and private. No email or password. Your workspace is visible only to you and the people you invite.</p>
        <form id="pk-form" class="stack" novalidate>
          <label class="f"><span>Organization name</span><input name="org_name" required minlength="2" maxlength="120" placeholder="e.g. Acme Holdings" autocomplete="organization" autofocus></label>
          <label class="f"><span>Username</span><input name="username" required minlength="3" maxlength="32" placeholder="e.g. ama.m" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
          <label class="f"><span>Display name <em>(optional, shown to colleagues)</em></span><input name="display_name" maxlength="80" placeholder="e.g. Ama M."></label>
          <label class="row small dim"><input type="checkbox" name="sample" checked> Include sample policies, risks and evidence to explore</label>
          <input type="hidden" name="label" value="${deviceLabel()}">
          <button class="btn primary lg block" type="submit">${icon('fingerprint')} Create passkey &amp; workspace</button>
        </form>
        <div id="auth-msg"></div>
        <p class="auth-alt">Joining a team, adding a new browser, or recovering access? <a href="#" id="to-code">Enter a code</a></p>
        <p class="auth-alt">Already have a passkey? <a href="#/login">Sign in</a></p>
        <p class="auth-fine">${icon('lock')} Your biometric stays on your device. We store only a public key.</p>`);
      const form = $('#pk-form', root);
      const uname = watchUsername(form.elements.namedItem('username'));
      const pf = prefetcher(() => api('POST', '/api/auth/signup/options', {}), { anchor: form });
      $('#to-code', root).addEventListener('click', (e) => { e.preventDefault(); mode = 'code'; draw(); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const field = (n) => (form.elements.namedItem(n)?.value || '').trim();
        if (field('org_name').length < 2) return msg('Enter your organization name.');
        if (!uname.ok) return msg(field('username').length < 3 ? 'Choose a username (at least 3 characters).' : 'Checking that username… try again in a moment.');
        const opts = pf.take();
        if (!opts) { const err = pf.error(); msg(err ? err.message : 'Getting ready… click again in a moment.', err ? 'bad' : 'info'); if (err) pf.refresh(); return; }
        opts.publicKey.user.name = field('username');
        opts.publicKey.user.displayName = field('display_name') || field('username');
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        // No await before this call: Safari only shows the passkey prompt inside the click.
        createPasskey(opts.publicKey)
          .then((credential) => api('POST', '/api/auth/signup/verify', {
            challengeId: opts.challengeId, credential, label: field('label'),
            username: field('username'), name: field('display_name'), org_name: field('org_name'),
            sample: form.elements.namedItem('sample').checked,
          }))
          .then(done)
          .catch((err) => { mount($('#auth-msg', root), createHelp(err)); btn.disabled = false; pf.refresh(); });
      });
      return;
    }

    if (mode === 'code') {
      mount($('#reg', root), html`
        <div class="reg-steps"><span class="on">1 · Code</span><i></i><span>2 · Passkey</span></div>
        <h1>Enter your code</h1>
        <p class="dim">Enter the invite your administrator sent you, a one-time code from <b>My account</b> in a browser where you are signed in, or a recovery code if you lost your passkeys.</p>
        <form id="code-form" class="stack">
          <label class="f"><span>Invite, one-time or recovery code</span><input id="code" class="code-input" value="${preset}" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="one-time-code" maxlength="40" required autofocus></label>
          <button class="btn primary lg block" type="submit">Continue ${icon('arrow')}</button>
        </form>
        <div id="auth-msg"></div>
        <p class="auth-alt">No code? <a href="#" id="to-signup">Create your own workspace</a></p>`);
      $('#to-signup', root).addEventListener('click', (e) => { e.preventDefault(); mode = 'signup'; draw(); });
      $('#code-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        code = $('#code', root).value;
        try { invite = await api('POST', '/api/auth/invite', { code }); mode = 'redeem'; draw(); } catch (err) { msg(err.message); }
      });
      return;
    }

    // mode === 'redeem'
    const join = invite.purpose === 'join', link = invite.purpose === 'link';
    mount($('#reg', root), html`
      <div class="reg-steps"><span class="on">1 · Code</span><i></i><span class="on">2 · Passkey</span></div>
      <h1>${join ? `Join ${invite.org || 'the workspace'}` : link ? 'Add this browser' : 'Recover your account'}</h1>
      <p class="dim">${join ? html`You're joining as <b>${roleName(invite.role)}</b>. Choose a username. No email or password needed.`
        : link ? html`This code is for <b>@${invite.username}</b>. Create a passkey in this browser, and you can sign in here from now on.`
        : html`This code is for <b>@${invite.username}</b>. Create a new passkey on this device to regain access.`}</p>
      <form id="pk-form" class="stack" novalidate>
        ${join ? html`
          <label class="f"><span>Username</span><input name="username" required minlength="3" maxlength="32" placeholder="e.g. ama.m" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus></label>
          <label class="f"><span>Display name <em>(optional, shown to colleagues)</em></span><input name="display_name" maxlength="80" placeholder="e.g. Ama M."></label>` : ''}
        <label class="f"><span>Passkey name <em>(helps you tell devices apart)</em></span><input name="label" maxlength="60" value="${deviceLabel()}"></label>
        <button class="btn primary lg block" type="submit">${icon('fingerprint')} Create passkey</button>
        <button class="btn ghost block" type="button" id="back">Use a different code</button>
      </form>
      <div id="auth-msg"></div>
      <p class="auth-fine">${icon('lock')} Your biometric stays on your device. We store only a public key.</p>`);
    const form = $('#pk-form', root);
    const uname = join ? watchUsername(form.elements.namedItem('username'), code) : { ok: true };
    const pf = prefetcher(() => api('POST', '/api/auth/register/options', { code }), { anchor: form });
    $('#back', root).addEventListener('click', () => { invite = null; mode = 'code'; draw(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const field = (n) => (form.elements.namedItem(n)?.value || '').trim();
      if (!uname.ok) return msg(field('username').length < 3 ? 'Choose a username (at least 3 characters).' : 'Checking that username… try again in a moment.');
      const opts = pf.take();
      if (!opts) { const err = pf.error(); msg(err ? err.message : 'Getting ready… click again in a moment.', err ? 'bad' : 'info'); if (err) pf.refresh(); return; }
      if (join) { opts.publicKey.user.name = field('username'); opts.publicKey.user.displayName = field('display_name') || field('username'); }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      createPasskey(opts.publicKey)
        .then((credential) => api('POST', '/api/auth/register/verify', { challengeId: opts.challengeId, credential, label: field('label'), username: field('username'), name: field('display_name') }))
        .then(done)
        .catch((err) => { mount($('#auth-msg', root), createHelp(err)); btn.disabled = false; pf.refresh(); });
    });
  };

  shell(root, 'register', html`<section class="auth-page"><div class="auth-glow"></div>
    <div class="auth-card reveal">${hostWarning()}${supportWarning()}<div id="reg"></div></div></section>`);
  draw();
}
const roleName = (r) => ({ admin: 'an Administrator', analyst: 'a GRC Analyst', approver: 'an Approver', auditor: 'an Auditor', employee: 'an Employee' }[r] || r);

// ---------- Legal ----------
export function privacyContent() {
  return html`<article class="legal">
    <span class="kicker">Legal</span><h1>Privacy policy</h1><p class="muted">Last updated ${UPDATED}</p>
    <div class="legal-summary"><b>The short version:</b> MandateGRC does not collect personal data about you. There are no passwords, no email addresses, no phone numbers, no analytics, no advertising, no tracking cookies and no third-party scripts. The only thing we need to recognise you is a username you choose and the public half of your passkey.</div>

    <h2>1. Who this applies to</h2>
    <p>This policy covers the MandateGRC software and any instance of it, including the hosted service at ${DOMAIN} and copies your organization runs on its own servers ("self-hosted"). For self-hosted copies, your organization operates the server and controls the data. We have no access to it.</p>

    <h2>2. What MandateGRC stores, completely</h2>
    <ul>
      <li><b>Username and an optional display name</b> that you choose. Neither has to be your real name.</li>
      <li><b>Your organization's name</b>, as you type it when creating a workspace.</li>
      <li><b>Passkey public key</b>, its credential ID, a signature counter (used to detect cloned keys) and a device label you can edit. The private key and your biometric data stay on your device.</li>
      <li><b>Account details:</b> your role, whether the account is active, when it was created, the time of your last sign-in, and whether you finished the product tour.</li>
      <li><b>Workspace content</b> your organization creates: policies, risks, exceptions, evidence references and acknowledgements.</li>
      <li><b>Audit trail:</b> which username performed which action, and when. It is append-only by design, because that is what makes it trustworthy evidence. It does not contain IP addresses.</li>
    </ul>

    <h2>3. What MandateGRC never collects</h2>
    <ul>
      <li>Email addresses, phone numbers, postal addresses or passwords.</li>
      <li><b>Biometric data.</b> Face ID, Touch ID and Windows Hello run entirely on your device. MandateGRC receives only a cryptographic signature proving the check succeeded.</li>
      <li><b>IP addresses.</b> To block abuse, the server counts sign-in attempts in memory using a hashed form of the connecting address. This is never written to disk and is discarded within 15 minutes.</li>
      <li>Device fingerprints, location, browsing behaviour, analytics events or advertising identifiers.</li>
    </ul>

    <h2>4. Cookies</h2>
    <p>MandateGRC sets exactly one cookie, <code>mandate_sid</code>, after you sign in. It is strictly necessary to keep you signed in, cannot be read by scripts (HttpOnly), is never sent to other sites (SameSite=Strict), and expires after 30 minutes of inactivity or 8 hours at most. There are no analytics or marketing cookies, so there is no cookie banner.</p>

    <h2>5. Third parties</h2>
    <p>None. MandateGRC loads no external fonts, content delivery networks, analytics, chat widgets or advertising. The browser is technically prevented from contacting any other server by our Content-Security-Policy. We do not sell, rent or share data with anyone.</p>

    <h2>6. Hosting</h2>
    <p>If you use the hosted service at ${DOMAIN}, workspace data is stored on the servers running that instance. Infrastructure providers may keep standard network or security logs outside the application, under their own policies. If you self-host MandateGRC, your organization's infrastructure policies apply instead.</p>

    <h2>7. How long data is kept</h2>
    <p>Data is kept while your workspace exists. Administrators can deactivate accounts and revoke passkeys at any time. Deleting a workspace deletes all of its data. Usernames that appear in the audit trail remain there so the record stays verifiable.</p>

    <h2>8. Your choices and rights</h2>
    <p>You can view and remove your own passkeys from <i>My account</i>. To correct your display name, deactivate your account or request a copy of workspace data, contact your workspace administrator. Depending on where you live, laws such as the GDPR may give you further rights, and we will honour them.</p>

    <h2>9. Children</h2>
    <p>MandateGRC is professional software and is not intended for anyone under 16.</p>

    <h2>10. Changes</h2>
    <p>If this policy changes, we will update this page and the date above. We will never start collecting personal data quietly.</p>

    <h2>11. Contact</h2>
    <p>Privacy questions: <b>privacy@${DOMAIN}</b></p>
  </article>`;
}

export function termsContent() {
  return html`<article class="legal">
    <span class="kicker">Legal</span><h1>Terms of service</h1><p class="muted">Last updated ${UPDATED}</p>
    <div class="legal-summary"><b>The short version:</b> You own your content. Keep your devices secure, because we cannot reset a passkey for you. MandateGRC helps you manage compliance, but it is not legal advice and does not certify you against any standard.</div>

    <h2>1. Agreement</h2>
    <p>By creating an account or using MandateGRC ("MandateGRC", "the service"), including the hosted service at ${DOMAIN}, you agree to these terms. If you use MandateGRC on behalf of an organization, you confirm that you are authorised to accept these terms for it.</p>

    <h2>2. The service</h2>
    <p>MandateGRC is software for authoring security policies, managing risks, exceptions, controls and evidence, and keeping an audit trail. It can be self-hosted or used as a hosted service. Features may change as the product improves.</p>

    <h2>3. Accounts and passkeys</h2>
    <ul>
      <li>Anyone can create a workspace. Joining someone else's workspace requires a one-time invite from its administrator. Do not share invite or recovery codes outside the intended recipient.</li>
      <li>You sign in with passkeys stored on your devices. You are responsible for keeping those devices secure, and you should register more than one passkey as a backup.</li>
      <li>Because there are no passwords or email addresses, access cannot be reset by email. If you lose all your passkeys, your workspace administrator can issue a one-time recovery code.</li>
      <li>Tell your administrator promptly if you believe a device holding your passkey has been lost or compromised.</li>
    </ul>

    <h2>4. Acceptable use</h2>
    <p>Do not attempt to access workspaces or data you are not authorised for, interfere with the service's security or availability, probe it for vulnerabilities without written permission, or use it to store unlawful content.</p>

    <h2>5. Your content</h2>
    <p>You and your organization keep all rights to the content you create in MandateGRC. On the hosted service, we process it only to provide the service to you. We do not mine, sell or train models on it.</p>

    <h2>6. Not legal or audit advice</h2>
    <p>Templates, linter suggestions, framework mappings and crosswalk suggestions are provided to help you work faster. They are not legal, regulatory or audit advice. Control titles are summaries: always check them against the official text of each standard. Using MandateGRC does not by itself make you compliant with, or certified against, any framework.</p>

    <h2>7. Availability and warranty</h2>
    <p>We work to keep the hosted service available and secure, but it is provided "as is" and "as available", without warranties of any kind to the extent the law allows. Keep backups of important records. For self-hosted instances, availability and backups are your organization's responsibility.</p>

    <h2>8. Limitation of liability</h2>
    <p>To the maximum extent permitted by law, MandateGRC and its operators are not liable for indirect, incidental or consequential damages, or for lost data, profits or revenue, arising from your use of the service.</p>

    <h2>9. Ending use</h2>
    <p>You may stop using MandateGRC at any time. Workspace administrators can deactivate accounts. We may suspend access that violates these terms or threatens the security of the service or other users.</p>

    <h2>10. Changes to these terms</h2>
    <p>We may update these terms. Material changes will be announced on this page with a new date. Continuing to use the service after a change means you accept the updated terms.</p>

    <h2>11. Contact</h2>
    <p>Questions about these terms: <b>legal@${DOMAIN}</b></p>
  </article>`;
}

export function docsPage(root, id) {
  shell(root, 'docs', html`<section class="docs-wrap"><div class="site-wrap wide" id="docs-root"></div></section>`);
  renderDocs($('#docs-root', root), id);
}

export function legalPage(root, which) {
  shell(root, which, html`<section class="site-sec legal-wrap"><div class="site-wrap narrow">${which === 'privacy' ? privacyContent() : termsContent()}</div></section>`);
}
