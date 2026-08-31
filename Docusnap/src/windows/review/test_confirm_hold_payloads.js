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

// Chris round 18 A4: the IPC edge is the SECOND whitelist on the same path — every hold payload the
// renderer dispatches on must come through `confirm-review` too. Each code is asserted by name, with
// the chain's two links checked together (a pin on one link greened while the other still dropped it).
const hnd = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'modules', 'review', 'handler.js'), 'utf8').split(CR + LF).join(LF);
const edge = hnd.slice(hnd.indexOf("ipcMain.handle('confirm-review'"), hnd.indexOf("ipcMain.handle('confirm-review'") + 3000);
check("confirm-review forwards prefixOutlier on PREFIX_OUTLIER", /r\.code === 'PREFIX_OUTLIER' \? \{ prefixOutlier:/.test(edge));
check("confirm-review forwards nearMatch on ISSUER_NEAR_MATCH", /r\.code === 'ISSUER_NEAR_MATCH' \? \{ nearMatch: r\.nearMatch \}/.test(edge));
check("confirm-review forwards typeSplit on TYPE_SPLIT (round 18 A4)", /r\.code === 'TYPE_SPLIT' \? \{ typeSplit: r\.typeSplit \}/.test(edge));

// r18 copy bugs on the same hold chain: the service payload must carry the near-match KIND (a sub-run hit
// has distance:null — without kind the renderer printed "null characters off"), and the renderer never
// prints a non-numeric distance.
const svc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services', 'reviewService.js'), 'utf8').split(CR + LF).join(LF);
check('reviewService forwards nearMatch.kind', /nearMatch: \{ existing: nm\.existing, distance: nm\.distance, confirms: nm\.confirms, source: nm\.source, kind: nm\.kind \|\| null \}/.test(svc));
check('showIssuerNearMatchHold never prints "null characters" (numeric guard with a prose fallback)', /const _dist = Number\(nm\.distance\);/.test(rend) && /Number\.isFinite\(_dist\) && _dist > 0 \? `\$\{_dist\} characters` : 'a few characters'/.test(rend));
// r18 A6: a hold on a FOREIGN field (a key this type does not define) is named as such, never as a
// field the user should go and fix.
check('renderCleanHoldReason names a foreign-field hold honestly', /const _foreign = !!\(v\.field && Array\.isArray\(fieldDefs\) && fieldDefs\.length && !fieldDefs\.some\(x => x\.key === v\.field\)\);/.test(rend)
      && /a detail this document type doesn't use/.test(rend));

console.log(fails ? LF + fails + ' FAILED' : LF + 'All confirm-hold payload checks passed');
process.exit(fails ? 1 : 0);
