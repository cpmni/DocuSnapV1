'use strict';
/* census_credit_sign.js <off_summary.json> <on_summary.json>
 *
 * The raw_value-on-keyword-money census (commit 32ae95b). My change makes the KEYWORD money mint emit
 * raw_value, which arms validator.credit_sign_note ARM 2 (the raw text carried a negative marker the
 * committed value dropped) on keyword totals — dead before, because keyword reads set no raw_value.
 * CREDIT_SIGN_COHERENCE is LIVE (forced on by money_sign_parens/cr, mig-98), so this ships.
 *
 * OFF arm = keyword.py at 32ae95b^ (pre-change); ON arm = HEAD. Same DB copy, same env, so the ONLY
 * difference is keyword totals carrying raw_value. This script isolates that difference:
 *   1. VALUE SAFETY — no committed field VALUE may differ between arms (the change is purely additive).
 *      Any diff here is a bug; the census FAILS.
 *   2. NEW ARM-2 FLAGS — every field that gained the credit-sign marker note ON but not OFF. These are
 *      exactly the totals my change newly routes to Review. Each needs a HUMAN verdict:
 *         TRUE  = a genuinely mis-signed / mis-typed credit total the app was silently filing as a charge
 *         FALSE = a correct positive total whose matched text carried an incidental marker (a table rule,
 *                 a column-bled 'CR') — a false hold to weigh against the catch.
 *   3. NON-VACUITY — if the ON arm produced ZERO arm-2 marker notes on any total, credit-sign was OFF on
 *      the copy (or no money doc carried a marker) and the run proves nothing. Reported loudly.
 *
 *   node TESTING/_measure/credit_sign_census/census_credit_sign.js <off_summary.json> <on_summary.json>
 */
const fs = require('fs');

// validator._CREDIT_MARKER_NOTE — arm 2's note text (the raw_value-driven one).
const MARKER = 'the amount may be negative on the page — check the sign before filing';
const hasMarker = (note) => String(note || '').includes(MARKER);

const [offPath, onPath] = process.argv.slice(2);
if (!offPath || !onPath) { console.log('usage: census_credit_sign.js <off_summary.json> <on_summary.json>'); process.exit(2); }
const OFF = JSON.parse(fs.readFileSync(offPath, 'utf8'));
const ON = JSON.parse(fs.readFileSync(onPath, 'utf8'));

const valueDiffs = [];   // {doc, field, off, on}
const newFlags = [];     // {doc, field, value, method, offNote}
let onMarkerTotal = 0;   // non-vacuity: any arm-2 marker in the ON arm

for (const doc of Object.keys(ON).sort()) {
  const on = ON[doc], off = OFF[doc];
  if (!off) { console.log(`WARN ${doc}: missing in OFF arm`); continue; }
  const keys = new Set([...Object.keys(on.fields || {}), ...Object.keys(off.fields || {})]);
  for (const k of keys) {
    const fon = (on.fields || {})[k] || {}, foff = (off.fields || {})[k] || {};
    // 1. value safety
    if ((fon.value ?? '') !== (foff.value ?? '')) valueDiffs.push({ doc, field: k, off: foff.value, on: fon.value });
    // 3. non-vacuity tally
    if (hasMarker(fon.note)) onMarkerTotal++;
    // 2. new arm-2 flag: gained the marker note ON, absent OFF
    if (hasMarker(fon.note) && !hasMarker(foff.note)) {
      newFlags.push({ doc, field: k, value: fon.value, method: fon.method, offNote: foff.note || '(none)' });
    }
  }
}

let fail = 0;
console.log('══ raw_value credit-sign census ══');
console.log(`docs: ON=${Object.keys(ON).length} OFF=${Object.keys(OFF).length}`);

console.log(`\n[1] VALUE SAFETY — committed values must be identical across arms (additive change):`);
if (valueDiffs.length) {
  fail = 1;
  console.log(`   FAIL — ${valueDiffs.length} value diff(s) (the change is NOT additive — investigate):`);
  for (const d of valueDiffs) console.log(`   - ${d.doc} [${d.field}] OFF=${JSON.stringify(d.off)} ON=${JSON.stringify(d.on)}`);
} else {
  console.log('   OK — 0 value diffs (purely additive, as designed).');
}

console.log(`\n[3] NON-VACUITY — arm-2 marker notes present in the ON arm: ${onMarkerTotal}`);
if (onMarkerTotal === 0) {
  fail = 1;
  console.log('   VACUOUS — credit-sign produced no arm-2 flags at all. Either CREDIT_SIGN_COHERENCE was');
  console.log('   OFF on the DB copy (check the _run_docs.js [env] line), or no money doc carried a marker.');
  console.log('   The census proves nothing in this state — do NOT read a clean [2] as a pass.');
}

console.log(`\n[2] NEW ARM-2 FLAGS — totals my change newly routes to Review (${newFlags.length}). EYEBALL each:`);
if (!newFlags.length) {
  console.log('   (none) — my change added no new sign-notes on this corpus.');
} else {
  console.log('   Open each in Review; mark TRUE (real mis-signed credit) or FALSE (correct total, incidental marker):');
  for (const f of newFlags) {
    console.log(`   - ${f.doc}`);
    console.log(`       field=${f.field}  value=${JSON.stringify(f.value)}  method=${f.method}`);
  }
  console.log(`\n   PASS BAR: every one above is a TRUE catch, OR the FALSE count is an acceptable`);
  console.log(`   review-hold rate the owner signs off (fail-toward-review: a false flag only asks for a`);
  console.log(`   human glance, never mis-files). Record the verdict in NIGHT_RUN.md's DONE ledger.`);
}

console.log(fail ? '\nCENSUS: BLOCKED (see [1]/[3])' : '\nCENSUS: value-safe + non-vacuous — classify [2] by hand.');
process.exit(fail ? 1 : 0);
