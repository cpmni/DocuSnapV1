'use strict';
/*
 * test_confirm_hold_payloads.js — Chris round 17 card 1 (2026-08-22 night).
 *
 * THE BUG: `confirmCurrentDoc` returned `{ error, code, prefixOutlier }` on a refused confirm, so every
 * OTHER hold the Confirm click handler dispatches on — the round-6 issuer near-match (`r.nearMatch`) and
 * the type-split ask (`r.typeSplit`) — arrived as `undefined` and fell to their toast branches: "This
 * sender has only ever filed as one document type — check the type before filing." with no Keep / Change,
 * a Confirm that re-holds for ever. The wizard asked perfectly; Review never did.
 *
 * Pin: every `r.code === '<CODE>'` branch the click handler dispatches on has its payload key present in
 * confirmCurrentDoc's failure return. Enumerated from the source so a new hold cannot be added without
 * its payload (a dead-end-by-construction check).
 *
 * Run: node src/windows/review/test_confirm_hold_payloads.js
 */
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const rend = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').split(CR + LF).join(LF);
let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// the failure return inside confirmCurrentDoc
const fnStart = rend.indexOf('async function confirmCurrentDoc(');
const retIdx = rend.indexOf("return { error: result?.error || 'Confirm failed. Check settings.'", fnStart);
check('confirmCurrentDoc has the documented failure return', fnStart > 0 && retIdx > fnStart);
const ret = rend.slice(retIdx, rend.indexOf('};', retIdx) + 2);

// the hold payloads the click handlers dispatch on: `if (r.code === 'X') { showY(r.<key>, ...` (+ r2 in the hold re-entry paths)
const dispatch = [...rend.matchAll(/if \(r2?\.code === '([A-Z_]+)'\) \{ show\w+\(r2?\.(\w+)/g)];
const keys = new Set(dispatch.map(m => m[2]));
check('the click handlers dispatch on at least three hold payloads (prefixOutlier, nearMatch, typeSplit)',
      ['prefixOutlier', 'nearMatch', 'typeSplit'].every(k => keys.has(k)));
for (const k of keys) check(`failure return carries \`${k}\``, new RegExp(`\\b${k}: result\\?\\.${k} \\|\\| null`).test(ret));

// the type-split hold renders buttons when it gets its payload (never only the toast)
check('showTypeSplitHold renders Change the type / Keep when given the payload',
      /function showTypeSplitHold\(ts, idx, groupKey\)[\s\S]{0,2500}tsh-change-btn[\s\S]{0,600}tsh-keep-btn/.test(rend));

console.log(fails ? LF + fails + ' FAILED' : LF + 'All confirm-hold payload checks passed');
process.exit(fails ? 1 : 0);
