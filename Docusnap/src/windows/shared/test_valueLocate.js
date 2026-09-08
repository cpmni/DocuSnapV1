'use strict';
/*
 * test_valueLocate.js — Chris round-10 card #4 (gary → design).
 * (a) The typed-value locate must see through a LEADING currency symbol so "4,142.35" locates the
 *     page's "£4,142.35" (→ a positioned teach, not a frozen constant) — WITHOUT introducing any new
 *     bare-number match class.
 * (b) The freeze-guard (_freezeDiscouraged) must fire on amount/date fields and NEVER on the genuine
 *     fixed-value name/code fields.
 * Run: node src/windows/shared/test_valueLocate.js
 */
const fs = require('fs');
const path = require('path');
const VL = require('./valueLocate');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// ── (a) currency-tolerant locate ────────────────────────────────────────────────────────────
function page(words) { return { words: words.map(([t, l]) => ({ t, b: [l, 10, 70, 12] })), natW: 800, natH: 400 }; }
const nHits = (val, words) => VL.locateValueInWords(val, page(words)).length;

check('£-prefixed page word located by digits-only typed value',
      nHits('4,142.35', [['Balance', 10], ['Due', 90], ['£4,142.35', 150]]) === 1);
check('squash form: typed "4142.35" locates "£4142.35" (currency strip + squash; comma-sensitive by design)',
      nHits('4142.35', [['£4142.35', 150]]) === 1);
check('idempotent: typed "£4,142.35" still locates',
      nHits('£4,142.35', [['£4,142.35', 150]]) === 1);
check('$ and € too',
      nHits('1,000.00', [['$1,000.00', 150]]) === 1 && nHits('50.00', [['€50.00', 150]]) === 1);

// false-locate bound: only enumerated currency glyphs, only leading, only digit-abutting are stripped
check('non-currency prefix "#4,142.35" does NOT match', nHits('4,142.35', [['#4,142.35', 150]]) === 0);
check('letter prefix "A4142.35" does NOT match', nHits('4142.35', [['A4142.35', 150]]) === 0);
check('suffix unit "4,142.35kg" does NOT match a bare amount', nHits('4,142.35', [['4,142.35kg', 150]]) === 0);
check('a lone "£" (no digits) does NOT match', nHits('4,142.35', [['£', 150]]) === 0);

// non-currency locates are UNAFFECTED (norm/gate-C mirror intact)
check('ref "PI/26/6000" split across words still squash-matches',
      nHits('PI/26/6000', [['PI/26', 150], ['/6000', 200]]) === 1);
check('a bare page amount still matches a bare typed amount (pre-existing, unchanged)',
      nHits('4,142.35', [['4,142.35', 150]]) === 1);

// ── (b) freeze-guard scope — eval _freezeDiscouraged + _isDateField out of teach/renderer.js ──
const tsrc = fs.readFileSync(path.join(__dirname, '..', 'teach', 'renderer.js'), 'utf8');
const s = tsrc.indexOf('function _isDateField');
const e = tsrc.indexOf('// Conservative "reads as a printed date"');
const _freezeDiscouraged = new Function('state',
  tsrc.slice(s, e) + '\nreturn _freezeDiscouraged;')({ dateFieldKey: '_dk' });

const yes = (f) => _freezeDiscouraged(f) === true;
const no  = (f) => _freezeDiscouraged(f) === false;
check('currency field → discouraged', yes({ type: 'currency', key: 'total_amount' }));
check('number field → discouraged',   yes({ type: 'number', key: 'qty_total' }));
check('date field → discouraged',     yes({ type: 'date', key: 'invoice_date' }));
check('text field with a date key → discouraged', yes({ type: 'text', key: 'despatch_date' }));
check('text field with a money-name key → discouraged', yes({ type: 'text', key: 'balance_due' }));
check('PIN: supplier_name (text) → NOT discouraged', no({ type: 'text', key: 'supplier_name' }));
check('PIN: vat_no (text) → NOT discouraged', no({ type: 'text', key: 'vat_no' }));
check('PIN: account_no (text) → NOT discouraged', no({ type: 'text', key: 'account_no' }));
check('PIN: a list field → NOT discouraged', no({ type: 'list', key: 'line_items' }));
check('PIN: invoice_number (text) → NOT discouraged', no({ type: 'text', key: 'invoice_number' }));

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
