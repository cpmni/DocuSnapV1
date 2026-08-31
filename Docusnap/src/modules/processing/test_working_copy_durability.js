#!/usr/bin/env node
'use strict';
// Crash-safety / durability suite (REAL filesystem) — complements the mock-fs
// test_reconcile_holding.js. Covers:
//   • ensureWorkingCopy (sync) + ensureWorkingCopyAsync (the #4 async twin): atomic
//     .part→rename, byte-faithful copy, inbox auto-create, missing-source → null,
//     unsafe-extension sanitisation, resilience to a stale .part.
//   • a real-fs reconcileHolding pass (live kept, dead/orphan/.part removed, unmanaged
//     files untouched) — proving a crash only ever leaves EXTRA files, never loses a doc.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_working_copy_durability.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const proc = require('./handler');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-wc-'));

async function testWorkingCopy() {
  console.log('working-copy durability (sync + async) —');
  const src = path.join(ROOT, 'src'); fs.mkdirSync(src, { recursive: true });
  const srcFile = path.join(src, 'scan.pdf'); fs.writeFileSync(srcFile, 'REAL-PDF-BYTES');

  for (const [label, fn] of [['sync', proc.ensureWorkingCopy], ['async', proc.ensureWorkingCopyAsync]]) {
    const inb = path.join(ROOT, 'inbox_' + label);
    const wp = await fn(fs, path, inb, srcFile, 42, 'scan.pdf');
    check(`${label}: returns inbox/<id>.pdf + copies bytes faithfully`, wp === path.join(inb, '42.pdf') && fs.readFileSync(wp, 'utf8') === 'REAL-PDF-BYTES');
    check(`${label}: auto-creates the inbox dir`, fs.existsSync(inb));
    check(`${label}: atomic — no leftover .part`, !fs.existsSync(wp + '.part'));

    const miss = await fn(fs, path, inb, path.join(src, 'nope.pdf'), 43, 'nope.pdf');
    check(`${label}: missing source → null (best-effort, no throw)`, miss === null);

    const noExt = await fn(fs, path, inb, srcFile, 44, 'scan.tar.gz;rm -rf');
    check(`${label}: unsafe/compound extension sanitised → no ext`, noExt === path.join(inb, '44'));

    fs.writeFileSync(path.join(inb, '45.pdf.part'), 'STALE');   // debris from a prior interrupted copy
    const wp2 = await fn(fs, path, inb, srcFile, 45, 'scan.pdf');
    check(`${label}: succeeds despite a stale .part; copy is correct`, wp2 === path.join(inb, '45.pdf') && fs.readFileSync(wp2, 'utf8') === 'REAL-PDF-BYTES');

    // The docId names the copy; the source name never leaks into the inbox path.
    const wp3 = await fn(fs, path, inb, srcFile, 46, '../../evil name*.pdf');
    check(`${label}: docId names the copy, source name never leaks a path`, wp3 === path.join(inb, '46.pdf'));
  }
}

function testReconcileRealFs() {
  console.log('reconcileHolding (real fs) —');
  const inbox = path.join(ROOT, 'inbox_rec'); fs.mkdirSync(inbox, { recursive: true });
  const db = new Database(':memory:'); runMigrations(db);
  const mk = (status) => documents.insert(db, { original_filename: 'x.pdf', folder_path: '/in', status }).lastInsertRowid;
  const idNR = mk('needs_review'), idDF = mk('deferred'), idER = mk('error'), idCF = mk('confirmed'), idDL = mk('deleted');
  const T = (n) => fs.writeFileSync(path.join(inbox, n), 'x');
  T(`${idNR}.pdf`); T(`${idDF}.pdf`); T(`${idER}.pdf`);        // live → keep
  T(`${idCF}.pdf`);                                            // confirmed (dead) → remove (copy already unlinked at confirm)
  T(`${idDL}.pdf`);                                            // soft-deleted → KEEP (recoverable — card 1)
  T('888888.pdf');                                             // orphan → remove
  T('junk.part'); T(`${idNR}.pdf.part`);                       // .part debris → remove
  T('notes.txt'); T('final-report.pdf'); T('7x.pdf');          // unmanaged → keep

  const s = proc.reconcileHolding(fs, path, db, inbox);
  const left = new Set(fs.readdirSync(inbox));
  check('live copies (needs_review/deferred/error) all KEPT', left.has(`${idNR}.pdf`) && left.has(`${idDF}.pdf`) && left.has(`${idER}.pdf`));
  check('confirmed (dead) copy removed', !left.has(`${idCF}.pdf`));
  check('SOFT-DELETED copy KEPT — restore must find a page (card 1)', left.has(`${idDL}.pdf`));
  check('orphan (no doc row) removed', !left.has('888888.pdf'));
  check('.part debris removed', !left.has('junk.part') && !left.has(`${idNR}.pdf.part`));
  check('unmanaged files untouched', left.has('notes.txt') && left.has('final-report.pdf') && left.has('7x.pdf'));
  check('summary counts: 2 parts, 1 orphan, 1 dead, 7 kept',
    s.partsRemoved === 2 && s.orphansRemoved === 1 && s.deadRemoved === 1 && s.kept === 7, JSON.stringify(s));
  db.close();
}

(async () => {
  await testWorkingCopy();
  testReconcileRealFs();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? fail + ' FAILED' : 'All working-copy durability / crash-safety checks passed.'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} process.exit(1); });
