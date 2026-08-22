'use strict';

// OFFER PRUNE — Q4c of the Chris round-14 queue (13b card 2 again: a "12 … ✓ File up to 12" bar
// shown seconds after those 12 filed themselves; pressing it → "Filed 0" + "kept back"; bars
// stacking; "Reprocess 13 from X" with 6 left). gary → Oracle SIGN OFF, 2026-08-22.
//
// An offer is a SNAPSHOT of the queue; the queue moves under it (auto-accept, another window,
// File All). The renderer now prunes every live offer to the documents STILL in the queue
// whenever the queue refreshes from a broadcast, and retires an offer-phase bar the moment its
// last candidate leaves. Pure, dependency-free; loaded as a <script> in Review
// (window.OfferPrune) and require()d by its test.
(function (root) {
  /** Sweep consent bar state: offer-phase candidates filtered to `liveIds`; null when none are
   *  left (the bar retires). 'filing' and 'done' phases are returned UNTOUCHED — the accept path
   *  re-validates server-side, and the receipt must keep naming what was filed. */
  function pruneOffer(state, liveIds) {
    if (!state) return null;
    if (state.phase !== 'offer') return state;
    const live = (state.candidates || []).filter(c => liveIds && liveIds.has(c.docId));
    if (!live.length) return null;
    if (live.length === state.candidates.length) return state;
    const keep = new Set(live.map(c => c.docId));
    state.candidates = live;
    if (state.unticked && typeof state.unticked.forEach === 'function') {
      for (const id of Array.from(state.unticked)) if (!keep.has(id)) state.unticked.delete(id);
    }
    return state;
  }
  /** A plain id list (the reprocess-offer bar) filtered to the live queue. */
  function pruneIds(ids, liveIds) {
    return (ids || []).filter(id => liveIds && liveIds.has(id));
  }
  root.OfferPrune = { pruneOffer, pruneIds };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).OfferPrune;
}
