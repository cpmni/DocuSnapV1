'use strict';
// test_money_sign_coupling.js — Oracle C1 (2026-08-31): the MONEY_SIGN_PARENS/CR captures must
// NEVER run without the CREDIT_SIGN_COHERENCE arms (the manufactured-minus safety: a table rule
// OCR'd as '(', a column-bled 'CR' token would otherwise commit a silent negative on an invoice).
// Source-contract pin on _reconcileEnv: the coupling block exists, sits inside the function, and
// forces coherence when EITHER capture is armed. Removing the force fails this red.
// Run: node src/modules/processing/test_money_sign_coupling.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const fnStart = src.indexOf('_reconcileEnv');
check('_reconcileEnv exists', fnStart > -1);

// The coupling must live AFTER the two capture bridges and force coherence on either flag.
const couple = /if\s*\(env\.MONEY_SIGN_PARENS === '1' \|\| env\.MONEY_SIGN_CR === '1'\)\s*\{\s*env\.CREDIT_SIGN_COHERENCE = '1';\s*\}/;
check('the C1 co-residency force exists (either capture ⇒ CREDIT_SIGN_COHERENCE)', couple.test(src));
check('the force sits inside/after _reconcileEnv', src.search(couple) > fnStart);

// Both capture bridges still read their own settings (independent flip stays possible).
check("parens bridge reads setting 'money_sign_parens'", src.includes("'money_sign_parens'"));
check("cr bridge reads setting 'money_sign_cr'", src.includes("'money_sign_cr'"));

console.log(fails ? `\n${fails} FAILED` : '\nAll money-sign coupling pins passed');
process.exit(fails ? 1 : 0);
