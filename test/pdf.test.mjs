// The PDF writer produces structurally valid files: every xref offset points at its object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, toWinAnsi, wrap, textWidth } from '../src/pdf.js';

test('xref offsets, page count and trailer are consistent', () => {
  const d = new PdfDoc({ landscape: true, title: 'T', footer: (p, n) => [`left ${p}`, `Page ${p} of ${n}`] });
  d.heading('Statement of Applicability');
  d.table([{ label: 'A', width: 1 }, { label: 'B', width: 3 }], Array.from({ length: 120 }, (_, i) => [String(i), 'word '.repeat(20)]));
  const buf = d.toBuffer();
  const s = buf.toString('latin1');
  const startxref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const entries = s.slice(startxref).split('\n').slice(2).filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  entries.forEach((off, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, off), `object ${i + 1} at ${off}`));
  const count = Number(s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.equal(count, d.pages.length);
  assert.ok(count > 1, 'long tables paginate');
});

test('text is encoded to WinAnsi idempotently and wraps within the width', () => {
  assert.equal(toWinAnsi('“Quoted” — ok'), toWinAnsi(toWinAnsi('“Quoted” — ok')));
  assert.ok(!toWinAnsi('“Quoted” — ok • 1…').includes('?'));
  assert.equal(toWinAnsi('漢'), '?');
  for (const l of wrap('A fairly long sentence that must wrap into several lines of limited width.', 100, 10)) assert.ok(textWidth(l, 10) <= 100);
});
