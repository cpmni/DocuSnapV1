#!/usr/bin/env node
'use strict';
/**
 * test_type_heading_label.js — pins the ⊕-teach AUTO-LABEL guard: a caption that is the document's
 * TYPE HEADING ("INVOICE", "Purchase Order") must NOT become an anchor label (it caused every
 * SuperStore invoice to hold at 69% — a title-labeled invoice_number anchor that never re-located).
 * It must fall to a position-only anchor. Guards against the OPPOSITE regression too: a real field
 * caption that merely CONTAINS a type word ("Invoice No", "Order Date") must STILL be usable.
 *
 * Extracts labelIsTypeHeading VERBATIM from renderer.js (so the test can't drift from the source) and
 * evals it with a fake allDocTypes. Run: node src/windows/review/test_type_heading_label.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const m = src.match(/function labelIsTypeHeading\(label\) \{[\s\S]*?\n\}/);
if (!m) { console.error('BAD: could not extract labelIsTypeHeading from renderer.js'); process.exit(1); }

let allDocTypes = [];
// eslint-disable-next-line no-eval
const labelIsTypeHeading = eval(`(${m[0].replace('function labelIsTypeHeading', 'function')})`);

allDocTypes = [
  { name: 'Invoice', title_aliases: ['Tax Invoice'] },
  { name: 'Purchase Order', title_aliases: '["PO"]' },   // aliases may arrive as a JSON string
  { name: 'Delivery Note', title_aliases: null },
];

let fails = 0;
const check = (label, want) => {
  const got = labelIsTypeHeading(label);
  const ok = got === want;
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${JSON.stringify(label).padEnd(18)} -> ${got} (want ${want})`);
  if (!ok) fails++;
};

console.log('type headings → caught (fall back to position-only):');
['INVOICE', 'Invoice', 'PURCHASE ORDER', 'Tax Invoice', 'PO', 'Delivery Note'].forEach(l => check(l, true));

console.log('real field captions that CONTAIN a type word → NOT caught (stay usable):');
['Invoice No', 'Invoice Number', 'Invoice Date', 'Order Date', 'PO Number'].forEach(l => check(l, false));

console.log('generic / empty → not a heading:');
['#', 'Date:', '', '   ', null].forEach(l => check(l, false));

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All type-heading-label checks passed.');
process.exit(0);
