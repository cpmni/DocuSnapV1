#!/usr/bin/env node
'use strict';
/*
 * src/windows/review/test_reprocess_modal_fullonly.js — owner 2026-09-07: "quite often when I reprocess all from a
 * supplier I don't get the full quick message, but this instead" (the native OK/Cancel box). Cause: with
 * Straighten-all ON the Quick/Full modal was skipped and the code fell through to confirm(). Now the SAME styled
 * modal opens in a Full-only shape. Source pin + a teach-wizard pin: the wizard never re-asks the type-split
 * question (the type is always the operator's own click).
 *
 *   node src/windows/review/test_reprocess_modal_fullonly.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const strip = (s) => s.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const rv = strip(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'));
const tw = strip(fs.readFileSync(path.join(__dirname, '..', 'teach', 'renderer.js'), 'utf8'));

console.log('1 the reprocess confirm never falls to the native box while Quick Reprocess is on');
const batch = rv.slice(rv.indexOf('async function runReprocessBatch('), rv.indexOf('async function runReprocessBatch(') + 4000);
check('the modal is offered whenever quick_reprocess is ON (no deskewSessionOn exclusion)', /if \(_quickOn\) \{\s*const choice = await showReprocessModeChoice\(docs\.length, scopeLabel, _fileLine, \{ fullOnly: !!deskewSessionOn \}\);/.test(batch));
check('the native confirm() stays only as the OFF fallback', /!opts\.preConfirmed && !_quickChoiceMade\s*&& !confirm\(/.test(batch));
const modal = rv.slice(rv.indexOf('function showReprocessModeChoice('), rv.indexOf('function showReprocessModeChoice(') + 6000);
check('showReprocessModeChoice takes opts.fullOnly', /function showReprocessModeChoice\(count, scopeLabel, fileLine, opts = \{\}\)/.test(modal) && /const fullOnly = !!\(opts && opts\.fullOnly\);/.test(modal));
check('full-only copy explains WHY (Straighten-all needs the page image)', /Straighten-all is on, so every document is re-read from its page image/.test(modal));
check('full-only shows Cancel + one Re-read button, no Quick', /if \(fullOnly\) \{\s*full\.textContent = 'Re-read \(straightened\)';[\s\S]{0,300}foot\.append\(cancel, full\);/.test(modal));
check('the ordinary Quick/Full shape is unchanged', /foot\.append\(cancel, full, quick\);/.test(modal) && /quick\.textContent = 'Quick \(recommended\)'/.test(modal));

console.log('2 the teach wizard never re-asks the type it was just told');
check('state.typeSplitAck is set before the gate (the click IS the answer)', /state\.typeSplitAck = true;\s*if \(!state\.typeSplitAck && D\.checkTypeSplit\)/.test(tw));
check('acknowledgeTypeSplit still rides the commit payload (reviewService does not re-ask)', /acknowledgeTypeSplit: !!state\.typeSplitAck/.test(tw));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
