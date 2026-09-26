'use strict';
// Guards src/windows/shared/importRoleResolve.js — the suggested-teach role-value fallback (reggie +
// gary → Oracle SIGN-OFF-W/COND 2026-09-26). The auto-draw looked up the import read by the taught
// type's EXACT key; an untyped import stores its reads under speculative keys, so teaching the doc as
// a type with different role keys missed a value that WAS read. This resolver routes the doc's single
// AGREED date/ref to the taught date/ref ROLE — exact-key first, strict role-equality trigger,
// fail-toward-manual on disagreement.
//   node src/windows/shared/test_import_role_resolve.js
global.window = global;
const R = require('./importRoleResolve');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// Alias sets as the renderer builds them from getAllDocTypes (the built-in types).
const TYPES = [
  { slug: 'invoice',        ref_field_key: 'invoice_number',      date_field_key: 'invoice_date' },
  { slug: 'sales_order',    ref_field_key: 'sales_order_number',  date_field_key: 'order_date' },
  { slug: 'purchase_order', ref_field_key: 'po_number',           date_field_key: 'po_date' },
  { slug: 'service_worksheet', ref_field_key: 'reference_number', date_field_key: 'worksheet_date' },
  { slug: 'quote',          ref_field_key: 'quote_number',        date_field_key: 'quote_date' },
];
const AL = R.buildRoleAliases(TYPES);
// opts for teaching as a QUOTE (quote_date / quote_number are the roles).
const quoteOpts = { refFieldKey: 'quote_number', dateFieldKey: 'quote_date', dateAlias: AL.dateAlias, refAlias: AL.refAlias };
// doc-11: an untyped import that stored the same date under four speculative keys + a reference_number.
const DOC11 = {
  invoice_date: '18-04-2025', order_date: '18-04-2025', po_date: '18-04-2025', worksheet_date: '18-04-2025',
  reference_number: 'NRQ-5470', supplier_name: 'Nordwind Refrigeration Ltd',
};

console.log('buildRoleAliases (drift-free from getAllDocTypes):');
check('date alias carries every type date key + doc_date',
  AL.dateAlias.has('invoice_date') && AL.dateAlias.has('quote_date') && AL.dateAlias.has('worksheet_date') && AL.dateAlias.has('doc_date'));
check('ref alias carries every type ref key + reference_number',
  AL.refAlias.has('invoice_number') && AL.refAlias.has('quote_number') && AL.refAlias.has('reference_number'));
check('ref alias does NOT carry a non-ref numeric key (no *_number suffix rule)',
  !AL.refAlias.has('account_no') && !AL.refAlias.has('vat_no'));

console.log('\nresolveImportValueForField — exact-key passthrough (byte-identical):');
check('exact key present → returned unchanged',
  R.resolveImportValueForField({ key: 'invoice_date' }, { invoice_date: '18-04-2025' },
    { dateFieldKey: 'invoice_date', refFieldKey: 'invoice_number', dateAlias: AL.dateAlias, refAlias: AL.refAlias }) === '18-04-2025');
check('PASSTHROUGH WINS over role — exact key present, roles target it, aliases would pick a DIFFERENT value',
  R.resolveImportValueForField({ key: 'quote_date' }, { quote_date: '01-01-2020', invoice_date: '18-04-2025', order_date: '18-04-2025' }, quoteOpts) === '01-01-2020');
check('empty-string exact value is NOT a hit (falls through to role, then undefined here)',
  R.resolveImportValueForField({ key: 'quote_number' }, { quote_number: '   ' }, quoteOpts) === undefined);

console.log('\nrole fallback — the doc-11 Quote case:');
check('date role: quote_date ← the four agreeing speculative dates',
  R.resolveImportValueForField({ key: 'quote_date' }, DOC11, quoteOpts) === '18-04-2025');
check('ref role: quote_number ← reference_number',
  R.resolveImportValueForField({ key: 'quote_number' }, DOC11, quoteOpts) === 'NRQ-5470');
check('total_amount (neither role) → undefined even with a currency value present',
  R.resolveImportValueForField({ key: 'total_amount' }, Object.assign({ total_paid: '3565.08' }, DOC11), quoteOpts) === undefined);

console.log('\ndisagreement → undefined (fail-toward-manual; the accepted trade-off):');
check('two DISTINCT dates across candidates → date role undefined',
  R.resolveImportValueForField({ key: 'quote_date' }, { invoice_date: '18-04-2025', order_date: '20-04-2025' }, quoteOpts) === undefined);
check('two DISTINCT refs → ref role undefined',
  R.resolveImportValueForField({ key: 'quote_number' }, { invoice_number: 'INV-1', po_number: 'PO-2' }, quoteOpts) === undefined);
check('separator-only difference is AGREEMENT (dates fold separators)',
  R.resolveImportValueForField({ key: 'quote_date' }, { invoice_date: '18-04-2025', order_date: '18/04/2025' }, quoteOpts) === '18-04-2025');

console.log('\nstrict role-equality trigger (Oracle C1 — NOT _isDateField):');
// A non-role date-typed field (expiry_date) sitting beside the role quote_date must NOT get the
// primary date bled onto it — even though the date candidates AGREE (so disagreement-suppression
// would not protect it). This pins the ruling so the broad trigger can't be "restored".
check('non-role date field (expiry_date) → undefined (no date bleed)',
  R.resolveImportValueForField({ key: 'expiry_date' }, DOC11, quoteOpts) === undefined);
check('ref role only fires on the ref role key, not another *_number field',
  R.resolveImportValueForField({ key: 'customer_number' }, DOC11, quoteOpts) === undefined);

console.log('\ndate shape gate + defensive:');
check('a *_date key holding junk is not adopted as the date',
  R.resolveImportValueForField({ key: 'quote_date' }, { invoice_date: 'not a date' }, quoteOpts) === undefined);
check('a *_date key with junk is IGNORED, a real agreeing date still wins',
  R.resolveImportValueForField({ key: 'quote_date' }, { some_date: 'N/A', invoice_date: '18-04-2025', order_date: '18-04-2025' }, quoteOpts) === '18-04-2025');
check('null importValues → undefined', R.resolveImportValueForField({ key: 'quote_date' }, null, quoteOpts) === undefined);
check('null field → undefined', R.resolveImportValueForField(null, DOC11, quoteOpts) === undefined);
check('roles unset (type with no role) → no fallback',
  R.resolveImportValueForField({ key: 'quote_date' }, DOC11, { dateAlias: AL.dateAlias, refAlias: AL.refAlias }) === undefined);

console.log(fails ? `\n${fails} FAILED` : '\nAll import-role-resolve checks passed');
process.exit(fails ? 1 : 0);
