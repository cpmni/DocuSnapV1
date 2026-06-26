/**
 * test_preset_labels.js — PRESET_CATALOG default label safety (reggie review).
 *
 * Pure assertions on the catalog constant (no DB), guarding the precision fixes:
 *  - name fields (ungated) carry only QUALIFIED/directional captions — never a bare
 *    ambiguous "From";
 *  - "Valid From" (a validity/terms date) is not seeded on quote_date;
 *  - canonical presets (Purchase/Sales Invoice) defer to shipped field_patterns (no
 *    labels arrays), with the correct company identity per invoice direction.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 npx electron database/modules/test_preset_labels.js
 */
const { PRESET_CATALOG } = require('./document_types');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const byName = (n) => PRESET_CATALOG.find(p => p.name === n);
const field = (preset, key) => (preset.fields || []).find(f => f.key === key) || {};
const labels = (preset, key) => field(preset, key).labels || [];

// ── Remittance Advice: payer name must be qualified, not a bare "From" ──
const rem = byName('Remittance Advice');
check('Remittance found', !!rem);
check('remittance customer_name drops bare "From"', !labels(rem, 'customer_name').includes('From'));
check('remittance customer_name has "Received From"', labels(rem, 'customer_name').includes('Received From'));
check('remittance customer_name has "Payment From"', labels(rem, 'customer_name').includes('Payment From'));

// ── Quote: "Valid From" is a terms date, not the quote date ──
const quote = byName('Quote');
check('Quote found', !!quote);
check('quote_date drops "Valid From"', !labels(quote, 'quote_date').includes('Valid From'));
check('quote_date keeps "Quote Date"', labels(quote, 'quote_date').includes('Quote Date'));

// ── A few enrichment fixes ──
check('delivery customer_name has "Consignee"', labels(byName('Delivery Note'), 'customer_name').includes('Consignee'));
check('statement total has "Closing Balance"', labels(byName('Statement'), 'total_amount').includes('Closing Balance'));
check('statement total never seeds bare "Balance"', !labels(byName('Statement'), 'total_amount').includes('Balance'));

// ── Canonical invoice presets DEFER to field_patterns (no per-field labels) ──
for (const n of ['Purchase Invoice', 'Sales Invoice']) {
  const p = byName(n);
  check(`${n} found`, !!p);
  check(`${n} fields carry NO labels (defer to field_patterns)`,
        (p.fields || []).every(f => !f.labels));
}
check('Purchase Invoice identity = supplier_name', byName('Purchase Invoice').company_key === 'supplier_name');
check('Sales Invoice identity = customer_name', byName('Sales Invoice').company_key === 'customer_name');

// ── Global safety invariant: no seeded label is a bare ambiguous single token ──
const BARE_BAD = new Set(['from', 'to', 'no', 'no.', 'date', 'amount', 'ref', 'total', 'balance', 'number']);
for (const p of PRESET_CATALOG) {
  for (const f of (p.fields || [])) {
    for (const l of (f.labels || [])) {
      check(`"${l}" (${p.name}/${f.key}) is non-empty`, typeof l === 'string' && l.trim().length > 0);
      check(`"${l}" (${p.name}/${f.key}) is not a bare ambiguous token`, !BARE_BAD.has(l.toLowerCase().trim()));
    }
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nAll preset-label checks passed');
process.exit(fail ? 1 : 0);
