#!/usr/bin/env node
'use strict';
/*
 * src/windows/review/test_convention_strip_and_nudge.js — the ONE-CONFIRM convention's surfaces (Oracle C5/C6,
 * 2026-09-07): the activity-strip event copy + its "Undo" (not "Put back") button, the re-check nudge wired to
 * the EXISTING reprocess-from-sender road, the ledger kind, the undo dispatcher branch, and the settings toggle
 * beside its parent. Source pins (renderers run only in their windows).
 *
 *   node src/windows/review/test_convention_strip_and_nudge.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const rv = strip(read('src/windows/review/renderer.js'));
const ev = read('src/lib/reviewEvents.js');
const ph = strip(read('src/modules/processing/handler.js'));
const sh = read('src/windows/settings/index.html');
const sr = strip(read('src/windows/settings/renderer.js'));

console.log('1 the ledger + the strip');
check("reviewEvents KINDS carries 'convention'", /KINDS = new Set\(\[[^\]]*'convention'[^\]]*\]\)/.test(ev));
check("_asShort: case 'convention' → 'Filing rule learned'", /case 'convention': return 'Filing rule learned';/.test(rv));
check("_asLine: the rule in the owner's words (letterhead → files under, without asking)", /case 'convention': \{[\s\S]{0,200}letterhead will now file under[\s\S]{0,80}without asking/.test(rv));
check('the icon/colour class treats it as a fix (pencil, accent), not a filed tick', /ev\.kind === 'issuer_fill' \|\| ev\.kind === 'convention'\) \? '✎'/.test(rv) && /ev\.kind === 'issuer_fill' \|\| ev\.kind === 'convention'\) return 'fix';/.test(rv));
check("the undo slot reads 'Undo' for a convention event and 'Put back' otherwise", /const _undoLabel = ev\.kind === 'convention' \? 'Undo' : 'Put back';/.test(rv) && /_apGhost\(_undoLabel\)/.test(rv));
check('…with a title that says the rule is forgotten, not that documents move', /Forgets this filing rule — the next document on this letterhead asks again\./.test(rv));

console.log('2 the re-check nudge (C6) rides the EXISTING reprocess road');
check('the confirm result → showConventionRecheckBar', /if \(result\.convention && result\.convention\.issuer\) showConventionRecheckBar\(result\.convention\);/.test(rv));
const fn = rv.slice(rv.indexOf('function showConventionRecheckBar('), rv.indexOf('function showConventionRecheckBar(') + 2200);
check('the bar names the rule and offers "Re-check the N other … waiting" only when N > 0', /Re-check the \$\{n\} other/.test(fn) && /\(n \? `<button class="btn" id="cvr-recheck">/.test(fn));
check('Re-check → runReprocessBatch on the queued same-sender (same-type preferred) docs — never a stored-row clear', /runReprocessBatch\(docs, issuer\)/.test(fn) && !/validation_note/.test(fn));
check('an OK button dismisses', /id="cvr-dismiss"/.test(fn));

console.log('3 the undo dispatcher (C5)');
check("a 'convention' branch retracts through retractBuyerIssuedConventionForDoc", /ev\.undo\.type === 'convention'[\s\S]{0,600}retractBuyerIssuedConventionForDoc\(db, id/.test(ph));
check("…audits 'buyer_issued_convention_undone'", /ev\.undo\.type === 'convention' \? 'buyer_issued_convention_undone'/.test(ph));
check('…and writes NO put_back receipt for it (nothing was put back)', /undone\.length && ev\.undo\.type !== 'convention'\) recordReviewEvent\(db, \{ kind: 'put_back'/.test(ph));
check('the setting is bridged to the Python env beside its parent', /BUYER_ISSUED_CONVENTION_ONE_CONFIRM == null && learning\.getSetting\(db, 'buyer_issued_convention_one_confirm', 'false'\) === 'true'/.test(ph));

console.log('4 settings (SFDEV-gated beside its parent) + the C7 label');
check('the toggle exists in the HTML', /id="buyer-issued-one-confirm-toggle"/.test(sh));
check('…wired to the setting in the renderer list', /\['buyer-issued-one-confirm-toggle', 'buyer_issued_convention_one_confirm'\]/.test(sr));
check('…and dev-gated like its parent', /'buyer-issued-convention-toggle', 'buyer-issued-one-confirm-toggle'/.test(sr));
check("the memory readers label the pseudo key 'Files purchase orders under this company'", /_hintKeyLabel\(h\.field_key\)/.test(sr) && /_hintKeyLabel\(r\.field_key\)/.test(sr) && /key === 'buyer_issued_convention' \? 'Files purchase orders under this company' : key/.test(sr));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
