// Documentation centre: step-by-step guides with real screenshots.
// Content lives in docs-content.js (trusted, static HTML strings authored by us, never user data).
import { html, raw, mount, $, $$, on, icon } from './core.js';
import { DOCS, DOC_GROUPS } from './docs-content.js';

const byId = Object.fromEntries(DOCS.map((d) => [d.id, d]));
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = (s) => String(s).replace(/<[^>]+>/g, ' ');

function figure(src, caption) {
  return html`<figure class="shot">
    <button class="shot-btn" data-zoom="${src}" data-cap="${plain(caption || '')}" aria-label="Enlarge screenshot">
      <img src="${src}" alt="${plain(caption || 'Screenshot')}" loading="lazy" decoding="async"><span class="shot-zoom">${icon('search')} Click to enlarge</span>
    </button>${caption ? html`<figcaption>${raw(caption)}</figcaption>` : ''}</figure>`;
}

function block(b) {
  if (b.p) return html`<p>${raw(b.p)}</p>`;
  if (b.h) return html`<h2 id="${slug(b.h)}">${b.h}</h2>`;
  if (b.figure) return figure(b.figure, b.caption);
  if (b.tip) return html`<div class="callout tip"><b>Tip</b><div>${raw(b.tip)}</div></div>`;
  if (b.warn) return html`<div class="callout warn"><b>Important</b><div>${raw(b.warn)}</div></div>`;
  if (b.list) return html`<ul class="doc-list">${b.list.map((i) => html`<li>${raw(i)}</li>`)}</ul>`;
  if (b.code) return html`<pre class="doc-code"><code>${b.code}</code></pre>`;
  if (b.table) return html`<div class="doc-table"><table><thead><tr>${b.table.head.map((h) => html`<th>${h}</th>`)}</tr></thead>
    <tbody>${b.table.rows.map((r) => html`<tr>${r.map((c) => html`<td>${raw(c)}</td>`)}</tr>`)}</tbody></table></div>`;
  if (b.compare) return html`<div class="compare-list">${b.compare.map(([bad, good]) => html`<div class="cmp">
    <div class="cmp-bad"><span>✕ Weak</span>${bad}</div><div class="cmp-good"><span>✓ Strong</span>${good}</div></div>`)}</div>`;
  if (b.faq) return html`<div class="faq">${b.faq.map(([q, a]) => html`<details><summary>${q}</summary><p>${raw(a)}</p></details>`)}</div>`;
  if (b.templates) return html`<div class="tpl-docs">${b.templates.map((t) => html`<div class="tpl-doc">
    <h3>${t.name}</h3><div class="tpl-owner">Owner: ${t.owner}</div>
    <dl><dt>Covers</dt><dd>${t.covers}</dd><dt>Tailor</dt><dd>${t.tailor}</dd><dt>Maps to</dt><dd class="mono-s">${t.fw}</dd></dl></div>`)}</div>`;
  if (b.steps) {
    return html`<ol class="doc-steps">${b.steps.map((s, i) => html`<li class="doc-step">
      <span class="step-badge">${i + 1}</span>
      <div class="step-body"><h3>${s.t}</h3><p>${raw(s.d)}</p>${s.img ? figure(s.img) : ''}</div></li>`)}</ol>`;
  }
  return '';
}

function nav(activeId) {
  return html`<aside class="docs-nav">
    <div class="search docs-search"><span>${icon('search')}</span><input id="doc-q" placeholder="Search the docs" aria-label="Search documentation"></div>
    <div id="doc-results" class="hidden"></div>
    <details class="doc-toc-wrap" id="doc-toc-wrap" open><summary>All guides</summary>
    <nav id="doc-toc" aria-label="Documentation">
      <a class="doc-link ${!activeId ? 'on' : ''}" href="#/docs">Documentation home</a>
      ${DOC_GROUPS.map((g) => html`<div class="doc-group"><div class="doc-group-t">${g}</div>
        ${DOCS.filter((d) => d.group === g).map((d) => html`<a class="doc-link ${d.id === activeId ? 'on' : ''}" href="#/docs/${d.id}">${d.title}</a>`)}</div>`)}
    </nav></details>
  </aside>`;
}

function home() {
  const path = ['create-workspace', 'write-policy', 'review-approve', 'publish', 'attestations'];
  return html`<article class="docs-main">
    <div class="docs-hero">
      <span class="kicker">Documentation</span>
      <h1>Learn MandateGRC, step by step</h1>
      <p class="lead">Illustrated guides for every task, from creating your workspace to publishing audit-ready policies. Every screenshot is taken from the real product.</p>
    </div>
    <h2>Start here</h2>
    <ol class="path">${path.map((id, i) => html`<li><a href="#/docs/${id}"><span class="path-n">${i + 1}</span><span><b>${byId[id].title}</b><small>${byId[id].summary}</small></span>${icon('arrow')}</a></li>`)}</ol>
    ${DOC_GROUPS.map((g) => html`<h2>${g}</h2><div class="doc-cards">${DOCS.filter((d) => d.group === g).map((d) => html`
      <a class="doc-card" href="#/docs/${d.id}"><b>${d.title}</b><span>${d.summary}</span><small>${d.minutes} min read</small></a>`)}</div>`)}
  </article>`;
}

function page(d) {
  const i = DOCS.indexOf(d), prev = DOCS[i - 1], next = DOCS[i + 1];
  const steps = d.blocks.reduce((n, b) => n + (b.steps ? b.steps.length : 0), 0);
  return html`<article class="docs-main">
    <div class="doc-crumbs"><a href="#/docs">Docs</a> / ${d.group}</div>
    <h1>${d.title}</h1>
    <div class="doc-meta">${d.minutes} min read${steps ? html` · ${steps} steps` : ''}</div>
    <p class="lead">${d.summary}</p>
    ${d.blocks.map(block)}
    <div class="doc-pager">
      ${prev ? html`<a class="pager prev" href="#/docs/${prev.id}"><small>← Previous</small><b>${prev.title}</b></a>` : html`<span></span>`}
      ${next ? html`<a class="pager next" href="#/docs/${next.id}"><small>Next →</small><b>${next.title}</b></a>` : html`<span></span>`}
    </div>
  </article>`;
}

function lightbox(src, cap) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog');
  mount(el, html`<figure><img src="${src}" alt="${cap}"><figcaption>${cap}</figcaption></figure><button class="icon-btn lb-close" aria-label="Close">${icon('x')}</button>`);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
}

// Renders the docs into `el`. `embedded` = inside the signed-in app (no fixed public navbar offset).
export function renderDocs(el, id, { embedded = false } = {}) {
  const d = id ? byId[id] : null;
  mount(el, html`<div class="docs ${embedded ? 'embedded' : ''}">${nav(d?.id)}${d ? page(d) : id ? html`<article class="docs-main"><h1>Page not found</h1><p><a href="#/docs">Back to the documentation home</a></p></article>` : home()}</div>`);
  document.title = `${d ? d.title + ' · ' : ''}Docs · MandateGRC`;
  on(el, 'click', '[data-zoom]', (e, b) => lightbox(b.dataset.zoom, b.dataset.cap));
  if (window.innerWidth < 900) $('#doc-toc-wrap', el)?.removeAttribute('open');
  const q = $('#doc-q', el), results = $('#doc-results', el), toc = $('#doc-toc', el);
  const index = DOCS.map((x) => ({ x, text: (x.title + ' ' + x.summary + ' ' + JSON.stringify(x.blocks)).replace(/<[^>]+>/g, ' ').toLowerCase() }));
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    if (!v) { results.classList.add('hidden'); toc.closest('details').classList.remove('hidden'); return; }
    const words = v.split(/\s+/);
    const hits = index.filter((r) => words.every((w) => r.text.includes(w))).map((r) => r.x);
    mount(results, hits.length ? html`<div class="doc-group-t">${hits.length} result${hits.length === 1 ? '' : 's'}</div>${hits.map((h) => html`<a class="doc-link" href="#/docs/${h.id}">${h.title}<small>${h.group}</small></a>`)}`
      : html`<div class="muted small">No guides match “${q.value}”.</div>`);
    results.classList.remove('hidden');
    toc.closest('details').classList.add('hidden');
  });
  if (embedded) el.closest('.main')?.scrollTo(0, 0); else window.scrollTo(0, 0);
}
