'use strict';
// Pins for src/windows/review/issuerTeachDecision.js (Chris 2026-09-01 cards 1+2, Oracle C1-C8).
//
//   §1 shouldDrawnReadReplaceField — BOTH polarities on the supplier_name key:
//        implausible + non-empty prior  → false (the card-2 fix; today's renderer writes unconditionally)
//        implausible + EMPTY prior      → true  (preserved behaviour — a blank field still takes the read)
//        plausible   + non-empty prior  → true
//   §2 the guard is NOT widened (C2): customer_name / any other key replaces even when implausible.
//   §3 switch-OFF parity: with implausible:false (what check-issuer-read answers when
//      teach_issuer_plausibility_warn = 'false') both decisions equal today's behaviour.
//   §4 the immunity list of learning.issuerReadLooksImplausible (BP / IBM / 3M / H&M …) is now
//      LOAD-BEARING for the write path — each must come through as REPLACE (= not declined) when
//      drawn over a non-empty prior, via the REAL predicate.
//   §5 shouldOfferIssuerRipple — implausible/empty never offers; plausible offers; OFF parity.
//
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/review/test_issuer_teach_decision.js
const path = require('path');
const D = require(path.join(__dirname, 'issuerTeachDecision.js'));
const learning = require(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'learning.js'));

let fails = 0, n = 0;
function eq(label, got, want) {
  n++;
  if (got === want) { console.log(`  ok   ${label}`); return; }
  fails++;
  console.log(`  FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

const SUP = 'supplier_name';

console.log('§1 shouldDrawnReadReplaceField — supplier_name, both polarities');
eq('implausible read over a non-empty prior is DECLINED (card 2)',
  D.shouldDrawnReadReplaceField({ read: 'NOCUM', priorValue: 'Nordwind Ltd', implausible: true, fieldKey: SUP }), false);
eq('implausible read over an EMPTY prior still writes (preserved)',
  D.shouldDrawnReadReplaceField({ read: 'NOCUM', priorValue: '', implausible: true, fieldKey: SUP }), true);
eq('implausible read over a whitespace-only prior still writes',
  D.shouldDrawnReadReplaceField({ read: 'NOCUM', priorValue: '   ', implausible: true, fieldKey: SUP }), true);
eq('plausible read over a non-empty prior replaces',
  D.shouldDrawnReadReplaceField({ read: 'Nordwind Ltd', priorValue: 'Nordwnd Ltd', implausible: false, fieldKey: SUP }), true);
eq('empty read never writes', D.shouldDrawnReadReplaceField({ read: '', priorValue: 'X', implausible: false, fieldKey: SUP }), false);
eq('whitespace read never writes', D.shouldDrawnReadReplaceField({ read: '  ', priorValue: '', implausible: false, fieldKey: SUP }), false);
eq('missing implausible flag (IPC threw) is treated as plausible — fail toward today\'s write',
  D.shouldDrawnReadReplaceField({ read: 'NOCUM', priorValue: 'Nordwind Ltd', fieldKey: SUP }), true);

console.log('§2 the guard is supplier_name ONLY (C2 — not _isNameLikeField)');
for (const key of ['customer_name', 'invoice_number', 'invoice_date', 'total_amount', 'contact_name']) {
  eq(`${key}: implausible + non-empty prior still replaces`,
    D.shouldDrawnReadReplaceField({ read: '&&&', priorValue: 'kept?', implausible: true, fieldKey: key }), true);
}
eq('no fieldKey: replaces', D.shouldDrawnReadReplaceField({ read: '&&&', priorValue: 'x', implausible: true }), true);

console.log('§3 switch-OFF parity (implausible:false from the IPC)');
for (const read of ['NOCUMENT', '&&&', '123', 'Nordwind Ltd']) {
  eq(`OFF: "${read}" over a non-empty prior replaces (today)`,
    D.shouldDrawnReadReplaceField({ read, priorValue: 'Prior Co', implausible: false, fieldKey: SUP }), true);
  eq(`OFF: "${read}" offers the ripple (today)`, D.shouldOfferIssuerRipple({ read, implausible: false }), true);
}

console.log('§4 immunity list is load-bearing for the write path (real predicate)');
for (const name of ['BP', 'IBM', '3M', 'H&M', 'Acme Ltd', 'Nordwind Logistics GmbH', 'O2', 'EE']) {
  const implausible = learning.issuerReadLooksImplausible(name);
  eq(`"${name}" predicate says plausible`, implausible, false);
  eq(`"${name}" drawn over a non-empty prior REPLACES`,
    D.shouldDrawnReadReplaceField({ read: name, priorValue: 'Prior Co', implausible, fieldKey: SUP }), true);
}
console.log('§4b the exhibit class through the real predicate');
for (const [read, want] of [['&&&', false], [', Ltd', false], ['12345', false], ['INVOICE', false], ['Order', false], ['=state -', false]]) {
  const implausible = learning.issuerReadLooksImplausible(read);
  eq(`"${read}" predicate flags it`, implausible, true);
  eq(`"${read}" drawn over a non-empty prior is DECLINED`,
    D.shouldDrawnReadReplaceField({ read, priorValue: 'Prior Co', implausible, fieldKey: SUP }), want);
}
// Honest scope (handover): a single-token garble that is not a chrome word (NOCUMENT, DOCUMENT)
// PASSES the predicate — the teardown is the fix for that class; this guard is defence-in-depth,
// not a closure. Pinned so a future "tighten the predicate" is a deliberate change, not a drift.
for (const read of ['NOCUMENT', 'DOCUMENT']) {
  eq(`"${read}" passes the predicate (documented scope gap)`, learning.issuerReadLooksImplausible(read), false);
}

console.log('§5 shouldOfferIssuerRipple');
eq('implausible never offers', D.shouldOfferIssuerRipple({ read: '&&&', implausible: true }), false);
eq('empty never offers', D.shouldOfferIssuerRipple({ read: '', implausible: false }), false);
eq('whitespace never offers', D.shouldOfferIssuerRipple({ read: ' ', implausible: false }), false);
eq('plausible offers', D.shouldOfferIssuerRipple({ read: 'Nordwind Ltd', implausible: false }), true);
eq('missing flag offers (fail toward today)', D.shouldOfferIssuerRipple({ read: 'Nordwind Ltd' }), true);
eq('no opts never offers', D.shouldOfferIssuerRipple(), false);

console.log(`\n${n - fails}/${n} passed`);
if (fails) { console.log(`FAILED ${fails}`); process.exit(1); }
