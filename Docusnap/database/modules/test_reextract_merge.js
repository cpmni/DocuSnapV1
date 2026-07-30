#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_reextract_merge.js
 * ----------------------------------------
 * Pins the fill-only merge of the fast on-open text-only re-extract (Slice B, DARK).
 * mergeReextractRows must ONLY ever produce ADDITIVE suggestions — it can never clobber a
 * stored value, never override a taught (anchored) empty, never surface a flagged value, and
 * never resurface a deliberately-flagged empty. A future dev who "unifies" it with
 * mergeReprocessRows (which DOES clobber) turns a read-only suggestion into a silent
 * overwrite; these checks go red first.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_reextract_merge.js
 */

const path = require('path');
const { _mergeReextractRows: merge } =
  require(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'));

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

// existing = array of stored extraction rows; fresh = engine result.extractions MAP.
const exrow = (field_key, display_value, extra = {}) =>
  ({ field_key, raw_value: display_value, display_value, confidence: 90,
     extraction_method: 'keyword', validation_note: null, corrected_to: null, ...extra });
const fast = (value, extra = {}) => ({ value, confidence: 88, method: 'keyword', validation_note: null, ...extra });

// ── 1. The core fill: empty stored field + clean fast value → a suggestion ──────
section('Fill-only core — an empty field the fast run read cleanly is suggested:');
{
  const existing = [exrow('invoice_number', ''), exrow('total_amount', null)];
  const fresh    = { invoice_number: fast('INV-42'), total_amount: fast('123.45') };
  const out = merge(existing, fresh, new Set());
  const by  = Object.fromEntries(out.map(s => [s.field_key, s]));
  check('empty-string field suggested', by.invoice_number && by.invoice_number.value === 'INV-42');
  check('null field suggested', by.total_amount && by.total_amount.value === '123.45');
  check('suggestion carries confidence + method', by.invoice_number.confidence === 88 && by.invoice_number.method === 'keyword');
  check('a field with NO stored row at all is still fillable',
        merge([], { po_number: fast('PO-9') }, new Set()).some(s => s.field_key === 'po_number' && s.value === 'PO-9'));
}

// ── 2. NEVER clobber a stored value (the whole point vs mergeReprocessRows) ─────
section('Keep-existing — a field that already has a value is never overwritten:');
{
  const existing = [exrow('invoice_number', 'INV-1')];
  const fresh    = { invoice_number: fast('INV-999') };   // differs — must be ignored
  const out = merge(existing, fresh, new Set());
  check('stored value present → NO suggestion (keep-existing, even on differ)', out.length === 0);
}

// ── 3. A flagged EMPTY is a review state, not a hole to fill ────────────────────
section('Flagged-empty preserved — an empty field carrying a validation_note is left alone:');
{
  const existing = [exrow('date', '', { validation_note: 'Could not read a valid date' })];
  const fresh    = { date: fast('04-06-2026') };
  check('flagged empty → NO suggestion', merge(existing, fresh, new Set()).length === 0);
}

// ── 4. Anchor-abstain (Oracle C6): a taught position that read nothing wins ─────
section('Anchor-abstain — a field with a learned anchor is not text-filled:');
{
  const existing = [exrow('reference_number', '')];
  const fresh    = { reference_number: fast('REF-7') };
  check('anchored empty field → NO suggestion', merge(existing, fresh, new Set(['reference_number'])).length === 0);
  check('same field, NO anchor → suggested', merge(existing, fresh, new Set()).length === 1);
}

// ── 5. Stage-4 clean only: a fast value the engine flagged is not surfaced ──────
section('Stage-4 clean — a fast value carrying its own validation_note is not suggested:');
{
  const existing = [exrow('total_amount', '')];
  const flagged  = { total_amount: fast('12,3.45', { validation_note: 'amount shape looks wrong' }) };
  check('flagged fast value → NO suggestion', merge(existing, flagged, new Set()).length === 0);
}

// ── 6. Empty / whitespace fast reads produce nothing ───────────────────────────
section('No empty fills — a blank fast read is never a suggestion:');
{
  const existing = [exrow('supplier_name', '')];
  check('null value', merge(existing, { supplier_name: fast(null) }, new Set()).length === 0);
  check('whitespace value', merge(existing, { supplier_name: fast('   ') }, new Set()).length === 0);
  check('empty result map', merge(existing, {}, new Set()).length === 0);
  check('null result map is safe', merge(existing, null, new Set()).length === 0);
}

console.log(`\n${fails ? fails + ' FAILED' : 'All fast re-extract fill-only merge checks passed.'}`);
process.exit(fails ? 1 : 0);
