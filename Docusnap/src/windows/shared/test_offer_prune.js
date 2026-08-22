#!/usr/bin/env node
'use strict';

/**
 * src/windows/shared/test_offer_prune.js
 * --------------------------------------
 * Q4c + Q4d of the Chris round-14 queue (stale offer bars; the stale "4 more" badge after a
 * send-back). gary → Oracle SIGN OFF, 2026-08-22.
 *
 *   pruneOffer: an offer-phase sweep state is filtered to the live queue and retired when empty;
 *               'filing' / 'done' untouched · pruneIds for the reprocess-offer bar
 *   renderer contract (source pins): _refreshQueueFromBroadcast prunes both bars, refreshes the
 *               reprocess count AND the readiness badge; a "nothing" / "auto-accept-running" sweep
 *               answer retires an OFFER bar only; the done render prints no "Put back" when 0 filed;
 *               the job_done sweep says "re-read just now".
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/windows/shared/test_offer_prune.js
 */

const path = require('path');
const fs = require('fs');
const OP = require('./offerPrune');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
const mk = (phase, ids, extra = {}) => ({ phase, supplier: 'Acme', typeSlug: 'invoice', candidates: ids.map(docId => ({ docId, filename: `${docId}.pdf` })), unticked: new Set(), ...extra });

console.log('§1 pruneOffer');
{
  const s = mk('offer', [1, 2, 3]); s.unticked.add(2); s.unticked.add(3);
  const r = OP.pruneOffer(s, new Set([1, 3, 9]));
  check('3 candidates, doc 2 gone → ids 1,3 left', r && r.candidates.length === 2 && r.candidates.map(c => c.docId).join() === '1,3');
  check('unticked pruned with them (2 gone, 3 stays)', !r.unticked.has(2) && r.unticked.has(3));
  check('same object mutated (renderer identity check still sees a change in candidates)', r === s);
  check('all gone → null (the bar retires)', OP.pruneOffer(mk('offer', [4, 5]), new Set([1])) === null);
  const same = mk('offer', [1, 2]);
  check('nothing gone → the same state, untouched', OP.pruneOffer(same, new Set([1, 2, 3])) === same && same.candidates.length === 2);
  const filing = mk('filing', [7]);
  check("'filing' phase NEVER pruned (positive control for the phase guard)", OP.pruneOffer(filing, new Set()) === filing && filing.candidates.length === 1);
  const done = mk('done', [7], { filed: [7], dropped: [] });
  check("'done' phase NEVER pruned (the receipt keeps naming what it filed)", OP.pruneOffer(done, new Set()) === done);
  check('null state → null', OP.pruneOffer(null, new Set([1])) === null);
  check('pruneIds filters to the live queue', OP.pruneIds([1, 2, 3], new Set([2])).join() === '2' && OP.pruneIds([1], new Set()).length === 0);
}

console.log('§2 renderer contract (source pins)');
{
  const ROOT = path.join(__dirname, '..', '..', '..');
  const rend = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'index.html'), 'utf8');
  const fn = (name) => { const i = rend.indexOf(name); return i < 0 ? '' : rend.slice(i, rend.indexOf('\n}\n', i) + 3); };
  const broadcast = fn('async function _refreshQueueFromBroadcast()');
  check('Review loads shared/offerPrune.js before renderer.js', html.indexOf('shared/offerPrune.js') > -1 && html.indexOf('shared/offerPrune.js') < html.indexOf('src="renderer.js"'));
  check('_refreshQueueFromBroadcast prunes the sweep offer to the live queue', /OfferPrune\.pruneOffer\(_sweepState, liveIds\)/.test(broadcast));
  check('…and the reprocess-offer bar (hidden at 0)', /OfferPrune\.pruneIds\(_rabOfferIds, liveIds\)/.test(broadcast) && /reprocess-autofile-bar/.test(broadcast));
  check('…and refreshes "Reprocess N from X"', /updateReprocessSupplierButton\(\)/.test(broadcast));
  check('Q4d: …and refreshes the readiness badge BEFORE the list renders', /await refreshScopeReadiness\(\)/.test(broadcast)
        && broadcast.indexOf('await refreshScopeReadiness()') < broadcast.indexOf("if (activeTab === 'review')   renderQueueList()"));
  const sweep = fn('async function _runQueueSweep(');
  check("a 'nothing' answer and an 'auto-accept-running' answer both retire a stale OFFER bar", (sweep.match(/_retireStaleOffer\(\)/g) || []).length >= 2);
  const retire = fn('function _retireStaleOffer()');
  check("…and ONLY an offer-phase bar (filing/done untouched)", /_sweepState\.phase === 'offer'/.test(retire));
  const doneRender = rend.slice(rend.indexOf("if (s.phase === 'done') {"), rend.indexOf("if (s.phase === 'done') {") + 2500);
  check('done render prints "Put back in Review" ONLY when something was filed', /s\.filed\.length \? `<span class="scb-undo"/.test(doneRender));
  check('job_done asks the sweep via quiet, and the bar then says "re-read just now"', /_runQueueSweep\(\{ via: 'quiet' \}\)/.test(rend) && /were re-read just now and pass every check/.test(rend));
  check("the 'nothing was re-read' sentence survives for the plain path (positive control)", /already read cleanly and now pass every check — nothing was re-read/.test(rend));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
