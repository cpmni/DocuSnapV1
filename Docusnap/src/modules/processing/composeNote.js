'use strict';
/*
 * composeNote — topic-aware validation-note composition (mig 158, DARK `note_topic_dedup`;
 * gary → Oracle SIGN-OFF-W/COND, 2026-09-10 night run).
 *
 * A reference field accumulated a WALL of overlapping "check the O/0 confusable ref" notes (owner:
 * "very wordy message"). Within ONE engine run the two engine-side ref-confusable notes are mutually
 * exclusive (both guard `not existing validation_note`); the wall is a CROSS-RUN, CROSS-LAYER artifact
 * built by the JS blind-append merge sites (handler.js LANE-HOLD SURVIVAL + rereadHolds.js S3-C5). This
 * collapses two notes about the SAME ref-recheck topic to the higher-rank one; every other note pair
 * falls through to the caller's exact current concat (byte-identical).
 *
 * SAFETY (Oracle): never returns empty when either input is non-empty (the trust.js hold key is note
 * PRESENCE); never touches `extraction_method` or `corrected_to`; the lane-hold (higher rank) always
 * survives, so a held doc can never be un-held; the ABSENT mark is its own topic that NEVER de-dups
 * (it drives the renderer's `_neitherOnPage` "draw the box again" affordance).
 *
 * KNOWN RESIDUALS (Oracle C1 — the broader "wordy notes" class is NOT fully closed by this slice):
 * there are FOUR JS append sites; only handler.js:1664 + rereadHolds.js:135 are routed here (they build
 * the ref exhibit). `rereadHolds.js:175` (first-fills only — skips a field that already HAD a value) and
 * `handler.js:1752` (a different-topic buyer-issued/"re-check N" flip note) are out of scope for the ref
 * exhibit and left for a later pass.
 */

// The ref-recheck ADVISORY marks. Python literals are hard-coded here (a JS site can't import them); the
// mark-sync pin asserts each is still a substring of the live Python constant, so a reworded Python mark
// that isn't mirrored here makes the de-dup go INERT (the wall returns — verbose, NEVER unsafe).
const REF_ADVISORY_MARKS = Object.freeze([
  'one character differs',                          // template_mapper.py _witness_note
  'look alike on a scan',                           // template_mapper.py _witness_note
  'check which is printed',                         // template_mapper.py _witness_note
  'please confirm the reference before filing',     // engine.py _FILING_SANITY_SOFTEN_MARK
  'the box may be clipping the first character',     // template_mapper.py _INLINE_DISAGREE_MARK
]);
// The ABSENT mark — its OWN topic, NEVER de-duped (renderer `_neitherOnPage` keys on it).
const ABSENT_MARK = "doesn't appear on this page as written";   // engine.py _FILING_SANITY_ABSENT_MARK
// Lane-hold family — mirrors handler.js `_isLaneHoldNote` (the hold that must always survive).
function _isLaneHold(n) {
  return n.includes('Read differently after learning') || n.includes('— confirm once.');
}
function _hasAbsent(n) { return n.includes(ABSENT_MARK); }
function _isRefAdvisory(n) { return REF_ADVISORY_MARKS.some(m => n.includes(m)); }
// Rank within the ref-recheck family: lane-hold (2 — actionable, carries corrected_to) > advisory (1).
// 0 = not in the family (or an absent-mark note) → never de-duped.
function _refRank(n) {
  if (_hasAbsent(n)) return 0;
  if (_isLaneHold(n)) return 2;
  if (_isRefAdvisory(n)) return 1;
  return 0;
}

/**
 * Returns the SURVIVOR note when both operands are the same ref-recheck topic (collapse the wall), else
 * null — the caller then keeps its exact current concat behaviour (byte-identical). Keeps the higher rank;
 * a tie keeps `existing`. Never empty when either input is non-empty (returns null → caller concats).
 */
function composeNote(existing, incoming) {
  const a = String(existing == null ? '' : existing).trim();
  const b = String(incoming == null ? '' : incoming).trim();
  if (!a || !b) return null;                     // an empty operand → nothing to collapse; caller handles it
  if (_hasAbsent(a) || _hasAbsent(b)) return null;   // Oracle C3: the absent mark is never droppable → concat
  const ra = _refRank(a), rb = _refRank(b);
  if (ra === 0 || rb === 0) return null;         // not BOTH in the ref-recheck family → different topics → concat
  return rb > ra ? b : a;                        // same topic → keep the higher rank; tie → existing
}

// Switch reader (env wins both ways; else the DB setting) — the _shadowRowSkipEnabled idiom, for the JS-main
// merge sites (which read the setting, not a Python spawn env). Default OFF ⇒ byte-identical.
function noteDedupOn(db) {
  const env = process.env.NOTE_TOPIC_DEDUP;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('../../../database/modules/learning').getSetting(db, 'note_topic_dedup', 'false') === 'true'; }
  catch { return false; }
}

module.exports = { composeNote, noteDedupOn, REF_ADVISORY_MARKS, ABSENT_MARK, _isRefAdvisory, _refRank };
