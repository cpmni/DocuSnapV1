'use strict';
// Unit test for sanitizeAnchorLabel — strips document-specific tokens (reference
// numbers / dates / serials) from an auto-detected anchor label so the stored
// label is a stable caption that generalises across documents.
const { sanitizeAnchorLabel } = require('./learning');

let fails = 0;
function eq(got, exp, name) {
  if (got === exp) { console.log(`  OK  ${name}`); }
  else { console.log(`  FAIL ${name}: got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`); fails++; }
}

// The bug: a reference number baked into the label.
eq(sanitizeAnchorLabel('2605-0769-1 Work Address'), 'Work Address', 'ref-prefixed caption -> caption');
// Stable captions pass through unchanged.
eq(sanitizeAnchorLabel('Work Address'), 'Work Address', 'clean caption unchanged');
eq(sanitizeAnchorLabel('Ticket No.'), 'Ticket No.', 'caption with No. unchanged');
eq(sanitizeAnchorLabel('Invoice Number'), 'Invoice Number', 'two-word caption unchanged');
eq(sanitizeAnchorLabel('PO'), 'PO', 'short caption unchanged');
// Trailing / embedded document-specific value tokens are stripped too.
eq(sanitizeAnchorLabel('Invoice 12345'), 'Invoice', 'trailing value stripped');
eq(sanitizeAnchorLabel('Order 2026-05-22 Confirmation'), 'Order Confirmation', 'embedded date stripped');
// Entirely document-specific -> empty (caller deletes / keeps original).
eq(sanitizeAnchorLabel('2605-0769-1'), '', 'bare reference -> empty');
eq(sanitizeAnchorLabel('22-05-2026'), '', 'bare date -> empty');
eq(sanitizeAnchorLabel('H7R5326676'), '', 'code-like serial -> empty');
// Edge inputs.
eq(sanitizeAnchorLabel(''), '', 'empty -> empty');
eq(sanitizeAnchorLabel(null), '', 'null -> empty');

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nAll sanitizeAnchorLabel checks passed.');
