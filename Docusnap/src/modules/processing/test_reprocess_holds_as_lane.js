#!/usr/bin/env node
'use strict';
/**
 * test_reprocess_holds_as_lane.js — Chris round 19 N1 (Oracle P1 SIGN OFF W/COND, 2026-08-23).
 *
 * The quiet lane held a wrong date on Larkspur; the SAME slip filed four times on Copperfield because
 * the values came through the MANUAL "Reprocess 19 from this sender" road, which had no holds at all.
 * rereadHolds.js is now the ONE road; both the lane and the manual reprocess call it.
 *
 *   §1 C1 — the Copperfield chain: import 03-11-2026 → box#1 reads 'INV-29273' into the date field
 *      (S3-C5 writes corrected_to = 03-11-2026) → box#2 reads 13-11-2026 ⇒ note + the offer stays the
 *      type-valid baseline 03-11-2026 (never 'INV-29273'); box#2 reads 03-11-2026 ⇒ NO hold (equal to
 *      the baseline — the 15 correct siblings clear)
 *   §2 per-scope keying: witnesses on sender A never hold sender B's first-fills in one batch
 *   §3 single-doc manual reprocess: a required-role first-fill holds UNCONDITIONALLY (no witnesses, no
 *      release); S3-C5 applies
 *   §4 the handler wiring (source contract): the switch (default OFF, env 1/0), onFileDone → onDocMerged
 *      via 'manual', release BEFORE `_currentBatchProcs = []`, the single-doc call via 'manual-single',
 *      the Settings toggle, the dialog copy
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_reprocess_holds_as_lane.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR + LF).join(LF);

const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const holdsMod = require('./rereadHolds');
const handler = require('./handler');

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req, type] of [['supplier_name', 1, 'text'], ['invoice_number', 1, 'text'], ['invoice_date', 1, 'date']])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, ?, ?, 1, 1)").run(k, k, type, req);
const holds = holdsMod.create({ corroborated: () => false, k: 1 });
const mk = (sup, rows) => {
  const id = Number(documents.insert(db, { original_filename: `${sup}-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: sup, document_type_id: 1 }).lastInsertRowid);
  for (const r of rows) db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corrected_to) VALUES (?, ?, ?, ?, 94, ?, ?)').run(id, r.key, r.value, r.value, r.method || 'keyword', r.corrected_to || null);
  return id;
};
const snapshot = (id) => db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
const setRows = (id, rows) => { db.prepare('DELETE FROM extractions WHERE document_id = ?').run(id); for (const r of rows) db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corroboration) VALUES (?, ?, ?, ?, 94, ?, ?)').run(id, r.key, r.value, r.value, r.method || 'template_mapping', r.corroboration || null); };
const ext = (id, key) => db.prepare('SELECT display_value, validation_note, corrected_to FROM extractions WHERE document_id = ? AND field_key = ?').get(id, key) || {};
const CF = 'Copperfield Electrical';
const base = (sup, num, date) => [{ key: 'supplier_name', value: sup, method: 'template_fixed' }, { key: 'invoice_number', value: num }, { key: 'invoice_date', value: date }];

console.log('§1 C1 — the Copperfield chain');
// import: the correct date; box#1 (the wrong-order teach) reads a REFERENCE into the date field
const d16 = mk(CF, base(CF, 'INV-29273', '03-11-2026'));
let existing = snapshot(d16);
setRows(d16, base(CF, '03-11-2026', 'INV-29273'));         // box#1: date box on the number, number box on the date
let b = holds.newBatch();
let r = holds.onDocMerged(db, b, { docId: d16, existing, via: 'manual', reliability: true });
check('box#1: S3-C5 fires on invoice_date (was 03-11-2026, now INV-29273) and corrected_to carries the type-valid baseline', ext(d16, 'invoice_date').corrected_to === '03-11-2026' && /Read differently/.test(ext(d16, 'invoice_date').validation_note || ''));
// box#2 (the corrected re-teach) reads the WRONG date
existing = snapshot(d16);
setRows(d16, base(CF, 'INV-29273', '13-11-2026'));
b = holds.newBatch();
r = holds.onDocMerged(db, b, { docId: d16, existing, via: 'manual', reliability: true });
check("box#2 wrong: held with 'was 03-11-2026, now 13-11-2026' — the baseline is the last INDEPENDENT value, not the junk 'INV-29273'", /was '03-11-2026', now '13-11-2026'/.test(ext(d16, 'invoice_date').validation_note || ''));
check("…and the offer (corrected_to) is 03-11-2026 — never 'INV-29273' on a date field", ext(d16, 'invoice_date').corrected_to === '03-11-2026');
// a correct sibling: box#2 reads the SAME date the import had
const d02 = mk(CF, base(CF, 'INV-41557', '17-12-2026'));
existing = snapshot(d02);
setRows(d02, base(CF, '17-12-2026', 'INV-41557'));          // box#1 junk
holds.onDocMerged(db, holds.newBatch(), { docId: d02, existing, via: 'manual', reliability: true });
existing = snapshot(d02);
setRows(d02, base(CF, 'INV-41557', '17-12-2026'));          // box#2 correct
holds.onDocMerged(db, holds.newBatch(), { docId: d02, existing, via: 'manual', reliability: true });
check('box#2 correct: equal to the baseline ⇒ NO hold on invoice_date (the 15 correct siblings clear)', !/Read differently after learning — was '17-12-2026'/.test(ext(d02, 'invoice_date').validation_note || '') && !/now '17-12-2026'/.test(ext(d02, 'invoice_date').validation_note || ''));
// a type-INVALID baseline is never offered: a ref-shaped corrected_to on a date row is ignored
const dX = mk(CF, [{ key: 'supplier_name', value: CF }, { key: 'invoice_number', value: 'INV-1' }, { key: 'invoice_date', value: 'INV-9999', corrected_to: 'INV-8888' }]);
existing = snapshot(dX);
setRows(dX, base(CF, 'INV-1', '05-05-2026'));
holds.onDocMerged(db, holds.newBatch(), { docId: dX, existing, via: 'manual', reliability: true });
// CHANGED 2026-08-27 (owner: "it is asking me to check an invalid date against a real date"): a junk baseline is
// nothing a human can choose, so the S3-C5 sentence no longer fires; the valid read counts as a FIRST FILL and the
// via's confirm-once hold applies instead. The offer stays empty either way (never 'INV-9999').
check("a junk display AND a junk corrected_to on a date row: NO 'Read differently' sentence, NO offer, the first-fill hold applies instead",
      !/Read differently/.test(ext(dX, 'invoice_date').validation_note || '') && !String(ext(dX, 'invoice_date').corrected_to || '').trim()
      && /confirm once/.test(ext(dX, 'invoice_date').validation_note || ''));

console.log("\n§1c the owner's exhibit (Silverbeck 0047-4): a clipped '0-02-2025' healed to '10-02-2025' is a fill, not a disagreement");
const dS = mk('Silverbeck Cleaning Supplies', [{ key: 'supplier_name', value: 'Silverbeck Cleaning Supplies' }, { key: 'invoice_number', value: 'SB-ORD52836' }, { key: 'invoice_date', value: '0-02-2025' }]);
existing = snapshot(dS);
setRows(dS, [{ key: 'supplier_name', value: 'Silverbeck Cleaning Supplies' }, { key: 'invoice_number', value: 'SB-ORD52836' }, { key: 'invoice_date', value: '10-02-2025' }]);
r = holds.onDocMerged(db, holds.newBatch(), { docId: dS, existing, via: 'manual-single' });
check("no 'Read differently — was 0-02-2025' sentence", !/Read differently/.test(ext(dS, 'invoice_date').validation_note || ''));
check("the valid date is held as a FIRST FILL with the honest confirm-once note", /Read again at your request — confirm once\./.test(ext(dS, 'invoice_date').validation_note || '') && r.firstFills.some(h => h.key === 'invoice_date'));
check("no one-click offer of the junk value", !String(ext(dS, 'invoice_date').corrected_to || '').trim());
check("control: a VALID old date vs a different valid new date still fires the disagreement",
      (() => { const dV = mk('Silverbeck Cleaning Supplies', [{ key: 'supplier_name', value: 'Silverbeck Cleaning Supplies' }, { key: 'invoice_number', value: 'SB-1' }, { key: 'invoice_date', value: '09-02-2025' }]);
               const exV = snapshot(dV); setRows(dV, [{ key: 'supplier_name', value: 'Silverbeck Cleaning Supplies' }, { key: 'invoice_number', value: 'SB-1' }, { key: 'invoice_date', value: '10-02-2025' }]);
               holds.onDocMerged(db, holds.newBatch(), { docId: dV, existing: exV, via: 'manual-single' });
               return /Read differently after learning — was '09-02-2025', now '10-02-2025'/.test(ext(dV, 'invoice_date').validation_note || '') && ext(dV, 'invoice_date').corrected_to === '09-02-2025'; })());

console.log('\n§1b r20 card 2 — the identity never gets a one-click Use of its old read');
const dI = mk(CF, base('Ticket Type', 'INV-7', '07-07-2026'));
existing = snapshot(dI); setRows(dI, base(CF, 'INV-7', '07-07-2026'));
holds.onDocMerged(db, holds.newBatch(), { docId: dI, existing, via: 'manual', reliability: true });
check("an issuer that read 'Ticket Type' before and the real sender now: the S3-C5 note lands but corrected_to stays EMPTY (no one-click 'Use Ticket Type')", /Read differently after learning — was 'Ticket Type'/.test(ext(dI, 'supplier_name').validation_note || '') && !String(ext(dI, 'supplier_name').corrected_to || '').trim());

console.log('\n§2 per-scope keying');
const A1 = mk('Sender A', base('Sender A', 'A-1', '01-01-2026')), A2 = mk('Sender A', [{ key: 'supplier_name', value: 'Sender A' }, { key: 'invoice_number', value: 'A-2' }]);
const B1 = mk('Sender B', [{ key: 'supplier_name', value: 'Sender B' }, { key: 'invoice_number', value: 'B-1' }]);
b = holds.newBatch();
let exA1 = snapshot(A1); setRows(A1, base('Sender A', 'A-1', '02-01-2026')); holds.onDocMerged(db, b, { docId: A1, existing: exA1, via: 'manual', reliability: true });   // a witness on A's date
let exA2 = snapshot(A2); setRows(A2, base('Sender A', 'A-2', '03-03-2026')); holds.onDocMerged(db, b, { docId: A2, existing: exA2, via: 'manual', reliability: true });   // A's first-fill
let exB1 = snapshot(B1); setRows(B1, base('Sender B', 'B-1', '04-04-2026')); holds.onDocMerged(db, b, { docId: B1, existing: exB1, via: 'manual', reliability: true });   // B's first-fill
const rel = holds.release(db, b);
check("sender A's first-fill stays held (A's box proved unreliable); sender B's first-fill is RELEASED (B has no witness)", rel.held.some(h => h.docId === A2) && rel.released.some(h => h.docId === B1) && !(ext(B1, 'invoice_date').validation_note || '').includes('confirm once') && (ext(A2, 'invoice_date').validation_note || '').includes('confirm once'));
check('statsSummary names the field per scope', /invoice_date:1/.test(holds.statsSummary(b)));

console.log('\n§3 single-doc manual reprocess');
const S1 = mk(CF, [{ key: 'supplier_name', value: CF }, { key: 'invoice_number', value: 'INV-5' }]);   // date blank
existing = snapshot(S1); setRows(S1, base(CF, 'INV-5', '06-06-2026'));
r = holds.onDocMerged(db, holds.newBatch(), { docId: S1, existing, via: 'manual-single' });
check("a single-doc reprocess first-fill of a required role holds UNCONDITIONALLY ('Read again at your request — confirm once.')", /Read again at your request — confirm once\./.test(ext(S1, 'invoice_date').validation_note || '') && r.firstFills.length === 1);

console.log('\n§4 the handler wiring (source contract)');
const ph = read(path.join(__dirname, 'handler.js'));
// mig 93 seeds reprocess_holds_as_lane ON; state the OFF arm explicitly so this pins the switch's
// OFF semantics (env unset → the setting decides), not the seed. The env arms below still override it.
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('reprocess_holds_as_lane', 'false')").run();
check('default (no setting) → OFF (DARK)', handler._reprocessHoldsEnabled(db) === false);
process.env.REPROCESS_HOLDS_AS_LANE = '1'; check('env 1 → on', handler._reprocessHoldsEnabled(db) === true);
process.env.REPROCESS_HOLDS_AS_LANE = '0'; check('env 0 → off', handler._reprocessHoldsEnabled(db) === false);
delete process.env.REPROCESS_HOLDS_AS_LANE;
const batchBlock = ph.slice(ph.indexOf("ipcMain.handle('reprocess-batch'"), ph.indexOf("ipcMain.handle('get-reprocess-status'"));
check("reprocess-batch: onFileDone merges through onDocMerged via 'manual' with reliability", /_holds\.onDocMerged\(db, _holdsBatch, \{ docId: nd\.docId, existing: nd\.existing, via: 'manual', reliability: true \}\)/.test(batchBlock));
const relAt = batchBlock.indexOf('_holdsRel = _holds.release(db, _holdsBatch)'), clearAt = batchBlock.indexOf('_currentBatchProcs = [];', batchBlock.indexOf('} finally {'));
check('reprocess-batch: the release runs in the finally BEFORE _currentBatchProcs = [] (C4)', relAt > 0 && clearAt > relAt);
check('reprocess-batch: the release is audited (reprocess_holds)', /action: 'reprocess_holds'/.test(batchBlock));
const singleBlock = ph.slice(ph.indexOf("ipcMain.handle('reprocess-document'"), ph.indexOf("ipcMain.handle('reprocess-document'") + 20000);
check("reprocess-document: the single-doc road calls onDocMerged via 'manual-single' after applyReprocessResult", /h\.onDocMerged\(db, h\.newBatch\(\), \{ docId, existing, via: 'manual-single' \}\)/.test(singleBlock) && singleBlock.indexOf("via: 'manual-single'") > singleBlock.indexOf('const applied = applyReprocessResult(db, docId, existing, result, filename, diagOn);'));
const sh = read(path.join(ROOT, 'src', 'windows', 'settings', 'index.html')), sr = read(path.join(ROOT, 'src', 'windows', 'settings', 'renderer.js'));
check('Settings surfaces the toggle', /id="reprocess-holds-toggle"/.test(sh) && /\['reprocess-holds-toggle', 'reprocess_holds_as_lane'\]/.test(sr));
const rend = read(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'));
check('the Reprocess dialog defines "clean" when the switch is on (C6)', /A value that reads differently from before is kept for you to check — the previous value is one click away\./.test(rend) && /getSetting\('reprocess_holds_as_lane'\)/.test(rend));
const ql = read(path.join(__dirname, 'quietLane.js'));
check('the lane delegates to the SAME module (one road)', /require\('\.\/rereadHolds'\)\.create\(/.test(ql) && !/function _holdChangedReads\(db, docId, existing\) \{/.test(ql));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
