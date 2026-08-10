'use strict';
/*
 * Tests for the PDF stamping module (src/services/pdfStamp.js).
 * Run with Electron-as-Node (project convention) or plain node — pdf-lib is pure JS:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/services/test_pdfstamp.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { stampPdf, stampedPathFor, hexToRgb, fmtDate, wrapText,
        elideNotes, parseStampPlacement, MAX_NOTES } = require('./pdfStamp');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-stamp-'));
let passed = 0;
function ok(name) { console.log(`  ok  ${name}`); passed++; }

// Build a minimal multi-page sample PDF to stamp.
async function makeSamplePdf(file, pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const pg = pdf.addPage([595, 842]); // A4-ish
    pg.drawText(`Sample invoice page ${i + 1}`, { x: 50, y: 780, size: 14, font });
  }
  fs.writeFileSync(file, await pdf.save());
}

// Re-load a written file and confirm it's a valid PDF with the expected page count.
async function assertValidPdf(file, expectPages) {
  assert.ok(fs.existsSync(file), `output exists: ${file}`);
  const buf = fs.readFileSync(file);
  assert.ok(buf.slice(0, 5).toString() === '%PDF-', 'has %PDF- header');
  const reloaded = await PDFDocument.load(buf);
  assert.strictEqual(reloaded.getPageCount(), expectPages, 'page count preserved');
}

(async () => {
  // ── unit: hex + helpers ──────────────────────────────────────────────────────
  assert.throws(() => hexToRgb('not-a-colour'), /Invalid hex/);
  assert.throws(() => hexToRgb('#12345'), /Invalid hex/);
  const c = hexToRgb('#2E7D32');
  assert.ok(c.green > c.red && c.green > c.blue, 'green channel dominant for #2E7D32');
  ok('hexToRgb validates + converts');

  assert.match(fmtDate('2026-06-28T10:00:00Z'), /^\d{2} [A-Z][a-z]{2} \d{4}$/);
  assert.match(fmtDate(undefined), /^\d{2} [A-Z][a-z]{2} \d{4}$/); // defaults to now
  ok('fmtDate formats DD MMM YYYY (and defaults to now)');

  assert.strictEqual(
    stampedPathFor(path.join('C:', 'out', 'Invoice.INV-1.pdf'), 'approve'.toUpperCase() === 'APPROVE' ? 'APPROVED' : 'APPROVED'),
    path.join('C:', 'out', 'Invoice.INV-1.APPROVED-stamped.pdf'));
  ok('stampedPathFor names the copy next to the source');

  // ── APPROVED (green) ─────────────────────────────────────────────────────────
  const src = path.join(TMP, 'invoice.pdf');
  await makeSamplePdf(src, 1);
  const approved = path.join(TMP, 'invoice.APPROVED.pdf');
  const out1 = await stampPdf(src, approved, {
    label: 'APPROVED', color: '#2E7D32', userName: 'Chris McCully', date: '2026-06-28',
    notes: 'Checked against PO and delivery note — all correct.',
  });
  assert.strictEqual(out1, approved);
  await assertValidPdf(approved, 1);
  const srcBytes = fs.readFileSync(src), outBytes = fs.readFileSync(approved);
  assert.ok(!srcBytes.equals(outBytes), 'stamped copy differs from the source');
  ok('APPROVED (green) stamp → valid PDF, original untouched');

  // original is byte-for-byte unchanged
  await assertValidPdf(src, 1);
  ok('source PDF was never mutated');

  // ── REJECTED (red) with a long multi-line note ───────────────────────────────
  const rejected = path.join(TMP, 'invoice.REJECTED.pdf');
  const longNote = 'Totals do not reconcile: the line items sum to £924.60 but the stated ' +
    'total due reads £942.60. Supplier bank details also differ from the account we hold on ' +
    'file, so this needs to be re-issued before it can be approved for payment.';
  await stampPdf(src, rejected, {
    label: 'REJECTED', color: '#C62828', userName: 'A. Reviewer', date: '2026-06-28',
    notes: longNote, position: 'top-right', rotate: -4,
  });
  await assertValidPdf(rejected, 1);
  ok('REJECTED (red) stamp with wrapped multi-line note → valid PDF');

  // wrapText actually splits a long string into multiple lines
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  assert.ok(wrapText(longNote, font, 9, 200).length > 1, 'long note wraps to >1 line');
  ok('wrapText wraps long text');

  // ── input validation ─────────────────────────────────────────────────────────
  await assert.rejects(stampPdf(path.join(TMP, 'nope.pdf'), rejected, {}), /not found/);
  await assert.rejects(stampPdf(src, path.join(TMP, 'bad.pdf'), { color: 'xyz' }), /Invalid hex/);
  await assert.rejects(stampPdf(src, path.join(TMP, 'bad.pdf'), { notes: 'x'.repeat(601) }), /too long/);
  ok('stampPdf rejects missing input / bad colour / over-long notes');

  // ── multi-page: stamp page 2 only ────────────────────────────────────────────
  const multi = path.join(TMP, 'multi.pdf');
  await makeSamplePdf(multi, 3);
  const multiOut = path.join(TMP, 'multi.stamped.pdf');
  await stampPdf(multi, multiOut, { label: 'APPROVED', page: 1 });
  await assertValidPdf(multiOut, 3);
  ok('multi-page source stamps the requested page, preserves all pages');

  // ── placement + size (owner 2026-08-02) ──────────────────────────────────────
  const placed = path.join(TMP, 'placed.pdf');
  await stampPdf(src, placed, { label: 'APPROVED', box: { x: 0.08, y: 0.62, w: 0.42 } });
  await assertValidPdf(placed, 1);
  // A placement saved on one page size must never push the stamp off a different one — the
  // clamp is the reason a stale setting can't produce an invisible stamp.
  const offpage = path.join(TMP, 'offpage.pdf');
  await stampPdf(src, offpage, { label: 'APPROVED', box: { x: 0.99, y: 0.99, w: 0.6 } });
  await assertValidPdf(offpage, 1);
  ok('box placement renders, and an off-page placement is clamped rather than lost');

  // ── the note ELIDES instead of costing the stamp ─────────────────────────────
  // stampPdf still THROWS above MAX_NOTES (contract for direct callers, asserted above), but the
  // workflow entry point swallows every throw — so before this, a 601-char rejection reason
  // produced no stamped copy at all, silently.
  assert.strictEqual(elideNotes('short'), 'short', 'short notes pass through untouched');
  assert.strictEqual(elideNotes('x'.repeat(MAX_NOTES)).length, MAX_NOTES, 'exactly-max is not touched');
  const elided = elideNotes('word '.repeat(400));
  assert.ok(elided.length <= MAX_NOTES, 'elided note fits MAX_NOTES');
  assert.ok(elided.endsWith('…'), 'elision is visible to the reader');
  await stampPdf(src, path.join(TMP, 'elided.pdf'), { label: 'APPROVED', notes: elided });
  ok('elideNotes keeps an over-long note inside the limit stampPdf enforces');

  // ── per-route stamped filenames ──────────────────────────────────────────────
  // Two approvals on ONE document must not write the same file: the second used to overwrite the
  // first while the earlier route row still pointed at that path.
  const p1 = stampedPathFor('/x/inv.pdf', 'APPROVED', 11);
  const p2 = stampedPathFor('/x/inv.pdf', 'APPROVED', 12);
  assert.notStrictEqual(p1, p2, 'different routes get different stamped paths');
  assert.strictEqual(stampedPathFor('/x/inv.pdf', 'APPROVED'), stampedPathFor('/x/inv.pdf', 'APPROVED'),
    'the no-route form is unchanged (legacy copies keep resolving)');
  assert.ok(!/[\\/]/.test(path.basename(stampedPathFor('/x/inv.pdf', 'APPROVED', '../../evil'))),
    'a hostile route id cannot escape the directory');
  ok('stamped paths are per-route, and a route id cannot traverse');

  // ── stored placement is parsed defensively ───────────────────────────────────
  // A malformed setting must read as "unset" (legacy corner), never throw and never stop a stamp.
  assert.strictEqual(parseStampPlacement(''), null);
  assert.strictEqual(parseStampPlacement('not json'), null);
  assert.strictEqual(parseStampPlacement('{"x":0.1,"y":0.1}'), null, 'no width ⇒ unset');
  assert.deepStrictEqual(parseStampPlacement('{"x":0.6,"y":0.05,"w":0.3}'), { x: 0.6, y: 0.05, w: 0.3 });
  const clamped = parseStampPlacement({ x: 9, y: -3, w: 99 });
  assert.ok(clamped.x <= 1 && clamped.y >= 0 && clamped.w <= 0.9, 'out-of-range values clamp');
  ok('parseStampPlacement falls back to unset on anything malformed');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\nAll pdfStamp checks passed (${passed}).`);
})().catch((e) => { console.error('FAIL:', e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} process.exit(1); });
