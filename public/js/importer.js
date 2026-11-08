// Policy import: reads an existing policy document entirely in the browser (the file is never
// uploaded), splits it into MandateGRC's 8-part anatomy, detects the policy type, and finds
// framework references. Supports .docx, .pdf (text-based), .md, .txt and .html, or pasted text.
// No third-party libraries: ZIP, DEFLATE (DecompressionStream) and PDF text are handled here.
import { POLICY_TYPES } from './criteria.js';

export const ACCEPT = '.docx,.pdf,.md,.markdown,.txt,.text,.html,.htm';
export const MAX_BYTES = 15 * 1024 * 1024;

// =====================================================================================
// 1. Readers → a flat list of blocks: { t: 'h'|'p'|'li'|'row', text, level?, cells? }
// =====================================================================================
export async function readPolicyFile(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is larger than 15 MB. Export just the policy text, or paste it instead.');
  const name = file.name || 'document';
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isPdf = String.fromCharCode(...buf.subarray(0, 5)) === '%PDF-';
  if (ext === 'docx' || (isZip && ext !== 'pdf')) return { format: 'docx', filename: name, ...(await readDocx(buf)) };
  if (ext === 'pdf' || isPdf) return { format: 'pdf', filename: name, ...(await readPdf(buf)) };
  if (ext === 'doc') throw new Error('Old .doc files are not supported. Open it in Word and "Save As" .docx, then import again.');
  const text = new TextDecoder('utf-8').decode(buf);
  if (ext === 'html' || ext === 'htm' || /^\s*<(!doctype|html)/i.test(text)) return { format: 'html', filename: name, blocks: readHtml(text) };
  if (ext === 'md' || ext === 'markdown') return { format: 'markdown', filename: name, blocks: readMarkdown(text) };
  return { format: 'text', filename: name, blocks: readPlainText(text) };
}

export function readPastedText(text) {
  const looksMd = /^#{1,6}\s|\n#{1,6}\s/.test(text);
  return { format: 'paste', filename: 'Pasted text', blocks: looksMd ? readMarkdown(text) : readPlainText(text) };
}

const clean = (s) => String(s || '').normalize('NFKC').replace(/[   ]/g, ' ').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

// ---------- Markdown ----------
function readMarkdown(text) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', text: clean(para.join(' ')) }); para = []; } };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__|`/g, '');
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) { flush(); out.push({ t: 'h', level: m[1].length, text: clean(m[2].replace(/#+\s*$/, '')) }); continue; }
    if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // table separator
    if (/^\s*\|.*\|\s*$/.test(line)) { flush(); out.push({ t: 'row', cells: line.trim().replace(/^\||\|$/g, '').split('|').map(clean) }); continue; }
    if ((m = /^\s*(?:[-*+•]|\d+[.)]|[a-z][.)])\s+(.*)$/i.exec(line))) { flush(); out.push({ t: 'li', text: clean(m[1]) }); continue; }
    // "Owner: CISO" style metadata lines are their own block, even without blank lines between them.
    if (/^\s*[A-Za-z][A-Za-z /&()-]{1,40}:\s+\S/.test(line) && line.length < 160) { flush(); out.push({ t: 'p', text: clean(line) }); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}

// ---------- Plain text (also used for PDF lines) ----------
function readPlainText(text) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', text: clean(para.join(' ')) }); para = []; } };
  const lines = text.split(/\r?\n/);
  // Typical full line length: a line well short of it, followed by a capitalised line, ends an item.
  const lens = lines.map((l) => clean(l).length).filter((n) => n > 20).sort((a, b) => a - b);
  const wrap = lens[Math.floor(lens.length * 0.9)] || 80;
  lines.forEach((raw, i) => {
    if (raw.startsWith('\u0001')) { flush(); const h = clean(raw.slice(1)); if (h) out.push({ t: 'h', level: 2, text: h }); return; }
    if (raw.includes('\t')) { flush(); const cells = raw.split('\t').map(clean); if (cells.some(Boolean)) out.push({ t: 'row', cells }); return; }
    const line = clean(raw);
    if (!line) { flush(); return; }
    const bullet = /^(?:[-*•▪◦●–]|\(?[a-z]\)|\(?[ivx]+\))\s+(.*)$/i.exec(line);
    const numbered = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(.*)$/.exec(line); // 4.1 / 4.1.2 → a numbered clause
    if (looksLikeHeading(line, lines[i + 1])) { flush(); out.push({ t: 'h', level: 2, text: line }); return; }
    if (bullet) { flush(); out.push({ t: 'li', text: bullet[1] }); return; }
    if (numbered) { flush(); out.push({ t: 'li', text: numbered[2] }); return; }
    const prev = para[para.length - 1];
    if (prev && prev.length < wrap * 0.6 && /^[A-Z0-9"“(]/.test(line) && !/[,(-]$/.test(prev)) flush();
    if (/[.:;]$/.test(line) || para.length) { para.push(line); if (/[.:;]$/.test(line)) flush(); return; }
    para.push(line);
  });
  flush();
  return out;
}

function looksLikeHeading(line, next = '') {
  if (line.length > 70 || /[.;,]$/.test(line)) return false;
  if (/^\d{1,2}(\.0)?[.)]?\s+[A-Z][A-Za-z&/,' -]{2,60}$/.test(line)) return true; // "1. Purpose", "2.0 Scope"
  if (/^(section|article|part)\s+\d+/i.test(line)) return true;
  if (classifyHeading(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && line.split(/\s+/).length <= 8) return true; // ALL CAPS
  return false;
}

// ---------- HTML (parsed inertly: DOMParser never runs scripts) ----------
function readHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const out = [];
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'template', 'nav', 'footer'].includes(tag)) continue;
      if (/^h[1-6]$/.test(tag)) out.push({ t: 'h', level: Number(tag[1]), text: clean(el.textContent) });
      else if (tag === 'li') out.push({ t: 'li', text: clean(el.textContent) });
      else if (tag === 'tr') out.push({ t: 'row', cells: [...el.children].map((c) => clean(c.textContent)) });
      else if (tag === 'p' || tag === 'dt' || tag === 'dd' || tag === 'blockquote') out.push({ t: 'p', text: clean(el.textContent) });
      else walk(el);
    }
  };
  walk(doc.body || doc.documentElement);
  return out.filter((b) => b.text || b.cells?.some(Boolean));
}

// ---------- DOCX: a ZIP archive containing word/document.xml ----------
async function inflate(bytes, format) {
  const ds = new DecompressionStream(format);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This .docx file looks damaged (no ZIP directory).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = buf.subarray(start, start + f.csize);
    if (f.method === 0) return data;
    if (f.method === 8) return inflate(data, 'deflate-raw');
    throw new Error('Unsupported compression in this .docx file.');
  };
}

async function readDocx(buf) {
  const read = await unzip(buf);
  const xml = await read('word/document.xml');
  if (!xml) throw new Error('This file is not a Word document (word/document.xml is missing).');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read this Word document.');
  // Map custom style ids (e.g. "a1") to their names ("heading 1") so localized/custom templates work.
  const styleNames = {};
  const stylesXml = await read('word/styles.xml');
  if (stylesXml) {
    const sd = new DOMParser().parseFromString(new TextDecoder().decode(stylesXml), 'application/xml');
    for (const st of sd.getElementsByTagName('w:style')) {
      const id = st.getAttribute('w:styleId'), nm = st.getElementsByTagName('w:name')[0]?.getAttribute('w:val');
      if (id && nm) styleNames[id] = nm;
    }
  }
  let title = '';
  const core = await read('docProps/core.xml');
  if (core) title = clean(new DOMParser().parseFromString(new TextDecoder().decode(core), 'application/xml').getElementsByTagName('dc:title')[0]?.textContent);

  const textOf = (el) => {
    let s = '';
    const visit = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') s += c.textContent;
        else if (ln === 'tab') s += ' ';
        else if (ln === 'br' || ln === 'cr') s += ' ';
        else if (ln === 'delText' || ln === 'instrText' || ln === 'fldChar') continue;
        else if (ln === 'del') continue; // tracked deletions are not part of the text
        else visit(c);
      }
    };
    visit(el);
    return clean(s);
  };
  const out = [];
  const body = doc.getElementsByTagName('w:body')[0];
  const para = (p) => {
    const text = textOf(p);
    if (!text) return;
    const pPr = [...p.childNodes].find((c) => c.localName === 'pPr');
    const styleId = pPr ? [...pPr.childNodes].find((c) => c.localName === 'pStyle')?.getAttribute('w:val') : null;
    const styleName = (styleNames[styleId] || styleId || '').toLowerCase();
    const outline = pPr ? [...pPr.childNodes].find((c) => c.localName === 'outlineLvl')?.getAttribute('w:val') : null;
    const isList = pPr && ([...pPr.childNodes].some((c) => c.localName === 'numPr') || /list/.test(styleName));
    let m;
    if (styleName === 'title') { out.push({ t: 'h', level: 0, text }); if (!title) title = text; return; }
    if ((m = /heading\s*(\d)/.exec(styleName)) || outline != null) { out.push({ t: 'h', level: m ? Number(m[1]) : Number(outline) + 1, text }); return; }
    // Short, fully bold paragraphs are used as headings in many policies.
    const runs = [...p.getElementsByTagName('w:r')].filter((r) => clean(r.textContent));
    const allBold = runs.length && runs.every((r) => r.getElementsByTagName('w:b').length && r.getElementsByTagName('w:b')[0].getAttribute('w:val') !== '0');
    if (allBold && text.length <= 80 && !/[.;,]$/.test(text) && !isList) { out.push({ t: 'h', level: 3, text }); return; }
    out.push({ t: isList ? 'li' : 'p', text });
  };
  const walk = (node) => {
    for (const el of node.childNodes) {
      if (el.nodeType !== 1) continue;
      if (el.localName === 'p') para(el);
      else if (el.localName === 'tbl') {
        for (const tr of [...el.childNodes].filter((c) => c.localName === 'tr')) {
          const cells = [...tr.childNodes].filter((c) => c.localName === 'tc').map(textOf);
          if (cells.some(Boolean)) out.push({ t: 'row', cells });
        }
      } else if (el.localName === 'sdt' || el.localName === 'sdtContent' || el.localName === 'customXml') walk(el);
    }
  };
  walk(body);
  return { blocks: out, title };
}

// ---------- PDF: best-effort text extraction (text-based PDFs, not scans) ----------
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return s; };

async function readPdf(buf) {
  const src = latin1(buf);
  const objs = new Map(); // num -> { dict, stream? (Uint8Array, decoded) }
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[3];
    const si = body.indexOf('stream');
    if (si >= 0 && /^[\s\S]*>>\s*$/.test(body.slice(0, si))) {
      const dict = body.slice(0, si);
      let start = m.index + m[0].indexOf(body) + si + 6;
      if (src[start] === '\r') start++;
      if (src[start] === '\n') start++;
      const end = src.indexOf('endstream', start);
      let raw = buf.subarray(start, end);
      while (raw.length && (raw[raw.length - 1] === 10 || raw[raw.length - 1] === 13)) raw = raw.subarray(0, raw.length - 1);
      objs.set(Number(m[1]), { dict, raw });
    } else objs.set(Number(m[1]), { dict: body });
  }
  const decode = async (o) => {
    if (!o?.raw) return '';
    if (o.text != null) return o.text;
    let data = o.raw;
    if (/\/FlateDecode/.test(o.dict)) { try { data = await inflate(data, 'deflate'); } catch { data = new Uint8Array(); } }
    else if (/\/Filter/.test(o.dict) && !/\/FlateDecode/.test(o.dict)) data = new Uint8Array(); // unsupported filter (images etc.)
    o.text = latin1(data);
    return o.text;
  };
  // Objects packed inside object streams (PDF 1.5+).
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const s = await decode(o);
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] || 0), first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const nums = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const num = nums[2 * k], off = nums[2 * k + 1], next = k + 1 < n ? nums[2 * k + 3] : s.length - first;
      if (!objs.has(num)) objs.set(num, { dict: s.slice(first + off, first + next) });
    }
  }
  const ref = (str) => { const r = /^\s*(\d+)\s+\d+\s+R/.exec(str || ''); return r ? Number(r[1]) : null; };
  const dictOf = (v) => { const n = ref(v); return n != null ? objs.get(n)?.dict || '' : v; };
  const subDict = (dict, key) => {
    const i = dict.search(new RegExp('/' + key + '\\b'));
    if (i < 0) return '';
    let rest = dict.slice(i + key.length + 1).trimStart();
    if (/^\d+\s+\d+\s+R/.test(rest)) return dictOf(rest);
    if (!rest.startsWith('<<')) return '';
    let depth = 0;
    for (let j = 0; j < rest.length; j++) {
      if (rest.startsWith('<<', j)) { depth++; j++; } else if (rest.startsWith('>>', j)) { depth--; j++; if (!depth) return rest.slice(0, j + 1); }
    }
    return rest;
  };
  // Fonts → ToUnicode maps.
  const cmapCache = new Map();
  const cmapFor = async (fontNum) => {
    if (cmapCache.has(fontNum)) return cmapCache.get(fontNum);
    const fd = objs.get(fontNum)?.dict || '';
    const tu = ref(/\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(fd)?.[1]);
    let map = null;
    if (tu != null) map = parseCMap(await decode(objs.get(tu)));
    // Glyph widths let us tell a word break from a word split across runs.
    const widths = new Map();
    let dw = 500;
    const arrayAt = (dict, key) => {
      const i = dict.search(new RegExp('/' + key + '\\s*(\\[|\\d+\\s+\\d+\\s+R)'));
      if (i < 0) return '';
      let rest = dict.slice(i + key.length + 1).trimStart();
      if (!rest.startsWith('[')) rest = (objs.get(ref(rest))?.dict || '').trim();
      let depth = 0;
      for (let j = 0; j < rest.length; j++) { if (rest[j] === '[') depth++; else if (rest[j] === ']' && !--depth) return rest.slice(1, j); }
      return '';
    };
    const type0 = /\/Subtype\s*\/Type0/.test(fd);
    if (type0) {
      const descRef = ref(/\/DescendantFonts\s*\[\s*(\d+\s+\d+\s+R)/.exec(fd)?.[1]);
      const dd = descRef != null ? objs.get(descRef)?.dict || '' : (/\/DescendantFonts\s*\[([\s\S]*?)\]\s*(\/|>>)/.exec(fd)?.[1] || '');
      dw = Number(/\/DW\s+(\d+)/.exec(dd)?.[1] || 1000);
      const toks = arrayAt(dd, 'W').match(/\[[^\]]*\]|-?\d+\.?\d*/g) || [];
      for (let k = 0; k < toks.length;) {
        const c = Number(toks[k]);
        if (toks[k + 1]?.startsWith('[')) { toks[k + 1].slice(1, -1).trim().split(/\s+/).filter(Boolean).forEach((w, n) => widths.set(c + n, Number(w))); k += 2; }
        else { const hi = Number(toks[k + 1]), w = Number(toks[k + 2]); for (let cc = c; cc <= hi && cc - c < 65536; cc++) widths.set(cc, w); k += 3; }
      }
    } else {
      const first = Number(/\/FirstChar\s+(\d+)/.exec(fd)?.[1] || 0);
      arrayAt(fd, 'Widths').trim().split(/\s+/).filter(Boolean).forEach((w, n) => widths.set(first + n, Number(w)));
      if (!widths.size) dw = 500;
    }
    const info = { map, type0, widths, dw, bold: /Bold|Black|Heavy|Semibold/i.test(/\/BaseFont\s*\/([^\s/>]+)/.exec(fd)?.[1] || '') };
    cmapCache.set(fontNum, info);
    return info;
  };
  // Pages in document order (follow the page tree from the catalog).
  const pages = [];
  const rootNum = ref(/\/Root\s+(\d+\s+\d+\s+R)/.exec(src)?.[1]) ?? [...objs].find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict))?.[0];
  const visit = (num, depth = 0, inherited = '') => {
    const d = objs.get(num)?.dict || '';
    if (depth > 30) return;
    const res = /\/Resources/.test(d) ? subDict(d, 'Resources') : inherited;
    if (/\/Type\s*\/Pages/.test(d)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(d)?.[1] || '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(k[1]), depth + 1, res);
    } else if (/\/Type\s*\/Page\b/.test(d)) pages.push({ dict: d, res });
  };
  const pagesNum = ref(/\/Pages\s+(\d+\s+\d+\s+R)/.exec(objs.get(rootNum)?.dict || '')?.[1]);
  if (pagesNum != null) visit(pagesNum);
  if (!pages.length) for (const [, o] of objs) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict, res: subDict(o.dict, 'Resources') });

  const lines = [];
  for (const pg of pages) {
    const fontDict = subDict(pg.res, 'Font');
    const fonts = {};
    for (const f of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) fonts[f[1]] = await cmapFor(Number(f[2]));
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(pg.dict)?.[1] || /\/Contents\s+(\d+\s+\d+\s+R)/.exec(pg.dict)?.[1] || '';
    let text = '';
    for (const c of contents.matchAll(/(\d+)\s+\d+\s+R/g)) text += (await decode(objs.get(Number(c[1])))) + '\n';
    extractPdfText(text, fonts, lines, pages.indexOf(pg));
  }
  // Remove repeated running headers/footers and page numbers.
  const freq = new Map();
  lines.forEach((l) => freq.set(l.text, (freq.get(l.text) || 0) + 1));
  const kept = lines.filter((l) => !(pages.length > 2 && freq.get(l.text) >= Math.max(3, pages.length * 0.6)) && !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text));
  if (!kept.length) throw new Error('No text could be extracted from this PDF. It may be a scanned image. Export it from the original document as .docx, or paste the text instead.');
  // Cells that share a baseline (tables) become one tab-separated row.
  const merged = [];
  for (const l of kept) {
    const prev = merged[merged.length - 1];
    if (prev && l.page === prev.page && l.y != null && prev.y != null && Math.abs(l.y - prev.y) < 1 && l.x != null && prev.x != null && l.x > prev.x + 1) {
      prev.cells.push(l.text); prev.size = Math.max(prev.size, l.size);
    } else merged.push({ ...l, cells: [l.text] });
  }
  // Font size (or bold, short, unpunctuated lines) tells headings apart from body text.
  const sizes = merged.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  const text = merged.map((l) => {
    if (l.cells.length > 1) return l.cells.join('\t');
    const heading = l.size >= body * 1.12 || (l.bold && l.text.length < 70 && !/[.;,]$/.test(l.text));
    return heading ? '\u0001' + l.text : l.text;
  }).join('\n');
  return { blocks: readPlainText(text) };
}

function parseCMap(s) {
  const map = new Map();
  let bytes = 1;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(s);
  if (cs) bytes = cs[1].length / 2;
  const hexToStr = (h) => { let out = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return out; };
  for (const sec of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of sec[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2].padStart(4, '0')));
  }
  for (const sec of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of sec[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3].startsWith('[')) {
        [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, k) => map.set(lo + k, hexToStr(x[1].padStart(4, '0'))));
      } else {
        const base = parseInt(m[3].slice(1, -1), 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
  }
  return { map, bytes };
}

function extractPdfText(content, fonts, lines, page) {
  let font = null, size = 10, scale = 1, y = null, x = null, cur = '', curSize = 10, curBold = false, curX = null, curY = null;
  let ctm = 1; const ctmStack = [];
  const push = () => { const t = clean(cur); if (t) lines.push({ text: t, size: curSize, bold: curBold, page, x: curX, y: curY }); cur = ''; };
  const startRun = () => { if (!cur) { curSize = size * scale * ctm; curBold = !!font?.bold; curX = x; curY = y; } };
  let runW = 0; // width (text-space units) shown since the last positioning operator
  const decodeStr = (bytes) => {
    const cm = font?.map;
    const step = cm?.map?.size ? cm.bytes : font?.type0 ? 2 : 1;
    let s = '', w = 0;
    for (let i = 0; i < bytes.length; i += step) {
      const code = step === 2 ? (bytes[i] << 8) | (bytes[i + 1] ?? 0) : bytes[i];
      s += cm?.map?.size ? (cm.map.get(code) ?? '') : String.fromCharCode(code); // else WinAnsi ≈ Latin-1
      w += font?.widths?.get(code) ?? font?.dw ?? 500;
    }
    runW += (w / 1000) * size;
    return s;
  };
  const stack = [];
  let i = 0;
  const n = content.length;
  const lineBreak = (newY) => { if (y != null && newY != null && Math.abs(newY - y) > 0.5) push(); };
  while (i < n) {
    const ch = content[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < n && content[i] !== '\n' && content[i] !== '\r') i++; continue; }
    if (ch === '(') { // literal string
      let depth = 1, j = i + 1; const bytes = [];
      while (j < n && depth) {
        const c = content[j];
        if (c === '\\') {
          const nx = content[j + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }[nx];
          if (esc != null) { bytes.push(esc); j += 2; continue; }
          if (/[0-7]/.test(nx)) { const o = /^[0-7]{1,3}/.exec(content.slice(j + 1, j + 4))[0]; bytes.push(parseInt(o, 8) & 255); j += 1 + o.length; continue; }
          j += 2; continue;
        }
        if (c === '(') depth++;
        if (c === ')') { depth--; if (!depth) break; }
        bytes.push(c.charCodeAt(0) & 255); j++;
      }
      stack.push({ str: bytes }); i = j + 1; continue;
    }
    if (ch === '<' && content[i + 1] !== '<') { // hex string
      const j = content.indexOf('>', i);
      const hex = content.slice(i + 1, j).replace(/\s+/g, '');
      const bytes = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt((hex.slice(k, k + 2) + '0').slice(0, 2), 16));
      stack.push({ str: bytes }); i = j + 1; continue;
    }
    if (ch === '[') { stack.push({ mark: '[' }); i++; continue; }
    if (ch === ']') {
      const arr = [];
      while (stack.length && !stack[stack.length - 1].mark) arr.unshift(stack.pop());
      stack.pop(); stack.push({ arr }); i++; continue;
    }
    if (ch === '<' || ch === '>') { i += 2; continue; } // dictionaries inside content (rare): skip markers
    const tok = /^[^\s()<>[\]{}/%]+|^\/[^\s()<>[\]{}/%]*/.exec(content.slice(i, i + 64))?.[0] || content[i];
    i += tok.length;
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok)) { stack.push({ num: Number(tok) }); continue; }
    if (tok.startsWith('/')) { stack.push({ name: tok.slice(1) }); continue; }
    const nums = () => stack.filter((x) => x.num != null).map((x) => x.num);
    switch (tok) {
      case 'q': ctmStack.push(ctm); break;
      case 'Q': ctm = ctmStack.pop() ?? 1; break;
      case 'cm': { const a = nums(); ctm *= Math.hypot(a[0] || 1, a[1] || 0) || 1; break; }
      case 'BT': y = null; x = null; break;
      case 'ET': push(); break;
      case 'Tf': { const nm = stack.filter((x) => x.name)[0]?.name; font = fonts[nm] || null; size = nums().pop() || size; break; }
      case 'Tm': { const a = nums(); scale = Math.hypot(a[0] || 1, a[1] || 0) || 1; lineBreak(a[5]); y = a[5]; if (!cur) x = a[4]; runW = 0; break; }
      case 'Td': case 'TD': {
        const a = nums(); const dx = a[0] || 0, dy = a[1] || 0;
        if (Math.abs(dy) > 0.5) { push(); y = (y ?? 0) + dy; x = (x ?? 0) + dx; }
        else { if (cur && dx - runW > size * 0.15 && !/\s$/.test(cur)) cur += ' '; x = (x ?? 0) + dx; }
        runW = 0;
        break;
      }
      case 'T*': push(); runW = 0; break;
      case "'": case '"': push(); // fall through: show text
      // eslint-disable-next-line no-fallthrough
      case 'Tj': { const s = stack.filter((e) => e.str).pop(); if (s) { startRun(); cur += decodeStr(s.str); } break; }
      case 'TJ': {
        const a = stack.filter((e) => e.arr).pop()?.arr || [];
        startRun();
        const parts = a.map((el) => (el.str ? decodeStr(el.str) : el.num));
        // If the text carries real spaces, offsets are only kerning; otherwise a large gap is a word break.
        const explicitSpaces = parts.some((p) => typeof p === 'string' && p.includes(' '));
        for (const p of parts) {
          if (typeof p === 'string') cur += p;
          else if (p != null) { runW -= (p / 1000) * size; if (p < (explicitSpaces ? -900 : -200)) cur += ' '; }
        }
        break;
      }
      default: break;
    }
    if (!/^[-+]?\d|^\//.test(tok)) stack.length = 0;
  }
  push();
}

// =====================================================================================
// 2. Analysis → anatomy, metadata, type, references
// =====================================================================================
const SECTION_RULES = [
  ['history', /^(revision|version|document|change|amendment)s?\s*(history|control|log|record)|^document (information|details|properties)|^(approval|sign[- ]?off)s?\b|^version\b/i],
  ['definitions', /^(definitions?|glossary|terms( and definitions)?|key terms|abbreviations|acronyms)\b/i],
  ['purpose', /^(policy\s+)?(purpose|objectives?|introduction|overview|background|aim|intent|rationale|policy statement of intent)\b/i],
  ['scope', /^(policy\s+)?(scope|applicability|application|who (this|the) policy applies to|coverage)\b/i],
  ['roles', /\b(roles?|responsibilit(y|ies)|accountabilit(y|ies)|ownership)\b/i],
  ['enforcement', /\b(compliance|enforcement|violations?|sanctions?|non-?compliance|disciplinary|exceptions?|waivers?|breach(es)? of (this )?policy|monitoring)\b/i],
  ['references', /^(references?|related (documents?|policies|standards|procedures)|supporting documents?|regulatory( requirements)?|legal (and|&) regulatory|frameworks?|standards and regulations|applicable (laws|regulations|standards)|appendi(x|ces))\b/i],
  ['statements', /^(the\s+)?(policy( statements?| requirements?| details| provisions| rules)?|requirements?|policy rules|rules|standards?|controls?|guidelines|procedures?)\b/i],
  ['contact', /^(contacts?|questions|further information|enquiries)\b/i],
];
const stripNum = (s) => clean(s).replace(/^(section|article|part)\s+\d+[.:)]?\s*/i, '').replace(/^\(?\d{1,2}(\.\d{1,2})*[.):]?\s+|^[A-Z][.)]\s+|^[ivx]+[.)]\s+/i, '').replace(/[:.]\s*$/, '');

export function classifyHeading(text) {
  const t = stripNum(text);
  if (t.length > 80) return null;
  for (const [key, re] of SECTION_RULES) if (re.test(t)) return key;
  return null;
}

const MODAL = /\b(must|shall|should|will|may|is required|are required|is prohibited|are prohibited|is not permitted|are not permitted|need to|needs to|have to|has to|is responsible|are responsible|ensure)\b/i;
const stripBullet = (s) => clean(s).replace(/^(?:[-*•▪◦●–]|\(?[a-z]\)|\(?[ivx]+\)|\d{1,2}(?:\.\d{1,2}){0,3}[.)]?)\s+/i, '');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = (w) => MONTHS[w.slice(0, 4).toLowerCase()] || MONTHS[w.slice(0, 3).toLowerCase()] || null;
function toIsoDate(v) {
  const s = clean(v).replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  const iso = (y, mo, d) => (y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  let m;
  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/i.exec(s)) && monthOf(m[2])) return iso(+m[3], monthOf(m[2]), +m[1]);
  if ((m = /([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(s)) && monthOf(m[1])) return iso(+m[3], monthOf(m[1]), +m[2]);
  if ((m = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s))) {
    const a = +m[1], b = +m[2];
    return b > 12 ? iso(+m[3], a, b) : iso(+m[3], b, a); // day/month unless that is impossible
  }
  return null;
}
function toCycle(v) {
  const s = v.toLowerCase();
  if (/semi-?annual|twice a year|every 6 months|6 months|six months|bi-?annual(?!ly)/.test(s)) return 6;
  if (/quarter|every 3 months|3 months|three months/.test(s)) return 3;
  if (/every (2|two) years|biennial|24 months/.test(s)) return 24;
  if (/every (3|three) years|36 months/.test(s)) return 36;
  if (/18 months/.test(s)) return 18;
  if (/annual|yearly|every year|12 months|twelve months|once a year/.test(s)) return 12;
  return null;
}
const META = [
  ['owner', /^(?:policy|document|process|business)?\s*owner(?:ship)?|^owned by|^policy (?:custodian|sponsor)|^responsible (?:executive|officer|person|owner)|^author(?:ity)?\b/i],
  ['effective_date', /^effective(?: from| date)?|^date (?:of )?(?:issue|effect)|^issue date|^issued|^publication date|^approved (?:on|date)|^date approved/i],
  ['review', /^(?:next )?review(?: cycle| frequency| period| schedule| date)?|^review(?:ed)? (?:every|annually)/i],
  ['classification', /^(?:data |information )?(?:classification|sensitivity|security classification)/i],
  ['version', /^(?:document |policy )?version(?: number| no\.?)?|^revision\b|^rev\.?\b/i],
  ['title', /^(?:policy|document) (?:name|title)|^title\b/i],
];

export function analyzePolicy(read, { controls = [] } = {}) {
  const warnings = [];
  const blocks = (read.blocks || []).map((b) => (b.cells ? { ...b, cells: b.cells.map(clean) } : { ...b, text: clean(b.text) })).filter((b) => b.text || b.cells?.some(Boolean));
  const meta = {};
  const takeMeta = (label, value) => {
    const l = stripNum(label);
    for (const [key, re] of META) {
      if (!re.test(l) || !clean(value) || meta[key]) continue;
      meta[key] = clean(value);
      return true;
    }
    return false;
  };
  // Title: document title property, first top-level heading, or first line naming a policy.
  let title = clean(read.title || '');
  const sections = { purpose: [], scope: [], statements: [], roles: [], enforcement: [], references: [], definitions: [], history: [], contact: [] };
  const found = {}; // section → original heading text
  const unrecognized = [];
  let current = null, topic = '', firstHeadingSeen = false;

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    // A bare label paragraph followed by its value (tables flattened into paragraphs by some exporters).
    const nextB = blocks[bi + 1];
    if (b.t === 'p' && nextB && nextB.t === 'p' && b.text.length <= 30 && !/[.:;,]$/.test(b.text) && (!current || current === 'history')
      && META.some(([, re]) => re.test(stripNum(b.text)) && new RegExp(re.source + '\\s*$', 'i').test(stripNum(b.text))) && nextB.text.length <= 120
      && takeMeta(b.text, nextB.text)) { bi++; continue; }
    // Metadata as "Label: value" lines or two-cell table rows.
    if (b.cells && b.cells.filter(Boolean).length === 2 && current !== 'roles' && takeMeta(b.cells[0], b.cells[1])) continue;
    const kv = b.text && /^([A-Za-z][A-Za-z /&()-]{1,40}?)\s*[:–—|]\s+(.{1,160})$/.exec(b.text);
    if (kv && (!current || current === 'history' || META.some(([, re]) => re.test(kv[1]))) && takeMeta(kv[1], kv[2])) continue;

    if (b.t === 'h' || (b.t !== 'row' && b.text && b.text.length < 60 && classifyHeading(b.text) && !/[.;]$/.test(b.text) && !MODAL.test(b.text))) {
      const key = classifyHeading(b.text);
      if (!title && (b.level === 0 || b.level === 1 || /\bpolicy\b/i.test(b.text)) && !key) { title = stripNum(b.text); continue; }
      firstHeadingSeen = true;
      if (key) { current = key; topic = ''; if (!found[key]) found[key] = stripNum(b.text); continue; }
      // An unknown heading: a sub-topic of the policy rules (e.g. "Passwords", "Remote access").
      if (!current || ['statements', 'purpose', 'scope', 'definitions', 'contact'].includes(current)) {
        if (current !== 'statements' && !found.statements) found.statements = stripNum(b.text);
        current = 'statements';
      }
      if (current === 'statements') { topic = stripNum(b.text); unrecognized.push(topic); }
      else if (current === 'roles') sections.roles.push({ head: stripNum(b.text) });
      continue;
    }
    if (!title && /\bpolicy\b/i.test(b.text || '') && (b.text || '').length < 90 && !MODAL.test(b.text)) { title = stripNum(b.text); continue; }
    // Content before any heading: a purpose-like opening paragraph.
    if (!current) {
      if (!firstHeadingSeen && b.t === 'p' && /\b(purpose|this policy|aims? to|in order to|establish)/i.test(b.text) && !sections.purpose.length) { sections.purpose.push(b); found.purpose = found.purpose || '(opening paragraph)'; }
      else if (b.text && MODAL.test(b.text)) { current = 'statements'; found.statements = found.statements || '(untitled)'; sections.statements.push({ ...b, topic }); }
      continue;
    }
    sections[current].push({ ...b, topic });
  }

  // ---- Purpose, scope, enforcement, references (prose sections) ----
  const prose = (arr) => arr.map((b) => (b.cells ? b.cells.filter(Boolean).join(' — ') : b.t === 'li' ? '• ' + stripBullet(b.text) : b.text)).join('\n\n').replace(/\n\n• /g, '\n• ').slice(0, 5000);
  const purpose = prose(sections.purpose);
  let scope = prose(sections.scope);
  // Scope is sometimes written inside the purpose ("This policy applies to …").
  if (!scope) {
    const s = sections.purpose.map((b) => b.text).join(' ').match(/[^.]*\b(applies to|applicable to)\b[^.]*\./i);
    if (s) { scope = clean(s[0]); found.scope = found.scope || '(found in purpose)'; }
  }
  const enforcement = prose(sections.enforcement);

  // ---- Statements: one rule each ----
  const statements = [];
  const addStmt = (text, topicLabel) => {
    let t = stripBullet(text);
    if (!t || t.length < 4) return;
    // Short list items under a topic heading need the topic for context: "Passwords: minimum 14 characters".
    if (topicLabel && t.split(/\s+/).length <= 12 && !new RegExp('\\b' + topicLabel.split(/\s+/)[0].replace(/[^\w]/g, ''), 'i').test(t) && !/^(all|each|every|the|users?|employees?|staff|personnel)\b/i.test(t)) t = `${topicLabel}: ${t}`;
    statements.push(t.slice(0, 2000));
  };
  for (const b of sections.statements) {
    if (b.cells) { const c = b.cells.filter(Boolean); if (c.length && !/^(requirement|control|rule|#|no\.?)$/i.test(c[0])) addStmt(c.join(' — '), b.topic); continue; }
    if (b.t === 'li') { addStmt(b.text, b.topic); continue; }
    // A paragraph: each sentence with an obligation starts a statement; follow-on sentences stay with it.
    const sentences = b.text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
    let curStmt = '';
    for (const s of sentences.map(clean).filter(Boolean)) {
      if (MODAL.test(s) && curStmt) { addStmt(curStmt, b.topic); curStmt = s; } else curStmt = curStmt ? `${curStmt} ${s}` : s;
    }
    if (curStmt) addStmt(curStmt, b.topic);
  }
  if (statements.length > 200) { warnings.push(`The document has ${statements.length} policy statements; only the first 200 were imported.`); statements.length = 200; }

  // ---- Roles ----
  const roles = [];
  let pendingRole = null;
  for (const b of sections.roles) {
    if (b.head) { pendingRole = { role: b.head, responsibility: '' }; roles.push(pendingRole); continue; }
    if (b.cells) {
      const c = b.cells.filter(Boolean);
      if (c.length >= 2 && !/^(role|title|position|stakeholder)s?$/i.test(c[0])) roles.push({ role: c[0].slice(0, 120), responsibility: c.slice(1).join(' ').slice(0, 1000) });
      continue;
    }
    const text = stripBullet(b.text);
    const m = /^([A-Z][A-Za-z ,&/()'-]{1,80}?)\s*[:–—]\s+(.+)$/.exec(text) || /^([A-Z][A-Za-z ,&/()'-]{1,60}?)\s+-\s+(.+)$/.exec(text);
    if (m) { roles.push({ role: m[1], responsibility: m[2] }); pendingRole = null; continue; }
    const subj = /^(?:the\s+)?([A-Z][A-Za-z &/()'-]{1,60}?)\s+(?:is|are|shall be|will be|must be)\s+(?:responsible|accountable)\b/.exec(text) || /^(?:the\s+)?([A-Z][A-Za-z &/()'-]{1,60}?)\s+(?:must|shall|will)\b/.exec(text);
    if (subj && subj[1].split(/\s+/).length <= 7) { roles.push({ role: subj[1], responsibility: text }); pendingRole = null; continue; }
    // A short, unpunctuated line is a role name; the text after it is that role's responsibility.
    if (b.t !== 'li' && text.split(/\s+/).length <= 6 && /^[A-Z]/.test(text) && !/[.;:,]$/.test(text)) {
      if (/^(roles?|responsibilit(y|ies)|title|position)$/i.test(text)) continue; // table header flattened
      pendingRole = { role: text, responsibility: '' }; roles.push(pendingRole); continue;
    }
    if (pendingRole) pendingRole.responsibility = clean(`${pendingRole.responsibility} ${text}`).slice(0, 1000);
    else if (roles.length) roles[roles.length - 1].responsibility = clean(`${roles[roles.length - 1].responsibility} ${text}`).slice(0, 1000);
  }
  const cleanRoles = roles.filter((r) => r.role && !/^(roles?|responsibilit(y|ies))$/i.test(r.role)).map((r) => ({ role: clean(r.role).slice(0, 120), responsibility: clean(r.responsibility).slice(0, 1000) })).slice(0, 30);

  // ---- Header fields ----
  const fullText = blocks.map((b) => b.text || (b.cells || []).join(' ')).join('\n');
  if (!title) title = stripNum(meta.title || '') || (read.filename || 'Imported policy').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  title = title.replace(/^(policy|document)\s*(name|title)\s*[:–-]\s*/i, '').slice(0, 200);
  const owner = (meta.owner || '').replace(/^(the|our)\s+/i, '').slice(0, 200);
  const effective_date = meta.effective_date ? toIsoDate(meta.effective_date) : null;
  let review_cycle_months = meta.review ? toCycle(meta.review) : null;
  if (!review_cycle_months) { const r = /\b(reviewed|review)\b[^.]{0,60}\b(annual(ly)?|every (twelve|12|6|six|3|three|24|two|2) (months|years?)|quarterly|semi-?annual(ly)?|yearly|biennial(ly)?)/i.exec(fullText); if (r) review_cycle_months = toCycle(r[0]); }
  let classification = null;
  const cl = (meta.classification || '') + ' ' + fullText.slice(0, 600);
  for (const level of ['Restricted', 'Confidential', 'Internal', 'Public']) if (new RegExp('\\b' + level + '\\b', 'i').test(meta.classification || '') || (!meta.classification && new RegExp('^\\s*' + level + '\\b', 'im').test(cl.slice(0, 600)))) { classification = level; break; }

  // ---- Framework references → control ids ----
  const byKey = new Map(controls.map((c) => [`${c.framework_code}:${c.ref}`.toUpperCase(), c.id]));
  const mapRefs = (text) => {
    const ids = new Set();
    const add = (fw, ref) => { const id = byKey.get(`${fw}:${ref}`.toUpperCase()); if (id) ids.add(id); return !!id; };
    let unmatched = 0;
    for (const m of text.matchAll(/\b(?:ISO(?:\/IEC)?\s*27001[^\n]{0,25}?|Annex\s*A\s*|A\.\s?)([5-8])\.(\d{1,2})(?!\.\d)\b/gi)) add('ISO27001', `${m[1]}.${m[2]}`) || unmatched++;
    for (const m of text.matchAll(/\bA\.\s?\d{1,2}\.\d{1,2}\.\d{1,2}\b/g)) unmatched++; // ISO 27001:2013 numbering
    for (const m of text.matchAll(/\b(AC|AT|AU|CA|CM|CP|IA|IR|MA|MP|PE|PL|PM|PS|PT|RA|SA|SC|SI|SR)-(\d{1,2})\b/g)) add('NIST80053', `${m[1]}-${m[2]}`) || unmatched++;
    for (const m of text.matchAll(/\b(GV|ID|PR|DE|RS|RC)\.([A-Z]{2})\b/g)) add('NISTCSF', `${m[1]}.${m[2]}`) || unmatched++;
    for (const m of text.matchAll(/\b(CC\d\.\d|A1\.\d|C1\.\d)\b/g)) add('SOC2', m[1]) || unmatched++;
    for (const m of text.matchAll(/\bCIS\b[^\n]{0,20}?(?:Control|Safeguard)?\s*#?(\d{1,2})(?!\.\d)\b/gi)) add('CIS', String(Number(m[1]))) || unmatched++;
    for (const m of text.matchAll(/\bPCI(?:[ -]?DSS)?\b[^\n]{0,30}?Requirement\s*(\d{1,2})\b/gi)) add('PCIDSS', String(Number(m[1]))) || unmatched++;
    for (const m of text.matchAll(/\b164\.(3\d\d)\s*\(([a-e])\)(?:\s*\((\d)\))?/g)) add('HIPAA', `164.${m[1]}(${m[2]})${m[3] ? `(${m[3]})` : ''}`) || add('HIPAA', `164.${m[1]}(${m[2]})(1)`) || unmatched++;
    if (/\bGDPR\b|General Data Protection Regulation/i.test(text)) for (const m of text.matchAll(/\bArt(?:icle|\.)\s*(\d{1,2})\b/gi)) add('GDPR', `Art. ${Number(m[1])}`);
    return { ids, unmatched };
  };
  const stmtObjs = statements.map((text) => ({ text, controls: [...mapRefs(text).ids] }));
  const docRefs = mapRefs(fullText);
  const stmtIds = new Set(stmtObjs.flatMap((s) => s.controls));
  const ref_controls = [...docRefs.ids].filter((id) => !stmtIds.has(id));
  const related = [
    prose(sections.references),
    sections.definitions.length ? 'Definitions (from the original document):\n' + prose(sections.definitions) : '',
    prose(sections.contact),
    `Imported from "${read.filename}"${meta.version ? ` (original version ${meta.version})` : ''}.`,
  ].filter(Boolean).join('\n\n').slice(0, 2000);
  if (docRefs.unmatched) warnings.push(`${docRefs.unmatched} framework reference${docRefs.unmatched === 1 ? '' : 's'} could not be matched to a built-in control (for example ISO 27001:2013 numbering). Map those statements with "Map controls" after import.`);

  // ---- Policy type: title signal + how well the content covers each type's checklist ----
  const ranked = detectType(title, statements, fullText);
  const best = ranked[0];
  const type = best && best.score >= 0.25 ? best : null;

  // ---- Report ----
  if (!statements.length) warnings.push('No policy statements were recognised. The draft will start with an empty statement for you to fill in.');
  const letters = (fullText.match(/[A-Za-z]/g) || []).length;
  if (read.format === 'pdf' && fullText.length > 200 && letters / fullText.length < 0.5) warnings.push('Some text in this PDF may not have extracted cleanly. Check the statements carefully, or import the .docx version.');
  const modalCount = statements.filter((s) => /\b(must|shall)\b/i.test(s)).length;

  return {
    draft: {
      title, owner, classification: classification || 'Internal', effective_date, review_cycle_months: review_cycle_months || 12,
      purpose, scope, enforcement,
      statements: stmtObjs, roles: cleanRoles, ref_controls, related_docs: related,
      policy_type: type ? type.key : 'other',
    },
    report: {
      format: read.format, filename: read.filename,
      found, unrecognized: [...new Set(unrecognized)].slice(0, 12),
      skipped: ['history', 'definitions'].filter((k) => sections[k].length).map((k) => ({ history: 'Revision history (MandateGRC keeps its own from approvals)', definitions: 'Definitions (kept in Related documents)' }[k])),
      meta: { owner: !!owner, effective_date: !!effective_date, review_cycle: !!review_cycle_months, classification: !!classification, version: meta.version || null },
      counts: { statements: statements.length, mandatory: modalCount, roles: cleanRoles.length, mapped: stmtIds.size + ref_controls.length },
      type: type ? { key: type.key, name: type.name, confidence: Math.round(type.score * 100), signals: type.signals } : null,
      alternatives: ranked.slice(type ? 1 : 0, 3).filter((r) => r.score >= 0.15).map((r) => ({ key: r.key, name: r.name, confidence: Math.round(r.score * 100) })),
      warnings,
    },
  };
}

export function detectType(title, statements, fullText = '') {
  const body = statements.length ? statements : fullText.split(/(?<=[.!?])\s+/);
  return POLICY_TYPES.map((t) => {
    const titleHit = t.detect.test(title);
    const met = t.requirements.filter((r) => body.some((s) => r.test.every((re) => re.test(s))));
    const coverage = t.requirements.length ? met.length / t.requirements.length : 0;
    const nameHit = !titleHit && new RegExp(t.name.split(/\s|&/)[0], 'i').test(fullText.slice(0, 400));
    const score = Math.min(1, (titleHit ? 0.45 : nameHit ? 0.15 : 0) + coverage * 0.55 + (titleHit && coverage >= 0.5 ? 0.1 : 0));
    const signals = [titleHit ? `the title suggests ${t.name}` : nameHit ? `the opening mentions ${t.name}` : null, `${met.length} of ${t.requirements.length} ${t.name} checklist topics are covered`].filter(Boolean);
    return { key: t.key, name: t.name, score, signals };
  }).sort((a, b) => b.score - a.score);
}
