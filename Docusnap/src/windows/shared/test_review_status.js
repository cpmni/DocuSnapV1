'use strict';
/*
 * test_review_status.js — pins deriveReviewStatus (shared/reviewStatus.js), the ONE live-status decision for
 * the Review preview strip (Oracle 2026-09-25 B1/B2, banner reconciliation cut 2). The owner hit a Review
 * screen shouting a background auto-file CHECK beside an actionable "ready to file" OFFER at once ("file now"
 * vs "still checking if fileable"). This reducer makes the background check YIELD to the offer/countdown —
 * which are NEVER suppressed (B1: a cancellable auto-file must always stay visible). Pure, no DOM.
 *   node src/windows/shared/test_review_status.js
 */
const RS = require('./reviewStatus.js');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── priority: countdown > offer > checking > idle ──
check('idle when nothing is live', RS.deriveReviewStatus({}) === 'idle');
check('checking when only a check is live', RS.deriveReviewStatus({ checkActive: true }) === 'checking');
check('offer when only an offer is live', RS.deriveReviewStatus({ offerActive: true }) === 'offer');
check('countdown when only a countdown is live', RS.deriveReviewStatus({ inviewActive: true }) === 'countdown');
check('offer beats checking', RS.deriveReviewStatus({ checkActive: true, offerActive: true }) === 'offer');
check('countdown beats offer', RS.deriveReviewStatus({ offerActive: true, inviewActive: true }) === 'countdown');
check('countdown beats everything', RS.deriveReviewStatus({ checkActive: true, offerActive: true, inviewActive: true }) === 'countdown');

// ── THE CLASH (the owner's exhibit): a check AND an offer live at once must resolve to ONE surface,
//    and it must be the actionable offer — the background check hides. This is the bug reproduced. ──
check('CLASH check+offer → the offer owns the strip (not both)',
      RS.deriveReviewStatus({ checkActive: true, offerActive: true }) === 'offer');
check('CLASH check+offer → the check bar does NOT show', RS.checkBarShows({ checkActive: true, offerActive: true }) === false);

// ── B1 INVARIANT (ship-blocker): the reducer NEVER hides the offer/countdown — it can only ever suppress
//    the background 'checking'. checkBarShows is the ONLY thing gated; assert the offer/countdown are never
//    the thing that yields. Enumerate all 8 states. ──
for (const inviewActive of [false, true]) for (const offerActive of [false, true]) for (const checkActive of [false, true]) {
  const s = { inviewActive, offerActive, checkActive };
  const v = RS.deriveReviewStatus(s);
  // whenever a countdown is live, it MUST own the strip (never suppressed by anything)
  if (inviewActive) check(`countdown never suppressed (${JSON.stringify(s)})`, v === 'countdown');
  // whenever an offer is live and no countdown, the offer MUST own it (never suppressed by the check)
  if (!inviewActive && offerActive) check(`offer never suppressed by the check (${JSON.stringify(s)})`, v === 'offer');
  // the check may show ONLY when nothing actionable is up
  check(`check shows only when idle-of-actionables (${JSON.stringify(s)})`,
        RS.checkBarShows(s) === (checkActive && !offerActive && !inviewActive));
  // at most ONE live surface, always
  check(`exactly one owner (${JSON.stringify(s)})`, RS.ORDER.includes(v));
}

// ── event sequence (the "interleaving" gate at the logic level): a check starts, an offer arrives mid-check,
//    the offer is dismissed while the check is still running, then the check finishes. At every step exactly
//    one live surface owns the strip and the offer/countdown are never hidden. ──
const seq = [
  { step: 'check starts',            s: { checkActive: true },                      want: 'checking' },
  { step: 'offer arrives mid-check', s: { checkActive: true, offerActive: true },   want: 'offer' },     // clash → offer wins, check hides
  { step: 'countdown starts',        s: { checkActive: true, inviewActive: true },  want: 'countdown' }, // countdown always wins
  { step: 'countdown ends, offer up',s: { checkActive: true, offerActive: true },   want: 'offer' },
  { step: 'offer dismissed',         s: { checkActive: true },                      want: 'checking' },  // check reappears
  { step: 'check finishes',          s: {},                                         want: 'idle' },
];
for (const t of seq) check(`sequence: ${t.step} → ${t.want}`, RS.deriveReviewStatus(t.s) === t.want);

console.log(fails ? `\n${fails} FAILED` : '\nAll review-status reducer pins passed');
process.exit(fails ? 1 : 0);
