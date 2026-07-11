#!/usr/bin/env node
'use strict';
// templates.shouldAdoptIssuerName — the WIDENED template-name heal (2026-07-10).
// A template created at a supplier's FIRST confirm inherits whatever sat in the issuer
// field: a wrong first detection births a postcode-named template ("BT23 1BE" — the
// PF_pur case, slug frozen as bt23_1be) or a bare caption word ("Ref" — 4 confirms deep),
// and the old heal (generic "<Type> Template" only) never touched them. The widened rule
// adopts a PLAUSIBLE confirmed issuer over a non-name (generic / shape-implausible /
// UK-postcode / bare caption word) and NEVER over a plausible hand-given name — so once a
// real name is in place the heal can't flip-flop between issuer variants.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_template_name_heal.js

const { shouldAdoptIssuerName } = require('./templates');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

console.log('ADOPT — junk/generic current names heal on the next plausible confirm:');
check("postcode name 'BT23 1BE' -> 'Pinnacle' (the PF_pur case)",
      shouldAdoptIssuerName('BT23 1BE', 'Pinnacle') === true);
check("caption word 'Ref' -> 'Ashford Wholesale' (template 20's class)",
      shouldAdoptIssuerName('Ref', 'Ashford Wholesale') === true);
check("caption word with punctuation 'Ref:'",
      shouldAdoptIssuerName('Ref:', 'Ashford Wholesale') === true);
check("implausible fragment 'IN'", shouldAdoptIssuerName('IN', 'Cloud VPS') === true);
check("bare number '36552'", shouldAdoptIssuerName('36552', 'Cloud VPS') === true);
check("generic 'Purchase Order Template' (the old heal, preserved)",
      shouldAdoptIssuerName('Purchase Order Template', 'Pinnacle') === true);
check("empty current name", shouldAdoptIssuerName('', 'Pinnacle') === true);
check("caption word 'Worksheet'", shouldAdoptIssuerName('Worksheet', 'Meridian Print & Copy') === true);

console.log('PROTECT — plausible names are never auto-renamed (no flip-flop):');
check("'Pinnacle' vs issuer variant 'Pinnacle Ltd' -> keep",
      shouldAdoptIssuerName('Pinnacle', 'Pinnacle Ltd') === false);
check("'Ashford Wholesale' -> keep", shouldAdoptIssuerName('Ashford Wholesale', 'Ashford') === false);
check("'Cloud VPS' -> keep", shouldAdoptIssuerName('Cloud VPS', 'CloudVPS Ltd') === false);
check("'3M' (digit-bearing short brand is plausible) -> keep",
      shouldAdoptIssuerName('3M', '3M Company') === false);
check("same name, case-insensitive -> no-op",
      shouldAdoptIssuerName('pinnacle', 'Pinnacle') === false);

console.log('GATE — a junk issuer never adopts:');
check("issuer is a postcode -> never adopt", shouldAdoptIssuerName('Ref', 'BT1 1AA') === false);
check("issuer implausible 'IN' -> never adopt", shouldAdoptIssuerName('Ref', 'IN') === false);
check("issuer empty -> never adopt", shouldAdoptIssuerName('Ref', '') === false);
check("issuer null -> never adopt", shouldAdoptIssuerName('Ref', null) === false);

console.log('DOCUMENTED residual (accepted): a hand-named <=3-char ALL-CAPS brand re-adopts');
console.log('the confirmed issuer (shape-implausible by the mirrored Python rule; cosmetic):');
check("'DHL' -> 'DHL Express Ltd' adopts (accepted trade-off, admin can use a longer name)",
      shouldAdoptIssuerName('DHL', 'DHL Express Ltd') === true);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nAll template-name-heal checks passed');
process.exit(0);
