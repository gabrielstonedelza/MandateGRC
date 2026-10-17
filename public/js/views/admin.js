import { html, mount, $, on, state, GET, POST, PUT, DEL, toast, fail, modal, confirmDialog, formData, fmtDate, fmtDateTime, ago, pill, icon, initials } from '../core.js';
import { createPasskey, passkeyError, deviceLabel, prefetcher } from '../passkey.js';

const ROLES = [
  ['admin', 'Administrator', 'Full access, including users and settings.'],
  ['analyst', 'GRC Analyst', 'Authors policies, manages risks, controls, evidence and exceptions.'],
  ['approver', 'Approver', 'Approves policies and exceptions. Cannot approve their own work.'],
  ['auditor', 'Auditor', 'Read-only access to everything, including the audit trail.'],
  ['employee', 'Employee', 'Reads policies in force and records acknowledgements.'],
];
const roleName = (r) => ROLES.find((x) => x[0] === r)?.[1] || r;

// Shows a one-time code once, with a ready-to-share link (the code travels in the URL fragment, which is never sent to servers).
function codeDialog(title, intro, code, expires) {
  const link = `${location.origin}/#/register?code=${encodeURIComponent(code)}`;
  modal({
    title,
    body: html`<div class="stack"><p class="dim">${intro}</p>
      <div class="secret">${code}</div>
      <label class="f"><span>Or share this link</span><input readonly value="${link}" id="lnk"></label>
      <div class="muted small">Valid until ${fmtDateTime(expires)} and usable once. Share it through a channel you trust. It is shown only now.</div></div>`,
    footer: html`<button class="btn" data-copy>${icon('link')} Copy link</button><button class="btn primary" data-close>Done</button>`,
    onMount: ({ el }) => on(el, 'click', '[data-copy]', async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch { $('#lnk', el).select(); }
    }),
  });
}

export async function usersView(el) {
  let [users, invites] = await Promise.all([GET('/api/users'), GET('/api/invites')]);
  const draw = () => mount(el, html`
    <div class="page-head"><div><h1>Users & roles</h1><div class="sub">MandateGRC has no passwords. People join with a one-time invite and sign in with a passkey (Face ID, Touch ID, Windows Hello or a security key). Roles are enforced on every request, and separation of duties is built in.</div></div>
      <div class="actions"><button class="btn primary" id="invite">${icon('plus')} Invite someone</button></div></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Passkeys</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${users.map((u) => html`<tr>
        <td><div class="row"><div class="avatar">${initials(u.name)}</div><div class="title-cell"><b>${u.name}</b><small>@${u.username}</small></div></div></td>
        <td>${roleName(u.role)}</td>
        <td>${u.active ? pill('ok', 'Active') : pill('retired', 'Disabled')}</td>
        <td>${u.passkeys ? html`<button class="btn xs" data-keys="${u.id}">${icon('fingerprint')} ${u.passkeys}</button>` : html`<span class="muted small">None</span>`}</td>
        <td>${u.last_login_at ? ago(u.last_login_at) : html`<span class="muted">Never</span>`}</td>
        <td class="nowrap"><button class="btn xs" data-edit="${u.id}">Edit</button> ${u.active ? html`<button class="btn xs" data-recover="${u.id}">Recovery code</button>` : ''}</td>
      </tr>`)}</tbody></table></div></div>
    <div class="card"><div class="card-h"><h3>Pending invites</h3><span class="muted">${invites.length}</span></div>
      ${invites.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Type</th><th>Role / account</th><th>Created by</th><th>Expires</th><th></th></tr></thead><tbody>
        ${invites.map((i) => html`<tr><td>${i.purpose === 'join' ? 'Invite' : 'Recovery'}</td><td>${i.purpose === 'join' ? roleName(i.role) : '@' + i.target}</td><td>${i.created_by_name || '—'}</td><td>${fmtDateTime(i.expires_at)}</td>
          <td><button class="btn xs danger" data-revoke="${i.id}">Revoke</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No pending invites. Codes are stored only as hashes, so lost codes can't be shown again. Just issue a new one.</div>`}</div>`);
  draw();
  const reload = async () => { [users, invites] = await Promise.all([GET('/api/users'), GET('/api/invites')]); draw(); };

  on(el, 'click', '#invite', () => modal({
    title: 'Invite someone',
    body: html`<form id="if" class="stack"><p class="dim">The person picks their own username and creates a passkey. You never handle their credentials, and no email address is needed.</p>
      <div class="section-label">Role</div>
      ${ROLES.map(([k, l, d]) => html`<label class="pick"><input type="radio" name="role" value="${k}" ${k === 'analyst' ? 'checked' : ''}><b>${l}</b><span class="dim small">${d}</span></label>`)}
      <label class="f"><span>Valid for</span><select name="days"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option></select></label></form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Create invite</button>`,
    onMount: ({ el: m, close }) => on(m, 'click', '[data-go]', async () => {
      const f = $('#if', m);
      try {
        const r = await POST('/api/invites', { role: $('[name=role]:checked', m).value, days: Number(f.days.value) });
        close(); await reload();
        codeDialog('Invite created', 'Send this code or link to the person you are inviting.', r.code, r.expires_at);
      } catch (e) { fail(e); }
    }),
  }));
  on(el, 'click', '[data-edit]', (e, b) => userForm(users.find((u) => u.id === Number(b.dataset.edit)), reload));
  on(el, 'click', '[data-recover]', (e, b) => {
    const u = users.find((x) => x.id === Number(b.dataset.recover));
    modal({
      title: `Recovery code for ${u.name}`,
      body: html`<div class="stack"><p class="dim">Use this when someone lost the device holding their passkey. The code lets <b>@${u.username}</b> create a new passkey. It is valid for 24 hours and works once.</p>
        <label class="row"><input type="checkbox" id="rv"> Also revoke all of their existing passkeys and sign them out (recommended if a device was stolen)</label></div>`,
      footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Issue recovery code</button>`,
      onMount: ({ el: m, close }) => on(m, 'click', '[data-go]', async () => {
        try {
          const r = await POST(`/api/users/${u.id}/recovery`, { revokeExisting: $('#rv', m).checked });
          close(); await reload();
          codeDialog('Recovery code issued', `Give this to ${u.name}. They enter it on the "Get started" page.`, r.code, r.expires_at);
        } catch (err) { fail(err); }
      }),
    });
  });
  on(el, 'click', '[data-keys]', async (e, b) => {
    const u = users.find((x) => x.id === Number(b.dataset.keys));
    const keys = await GET(`/api/users/${u.id}/passkeys`).catch(fail);
    if (!keys) return;
    modal({
      title: `${u.name}'s passkeys`,
      body: html`<div class="stack">${keys.map((k) => html`<div class="row"><span>${icon('fingerprint')}</span><div><b>${k.label}</b><div class="muted small">Added ${fmtDate(k.created_at)} · last used ${k.last_used_at ? ago(k.last_used_at) : 'never'}${k.backed_up ? ' · synced' : ''}</div></div>
        <button class="btn xs danger right" data-del-key="${k.id}">Revoke</button></div>`)}</div>`,
      onMount: ({ el: m, close }) => on(m, 'click', '[data-del-key]', async (ev, kb) => {
        if (!(await confirmDialog({ title: 'Revoke passkey?', message: 'That device will no longer be able to sign in, and the user is signed out everywhere.', confirm: 'Revoke', danger: true }))) return;
        try { await DEL(`/api/users/${u.id}/passkeys/${encodeURIComponent(kb.dataset.delKey)}`); toast('Passkey revoked.'); close(); await reload(); } catch (err) { fail(err); }
      }),
    });
  });
  on(el, 'click', '[data-revoke]', async (e, b) => {
    try { await DEL(`/api/invites/${encodeURIComponent(b.dataset.revoke)}`); toast('Invite revoked.'); await reload(); } catch (err) { fail(err); }
  });
}

function userForm(u, done) {
  modal({
    title: `Edit @${u.username}`,
    body: html`<form id="uf" class="stack">
      <label class="f"><span>Display name</span><input name="name" value="${u.name}" maxlength="80" required></label>
      <div class="section-label">Role</div>
      ${ROLES.map(([k, l, d]) => html`<label class="pick"><input type="radio" name="role" value="${k}" ${u.role === k ? 'checked' : ''}><b>${l}</b><span class="dim small">${d}</span></label>`)}
      <label class="row"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>
    </form>`,
    footer: html`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go>Save</button>`,
    onMount: ({ el, close }) => on(el, 'click', '[data-go]', async () => {
      const d = formData($('#uf', el));
      d.role = $('[name=role]:checked', el)?.value;
      try { await PUT(`/api/users/${u.id}`, d); toast('User updated.'); close(); await done(); } catch (e) { fail(e); }
    }),
  });
}

export async function settingsView(el) {
  const s = await GET('/api/settings');
  mount(el, html`
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Workspace configuration. Every change is written to the audit trail.</div></div></div>
    <form class="card" id="sf"><div class="card-b form-grid">
      <label class="f full"><span>Organization name</span><input name="org_name" value="${s.org_name}" maxlength="120" required></label>
      <label class="f"><span>Risk appetite <em>(max acceptable residual score, 1–25)</em></span><input type="number" name="risk_appetite" min="1" max="25" value="${s.risk_appetite}"></label>
      <label class="f"><span>Session idle timeout <em>(minutes)</em></span><input type="number" name="session_idle_minutes" min="5" max="240" value="${s.session_idle_minutes}"></label>
    </div><div class="modal-f"><button class="btn primary" type="submit">Save settings</button></div></form>
    ${(state.meta.sample_count || 0) ? html`<div class="card"><div class="card-h"><h3>Sample data</h3></div><div class="card-b row">
      <span class="dim">This workspace still contains ${state.meta.sample_count} sample items created with it.</span><button class="btn danger sm right" id="clear-sample">Remove sample data</button></div></div>` : ''}
    <div class="card"><div class="card-h"><h3>Security & privacy posture of this deployment</h3></div><div class="card-b">
      <ul class="dim">
        <li>Passwordless: sign-in uses passkeys (WebAuthn / FIDO2) with user verification. Only public keys are stored, and biometrics never leave the device.</li>
        <li>Phishing-resistant: passkeys are bound to this site's domain. Signature counters detect cloned authenticators.</li>
        <li>Workspace isolation: every record belongs to one workspace and every query is filtered by it. Joining a workspace requires a one-time invite (stored hashed, 100 bits of entropy, single use, expiring).</li>
        <li>No email addresses, phone numbers or passwords are collected. IP addresses are never written to disk.</li>
        <li>HttpOnly, SameSite=Strict session cookies with idle and 8-hour absolute timeouts and server-side revocation.</li>
        <li>CSRF tokens and Origin verification on every state change. A strict Content-Security-Policy allows no inline or third-party code.</li>
        <li>Role-based access control and separation of duties enforced server-side.</li>
        <li>SHA-256 hash-chained, append-only audit trail with on-demand integrity verification.</li>
        <li>No third-party runtime dependencies, so there is no npm supply-chain exposure.</li>
      </ul>
    </div></div>`);
  $('#clear-sample', el)?.addEventListener('click', async () => {
    const { clearSampleData } = await import('./policies.js');
    clearSampleData(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  });
  $('#sf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await PUT('/api/settings', formData(e.target));
      state.org = r.org_name; state.meta.risk_appetite = r.risk_appetite;
      toast('Settings saved.');
    } catch (err) { fail(err); }
  });
}

export async function accountView(el) {
  const me = state.me;
  let keys = await GET('/api/auth/passkeys');
  const draw = () => mount(el, html`
    <div class="page-head"><div><h1>My account</h1><div class="sub">No email, no password. Your identity is a username plus the passkeys on your devices.</div></div></div>
    <div class="grid g2">
      <div class="card"><div class="card-b"><dl class="kv"><dt>Display name</dt><dd>${me.name}</dd><dt>Username</dt><dd>@${me.username}</dd><dt>Role</dt><dd>${roleName(me.role)}</dd><dt>Last sign-in</dt><dd>${fmtDateTime(me.last_login_at)}</dd></dl></div></div>
      <div class="card"><div class="card-h"><h3>My passkeys</h3><button class="btn sm primary right" id="add">${icon('plus')} Add a passkey</button></div>
        <div class="card-b stack">
          ${keys.map((k) => html`<div class="row"><span class="feat-ic sm">${icon('fingerprint')}</span><div><b>${k.label}</b><div class="muted small">Added ${fmtDate(k.created_at)} · last used ${k.last_used_at ? ago(k.last_used_at) : 'never'}${k.backed_up ? ' · synced across devices' : ''}</div></div>
            <button class="btn xs danger right" data-rm="${k.id}" ${keys.length <= 1 ? 'disabled title="You need at least one passkey"' : ''}>Remove</button></div>`)}
          ${keys.length < 2 ? html`<div class="notice info small">Add a second passkey (for example your phone or a hardware key) so you can still sign in if you lose this device.</div>` : ''}
        </div></div>
    </div>`);
  draw();
  // Prefetched so the passkey prompt runs directly inside the click (Safari requirement).
  const pf = prefetcher(() => POST('/api/auth/passkeys/options'), { anchor: el });
  on(el, 'click', '#add', (e, b) => {
    const opts = pf.take();
    if (!opts) { toast(pf.error()?.message || 'Getting ready… click "Add a passkey" again in a moment.', pf.error() ? 'err' : 'ok'); if (pf.error()) pf.refresh(); return; }
    b.disabled = true;
    createPasskey(opts.publicKey)
      .then((credential) => POST('/api/auth/passkeys/verify', { challengeId: opts.challengeId, credential, label: deviceLabel() }))
      .then(async () => { toast('Passkey added.'); keys = await GET('/api/auth/passkeys'); draw(); })
      .catch((err) => { toast(err instanceof DOMException ? passkeyError(err) : err.message, 'err'); b.disabled = false; })
      .finally(() => pf.refresh());
  });
  on(el, 'click', '[data-rm]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Remove this passkey?', message: 'That device will no longer be able to sign in to MandateGRC.', confirm: 'Remove', danger: true }))) return;
    try { await DEL(`/api/auth/passkeys/${encodeURIComponent(b.dataset.rm)}`); toast('Passkey removed.'); keys = await GET('/api/auth/passkeys'); draw(); } catch (err) { fail(err); }
  });
}
