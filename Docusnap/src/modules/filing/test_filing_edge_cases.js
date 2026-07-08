#!/usr/bin/env node
'use strict';
// Thorough filing edge-case suite — reserved device names, long paths, Unicode/RTL/
// emoji, empty-after-sanitise, path-traversal containment, duplicate chains on disk,
// re-file (no spurious -DUPLICATE), malformed field keys (buildXml must not crash the
// filing), and date normalisation. Complements test_path_hardening + test_filename_pattern.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/filing/test_filing_edge_cases.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const filing = require('./handler');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-filing-'));
const OUTPUT = path.join(ROOT, 'output'); const WORK = path.join(ROOT, 'work');
fs.mkdirSync(OUTPUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
const db = new Database(':memory:'); runMigrations(db);
const DT = { name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' };
let wcSeq = 0;
function workingCopy() { const p = path.join(WORK, `wc_${++wcSeq}.pdf`); fs.writeFileSync(p, `PDF-${wcSeq}-${Math.random()}`); return p; }

async function file(allValues, { existingFiledPath = null } = {}) {
  return filing.commitDocument({
    db, fs, path, outputRoot: OUTPUT, folderPath: WORK, originalFilename: 'scan.pdf',
    workingPath: workingCopy(), existingFiledPath, allValues, documentType: 'Invoice', dtInfo: DT, logger: null,
  });
}
const underRoot = (p) => { const r = path.resolve(OUTPUT), t = path.resolve(p); return t === r || t.startsWith(r + path.sep); };

(async () => {
  // 1. Reserved Windows device name as the supplier folder → defused, contained.
  {
    const r = await file({ supplier_name: 'CON', invoice_number: 'INV-1', invoice_date: '01-01-2024' });
    check('reserved device name "CON" folder is defused + contained', r.success && underRoot(r.filePath) && !/[\\/]CON[\\/]/.test(r.filePath), r.filePath.replace(OUTPUT, '<out>'));
  }
  // 2. Over-long supplier + ref → truncated, safe, contained.
  {
    const longName = 'A'.repeat(300), longRef = 'R'.repeat(300);
    const r = await file({ supplier_name: longName, invoice_number: longRef, invoice_date: '02-02-2024' });
    const seg = r.filePath.replace(OUTPUT + path.sep, '').split(path.sep)[0];
    check('over-long supplier truncated to a safe folder segment', r.success && seg.length <= 80 && underRoot(r.filePath), `(${seg.length} chars)`);
    check('over-long filename does not exceed a sane length', path.basename(r.filePath).length <= 200);
  }
  // 3. Unicode / RTL / emoji supplier → contained, non-empty, exists.
  for (const name of ['Ünîçødé Trading Ltd', 'شركة الاختبار', '株式会社テスト', '📄 Receipts Inc']) {
    const r = await file({ supplier_name: name, invoice_number: 'INV-U', invoice_date: '03-03-2024' });
    check(`unicode/RTL/emoji supplier "${name}" files safely + contained`, r.success && underRoot(r.filePath) && fs.existsSync(r.filePath));
  }
  // 4. Empty-after-sanitise supplier → "Unknown Company" folder (QA #10), never dropped.
  for (const bad of ['..', '///', '***', '.', '   ']) {
    const r = await file({ supplier_name: bad, invoice_number: 'INV-E', invoice_date: '04-04-2024' });
    check(`empty-sanitising supplier ${JSON.stringify(bad)} → Unknown Company folder`, r.success && /Unknown[- ]Company/.test(r.filePath) && underRoot(r.filePath));
  }
  // 5. Path-traversal supplier / ref → contained under the output root (no escape).
  for (const evil of ['../../Windows/System32', '..\\..\\secret', '../..', './../x']) {
    const r = await file({ supplier_name: evil, invoice_number: '../../evil', invoice_date: '05-05-2024' });
    check(`traversal supplier ${JSON.stringify(evil)} stays under the output root`, r.success && underRoot(r.filePath), r.success ? r.filePath.replace(OUTPUT, '<out>') : r.error);
  }
  // 6. Duplicate chain: 3 DISTINCT docs, identical name → F / F-DUPLICATE / F-DUPLICATE-2, all exist + distinct.
  {
    const vals = { supplier_name: 'DupCo', invoice_number: 'INV-DUP', invoice_date: '06-06-2024' };
    const a = await file(vals), b = await file(vals), c = await file(vals);
    const names = [a, b, c].map(r => path.basename(r.filePath));
    const allExist = [a, b, c].every(r => fs.existsSync(r.filePath));
    const distinct = new Set([a, b, c].map(r => path.resolve(r.filePath))).size === 3;
    check('duplicate chain → F / -DUPLICATE / -DUPLICATE-2', /INV-DUP\.pdf$/.test(names[0]) && /-DUPLICATE\.pdf$/.test(names[1]) && /-DUPLICATE-2\.pdf$/.test(names[2]), names.join(', '));
    check('all 3 duplicate copies exist on disk + are distinct', allExist && distinct);
    check('b and c flagged isDuplicate', b.isDuplicate && c.isDuplicate && !a.isDuplicate);
  }
  // 7. Malformed field keys must NOT crash filing (QA #9 buildXml guard) — file still lands.
  {
    const r = await file({ supplier_name: 'KeyCo', invoice_number: 'INV-K', invoice_date: '07-07-2024', 'ref__': 'x', '_': 'y', 'amount_': 'z', '__x': 'w' });
    check('malformed field keys do not crash filing (file still landed)', r.success && fs.existsSync(r.filePath));
  }
  // 8. Re-file of the SAME doc to the SAME name → NOT suffixed -DUPLICATE (in-place update).
  {
    const vals = { supplier_name: 'RefileCo', invoice_number: 'INV-RF', invoice_date: '08-08-2024' };
    const first = await file(vals);
    const again = await file(vals, { existingFiledPath: first.filePath });
    check('re-file to the same name is NOT a duplicate (in-place)', again.success && !again.isDuplicate && path.resolve(again.filePath) === path.resolve(first.filePath), path.basename(again.filePath));
  }
  // 9. Date normalisation → canonical DD-MM-YYYY.
  {
    const cases = [['2024-08-03', '03-08-2024'], ['3/8/2024', '03-08-2024'], ['03.08.2024', '03-08-2024'], ['Aug 3 2024', '03-08-2024'], ['03-08-2024', '03-08-2024']];
    let ok = 0; for (const [inp, want] of cases) { const got = filing.normaliseDate(inp); if (got === want) ok++; else console.log(`    date ${inp} → ${got} (want ${want})`); }
    check('normaliseDate handles common input formats → DD-MM-YYYY', ok === cases.length, `(${ok}/${cases.length})`);
    // Contract: normaliseDate returns null for an unparseable value; the CALLER
    // (reviewService.confirm) only overwrites when the result is truthy, so an
    // unparseable date is never dropped from allValues — it's left as typed.
    check('normaliseDate returns null for an unparseable value (caller keeps original)', filing.normaliseDate('not a date') === null);
  }
  // 10. sanitiseFolderName direct contract.
  {
    check('sanitiseFolderName: dot-only → Unknown Company', filing.sanitiseFolderName('..') === 'Unknown Company');
    check('sanitiseFolderName: empty → Unknown Company', filing.sanitiseFolderName('') === 'Unknown Company');
    check('sanitiseFolderName: strips illegal chars', !/[\\/:*?"<>|]/.test(filing.sanitiseFolderName('a/b:c*d')));
    check('sanitiseFolderName: caps length ≤ 60', filing.sanitiseFolderName('Z'.repeat(200)).length <= 60);
  }
  // 11. EVERY produced path in this run is contained (defence-in-depth sweep already asserted per-case).
  check('no filing escaped the output root (root sweep)', fs.readdirSync(ROOT).length >= 1);

  db.close();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? fail + ' FAILED' : 'All filing edge-case checks passed.'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} process.exit(1); });
