'use strict';
/*
 * test_format_consistency_twin.js — CROSS-LANGUAGE pin (Oracle C2, 2026-09-24): the JS penalty constants in
 * database/modules/format_consistency.js must equal validator.py's `_FC_MISMATCH_BASE/STEP/CAP` literals.
 * A one-sided bump on either side turns this red. Reads the Python source at test time (no Python spawn).
 *
 * Run: node database/modules/test_format_consistency_twin.js   (plain node is fine — no native modules)
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const fc = require(path.join(REPO, 'database', 'modules', 'format_consistency'));

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const py = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'validator.py'), 'utf8');
const lit = (name) => { const m = new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm').exec(py); return m ? Number(m[1]) : NaN; };
const base = lit('_FC_MISMATCH_BASE'), step = lit('_FC_MISMATCH_STEP'), cap = lit('_FC_MISMATCH_CAP');

console.log('1. validator.py literals found');
check('base/step/cap parsed', Number.isFinite(base) && Number.isFinite(step) && Number.isFinite(cap));
console.log('2. JS == Python');
check(`FC_MISMATCH_BASE ${fc.FC_MISMATCH_BASE} == ${base}`, fc.FC_MISMATCH_BASE === base);
check(`FC_MISMATCH_STEP ${fc.FC_MISMATCH_STEP} == ${step}`, fc.FC_MISMATCH_STEP === step);
check(`FC_MISMATCH_CAP ${fc.FC_MISMATCH_CAP} == ${cap}`, fc.FC_MISMATCH_CAP === cap);
console.log('3. the delta formula = format_consistency_adjustment\'s mismatch leg');
check('0 -> 0', fc.mismatchDelta(0) === 0);
check('1 -> -base', fc.mismatchDelta(1) === -base);
check('2 -> -(base+step)', fc.mismatchDelta(2) === -(base + step));
check('10 -> -cap', fc.mismatchDelta(10) === -cap);
console.log('4. both JS consumers import from here (no literal copies)');
const cas = fs.readFileSync(path.join(REPO, 'src', 'services', 'charsetAcceptService.js'), 'utf8');
const ph  = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('charsetAcceptService requires format_consistency', /database\/modules\/format_consistency/.test(cas) && !/_FC_MISMATCH_BASE\s*=\s*12/.test(cas));
check('processing/handler requires format_consistency in the Quick-rescore helper', /database\/modules\/format_consistency/.test(ph));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
