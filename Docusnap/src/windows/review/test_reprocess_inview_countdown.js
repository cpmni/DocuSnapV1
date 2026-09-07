#!/usr/bin/env node
'use strict';
/*
 * src/windows/review/test_reprocess_inview_countdown.js — the in-view countdown on the REPROCESS door
 * (owner 2026-09-07: "I keep getting this message when all the other docs have filed and there is only the
 * one in view left").
 *
 * The 09-01 countdown (sweep_inview_countdown) was wired to the SCOPE SWEEP only; after a Reprocess the
 * last document on screen always waited for a click on the consent bar. Now, when the server's offer is
 * EXACTLY the document on screen and the switch is on, the same 5→1 countdown + Stop runs; expiry calls
 * the SAME no-payload accept IPC (the server files only its own recorded offer); Stop / a touched field /
 * navigating away fall back to the click door. Source pin (renderer.js runs only in the window):
 *   1 the gate: n === 1 AND currentDoc.id === offerIds[0] AND the sweep_inview_countdown setting, re-checked
 *     after the await; n > 1 / another doc / switch OFF → the static bar (its copy byte-identical);
 *   2 expiry → _acceptReprocessOffer (the ONE accept road, shared with the File-N click; no payload);
 *   3 Stop and cancel → _renderReprocessOfferBar (the click door survives; Not now still exists);
 *   4 the sweep door is untouched: no opts → sweep-inview-file / sweep-inview-hold; the shared cancel keeps
 *     the field-touch / focus / navigation / unload triggers; expiry/stop cancel silently (no bar flash).
 *
 *   node src/windows/review/test_reprocess_inview_countdown.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const raw = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const js = raw.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const slice = (from, to) => { const a = js.indexOf(from); const b = js.indexOf(to, a + 1); return a >= 0 && b > a ? js.slice(a, b) : ''; };
const offerFn = slice('async function showReprocessAutofileOffer(', 'function _renderReprocessOfferBar(');
const barFn = slice('function _renderReprocessOfferBar(', 'async function _acceptReprocessOffer(');
const acceptFn = slice('async function _acceptReprocessOffer(', 'let _sweepTimer = null');
const cdBlock = slice('function _cancelInviewCountdown(', 'window.docusnap.onReviewCountChanged(');

console.log('1 the gate');
check('showReprocessAutofileOffer located + async', offerFn.length > 100);
check('gate: exactly one offered doc AND it is the doc on screen AND no countdown already running',
      /offerIds\.length === 1 && currentDoc && currentDoc\.id === offerIds\[0\] && !_inviewCd/.test(offerFn));
check("the switch is read from the setting 'sweep_inview_countdown'", /getSetting\?\.\('sweep_inview_countdown'\)/.test(offerFn));
check('re-checked AFTER the await (doc still on screen, offer still this one, no countdown started meanwhile)',
      /cdOn && currentDoc && currentDoc\.id === offerIds\[0\] && _rabOfferIds && _rabOfferIds\[0\] === offerIds\[0\] && !_inviewCd/.test(offerFn));
check('every other case renders the static bar', offerFn.trimEnd().endsWith('_renderReprocessOfferBar(bar, offerIds);\n}'));
check('the static bar copy is byte-identical', barFn.includes("reprocessed document${n === 1 ? '' : 's'} read clean and ${n === 1 ? 'is' : 'are'} ready to file — ")
      && barFn.includes('id="rab-file">✓ File ${n}</button>') && barFn.includes('id="rab-review">Review them</button>') && barFn.includes('id="rab-dismiss">Not now</button>'));

console.log('2 expiry = the ONE accept road');
check('onExpire → _acceptReprocessOffer(bar)', /onExpire: \(\) => _acceptReprocessOffer\(bar\)/.test(offerFn));
check('the File-N click uses the same road', /rab-file'\)\?\.addEventListener\('click', \(\) => _acceptReprocessOffer\(bar\), \{ once: true \}\)/.test(barFn));
check('the accept IPC takes NO payload (the server files only its own recorded offer)', /reprocessAutocommitAccept\(\)/.test(acceptFn) && !/reprocessAutocommitAccept\([^)]+\)/.test(acceptFn));
check('the "you approved" toast survives on the shared road', /you approved/.test(acceptFn));

console.log('3 Stop and cancel fall back to the click door');
check('onStop → the static bar', /onStop:\s+\(\) => _renderReprocessOfferBar\(bar, offerIds\)/.test(offerFn));
check('onCancel → the static bar, only while this offer is still the live one', /onCancel: \(\) => \{ if \(_rabOfferIds && _rabOfferIds\[0\] === offerIds\[0\]\) _renderReprocessOfferBar\(bar, offerIds\); \}/.test(offerFn));
check('the bar is hidden before the countdown starts (no double surface)', /bar\.style\.display = 'none';\s*const started = _startInviewCountdown\(/.test(offerFn));

console.log('4 the sweep door is untouched');
check('_startInviewCountdown(ev, opts) defaults to the sweep source', /source: \(opts && opts\.source\) \|\| 'sweep'/.test(cdBlock));
check('the sweep event still calls it with NO opts', /onSweepInviewEligible\?\.\(\(ev\) => \{ try \{ _startInviewCountdown\(ev\); \} catch \{\} \}\)/.test(cdBlock));
const fileNow = slice('async function _inviewFileNow(', 'async function _inviewHold(');
const hold = slice('async function _inviewHold(', 'function _startInviewCountdown(');
check('expiry with no onExpire → sweepInviewFile (the reprocess door returns before it)',
      /typeof cd\.onExpire === 'function'/.test(fileNow) && /return; \}/.test(fileNow) && /sweepInviewFile\(cd\.docId, cd\.fingerprint\)/.test(fileNow));
check('Stop with no onStop → sweepInviewHold (the reprocess door returns before it)',
      /typeof cd\.onStop === 'function'/.test(hold) && /return; \}/.test(hold) && /sweepInviewHold\(cd\.docId\)/.test(hold));
check('expiry/stop cancel SILENTLY (no click-door flash), field-touch/focus/unload cancel loudly',
      /_cancelInviewCountdown\(\{ silent: true \}\)/.test(fileNow) && /_cancelInviewCountdown\(\{ silent: true \}\)/.test(hold)
      && /document\.addEventListener\('input',[^\n]*_cancelInviewCountdown\(\)/.test(cdBlock)
      && /document\.addEventListener\('focusin',[^\n]*_cancelInviewCountdown\(\)/.test(cdBlock)
      && /beforeunload[^\n]*_cancelInviewCountdown\(\)/.test(cdBlock));
check('navigating to another doc still cancels (selectDoc road)', /if \(_inviewCd && \(!doc \|\| doc\.id !== _inviewCd\.docId\)\) _cancelInviewCountdown\(\);/.test(js));
check('the countdown copy + Stop button are unchanged', /This document will file itself in/.test(cdBlock) && /class="ivc-stop"/.test(cdBlock));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
