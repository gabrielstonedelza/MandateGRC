import { html, mount, on, GET, POST, toast, fail, modal, fmtDate, pill, can } from '../core.js';

export async function attestationsView(el) {
  let data = await GET('/api/attestations');
  const draw = () => {
    const pending = data.mine.filter((p) => !p.attested_at);
    mount(el, html`
      <div class="page-head"><div><h1>Attestations</h1><div class="sub">Each user acknowledges every policy in force. A new version re-opens attestation automatically, so acknowledgements always match the current text.</div></div></div>
      <div class="card" data-tour="mine">
        <div class="card-h"><h3>My acknowledgements</h3><span class="muted">${pending.length} pending of ${data.mine.length}</span></div>
        ${data.mine.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Policy</th><th>Version</th><th>Effective</th><th>Status</th><th></th></tr></thead><tbody>
          ${data.mine.map((p) => html`<tr><td class="title-cell"><b>${p.title}</b><small>${p.code}</small></td><td class="mono">v${p.version}</td><td>${fmtDate(p.effective_date)}</td>
            <td>${p.attested_at ? pill('ok', `Acknowledged ${fmtDate(p.attested_at)}`) : pill('medium', 'Pending')}</td>
            <td class="nowrap"><a class="btn xs" href="#/policies/${p.id}/doc">${p.attested_at ? 'Read' : 'Read & acknowledge'}</a></td></tr>`)}
        </tbody></table></div>` : html`<div class="empty"><b>No policies in force yet</b></div>`}
      </div>
      ${data.stats ? html`<div class="card">
        <div class="card-h"><h3>Organization completion</h3><span class="muted">Active users per policy version</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Policy</th><th>Version</th><th>Completion</th><th>Outstanding</th></tr></thead><tbody>
          ${data.stats.map((s) => html`<tr><td class="title-cell"><b>${s.title}</b><small>${s.code}</small></td><td class="mono">v${s.version}</td>
            <td><div class="row"><div class="bar grow"><i class="${s.rate >= 90 ? 'ok' : s.rate >= 50 ? 'warn' : 'bad'}" data-w="${s.rate}"></i></div><b>${s.rate}%</b><span class="muted small">${s.attested}/${s.total}</span></div></td>
            <td>${s.pending.length ? html`<button class="btn xs" data-pending="${s.id}">${s.pending.length} people</button>` : html`<span class="muted">None</span>`}</td></tr>`)}
        </tbody></table></div></div>` : ''}`);
  };
  draw();
  on(el, 'click', '[data-pending]', (e, b) => {
    const s = data.stats.find((x) => x.id === Number(b.dataset.pending));
    modal({ title: `${s.code}: outstanding acknowledgements`, body: html`<div class="stack">${s.pending.map((u) => html`<div class="row"><b>${u.name}</b><span class="muted small right">${u.role}</span></div>`)}</div>` });
  });
}
