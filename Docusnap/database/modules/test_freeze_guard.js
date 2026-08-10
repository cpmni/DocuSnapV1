'use strict';
/*
 * test_freeze_guard.js — pins for TEMPLATE_FREEZE_QUALIFY's predicate.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_freeze_guard.js
 *
 * THE DEFECT. `_buildTemplateFields` decided whether to freeze a value from four inputs, none of
 * which looked at the value. The teach wizard's draw-box OCR read became the template's permanent
 * value at confidence 95, method `template_fixed` — the one method every credibility rail in
 * engine.py deliberately exempts, because it is meant to mean "a human set this literal". On the
 * live install it froze the string 'VAT' as a supplier's VAT number, stamped on 21 of 145 documents.
 *
 * THE BOUNDARY THIS FILE DEFENDS is not "refuse more". On 2026-08-08 a blanket unfreeze of every
 * non-issuer field moved `vat_no` from 51% to 16%: a VAT number IS a genuine per-supplier constant
 * and the stamp was carrying it. So a predicate that is too wide is not cautious, it is
 * destructive. Two rows below are marked TRADE-OFF PIN and carry that measurement as their reason;
 * anyone who widens this to "just don't freeze non-issuer fields" turns them red.
 */
const { freezeDeclineReason } = require('./freeze_guard');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const decl = (k, v, m, ctx) => freezeDeclineReason(k, v, m, ctx);

console.log('1. THE DEFECT — a caption must never become a permanent value');
check("vat_no 'VAT' declined (it is a printed caption, and vat_tax ships it as a label)",
      decl('vat_no', 'VAT', { type: 'text', label: 'VAT Number' }) === 'caption');
check("delivery_number 'Delivery' declined (the 2026-08-07 caption-hijack class)",
      decl('delivery_number', 'Delivery', { type: 'text' }) === 'caption');
check("a caption from THIS TYPE's own field labels is declined too",
      decl('account_no', 'Account Number', { type: 'text' },
           { extraCaptions: ['Account Number'] }) === 'caption');

console.log('\n2. FORMAT — judged by the format the READER uses, not only the DB type');
// vat_no is typed plain 'text' on every shipped and preset type, so a DB-type-only check would be
// inert for the exact field that produced this defect. The shipped field_patterns entry is what the
// reader gates on, so that is what the freeze asks about.
check("vat_no '3PL' declined on format (13 documents on the live install)",
      decl('vat_no', '3PL', { type: 'text' }) === 'format');
check("vat_no '1RE' declined on format (6 documents)",
      decl('vat_no', '1RE', { type: 'text' }) === 'format');
check("vat_no 'ee05351042' declined on format (an OCR garble that looks foreign)",
      decl('vat_no', 'ee05351042', { type: 'text' }) === 'format');

console.log('\n3. CODE-ROLE — a code always carries a digit');
// A key with NO shipped pattern, so arm B is silent and arm C is the only thing that can speak.
// (Using a SHIPPED code key here would pass for the wrong reason — 'job_no' carries its own
// job_reference pattern, so arm B answers first and the pin would never exercise arm C.)
check("a *_no field with no shipped pattern, holding a digit-free word, is declined",
      decl('ticket_no', 'Worksheet', { type: 'text' }) === 'codeless_code_role');
check("...and one carrying a digit is fine",
      decl('ticket_no', 'TK-8887', { type: 'text' }) === null);
check("a *_reference key is code-role too",
      decl('customer_reference', 'Reference', { type: 'text' }) === 'codeless_code_role');

console.log('\n4. TRADE-OFF PINS — measured, not assumed (2026-08-08: vat_no 51% -> 16%)');
check("TRADE-OFF PIN: a REAL VAT number still freezes (text-typed, arm B via the shipped pattern)",
      decl('vat_no', 'GB 903 3318 42', { type: 'text' }) === null);
check("TRADE-OFF PIN: a real VAT number freezes when the field IS typed vat_gb",
      decl('vat_no', 'GB 903 3318 42', { type: 'vat_gb' }) === null);
check("TRADE-OFF PIN: the ISSUER is never governed, in either direction",
      decl('supplier_name', 'VAT', { type: 'text', label: 'Document Issuer' }) === null);
check("a genuinely constant NON-name field still freezes ('Net 30' terms)",
      decl('payment_terms', 'Net 30', { type: 'text' }) === null);
check("...including an all-alpha one, because it is not a code-role key",
      decl('payment_terms', 'On receipt', { type: 'text' }) === null);
check("a currency CODE constant still freezes",
      decl('currency', 'GBP', { type: 'currency_code' }) === null);
// ORACLE C8 — pin what we INTEND on the two fields where arm B genuinely speaks, so the trade-off
// is recorded here rather than discovered by a customer whose template stopped freezing.
// A percentage is not currency, so a frozen discount of '5%' IS declined: intended, because the
// field's own shipped validation says currency and '5%' is not one. If that ever needs to change,
// change the FIELD's validation, not this guard.
check("TRADE-OFF PIN: a frozen discount of '5%' is declined (its shipped format says currency)",
      decl('discount', '5%', { type: 'text' }) === 'format');
check("TRADE-OFF PIN: a bare currency SYMBOL is declined; the three-letter code is what freezes",
      decl('currency', '£', { type: 'currency_code' }) === 'format');

// ORACLE C3 (2026-08-10) -- the VAT_EU_FORMATS seam, pinned as an ACCEPTED COST.
// `vat_eu_formats` widens `validation_patterns.vat_gb` for the two consumers that matter to the
// operator: every Python stage (keyword.load_patterns) and the renderer's on-blur warning
// (get-validation-patterns). It deliberately does NOT widen `trust._sharedValidationPatterns`,
// which is what arm B consults -- so with the flag ARMED a CORRECT German VAT number is still
// declined a freeze, with the reason 'format'. The direction is safe (the field stays variable
// rather than being frozen from a sample of one) but the reason is misleading.
// Pinned so that widening trust.js becomes a DELIBERATE act with the freeze and auto-file paths
// measured, not a tidy-up. The reasoning lives at trust._sharedValidationPatterns.
check("TRADE-OFF PIN: a correct non-UK VAT number is declined a freeze ('format') because trust.js "
      + "is the un-widened third consumer of validation_patterns",
      decl('vat_no', 'DE123456789', { type: 'text' }) === 'format');
check("CONTROL: a UK VAT number is NOT declined by arm B, so the pin above is about the widening "
      + "and not about arm B refusing every vat_no",
      decl('vat_no', 'GB651002784', { type: 'text' }) !== 'format');

console.log('\n5. FAILS SAFE — anything it cannot judge, it allows');
check('unknown custom type + opaque key → freeze (no arm can speak)',
      decl('field_7', 'ANYTHING', { type: 'widget' }) === null);
check('no meta at all → freeze', decl('some_key', 'some value', null) === null);
check('empty value → nothing to judge', decl('vat_no', '   ', { type: 'text' }) === null);
check('empty key → nothing to judge', decl('', 'VAT', { type: 'text' }) === null);
check('a caption-shaped value on the issuer with a custom companyKeys list is still allowed',
      decl('issuer_name', 'VAT', { type: 'text' }, { companyKeys: ['issuer_name'] }) === null);

console.log(fails ? `\n${fails} FAILED` : '\nAll freeze-guard pins passed');
process.exit(fails ? 1 : 0);
