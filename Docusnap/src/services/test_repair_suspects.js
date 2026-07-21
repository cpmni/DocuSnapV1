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

// B1 for a ref field typed plain 'text' (built-in ref fields are) — must still shape-check
// via the key-role coercion (the live invoice_number case).
const b1t = [];
for (let i = 1; i <= 5; i++) b1t.push({ document_id: i, field_key: 'invoice_number', value: `1184${i}`, field_type: 'text' });
b1t.push({ document_id: 6, field_key: 'invoice_number', value: '152888', field_type: 'text' });   // 6-digit off-shape singleton
check('B1 flags a TEXT-typed ref off-shape singleton (key-role coercion)', R.detectAnomalousValues(b1t).some(s => s.id === 6 && s.field === 'invoice_number'));

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

// ── Outlier field explanations (per-field "why it looks out of place") ────────────
console.log('explainOutlierFields — per-field reasons for an outlier doc');
// 6 conforming refs '####' + the outlier doc (id 99) with an off-shape '######' ref
// and a garbled supplier name. Only the outlier's fields get explained.
const ov = [];
for (let i = 1; i <= 6; i++) {
  ov.push({ document_id: i, field_key: 'invoice_number', value: `31${i}0`, field_type: 'alphanumeric' });
  ov.push({ document_id: i, field_key: 'supplier_name', value: 'SuperStore', field_type: 'text' });
}
ov.push({ document_id: 99, field_key: 'invoice_number', value: '152888', field_type: 'alphanumeric' });
ov.push({ document_id: 99, field_key: 'supplier_name', value: 'xzq wq zzt', field_type: 'text' });
const ef = R.explainOutlierFields(ov, [99]);
check('explains the outlier ref (off-shape)', ef.some(s => s.id === 99 && s.field === 'invoice_number' && /usual format/.test(s.text)));
check('explanation carries a dominant-shape example', ef.some(s => s.field === 'invoice_number' && s.example));
check('explains the outlier garbled name', ef.some(s => s.id === 99 && s.field === 'supplier_name'));
check('does NOT explain a conforming (non-outlier) doc', !ef.some(s => s.id !== 99));
check('no outlier ids → nothing explained', R.explainOutlierFields(ov, []).length === 0);

// A ref field typed plain 'text' (built-in ref fields are) must STILL get shape-checked via
// the key-role coercion — this is the live invoice_number=######  vs dominant ##### case.
const ovText = [];
for (let i = 1; i <= 6; i++) ovText.push({ document_id: i, field_key: 'invoice_number', value: `3${i}150`, field_type: 'text' });
ovText.push({ document_id: 99, field_key: 'invoice_number', value: '152888', field_type: 'text' });
check('explains a TEXT-typed ref field via key-role coercion', R.explainOutlierFields(ovText, [99]).some(s => s.id === 99 && s.field === 'invoice_number'));
check('isRefLike matches invoice_number / po_number / reference', R.isRefLike('invoice_number') && R.isRefLike('po_number') && R.isRefLike('reference') && !R.isRefLike('customer_name'));

// ── Detector B4: reference-PREFIX outlier (wrong-document-type misfile) ────────────
// The motivating live case: one PO-21275 among 80 DN-##### delivery numbers (doc #190,
// the poisoned GT). shapeSignature folds both to "@@-#####", so B1/explainOutlierFields
// are structurally blind; B4 learns the dominant LITERAL prefix and flags the odd one.
console.log('Detector B4 — ref-prefix outliers');
// alphaPrefix contract (always runs, independent of the kill switch).
check('alphaPrefix: >=2 letters uppercased; null on numeric-lead / single letter',
  R.alphaPrefix('dn-1') === 'DN' && R.alphaPrefix('PO-2') === 'PO'
  && R.alphaPrefix('2024-INV') === null && R.alphaPrefix('S-1') === null && R.alphaPrefix('123') === null);

// Target pool: 12 DN + 1 PO singleton (models DN:80/PO:1 at unit scale).
const p4 = [];
for (let i = 1; i <= 12; i++) p4.push({ document_id: i, field_key: 'delivery_number', value: `DN-${70000 + i}`, field_type: 'text' });
p4.push({ document_id: 99, field_key: 'delivery_number', value: 'PO-21275', field_type: 'text' });
// Uniform SO pool — must never flag.
const p4u = [];
for (let i = 1; i <= 10; i++) p4u.push({ document_id: i, field_key: 'sales_order_number', value: `SO-${1000 + i}`, field_type: 'text' });
// Gate-3 case: 17 bare numbers + 6 WS + 1 XY singleton (models service_worksheet/reference_number,
// 29% prefixed). Without gate 3 the XY would flag (WS 6/7 dominant); gate 3 must skip the field.
const p4m = [];
for (let i = 1; i <= 17; i++) p4m.push({ document_id: i, field_key: 'reference_number', value: `${400000 + i}`, field_type: 'text' });
for (let i = 1; i <= 6; i++) p4m.push({ document_id: 100 + i, field_key: 'reference_number', value: `WS-${i}`, field_type: 'text' });
p4m.push({ document_id: 200, field_key: 'reference_number', value: 'XY-9', field_type: 'text' });
// Recurrence exemption: a 2nd prefix used by >=2 docs is a learned rare format, not a singleton.
const p4r = [];
for (let i = 1; i <= 12; i++) p4r.push({ document_id: i, field_key: 'delivery_number', value: `DN-${70000 + i}`, field_type: 'text' });
p4r.push({ document_id: 98, field_key: 'delivery_number', value: 'GRN-1', field_type: 'text' });
p4r.push({ document_id: 99, field_key: 'delivery_number', value: 'GRN-2', field_type: 'text' });
// Thin pool: 6 DN + 1 PO (n=7 < 8) → gate 1 skip.
const p4t = [];
for (let i = 1; i <= 6; i++) p4t.push({ document_id: i, field_key: 'delivery_number', value: `DN-${i}`, field_type: 'text' });
p4t.push({ document_id: 99, field_key: 'delivery_number', value: 'PO-1', field_type: 'text' });

if (process.env.REPAIR_PREFIX_MISMATCH === '0') {
  // Kill switch = byte-identical: the detector must be a total no-op.
  check('KILL SWITCH (REPAIR_PREFIX_MISMATCH=0): detectRefPrefixOutliers is a no-op',
    R.detectRefPrefixOutliers(p4).length === 0 && R.detectRefPrefixOutliers(p4r).length === 0 && R.detectRefPrefixOutliers(p4m).length === 0);
} else {
  const f4 = R.detectRefPrefixOutliers(p4);
  check('B4 flags a PO ref in a DN pool (the doc #190 class)', f4.some(s => s.id === 99 && s.field === 'delivery_number' && s.severity === 3));
  check('B4 does NOT flag the dominant DN refs', !f4.some(s => s.id !== 99));
  check('B4 silent on a uniform SO pool', R.detectRefPrefixOutliers(p4u).length === 0);
  check('B4 gate-3: field with prefixes NOT the norm (29% prefixed) is skipped despite an off-prefix singleton', R.detectRefPrefixOutliers(p4m).length === 0);
  check('B4 exempts a recurring 2nd prefix (>=2 docs = learned rare format)', R.detectRefPrefixOutliers(p4r).length === 0);
  check('B4 thin pool (<8) → no flags', R.detectRefPrefixOutliers(p4t).length === 0);
}

console.log(`\n${fail ? fail + ' FAILED' : 'All repairSuspects detector checks passed.'}`);
process.exit(fail ? 1 : 0);
