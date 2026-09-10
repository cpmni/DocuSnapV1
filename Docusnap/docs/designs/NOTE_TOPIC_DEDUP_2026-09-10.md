# NOTE-TOPIC DE-DUP — collapse stacked ref-recheck notes (mig 158, DARK)

gary → **Oracle SIGN-OFF-W/COND** (night run 2026-09-10). Built DARK. Kill switch `note_topic_dedup` /
env `NOTE_TOPIC_DEDUP`, in `TEST_SWITCH_KEYS`. Byte-identical OFF.

## The problem (owner: "very wordy message")
A Vellum & Crane sales order's SALES ORDER NUMBER field showed a WALL of three stacked validation notes,
all about the same O/0 confusable ref (`SO-47966` / `S0-47966`). The engine self-limits to **one** note per
run (both engine writers guard `not existing validation_note` — `template_mapper.py:3015`, `engine.py:7388`),
so the wall is a **cross-run, cross-layer** artifact: the JS merge sites blind-append across reprocess runs.

## Root cause + scope (Oracle C1)
There are **FOUR** JS append sites. Only two build the ref exhibit and are routed through the fix:
- `handler.js:1664` (LANE-HOLD SURVIVAL): `fresh && !keep.includes(fresh) ? keep+" "+fresh : keep`.
- `rereadHolds.js:135` (S3-C5): `prior ? prior+" "+note : note`.
**Known residuals** (NOT closed by this slice, out of scope for the ref exhibit): `rereadHolds.js:175`
(first-fills only — skips a field that already HAD a value) and `handler.js:1752` (a different-topic
buyer-issued/"re-check N" flip note). Named so the broader "wordy notes" class isn't claimed as closed.

## The fix
`src/modules/processing/composeNote.js` — a pure `composeNote(existing, incoming)`:
- Classifies each note: **ABSENT** (`_FILING_SANITY_ABSENT_MARK` "doesn't appear on this page as written")
  — its own topic, **never de-duped** (drives the renderer's `_neitherOnPage`); **lane-hold** (rank 2 —
  `_isLaneHoldNote`, carries `corrected_to`); **ref-advisory** (rank 1 — any of the ref-recheck marks); else
  no topic.
- Returns the **higher-rank survivor** only when BOTH operands are in the ref-recheck family (collapse the
  wall); else `null` → the caller keeps its **exact current concat** (byte-identical). Never empty when either
  input is non-empty; never touches `extraction_method`/`corrected_to`.
Routed through the two sites when `noteDedupOn(db)` (setting `note_topic_dedup`, env `NOTE_TOPIC_DEDUP` wins
both ways). At `:1664` the lane-hold is `keep` (survives); at `:135` the lane-hold is the incoming `note`
(survives, drops the advisory `prior`). So the exhibit collapses to the S3-C5 lane-hold note — the most
actionable one (its `corrected_to` gives Review the Use/Keep buttons).

## Why it's safe (Oracle — traced)
trust.js keys on note **PRESENCE** + method **sentinels** (`isAxisLockNoteRow`/`isNonNameFlagRow`) +
`corrected_to` divergence — **never a mark substring** (the owner's "trust.js keys on the marks" premise was
inaccurate). composeNote keeps ≥1 note, never touches method/corrected_to → **auto-file byte-identical**. The
**lane-hold always survives** → a held doc can never be un-held. The engine B/P resolvers run in-engine before
any JS compose + re-derive from the page → a JS note edit can't rob them. **Mark-sync:** the JS mark literals
are hard-coded (a JS site can't import Python constants); a reworded Python mark not mirrored here makes the
de-dup go INERT (the wall returns — verbose, **never unsafe**) — a pin asserts each JS literal is still a
substring of the live Python constant.

## Verification
- Pins GREEN: `src/modules/processing/test_note_topic_dedup.js` (lane-hold survives both site shapes; absent +
  advisory both kept, matches `_neitherOnPage` regex; two advisories → one survivor; ref-advisory + a
  different-topic note NOT merged; never-empty; the two site OFF-vs-ON shapes; mark-sync × 6) +
  `test_migration158_note_topic_dedup.js`; `TEST_SWITCH_KEYS` → 42; release gate clean; handler/rereadHolds/
  composeNote require clean.
- **⚑ FLIP GATE (owner-owed):** realdoc M=0 with the switch OFF + the persisted `validation_note` column
  byte-identical OFF; the **auto-file set-equality** gate — `isAutoFileEligible`/`wouldFile` set IDENTICAL ON
  vs OFF across the corpus (empirically pins the presence-only claim). HYPOTHESIS: the corpus harness is
  largely single-pass and may not exercise the cross-run merge that builds the wall — the JS unit pins are the
  real gate; the flip note must say so.
- Optional companion (if the owner wants immediate legacy relief): a display-time collapse in the renderer,
  computed AFTER the mark-classifiers read the raw note — cosmetic only. Not built.
