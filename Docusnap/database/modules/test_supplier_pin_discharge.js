#!/usr/bin/env node
'use strict';
// shouldClearSupplierPin — the JS half of SUPPLIER_PIN_SELF_DISCHARGE (Oracle G7 pins).
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_supplier_pin_discharge.js

const { shouldClearSupplierPin } = require('./supplier_pin_discharge');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

check('no signal (the dark default) → never clears',
      shouldClearSupplierPin('Oakhaven Electrical Wholesale', undefined) === false);
check('signal without a pin string → never clears',
      shouldClearSupplierPin('Oakhaven Electrical Wholesale', { value: 'x' }) === false);
check('exact match → clears',
      shouldClearSupplierPin('Oakhaven Electrical Wholesale',
        { pin: 'Oakhaven Electrical Wholesale', value: 'Oakhaven Electrical Wholesale', method: 'template_fixed' }) === true);
check('whitespace-trimmed match → clears',
      shouldClearSupplierPin(' Oakhaven Electrical Wholesale ',
        { pin: 'Oakhaven Electrical Wholesale' }) === true);
check('RACE: pin re-resolved to a DIFFERENT name mid-run → the NEW pin survives',
      shouldClearSupplierPin('Harrowgate Timber Supplies',
        { pin: 'Oakhaven Electrical Wholesale' }) === false);
check('pin already cleared → no-op',
      shouldClearSupplierPin(null, { pin: 'Oakhaven Electrical Wholesale' }) === false);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
