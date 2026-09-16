# Split-segment "look first" hold — design record (2026-09-16)

**Status:** BUILT, default ON (mig 176 `split_segment_multipage_hold`, INSERT OR IGNORE seed; kill = `'false'`).
**Advisors:** gary (design + test strategy) → Oracle **SIGN OFF WITH CONDITIONS** C1–C10 (all built). Owner: "build it
once the oracle signs off".

## The seam (found by the watch_separate soak, `TESTING/_measure/watch_separate_soak_20260916/RESULT.md`)
The multi-document separator (`python_backend/ocr/segmentation.py`) cuts a later page into a new document only when
that page presents a known template's FIRST-PAGE signature (logo + keyword-fingerprint overlap ≥ 0.5). Same-logo
sibling types and non-templated pages fail that floor ("continuation"), so document A's page and a stranger page B
come out as ONE multi-page segment that reads 100 % clean from page A.
- Watch path: held only by an import-time `autoFileRun=false` (`src/modules/watch/handler.js:483`) — no row fact, so
  File-All-Ready / the scope sweep could file it later unseen.
- Manual path: NO hold at all — `processing/handler.js` discarded the rewrites ("only the count is used") and the
  segment auto-filed. **Measured 2026-09-16 (belt OFF, the soak's bundle set through a manual import): 12 of 16
  multi-page cuts auto-filed at 100 %** — company B's page bound inside company A's filed PDF, in A's folder.
- Class boundary (Oracle): the belt closes the merged-CUT class only. A stack whose only recognised first page is
  page 1 is never split at all (`split_plan.js` 'skip') and imports WHOLE — that is the separator-accuracy item.

## The fix (hold-only; one setting; no schema; both arrival paths)
1. `_separateBatchDocuments` rewrites carry `separators` (`handler.js:2929`); pure `split_plan.segmentHoldPages(rewrites)`
   → Map<basename, {from,to}> of the MULTI-page segments of HEURISTIC splits (a sheet-bounded rewrite is exempt; a
   1-page cut can't hold a stranger). The rewrite set is the trigger — never the filename alone (a user's own
   `x_split_p2-3.pdf` or the Review Split tool's output has no rewrite → never held).
2. Both paths thread the set to `_handleFileMessage(…, autoFileRun, { segmentHold })`; the stamp `_stampSegmentHold`
   runs after the extraction rows are written and before the import-strip chip verdict + `_maybeAutoFile` (C2):
   the sentence "Pages a–b were cut from a multi-document scan; check every page belongs to this document (if one
   doesn't, use Split) — confirm once." lands on the ref-role row → date-role row → a VISIBLE valued non-identity row
   (prefer one with no note) → `supplier_name` LAST (issuerSiblingFillService machine-clears supplier_name notes on
   siblings) → a stub on the ref key (C3). Idempotent. The "— confirm once." suffix joins the lane-hold family
   byte-equal with `handler._isLaneHoldNote` / `rereadHolds.CONFIRM_ONCE` / `composeNote._isLaneHold` (C8).
3. Effect: the ONE predicate `isAutoFileEligible` refuses (a role note is never soft) at import, File-All-Ready
   (incl. the put-back bypass), the scope sweep (Tier 1 via the predicate, Tier 2 via `sweepPredicate` 'stored-flagged',
   C7) and the reprocess offer. A human Confirm clears every note (`reviewService.js`); Mark reviewed → File All is
   a human look too.
4. Slice 2 (C1, same release): the merge keeps a lane-hold note only when the fresh value equals the stored one, so
   `split_plan.carrySegmentHold` runs at the ONE production merge site (`handler.js` after `mergeReprocessRows`,
   before the row write and before rereadHolds) and puts the sentence back on the merged ref-role row.
5. C4: `get-auto-file-reason` reports kind `'segment-hold'` + `{from,to}`; Review's reason copy says what it is and
   points at Split — never "flagged by a formatting check". C5: `composeNote._refRank` = 0 for the mark (never
   de-duped under `note_topic_dedup`; a co-present ref advisory survives).

## The pinned trade-off
A CORRECT heuristic multi-page cut (a genuine 2-page invoice inside a stack) now needs one human look instead of
riding File-All's one click. 1-page cuts (the real 34-page Print Tracker bundle → 34 one-page cuts → one File-All
click) and sheet-bounded cuts are untouched. Customers who scan stacks of multi-page documents and want zero looks
have the built answer: separator sheets (exempt by construction).

## Pins
`src/modules/processing/test_segment_hold_predicate.js` (pure: selection, sheet exemption, the naming contract in
`pdf_splitter.py`, the byte-equal family literal, carrySegmentHold, composeNote own-topic) ·
`src/modules/processing/test_segment_hold_stamp.js` (Electron-as-Node: every door refuses incl. the bypass + the
sweep Tier 2; positive control; OFF byte-identical; THE TRADE-OFF; C6 no-rewrite never held; C3 target order;
idempotent; merge drop → carry; C10 source contracts) · `database/test_segment_hold_default.js` (mig 176 fresh ON,
kill durable, unlisted, gate-clean) · `test_note_topic_dedup.js` (C5 case).

## Verification (2026-09-16)
- Manual import, belt OFF (old code): 102 docs, 62 auto-filed, **12 / 16 multi-page cuts auto-filed** (the exposure).
- Watch replay, belt ON (new code): 104 docs; 14/14 multi-page cuts marked, held, 0 eligible; 85 one-page cuts
  unmarked (55 already "ready" for the one-click File All); 5 singles untouched. VIOLATIONS 0.
- Manual replay, belt ON: 104 docs; 14/14 multi-page cuts marked, held, **0 auto-filed** (was 12/16); the 55
  one-page cuts auto-filed exactly as before. VIOLATIONS 0. Record + checker:
  `TESTING/_measure/watch_separate_soak_20260916/` (`RESULT.md`, `soak_on_check.js`, `on_*_result.txt`).
- `npm run test:pins` green (382 files; `test_ref_class_fix.js` is a pre-existing timing flake — its ARM B hashes
  two corpora built at different moments — passes when the two land in the same second).

## Rollback
One setting: `split_segment_multipage_hold = 'false'` (durable; mig 176 never re-forces). Rows already stamped keep
their note until confirmed (a human look each) — or clear them with one UPDATE on the mark if the belt is abandoned.
