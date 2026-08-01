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

// ── 7. BRANDING-BLANK LIVE FILL exception (owner + bob 2026-08-01) ─────────────
// The ONE legitimate crack in the flagged walls: a veto-blanked issuer (empty +
// 'confirm the correct company' marker note) re-checked against warmer learning that
// resolves the sender. opts.brandingBlankSupplier gates it (threaded from
// REEXTRACT_UNPIN_BLANK_SUPPLIER); OFF = byte-identical to the walls above.
section('Branding-blank issuer live fill — narrow exception, everything else walled:');
{
  const BB = { validation_note: "The sender's name couldn't be confirmed on this page. Please "
                              + "confirm the correct company — it's usually printed at the top "
                              + "of the document." };
  const vetoRow = exrow('supplier_name', null, { ...BB, extraction_method: 'template_fixed', confidence: 0 });
  const inferred = fast('Vellum & Crane Stationers',
    { confidence: 70, method: 'template_identity',
      validation_note: 'Company inferred from previously filed documents on this layout — please confirm before filing.' });
  const ON = { brandingBlankSupplier: true };
  check('veto-blanked issuer + inferred fresh read → SUGGESTED (the live ⟳ pill)',
        merge([vetoRow], { supplier_name: inferred }, new Set(), ON).length === 1);
  check('…clean note-free fresh read also suggested',
        merge([vetoRow], { supplier_name: fast('Vellum & Crane Stationers') }, new Set(), ON).length === 1);
  check('opts OFF → walls hold (byte-identical legacy)',
        merge([vetoRow], { supplier_name: inferred }, new Set()).length === 0
        && merge([vetoRow], { supplier_name: inferred }, new Set(), {}).length === 0);
  check('fresh read with a DIFFERENT note class → walled (never surface a flagged value)',
        merge([vetoRow], { supplier_name: fast('X Corp', { validation_note: 'format differs from the usual — please verify' }) },
              new Set(), ON).length === 0);
  check('stored row with a NON-branding note → walled (the exception needs the marker)',
        merge([exrow('supplier_name', null, { validation_note: 'some other flag', confidence: 0 })],
              { supplier_name: inferred }, new Set(), ON).length === 0);
  check('stored row with a VALUE → walled (fill-only forever)',
        merge([exrow('supplier_name', 'Ridgeway Plant Hire', BB)],
              { supplier_name: inferred }, new Set(), ON).length === 0);
  check('other field keys never use the exception',
        merge([exrow('invoice_number', null, BB)],
              { invoice_number: inferred }, new Set(), ON).length === 0);
  // FLIPPED 2026-08-01 evening (was: "anchor-abstain still wins over the exception"): every
  // confirm writes an authoritative supplier_name anchor for its scope, so the old
  // composition killed the exception's ONE target case (a sibling batch after the first
  // confirm — measured live on the 18-doc Saltmarsh queue). The branding-note marker the
  // exception requires can never appear on an anchored INTENTIONAL empty, so ordinary
  // abstains keep their wall (next check).
  check('branding-blank exception cracks the anchor-abstain wall (the sibling-batch case)',
        merge([vetoRow], { supplier_name: inferred }, new Set(['supplier_name']), ON).length === 1);
  // BOTH live veto-class copies carry the marker (the no-name blank ends 'confirm the
  // correct company', the logo-conflict blank ends 'set the correct company' — a one-copy
  // matcher missed 6 of 17 live Saltmarsh docs, and broke once before: cea79ef).
  check("…'set the correct company' (logo-conflict copy) also admits the exception",
        merge([exrow('supplier_name', null, { validation_note:
                "Couldn't confirm which company sent this — the logo matched another company but the page text doesn't agree. Please set the correct company.",
                confidence: 0 })],
              { supplier_name: inferred }, new Set(['supplier_name']), ON).length === 1);
  check('…but a NON-exception anchored field still abstains (ordinary wall intact)',
        merge([exrow('invoice_number', null, { validation_note: null, confidence: 0 })],
              { invoice_number: fast('INV-123') }, new Set(['invoice_number']), ON).length === 0);
}

section('Known-template pick admission (REEXTRACT_BLANK_REIDENTIFY — the Saltmarsh cold-batch fix)');
{
  const { _admitReextractPick: admit } =
    require(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'));
  check('non-blank doc: guarded pick admissible (pre-existing behaviour)',
        admit(false, null, 21) === true && admit(false, 5, 21) === true);
  check('no pick → never admissible', admit(false, 5, null) === false && admit(true, 5, null) === false);
  check('PIN anti-recollision (930842e): blank doc + pick == stale stored id → NOT admissible',
        admit(true, 5, 5) === false);
  check('blank doc + pick differs from stale id → admissible (sibling template born since)',
        admit(true, 5, 21) === true);
  check('blank doc never linked (stored null) + fresh pick → admissible',
        admit(true, null, 21) === true);
}

console.log(`\n${fails ? fails + ' FAILED' : 'All fast re-extract fill-only merge checks passed.'}`);
process.exit(fails ? 1 : 0);
