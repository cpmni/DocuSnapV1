#!/usr/bin/env node
'use strict';
// repairSuspects — the precision-first "worth a look" detectors for Learning Repair.
// Tests the pure functions directly (Detector A outliers, Detector B anomalous values):
// precision guards (multi-modal layouts, thin pools, recurring values) must NOT false-flag.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_repair_suspects.js

const R = require('./repairSuspects');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };
const HX = (c) => c.repeat(16);   // a uniform 16-hex phash

// ── Detector A: outlier documents ────────────────────────────────────────────
console.log('Detector A — outlier documents');
// 9-doc dominant layout + a legit 3-doc second layout + 1 true outlier (far hash + unrelated kw).
const kwA = ['invoice', 'acme', 'ltd'], kwB = ['invoice', 'acme', 'quote'], kwOut = ['receipt', 'zenith', 'corp'];
const rowsA = [];
for (let i = 0; i < 9; i++) rowsA.push({ id: 100 + i, logo_phash: HX('a'), keyword_fingerprint: kwA, overall_confidence: 95 });
for (let i = 0; i < 3; i++) rowsA.push({ id: 200 + i, logo_phash: HX('c'), keyword_fingerprint: kwB, overall_confidence: 92 });
rowsA.push({ id: 999, logo_phash: HX('5'), keyword_fingerprint: kwOut, overall_confidence: 60 });   // outlier

const flaggedA = R.detectOutlierDocs(rowsA).map(s => s.id);
check('flags the true outlier', flaggedA.includes(999));
check('does NOT flag the dominant layout (9 docs)', !rowsA.slice(0, 9).some(r => flaggedA.includes(r.id)));
check('does NOT flag the legit 2nd layout (3 docs, multi-modal guard)', ![200, 201, 202].some(id => flaggedA.includes(id)));

// Thin-pool gate: < 8 usable phashes → no detection.
check('thin pool (<8) → no flags', R.detectOutlierDocs(rowsA.slice(0, 6)).length === 0);
// Null/short phash skip: a doc with no phash never becomes a fabricated outlier.
const rowsNull = rowsA.slice(0, 9).concat([{ id: 777, logo_phash: null, keyword_fingerprint: kwOut, overall_confidence: 50 }]);
check('null-phash doc is skipped (no fabricated outlier)', !R.detectOutlierDocs(rowsNull).some(s => s.id === 777));

// ── Detector B: anomalous field values ───────────────────────────────────────
console.log('Detector B — anomalous field values');
// B1: alphanumeric ref, 5× '@@@-####' + 1 off-shape singleton.
const b1 = [];
for (let i = 1; i <= 5; i++) b1.push({ document_id: i, field_key: 'ref', value: `ABC-100${i}`, field_type: 'alphanumeric' });
b1.push({ document_id: 6, field_key: 'ref', value: '9999999', field_type: 'alphanumeric' });
const fb1 = R.detectAnomalousValues(b1);
check('B1 flags the off-shape singleton ref', fb1.some(s => s.id === 6 && s.field === 'ref'));
check('B1 does NOT flag a conforming ref', !fb1.some(s => s.id === 1));

// B1 recurrence exemption: a SECOND shape that recurs (≥2) is learned, not flagged.
const b1r = b1.slice(0, 5).concat([
  { document_id: 6, field_key: 'ref', value: '9999999', field_type: 'alphanumeric' },
  { document_id: 7, field_key: 'ref', value: '8888888', field_type: 'alphanumeric' },
]);
check('B1 exempts a recurring 2nd shape (learned)', !R.detectAnomalousValues(b1r).some(s => s.field === 'ref' && (s.id === 6 || s.id === 7)));

// B2: name field, 5 good names + 1 garbled singleton.
const b2 = [
  { document_id: 1, field_key: 'supplier_name', value: 'Acme Industrial Ltd', field_type: 'text' },
  { document_id: 2, field_key: 'supplier_name', value: 'Beaumont Care Homes', field_type: 'text' },
  { document_id: 3, field_key: 'supplier_name', value: 'Greenfield Trading', field_type: 'text' },
  { document_id: 4, field_key: 'supplier_name', value: 'Sunrise Components', field_type: 'text' },
  { document_id: 5, field_key: 'supplier_name', value: 'Meridian Logistics', field_type: 'text' },
  { document_id: 6, field_key: 'supplier_name', value: 'xzq wq zzt', field_type: 'text' },   // garbled
];
const fb2 = R.detectAnomalousValues(b2);
check('B2 flags a garbled name', fb2.some(s => s.id === 6 && s.field === 'supplier_name'));
check('B2 does NOT flag a good name', !fb2.some(s => s.id === 2));

// B3: currency field with letters.
const b3 = [];
for (let i = 1; i <= 5; i++) b3.push({ document_id: i, field_key: 'total_amount', value: `$1${i}.00`, field_type: 'currency' });
b3.push({ document_id: 6, field_key: 'total_amount', value: '$1OO.OO ABC', field_type: 'currency' });
check('B3 flags letters in a currency field', R.detectAnomalousValues(b3).some(s => s.id === 6 && s.field === 'total_amount'));

// Thin-evidence gate: a field with < 6 confirmed values → nothing flagged.
const thin = b1.slice(0, 4);
check('thin field (<6) → no flags', R.detectAnomalousValues(thin).length === 0);

console.log(`\n${fail ? fail + ' FAILED' : 'All repairSuspects detector checks passed.'}`);
process.exit(fail ? 1 : 0);
