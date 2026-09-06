#!/usr/bin/env node
'use strict';
/*
 * src/windows/review/test_teach_currency_nolabel_warn.js — Item 1 teach-side (log review 2026-09-05;
 * Oracle C2: WARN, refuse nothing).
 *
 * The Review ⊕ readout used to greet a CURRENCY field taught with NO caption with a green checkmark
 * ("will remember this exact spot"). A position-only box on a totals block reads the wrong row on
 * every document whose line count differs (Meadowvale credit notes: 17/20 @50, 13 in review). The
 * readout is now the WARN variant with the typed-caption input for that case, and the position-only
 * save still happens (a receipt total with no adjacent caption must stay teachable).
 *
 * Source pin (renderer.js runs only in the window; the test_teach_label_pick.js convention):
 *   1 the currencyNoLabel gate is keyed on the FIELD TYPE via fieldDefs (never the caption text);
 *   2 the warn variant renders the editable .ar-label-edit input (the existing change handler re-stages
 *     a typed caption) with the caption-example placeholder;
 *   3 the non-currency fallback keeps its checkmark copy byte-for-byte;
 *   4 nothing in the branch returns early or clears pendingAnchors (refuse nothing).
 *
 *   node src/windows/review/test_teach_currency_nolabel_warn.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const raw = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const js = raw.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const start = js.indexOf('function showAnchorReadout(');
const end = js.indexOf('async function reDetectAnchor(');
const fn = js.slice(start, end);
check('showAnchorReadout located', start > 0 && end > start);

console.log('1 the gate');
check('currencyNoLabel is keyed on fieldDefs type === currency AND detected.fallback',
      /const currencyNoLabel = !!\(detected\.fallback && _teachFdef && _teachFdef\.type === 'currency'\);/.test(fn));
check('the field def comes from fieldDefs by lastTeachCtx.fieldKey', /fieldDefs[\s\S]{0,120}find\(f => f && f\.key === lastTeachCtx\?\.fieldKey\)/.test(fn));

console.log('2 the warn variant');
const branch = fn.slice(fn.indexOf('if (currencyNoLabel) {'), fn.indexOf('} else if (detected.fallback) {'));
check('the currencyNoLabel branch exists and precedes the plain fallback', branch.length > 50);
check('…it warns about the wrong row', /wrong row/.test(branch) && /&#9888;/.test(branch));
check('…and renders the editable caption input', /class="ar-label-edit"/.test(branch));
check('…the input starts EMPTY with a caption-example placeholder', /\(suspicious \|\| currencyNoLabel\) \? '' :/.test(fn) && /if \(currencyNoLabel\) lblInput\.placeholder = 'e\.g\. Total to Pay';/.test(fn));

console.log('3 the non-currency fallback is unchanged');
check('the checkmark fallback copy survives verbatim',
      fn.includes('&#10003; No label word sits next to this value, so Scan Finder will <strong>remember this exact spot</strong>'));

console.log('4 refuse nothing');
check('the branch never returns early', !/return;/.test(branch));
check('the branch never clears pendingAnchors (the position-only save stands)', !/pendingAnchors\[[^\]]*\]\s*=\s*(null|undefined)|delete pendingAnchors/.test(branch));
check('the change handler that re-stages a typed caption is still wired', /lblInput\.addEventListener\('change'/.test(fn) && /pendingAnchors\[fk\]\.anchor_label = cleaned \|\| '';/.test(fn));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
