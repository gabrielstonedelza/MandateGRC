// Minimal, dependency-free PDF writer for audit artefacts (Statement of Applicability, audit
// package index). Uses the PDF standard Helvetica fonts with WinAnsi encoding, so no font files are
// embedded and every viewer renders it. Supports headings, wrapped paragraphs, key/value blocks and
// tables whose header repeats on each page, plus a footer with page numbers.
import zlib from 'node:zlib';

// Helvetica glyph widths (1/1000 em) for ASCII 32–126, from the standard AFM metrics.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Helvetica-Bold, same range.
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Characters outside Latin-1 that WinAnsi still encodes.
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '→': null, '←': null, '≤': null, '≥': null, '×': 0xd7 };
const FALLBACK = { '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '✓': 'v', '✗': 'x', '·': '·' };

export function toWinAnsi(text) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    const code = ch.codePointAt(0);
    if (ch === '\n' || ch === '\t') { out += ' '; continue; }
    if (code >= 32 && code <= 126) out += ch;
    else if (WIN[ch]) out += String.fromCharCode(WIN[ch]);
    else if (FALLBACK[ch]) out += FALLBACK[ch];
    // 128–255: Latin-1, or a character this function already mapped to WinAnsi (idempotent).
    else if (code >= 128 && code <= 255) out += ch;
    else out += '?';
  }
  return out;
}

const charWidth = (c, bold) => {
  const code = c.charCodeAt(0);
  if (code >= 32 && code <= 126) return (bold ? WB : W)[code - 32];
  return bold ? 600 : 556;
};
export const textWidth = (s, size, bold = false) => [...s].reduce((a, c) => a + charWidth(c, bold), 0) * size / 1000;
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const rgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' '); };

// Greedy word wrap; very long words are broken by character.
export function wrap(text, width, size, bold = false) {
  const lines = [];
  for (const para of toWinAnsi(text).split(/\s*\u0000\s*/)) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const cand = line ? `${line} ${word}` : word;
      if (textWidth(cand, size, bold) <= width) { line = cand; continue; }
      if (line) lines.push(line);
      if (textWidth(word, size, bold) <= width) { line = word; continue; }
      let chunk = '';
      for (const c of word) {
        if (textWidth(chunk + c, size, bold) > width) { lines.push(chunk); chunk = c; } else chunk += c;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

export class PdfDoc {
  constructor({ landscape = false, title = 'Document', author = 'MandateGRC', margin = 40, footer = null } = {}) {
    [this.w, this.h] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    this.m = margin;
    this.title = title;
    this.author = author;
    this.footer = footer;
    this.pages = [];
    this.newPage();
  }
  get contentWidth() { return this.w - 2 * this.m; }
  get bottom() { return this.m + 28; } // room for the footer
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.h - this.m; }
  ensure(height) { if (this.y - height < this.bottom) this.newPage(); }

  text(x, y, s, { size = 10, bold = false, color = '#1d2433' } = {}) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(toWinAnsi(s))}) Tj ET`);
  }
  line(x1, y1, x2, y2, { color = '#c9ced8', width = 0.6 } = {}) {
    this.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  rect(x, y, w, h, { fill = '#f2f4f7' } = {}) {
    this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  space(pt) { this.y -= pt; }
  heading(s, { size = 16, color = '#111827' } = {}) {
    this.ensure(size + 10);
    this.y -= size;
    this.text(this.m, this.y, s, { size, bold: true, color });
    this.y -= 8;
  }
  paragraph(s, { size = 9.5, bold = false, color = '#374151', leading = 1.35 } = {}) {
    for (const l of wrap(s, this.contentWidth, size, bold)) {
      this.ensure(size * leading);
      this.y -= size * leading;
      this.text(this.m, this.y, l, { size, bold, color });
    }
    this.y -= 4;
  }
  rule({ color = '#b8892e', width = 1.2 } = {}) { this.ensure(6); this.y -= 3; this.line(this.m, this.y, this.w - this.m, this.y, { color, width }); this.y -= 6; }
  keyValues(pairs, { size = 9.5, keyWidth = 150 } = {}) {
    for (const [k, v] of pairs) {
      const lines = wrap(String(v ?? ''), this.contentWidth - keyWidth, size);
      this.ensure(lines.length * size * 1.35);
      lines.forEach((l, i) => {
        this.y -= size * 1.35;
        if (!i) this.text(this.m, this.y, k, { size, bold: true, color: '#4b5563' });
        this.text(this.m + keyWidth, this.y, l, { size });
      });
    }
    this.y -= 4;
  }

  // columns: [{ label, width (fraction of the content width) }]; rows: arrays of cell strings.
  table(columns, rows, { size = 8, pad = 4, header = true, zebra = true, maxRowLines = 40 } = {}) {
    const total = columns.reduce((a, c) => a + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.contentWidth);
    const lh = size * 1.3;
    const drawHeader = () => {
      if (!header) return;
      const lines = columns.map((c, i) => wrap(c.label, widths[i] - 2 * pad, size, true));
      const hgt = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad;
      this.ensure(hgt + lh * 2);
      this.rect(this.m, this.y - hgt, this.contentWidth, hgt, { fill: '#1f2937' });
      let x = this.m;
      lines.forEach((ls, i) => { ls.forEach((l, j) => this.text(x + pad, this.y - pad - (j + 1) * lh + 2, l, { size, bold: true, color: '#ffffff' })); x += widths[i]; });
      this.y -= hgt;
    };
    drawHeader();
    rows.forEach((row, r) => {
      let cells = row.map((v, i) => wrap(String(v ?? ''), widths[i] - 2 * pad, size, !!columns[i].bold));
      const fit = Math.floor((this.h - 2 * this.m - 60) / lh);
      cells = cells.map((ls) => (ls.length > Math.min(maxRowLines, fit) ? [...ls.slice(0, Math.min(maxRowLines, fit) - 1), '…'] : ls));
      const hgt = Math.max(1, ...cells.map((l) => l.length)) * lh + 2 * pad;
      if (this.y - hgt < this.bottom) { this.newPage(); drawHeader(); }
      if (zebra && r % 2) this.rect(this.m, this.y - hgt, this.contentWidth, hgt, { fill: '#f5f6f8' });
      let x = this.m;
      cells.forEach((ls, i) => {
        ls.forEach((l, j) => this.text(x + pad, this.y - pad - (j + 1) * lh + 2, l, { size, bold: !!columns[i].bold, color: columns[i].color?.(row[i]) || '#1d2433' }));
        x += widths[i];
      });
      this.line(this.m, this.y - hgt, this.w - this.m, this.y - hgt, { color: '#e3e6eb', width: 0.4 });
      this.y -= hgt;
    });
    this.y -= 8;
  }

  toBuffer() {
    const n = this.pages.length;
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [];
      if (this.footer) {
        const [left, right] = [].concat(this.footer(i + 1, n));
        foot.push(`${rgb('#d1d5db')} RG 0.5 w ${this.m} ${this.m + 14} m ${this.w - this.m} ${this.m + 14} l S`);
        if (left) foot.push(`BT /F1 7.5 Tf ${rgb('#6b7280')} rg ${this.m} ${this.m} Td (${esc(toWinAnsi(left))}) Tj ET`);
        const r = right || `Page ${i + 1} of ${n}`;
        foot.push(`BT /F1 7.5 Tf ${rgb('#6b7280')} rg ${(this.w - this.m - textWidth(toWinAnsi(r), 7.5)).toFixed(2)} ${this.m} Td (${esc(toWinAnsi(r))}) Tj ET`);
      }
      const stream = zlib.deflateSync(Buffer.from([...ops, ...foot].join('\n'), 'latin1'));
      const content = add({ stream, dict: `<< /Length ${stream.length} /Filter /FlateDecode >>` });
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${n} >>`;
    const d = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const info = add(`<< /Title (${esc(toWinAnsi(this.title))}) /Author (${esc(toWinAnsi(this.author))}) /Producer (MandateGRC) /CreationDate (D:${d}Z) >>`);
    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(offset);
      const parts = typeof o === 'string'
        ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
        : [Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
      for (const p of parts) { chunks.push(p); offset += p.length; }
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}
