'use strict';
/*
 * test_supplier_identifiers.js — slice 1a of the identifier-registry arc: the JS extractor twin +
 * the confirm-time LEARN (name-gated, issuer-region) + retract. DARK behind `identifier_registry`.
 * The load-bearing pin is the C2 name-gate SEAM: a doc whose confirmed supplier name is ABSENT from
 * the header (buyer-issued) learns NOTHING — so a recipient/counterparty VAT is never learned as the
 * issuer's. Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd database/modules/test_supplier_identifiers.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const learning = require('./learning');
const idext = require('./identifierExtract');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── extractor twin (parity with the Python test: GB980780684 is checksum-valid) ──
check('checksum: a valid VAT passes', idext.validVatGb('GB 980 7806 84') === true);
check('checksum: a one-digit-off VAT FAILS (never fold)', idext.validVatGb('GB 980 7806 85') === false);
check('checksum: GD/HA government form bypasses', idext.validVatGb('GBGD001') && idext.validVatGb('GBHA500'));

const HDR = "Castellan Security Systems\nVAT Reg No GB 980 7806 84\nRegistered in England No 04123456\n"
          + "Tel: 0161 496 0248\nFax: 0161 496 0249\nSERVICE WORKSHEET\nBILL TO\nBramblewood Joinery Ltd\n";
const ids = idext.extractIdentifiers(HDR);
check('twin: VAT extracted in the header region', ids.some(i => i.kind === 'vat' && i.value_norm === 'GB980780684' && i.position.region === 'header'));
check('twin: captioned company number zero-padded', ids.some(i => i.kind === 'company_no' && i.value_norm === '04123456'));
check('twin: FAX not extracted as a phone', !ids.some(i => i.kind === 'phone' && i.value_norm === '01614960249'));

function fresh() { const db = new Database(':memory:'); runMigrations(db); return db; }

// ── LEARN (armed) ──
process.env.IDENTIFIER_REGISTRY = '1';
const db = fresh();
db.prepare("INSERT INTO documents (id, original_filename, folder_path, status, supplier_name, ocr_text) VALUES (1,'x.pdf','C:/in','confirmed','Castellan Security Systems',?)").run(HDR);
const r = learning.saveSupplierIdentifiers(db, { supplierName: 'Castellan Security Systems', ocrText: HDR, documentId: 1 });
check('learn: >=1 identifier learned from a name-present header', r.learned >= 1);
const vrow = db.prepare("SELECT * FROM supplier_identifiers WHERE kind='vat'").get();
check('learn: VAT row stored (header region, normalised)', !!vrow && vrow.value_norm === 'GB980780684' && vrow.issuer_region === 'header');
learning.saveSupplierIdentifiers(db, { supplierName: 'Castellan Security Systems', ocrText: HDR, documentId: 1 });
check('learn: dedup — a second sighting bumps times_seen, no dup row',
      db.prepare("SELECT COUNT(*) n, MAX(times_seen) t FROM supplier_identifiers WHERE kind='vat'").get().n === 1
      && db.prepare("SELECT times_seen FROM supplier_identifiers WHERE kind='vat'").get().times_seen === 2);

// ── PIN-SEAM (C2): name ABSENT from the header (buyer-issued) → learn NOTHING ──
const db2 = fresh();
const r2 = learning.saveSupplierIdentifiers(db2, { supplierName: 'Quillstone Print', ocrText: HDR, documentId: 2 });   // header names Castellan, not Quillstone
check('SEAM: a name-absent header (buyer-issued) learns 0 — never a recipient/counterparty identifier',
      r2.learned === 0 && db2.prepare('SELECT COUNT(*) n FROM supplier_identifiers').get().n === 0);

// ── PIN-OFF: switch off ⇒ inert ──
process.env.IDENTIFIER_REGISTRY = '0';
const db3 = fresh();
const r3 = learning.saveSupplierIdentifiers(db3, { supplierName: 'Castellan Security Systems', ocrText: HDR, documentId: 3 });
check('OFF: 0 learned (byte-identical confirm)', r3.learned === 0 && db3.prepare('SELECT COUNT(*) n FROM supplier_identifiers').get().n === 0);
process.env.IDENTIFIER_REGISTRY = '1';

// ── retract (deconfirm inverse) ──
const un = learning.retractSupplierIdentifiers(db, 1);
check('retract: re-derives the doc\'s identifiers and decrements', (un.decremented + un.deleted) >= 1
      && db.prepare("SELECT times_seen FROM supplier_identifiers WHERE kind='vat'").get().times_seen === 1);
delete process.env.IDENTIFIER_REGISTRY;

console.log(fails ? `\n${fails} FAILED` : '\nAll supplier-identifier pins passed');
process.exit(fails ? 1 : 0);
