import { html, mount, $, on, GET, fail, fmtDateTime, icon, download, pill, toast } from '../core.js';

export async function auditView(el) {
  const PAGE = 50;
  let offset = 0, q = '', verify = null, data = await GET(`/api/audit?limit=${PAGE}`);

  const load = async () => { data = await GET(`/api/audit?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(q)}`); drawTable(); };
  const tone = (a) => (/failed|blocked|locked|deleted|retired|rejected/.test(a) ? 'high' : /approved|published|login$|verified/.test(a) ? 'ok' : 'info');

  mount(el, html`
    <div class="page-head">
      <div><h1>Audit trail</h1><div class="sub">Append-only and tamper-evident. Each entry is chained to the previous one with SHA-256, and the database rejects updates and deletes. Verify the chain at any time to prove nothing has been altered.</div></div>
      <div class="actions"><button class="btn" id="csv">${icon('download')} Export CSV</button><button class="btn primary" id="verify">${icon('audit')} Verify integrity</button></div>
    </div>
    <div id="vres"></div>
    <div class="card">
      <div class="card-h"><h3>Events</h3><span class="muted" id="count"></span><div class="right search"><span>${icon('search')}</span><input id="q" placeholder="Filter by user, action, entity" aria-label="Filter audit trail"></div></div>
      <div id="tbl"></div>
      <div class="card-b row"><button class="btn sm" id="prev">← Newer</button><span class="muted small" id="pg"></span><button class="btn sm right" id="next">Older →</button></div>
    </div>`);

  function drawTable() {
    $('#count', el).textContent = `${data.total} events`;
    $('#pg', el).textContent = data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total}` : '';
    $('#prev', el).disabled = offset === 0;
    $('#next', el).disabled = offset + PAGE >= data.total;
    mount($('#tbl', el), data.rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>Hash</th></tr></thead><tbody>
      ${data.rows.map((r) => html`<tr><td class="mono muted">${r.id}</td><td class="nowrap">${fmtDateTime(r.ts)}</td><td><b>${r.username || '—'}</b><br><small class="muted mono">${r.ip || ''}</small></td>
        <td>${pill(tone(r.action), r.action)}</td><td class="mono small">${r.entity || ''} ${r.entity_id || ''}</td>
        <td class="small dim">${r.details ? r.details.slice(0, 160) : ''}</td><td class="hash" title="prev ${r.prev_hash}">${r.hash.slice(0, 12)}…</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><b>No events match</b></div>`);
  }
  drawTable();

  let t;
  $('#q', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; offset = 0; load().catch(fail); }, 250); });
  on(el, 'click', '#prev', () => { offset = Math.max(0, offset - PAGE); load().catch(fail); });
  on(el, 'click', '#next', () => { offset += PAGE; load().catch(fail); });
  on(el, 'click', '#verify', async () => {
    try {
      verify = await GET('/api/audit/verify');
      mount($('#vres', el), verify.ok
        ? html`<div class="notice good">${icon('check')}<div><b>Chain intact.</b> All ${verify.entries} entries verified. Head hash <span class="mono">${verify.head}</span></div></div>`
        : html`<div class="notice bad"><b>Integrity failure.</b> The chain breaks at entry #${verify.brokenAt}. Records from that point may have been altered outside MandateGRC.</div>`);
      load().catch(fail);
    } catch (e) { fail(e); }
  });
  on(el, 'click', '#csv', async () => {
    try {
      const res = await fetch('/api/audit/export', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Export failed');
      download(`mandategrc-audit-${new Date().toISOString().slice(0, 10)}.csv`, await res.text(), 'text/csv');
      toast('Audit trail exported.');
    } catch (e) { fail(e); }
  });
}
