#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_issuer_plausibility.js
 * --------------------------------------------
 * Pins `learning.issuerReadLooksImplausible` — the teach-time warning that answers Chris's round-2
 * finding #2: a ⊕ teach read `@a eens Ee`, showed a green "Captured the Document Issuer position"
 * toast, flagged nothing, and the value became TWO output folders (`@a-eens-Ee` and `a-eens-Ee`,
 * differing only by a leading `@`). His diagnosis is the thing worth pinning:
 *
 *     "Every guard in this product is pointed at absence. None of them is pointed at
 *      confident nonsense."
 *
 * The app warns plainly when the issuer is EMPTY and said nothing at all when it was gibberish.
 *
 * WHAT THIS PIN EXISTS TO STOP, in both directions:
 *   1. Someone "simplifying" this to the existing `isPlausibleSupplierName`. MEASURED: that one
 *      rejects `BP` and `IBM` on a <=3-char all-caps rule written for a different job, so it would
 *      nag a customer whose supplier really is BP, on a correct value. Checks 3-5 make that
 *      substitution fail loudly.
 *   2. Someone tightening the quality floor to catch the known miss. That costs real names —
 *      `J S Bloggs` and `A J Smith Ltd` are ordinary UK small businesses, and their initials are
 *      not gibberish.
 *
 * The accepted miss is pinned too (check 7), so it is a recorded trade-off and not a surprise.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_issuer_plausibility.js
 */
const learning = require('./learning');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};
const imp = (v) => learning.issuerReadLooksImplausible(v);

console.log('\n1. THE EXHIBIT — the read that made the folders');
// RED-FIRST NOTE: run this file against the commit before the predicate existed and it throws
// (the export is absent), which is the honest way this pin fails. There is no earlier version of
// the function that returns false here — the behaviour it pins did not exist at all.
check("'@a eens Ee' is refused (the value Chris filed 20 documents under)", imp('@a eens Ee'));
check("'a eens Ee' — the same value without the @ — is refused", imp('a eens Ee'));

console.log('\n2. Other junk observed in the same round');
for (const v of ['ee ial CL3 5RV', '0 vai ae CL3 5RV', 'pope pen vias', '=state -', 'acon eal']) {
  check(`${JSON.stringify(v)} refused`, imp(v));
}
check("a value with NO letters at all is refused ('12345678')", imp('12345678'));
check("punctuation-only is refused ('- / -')", imp('- / -'));

console.log('\n3. THE BP/IBM IMMUNITY — why this is not isPlausibleSupplierName');
// A single-token value is never judged. That is the whole reason this predicate exists separately.
for (const v of ['BP', 'IBM', '3M', 'H&M']) {
  check(`${JSON.stringify(v)} is NOT warned about`, !imp(v));
}
check('(control) isPlausibleSupplierName DOES reject BP — so the two are genuinely different '
      + 'and this pin is not vacuous', learning.isPlausibleSupplierName('BP') === false);

console.log('\n4. INITIALS — ordinary UK small-business names survive');
for (const v of ['J S Bloggs', 'A J Smith Ltd', 'W H Smith', 'A & B Ltd']) {
  check(`${JSON.stringify(v)} is NOT warned about`, !imp(v));
}

console.log('\n5. Real companies, including every awkward shape I could think of');
for (const v of ['Quillstone Print & Packaging', 'Oakhaven Electrical Wholesale', 'Ironclad Tool Hire',
                 'Nordwind Refrigeration Ltd', 'Silverbeck Cleaning Supplies', 'Castellan Security Systems',
                 'Bramblewood Joinery Ltd', 'Meadowvale Dairy Wholesale', 'Six Mile Software',
                 'G2 Environmental', '24/7 Services', 'E.ON UK plc', 'Marks & Spencer plc',
                 'P&O Ferries', 'Pelican Office Interiors -']) {
  check(`${JSON.stringify(v)} is NOT warned about`, !imp(v));
}

console.log('\n6. It is a WARNING, so it must never fire on the EMPTY case');
// Empty has its own guard, and it is a good one ("...saved under 'Unknown Company'"). Two guards
// firing on the same value would be worse copy than one.
for (const v of ['', '   ', null, undefined]) {
  check(`${JSON.stringify(v)} is left to the empty-issuer guard`, !imp(v));
}

console.log('\n7. THE ACCEPTED MISS, pinned so it is a decision and not a surprise');
// A garble whose tokens are individually word-shaped scores 0.67 and passes. Tightening the floor
// to catch it costs the names in section 4. If you change this, change section 4's expectations
// too and prove the trade with a measurement, not an opinion.
check("'RENN ERNE, Nh' is NOT caught — known miss, tightening the floor costs real names",
      !imp('RENN ERNE, Nh'));

console.log(fails ? `\n${fails} FAILED` : '\nAll issuer-plausibility pins passed');
process.exit(fails ? 1 : 0);
