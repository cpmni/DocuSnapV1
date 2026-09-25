'use strict';

// deriveReviewStatus — the ONE live-status decision for the Review preview strip (Oracle 2026-09-25,
// banner reconciliation, cut 2). The owner hit a Review screen shouting two live messages at once — a
// background auto-file eligibility CHECK ("Checking … 7 of 18") beside an actionable "N ready to file"
// OFFER — which read as a contradiction ("file now" vs "still checking if they're fileable").
//
// This pure reducer decides which ONE live surface owns the strip, so the two never co-render.
//
// HARD INVARIANT (Oracle B1, the ship-blocker): the actionable auto-file COUNTDOWN and OFFER are NEVER
// suppressed — a cancellable auto-file must always stay visible (hiding it would turn a countdown the user
// can Stop into a silent auto-file). So only the BACKGROUND check yields, never the other way. Priority is
// fixed and one-directional:
//     countdown  >  offer  >  checking  >  idle
// Because the offer/countdown always win, no offer is ever deferred or delayed (Oracle B2 satisfied by
// construction — nothing to scope by sender, nothing to replay).
//
// Pure + dependency-free. Loaded as a <script> in Review (window.ReviewStatus) and require()d by
// test_review_status.js — ONE source. The renderer applies the verdict to element visibility; the DECISION
// lives here so it is unit-testable without a DOM (this repo has no jsdom).
(function (root) {
  const ORDER = ['countdown', 'offer', 'checking', 'idle'];

  // s: { inviewActive, offerActive, checkActive } — the three live surfaces' current state.
  //   inviewActive — the in-view auto-file countdown is running (renderer `_inviewCd`).
  //   offerActive  — the "N ready to file" reprocess offer bar is on screen.
  //   checkActive  — a quiet-lane 'ready' eligibility check job is in flight.
  // Returns the single surface that owns the live strip.
  function deriveReviewStatus(s) {
    s = s || {};
    if (s.inviewActive) return 'countdown';   // live cancellable auto-file — always owns the surface
    if (s.offerActive)  return 'offer';        // actionable "ready to file" — wins over the background check
    if (s.checkActive)  return 'checking';     // background eligibility check — shows only when nothing actionable is up
    return 'idle';
  }

  // The check bar may show ONLY when it owns the strip. (The offer/countdown render on their own paths and
  // are never gated by this — the invariant above.)
  function checkBarShows(s) { return deriveReviewStatus(s) === 'checking'; }

  root.ReviewStatus = { deriveReviewStatus, checkBarShows, ORDER };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).ReviewStatus;
}
