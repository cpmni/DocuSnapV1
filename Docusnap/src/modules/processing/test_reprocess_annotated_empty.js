'use strict';
/*
 * test_reprocess_annotated_empty.js — pins REPROCESS_ANNOTATED_EMPTY_WINS
 * (2026-07-31; Oracle SIGN-OFF-W/COND, second pass on the name-presence veto).
 *
 * THE BUG (live, docs 171/173/180/181): mergeReprocessRows' kept_existing carry-over
 * treated an engine's DELIBERATE annotated empty (null value + validation_note — the
 * abstain-speak class: TEMPLATE_FIXED_NAME_PRESENCE_VETO, BRANDING_NAMED_BLANK,
 * logo-abstain, positional-read drop, shape/date withholds) as "reprocess read nothing"
 * and resurrected the stale wrong value + OLD note. The veto fired python-side and the
 * merge undid it. NOTE (Oracle C5): the realdoc M=0 harness runs FRESH extraction and is
 * structurally BLIND to this merge — THIS battery is the gate.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> src/modules/processing/test_reprocess_annotated_empty.js
 */
const path = require('path');
const H = require(path.join(__dirname, 'handler.js'));
const merge = H._mergeReprocessRows;
const reex = H._mergeReextractRows;
const colBlank = H._supplierColumnBlanked;

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const exRow = (over) => Object.assign({
  field_key: 'supplier_name', raw_value: 'Copperfield Electrical',
  display_value: 'Copperfield Electrical', confidence: 69,
  extraction_method: 'template_fixed',
  validation_note: "This document's letterhead doesn't match 'Copperfield Electrical'.",
  corrected_to: null,
}, over || {});
const newAnnotatedEmpty = (over) => Object.assign({
  field_key: 'supplier_name', raw_value: null, display_value: null, confidence: 0,
  extraction_method: 'template_fixed',
  validation_note: "The sender's name couldn't be confirmed on this page. Please confirm the "
    + "correct company — it's usually printed at the top of the document.",
  corrected_to: null, anchor_label: null, candidates: null, suggested_supplier: null,
}, over || {});
const newBareEmpty = (over) => Object.assign({
  // The validator normaliser placeholder {value:None, conf:0, method:'unknown'} — THE shape
  // kept_existing exists for (a degraded pass must never wipe a good stored read).
  field_key: 'supplier_name', raw_value: null, display_value: null, confidence: 0,
  extraction_method: 'unknown', validation_note: null,
  corrected_to: null, anchor_label: null, candidates: null, suggested_supplier: null,
}, over || {});

console.log('§1 PIN — un-annotated empty keeps existing (byte-identical legacy carry-over):');
{
  const traces = [];
  const out = merge([exRow()], [newBareEmpty()], null, (f, d) => traces.push(d));
  check('value/conf/note/corrected_to all carried from the old row',
        out[0].display_value === 'Copperfield Electrical' && out[0].confidence === 69
        && /letterhead doesn't match/.test(out[0].validation_note || ''));
  check("trace decision 'kept_existing'", traces.includes('kept_existing'));
}

console.log('\n§1b Oracle C2 (2026-08-11) — the corroboration RECORD rides with a kept value:');
{
  // A kept value whose record was dropped read as "no longer corroborated" in Review after
  // every reprocess-that-kept. Both keep branches carry it: kept_existing and the
  // missing-from-new carry-over.
  const corrobJson = '{"winner_family":"mapping","agree":["keyword"],"disagree":[],"independent_agree":true}';
  const kept = merge([exRow({ corroboration: corrobJson })], [newBareEmpty()], null, null);
  check('kept_existing carries corroboration', kept[0].corroboration === corrobJson);
  const carried = merge([exRow({ field_key: 'vat_no', corroboration: corrobJson })],
                        [newBareEmpty({ field_key: 'supplier_name' })], null, null);
  const vatRow = carried.find(r => r.field_key === 'vat_no');
  check('missing-from-new carry-over carries corroboration', vatRow && vatRow.corroboration === corrobJson);
  // Control: a NEW value (used_new) keeps ITS OWN record, never the stale one.
  const fresh = merge([exRow({ corroboration: corrobJson })],
                      [exRow({ display_value: 'New Co', raw_value: 'New Co', corroboration: null })], null, null);
  check('a replaced value does NOT inherit the old record', fresh[0].corroboration == null);
}

console.log('\n§1c TEMPLATE_HIDDEN_FIELD_DROP (gary 2026-08-11) — declared-absent keys stop resurrecting:');
{
  // The owner's exhibit: "when I remove them and reprocess, they return again" — kept_existing
  // carried the stored wrong fill over the engine's new empty on every reprocess.
  const hidden = new Set(['account_no']);
  const exHid = exRow({ field_key: 'account_no', display_value: 'JB-8887', raw_value: 'JB-8887',
                        validation_note: null });
  const out = merge([exHid], [newBareEmpty({ field_key: 'account_no' })], null, null, hidden);
  check('a stored fill on a DECLARED-ABSENT key is dropped, not resurrected',
        !out.some(r => r.field_key === 'account_no'));
  // The human's answer is never lost — same convention as the annotated-empty corrected_to rule.
  const exCorr = exRow({ field_key: 'account_no', display_value: 'ACC-1', raw_value: 'ACC-1',
                         corrected_to: 'ACC-1', validation_note: null });
  const out2 = merge([exCorr], [newBareEmpty({ field_key: 'account_no' })], null, null, hidden);
  check('PINNED: a hidden row the OPERATOR corrected survives (corrected_to is sacred)',
        out2.some(r => r.field_key === 'account_no' && r.corrected_to === 'ACC-1'));
  // Carry-over rows (missing from new) obey the same rule.
  const out3 = merge([exHid], [newBareEmpty({ field_key: 'supplier_name' })], null, null, hidden);
  check('a hidden-key CARRY-OVER row is dropped too', !out3.some(r => r.field_key === 'account_no'));
  // Control: hiddenKeys null/empty = byte-identical to the whole battery above and below.
  const outNull = merge([exHid], [newBareEmpty({ field_key: 'account_no' })], null, null, null);
  check('CONTROL: hiddenKeys=null keeps today\'s kept_existing byte-identically',
        outNull.some(r => r.field_key === 'account_no' && r.display_value === 'JB-8887'));
}

console.log('\n§2 Annotated empty WINS (the abstain-speak class lands on reprocess):');
{
  const traces = [];
  const out = merge([exRow()], [newAnnotatedEmpty()], null, (f, d) => traces.push(d));
  check('value is NULL (the stale Copperfield is NOT resurrected)', out[0].display_value == null);
  check('the NEW note stands (veto note, not the old letterhead note)',
        /couldn't be confirmed/.test(out[0].validation_note || ''));
  check("distinct trace decision 'used_new_annotated' (Oracle C4)",
        traces.includes('used_new_annotated') && !traces.includes('kept_existing'));
}
{
  // BRANDING_NAMED_BLANK shape: annotated empty + suggested_supplier → the Use-button
  // must survive the merge (it now works on reprocess for the first time).
  const out = merge([exRow()],
    [newAnnotatedEmpty({ suggested_supplier: 'Thornbury Fasteners' })], null, null);
  check('suggested_supplier rides the new row (named-blank Use-button on reprocess)',
        out[0].suggested_supplier === 'Thornbury Fasteners' && out[0].display_value == null);
}

console.log('\n§3 PIN — operator correction outranks the engine abstain (Oracle C1, blocking):');
{
  const out = merge([exRow({ corrected_to: 'Ironbridge Fabrication' })],
                    [newAnnotatedEmpty()], null, null);
  check('corrected row keeps the human answer (kept_existing) despite the annotated empty',
        out[0].display_value === 'Copperfield Electrical'
        && out[0].corrected_to === 'Ironbridge Fabrication');
}

console.log('\n§4 Kill switch — OFF is byte-identical to the legacy merge:');
process.env.REPROCESS_ANNOTATED_EMPTY_WINS = '0';
try {
  const out = merge([exRow()], [newAnnotatedEmpty()], null, null);
  check('OFF → kept_existing even on an annotated empty',
        out[0].display_value === 'Copperfield Electrical'
        && /letterhead doesn't match/.test(out[0].validation_note || ''));
  check('OFF → column mirror never blanks', colBlank([newAnnotatedEmpty()]) === false);
} finally {
  delete process.env.REPROCESS_ANNOTATED_EMPTY_WINS;
}

console.log('\n§5 Type-flip compose — annotated-empty rows present, flip note still lands:');
{
  const flip = { newTypeKeys: new Set(['supplier_name', 'po_number']), refKey: 'po_number',
                 noteText: "Document type changed from 'Invoice' to 'Purchase Order' on reprocess — please check the fields." };
  const out = merge(
    [exRow(), { field_key: 'po_number', raw_value: 'PO-1', display_value: 'PO-1', confidence: 95,
                extraction_method: 'keyword', validation_note: null, corrected_to: null }],
    [newAnnotatedEmpty(),
     { field_key: 'po_number', raw_value: 'PO-1', display_value: 'PO-1', confidence: 95,
       extraction_method: 'keyword', validation_note: null, corrected_to: null,
       anchor_label: null, candidates: null, suggested_supplier: null }],
    flip, null);
  const po = out.find(r => r.field_key === 'po_number');
  const sup = out.find(r => r.field_key === 'supplier_name');
  check('flip note planted on the ref row; no crash with a value-less supplier row',
        /type changed/.test(po.validation_note || '') && sup.display_value == null);
}

console.log('\n§6 Column mirror predicate (Oracle C2):');
{
  check('annotated-empty supplier row → TRUE (documents.supplier_name goes NULL)',
        colBlank([newAnnotatedEmpty()]) === true);
  check('valued supplier row → FALSE', colBlank([exRow()]) === false);
  check('bare (un-annotated) empty → FALSE (COALESCE keeps the old scope)',
        colBlank([newBareEmpty()]) === false);
  check('no supplier row at all → FALSE', colBlank([{ field_key: 'po_number', display_value: 'PO-1' }]) === false);
}

console.log('\n§7 PIN — mergeReextractRows untouched (Oracle C3, fill-only law):');
{
  // An annotated-empty fast-reextract result must NEVER become a suggestion pill.
  const sugg = reex([{ field_key: 'supplier_name', display_value: null, validation_note: null }],
                    { supplier_name: { value: null, confidence: 0,
                                       validation_note: 'nothing was assumed' } });
  check('annotated-empty fast result → no suggestion', !sugg || !sugg.supplier_name);
}

console.log('\n§8 PIN — REPROCESS_SHADOW_STALE_DROP (built 2026-08-12 NIGHT, the Pelican re-poison exhibit):');
{
  // A stale shadow_reconcile row (the vat-reg 2093.55 mint) whose field the fresh run no longer
  // produces: DARK = carried forward (today's behaviour, the doc stays poisoned); ARMED = dropped
  // so the maths reflect THIS run's reads. A row the operator corrected is human data — never
  // dropped, either way.
  const shadowRow = { field_key: 'vat_tax', raw_value: '2093.55', display_value: '2093.55',
                      confidence: 90, extraction_method: 'shadow_reconcile',
                      validation_note: null, corrected_to: null };
  const freshRows = [{ field_key: 'total', raw_value: '11,052.96', display_value: '11,052.96',
                       confidence: 94, extraction_method: 'template_mapping',
                       validation_note: null, corrected_to: null }];
  delete process.env.REPROCESS_SHADOW_STALE_DROP;
  const dark = merge([shadowRow], freshRows, null, null);
  check('DARK: stale shadow row carried forward (byte-identical today)',
        dark.some(r => r.field_key === 'vat_tax' && r.display_value === '2093.55'));
  process.env.REPROCESS_SHADOW_STALE_DROP = '1';
  const traces = [];
  const armed = merge([shadowRow], freshRows, null, (f, d) => traces.push(`${f}:${d}`));
  check('ARMED: stale shadow row DROPPED', !armed.some(r => r.field_key === 'vat_tax'));
  check('ARMED: drop is traced (dropped_stale_shadow)', traces.includes('vat_tax:dropped_stale_shadow'));
  const armedCorr = merge([{ ...shadowRow, corrected_to: '1,842.16' }], freshRows, null, null);
  check('ARMED: an operator-corrected shadow row is NEVER dropped (human data sacred)',
        armedCorr.some(r => r.field_key === 'vat_tax'));
  const armedFresh = merge([shadowRow],
    freshRows.concat([{ field_key: 'vat_tax', raw_value: '1,842.16', display_value: '1,842.16',
                        confidence: 90, extraction_method: 'shadow_reconcile',
                        validation_note: null, corrected_to: null }]), null, null);
  check('ARMED: a field the fresh run DID produce uses the new read (used_new path, not the drop)',
        armedFresh.some(r => r.field_key === 'vat_tax' && r.display_value === '1,842.16'));
  const armedNonShadow = merge([{ ...shadowRow, extraction_method: 'keyword' }], freshRows, null, null);
  check('ARMED: a NON-shadow row is untouched by the drop (carried as today)',
        armedNonShadow.some(r => r.field_key === 'vat_tax'));
  process.env.REPROCESS_SHADOW_STALE_DROP = '0';
  const killed = merge([shadowRow], freshRows, null, null);
  check('env =0 kills the drop even if the setting were on (harness both-directions)',
        killed.some(r => r.field_key === 'vat_tax'));
  delete process.env.REPROCESS_SHADOW_STALE_DROP;
}

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('ALL PASS');
