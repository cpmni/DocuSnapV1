#!/usr/bin/env node
'use strict';
// PIN (owner 2026-08-22): the teach wizard names the template from the issuer the operator sees in
// the wizard, never from the document row's first-pass read. A template was minted as
// "DOCUMENT OLUTIONS" from a 69% letterhead prefill while the corrected "DOCUMENT SOLUTIONS" went into
// the template's identity — the name Review shows as "Recognised by" must be the corrected value.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
let fails = 0;
const check = (l, ok) => { console.log(`  ${ok ? 'OK ' : 'BAD'} ${l}`); if (!ok) fails++; };
check('promote-to-template supplier = the wizard value first, the doc row last',
      /const supplier = allValues\.supplier_name \|\| allValues\.supplier \|\| state\.doc\.supplier_name \|\| null;/.test(src));
check('…and the old precedence (doc row first) is gone',
      !/const supplier = state\.doc\.supplier_name \|\| allValues\.supplier/.test(src));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
