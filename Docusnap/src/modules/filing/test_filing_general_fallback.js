#!/usr/bin/env node
'use strict';

/**
 * src/modules/filing/test_filing_general_fallback.js
 * --------------------------------------------------
 * PIN 6 of the Generic Document design (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §6):
 * a blank-issuer GENERAL DOCUMENT files under 'General/'; every other type keeps the
 * 'Unknown Company' failure signal byte-identical. Exercises the REAL commitDocument
 * (temp output root + a real source file), not a pure helper.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/filing/test_filing_general_fallback.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'better-sqlite3'));
const { commitDocument } = require('./handler');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

(async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdt_filing_'));
  const outputRoot = path.join(tmp, 'out');
  const srcDir = path.join(tmp, 'src');
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });

  const mk = (name) => { const p = path.join(srcDir, name); fs.writeFileSync(p, 'x'); return name; };

  console.log('§1 generic type + blank issuer ⇒ General/');
  await commitDocument({
    db, fs, path, outputRoot, folderPath: srcDir,
    originalFilename: mk('a.pdf'), workingPath: null, existingFiledPath: null,
    allValues: { supplier_name: '', date: '15-07-2026', title: 'Boiler Service Certificate' },
    documentType: 'General Document',
    dtInfo: { slug: 'general_document', ref_field_key: null, date_field_key: 'date' },
    logger: null,
  });
  let files = walk(outputRoot).map(f => path.relative(outputRoot, f));
  check('filed under General/2026/July', files.some(f => /^General\\2026\\July\\/.test(f)), JSON.stringify(files));
  check('no Unknown Company folder created', !files.some(f => f.startsWith('Unknown-Company') || f.startsWith('Unknown Company')));

  console.log('§2 PIN 6 — every other type keeps Unknown Company byte-identical');
  await commitDocument({
    db, fs, path, outputRoot, folderPath: srcDir,
    originalFilename: mk('b.pdf'), workingPath: null, existingFiledPath: null,
    allValues: { supplier_name: '', invoice_date: '15-07-2026', invoice_number: 'INV-1' },
    documentType: 'Invoice',
    dtInfo: { slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' },
    logger: null,
  });
  files = walk(outputRoot).map(f => path.relative(outputRoot, f));
  check('invoice with blank issuer ⇒ Unknown-Company/', files.some(f => f.startsWith('Unknown-Company') || f.startsWith('Unknown Company')), JSON.stringify(files));

  console.log('§3 a NAMED issuer on a generic doc still gets its own folder (General is the blank fallback only)');
  await commitDocument({
    db, fs, path, outputRoot, folderPath: srcDir,
    originalFilename: mk('c.pdf'), workingPath: null, existingFiledPath: null,
    allValues: { supplier_name: 'Alder Point Joinery', date: '15-07-2026' },
    documentType: 'General Document',
    dtInfo: { slug: 'general_document', ref_field_key: null, date_field_key: 'date' },
    logger: null,
  });
  files = walk(outputRoot).map(f => path.relative(outputRoot, f));
  check('named issuer ⇒ its own company folder', files.some(f => f.startsWith('Alder-Point-Joinery') || f.startsWith('Alder Point Joinery')), JSON.stringify(files));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL — test crashed:', e.message); process.exit(1); });
