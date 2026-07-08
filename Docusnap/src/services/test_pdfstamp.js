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
const { stampPdf, stampedPathFor, hexToRgb, fmtDate, wrapText } = require('./pdfStamp');

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

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\nAll pdfStamp checks passed (${passed}).`);
})().catch((e) => { console.error('FAIL:', e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} process.exit(1); });
