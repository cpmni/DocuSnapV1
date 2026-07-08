'use strict';
// Unit test for database/modules/slug.js — canonical shape, edge cases, uniqueness.
// Run: node database/modules/test_slug.js
const { safeSlug, uniqueSlug } = require('./slug');

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}  =>  ${JSON.stringify(got)}${ok ? '' : ' (want ' + JSON.stringify(want) + ')'}`);
  if (!ok) fail++;
};

// ASCII names unchanged (no regression for existing installs).
eq('Invoice', safeSlug('Invoice', { fallback: 'type' }), 'invoice');
eq('Sales Order', safeSlug('Sales Order', { fallback: 'type' }), 'sales_order');
eq('Purchase Invoice', safeSlug('Purchase Invoice', { fallback: 'type' }), 'purchase_invoice');
// Field keys unchanged.
eq('invoice_number key', safeSlug('invoice_number', { fallback: 'field' }), 'invoice_number');
eq('po_date key', safeSlug('po_date', { fallback: 'field' }), 'po_date');

// Edge cases that used to break.
eq('malformed ref__', safeSlug('ref__', { fallback: 'field' }), 'ref');
eq('malformed amount_', safeSlug('amount_', { fallback: 'field' }), 'amount');
eq('malformed _', safeSlug('_', { fallback: 'field' }), 'field');
eq('malformed __x', safeSlug('__x', { fallback: 'field' }), 'x');
eq('symbol-only ###', safeSlug('###', { fallback: 'type' }), 'type');
eq('emoji + text', safeSlug('📄 Receipt', { fallback: 'type' }), 'receipt');
eq('non-Latin 发票', safeSlug('发票', { fallback: 'type' }), 'type');
eq('accented façade', safeSlug('façade', { fallback: 'type' }), 'facade');
eq('accented Zürich', safeSlug('Zürich', { fallback: 'type' }), 'zurich');
eq('empty', safeSlug('', { fallback: 'type' }), 'type');
eq('null', safeSlug(null, { fallback: 'type' }), 'type');
eq('leading/trailing spaces', safeSlug('  Delivery Note  ', { fallback: 'type' }), 'delivery_note');
eq('collapse runs', safeSlug('a---b...c', { fallback: 'type' }), 'a_b_c');

// Shape check: never leading/trailing/double underscore.
const shape = /^[a-z0-9]+(_[a-z0-9]+)*$/;
for (const inp of ['ref__', '  x  ', '###a###', 'A_B__C', '__z__']) {
  const s = safeSlug(inp, { fallback: 'field' });
  eq(`shape ${JSON.stringify(inp)} -> ${s}`, shape.test(s), true);
}

// Uniqueness suffix.
const taken = new Set(['type', 'type_2']);
eq('uniqueSlug appends past taken', uniqueSlug('发票', (s) => taken.has(s), { fallback: 'type' }), 'type_3');
eq('uniqueSlug first free', uniqueSlug('Invoice', (s) => taken.has(s), { fallback: 'type' }), 'invoice');

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll slug checks passed.');
process.exit(fail ? 1 : 0);
