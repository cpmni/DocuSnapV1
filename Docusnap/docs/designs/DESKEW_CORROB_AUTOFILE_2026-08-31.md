# Corroborated-straighten auto-file (DESKEW_CORROB_AUTOFILE) — DARK arc

**Status:** BUILT DARK + unit-pinned (2026-08-31 NIGHT2). Owner ask; gary + reggie design → **Oracle
SIGN-OFF-WITH-CONDITIONS (C1-C7, all applied)**. **DO NOT FLIP** without the enumerated-heals census
(owner-machine) — Oracle: "DO NOTHING is the correct LIVE state until the census." Default OFF = byte-identical.

## The ask
On a tilted scan the review-bound straighten retry recovers fields but holds every straighten-CHANGED
field with a "Read differently after straightening — confirm once" note, so the doc can't auto-file.
Owner exhibit (Pelican invoice, doc 806): after straightening, invoice_date=07-06-2026 and
invoice_number=PI/26/7656 each read by **both keyword and anchor(crop)** (corroboration `{winner:crop,
agree:[keyword], independent_agree:true}`, verified in the live DB) + regex-valid — yet held. Owner:
corroboration + regex should be enough to auto-file.

## Root cause + charter
`_deskew_retry_apply_holds` (`process_docs.py:124`) stamps `_DESKEW_CHANGED_NOTE` on every straighten-changed
field; `isAutoFileEligible` refuses any note (`trust.js` `flagged`), so the note IS the whole hold. Oracle
confirmed the retry's `raw2["_needs_review"]=True` is a dead guard under `autofile_gate_unify` (on since
mig-93), so the note is the only safety. The arc NARROWS the charter from "never auto-files a straightening-
CHANGED value" to "…an UNVERIFIED changed value."

## Design (Option A — skip the note write in Python; no floor touched)
Behind DARK env `DESKEW_CORROB_AUTOFILE` (bridged in `handler.js _reconcileEnv` **only when
`corroboration_autofile` AND `deskew_corrob_autofile` are both true** — C7), `_deskew_retry_apply_holds`
skips writing the note (and `corrected_to`) on a changed field iff `_deskew_corrob_autofile_ok`:
- **C2a** `engine._corrob_licensed(rec)` (≥2 distinct page families {mapping,crop,keyword}, no disagree) **AND
  a `keyword` page-text witness in the agreeing set** — a page-text read is a different OCR invocation from a
  crop re-OCR, closing the mapping+crop common-mode case. A NEW wrapper `_corrob_licensed_keyword`; the shared
  `_corrob_licensed` (`engine.py:1804` / `trust.js:550`) is NOT modified.
- **C2b/C2c/C3** the STRAIGHTENED value matches its learned skeleton — `now_shape is True`. The engine now
  surfaces a per-field verdict `results["_shape_ok"]` (`engine.py`, by the `_corroboration_emit` attach):
  True = `check_value` None (coarse-consistent; for date/currency this also means it parses) AND
  `shape_match_score == 1.0` (exact learned skeleton); False = has a skeleton but violates it; ABSENT = no
  learned skeleton. **Requiring a matched skeleton is stricter than reggie's regex-only** — the conservative
  choice Oracle mandated. A field with no learned skeleton never fires (fail-toward-hold).
- **C4 (the seam)** raw-credibility: skip ONLY when the RAW read `was` was NOT a credible competing reading —
  `was` empty OR its skeleton verdict (`raw_extractions["_shape_ok"]`) is False. A `was` that is itself
  skeleton-valid and merely DIFFERS keeps the note (two credible reads disagree → human). This is the backstop
  Oracle added because the straightened corroboration record is BLIND to the raw pass (both keyword+crop read
  the SAME straightened raster, so they can't tell "straightening fixed it" from "straightening broke a correct
  read"). Exhibit: invoice_date `was=''` (rescue); invoice_number `was='PO-29444'` fails Pelican's PI/NN/NNNN
  skeleton (rescue). Danger case (straightening flips a correct INV-100→INV-200, both skeleton-valid): `was`
  skeleton True → HELD.
- **C5** an emptied field (`now` empty) always holds. **C6** never file over a pre-existing note or
  `corrected_to` (free — the one-note-per-field guard at `:135` + the corrected_to guard).

Everything stays Python-side; `isAutoFileEligible` is UNCHANGED (a note-free row files via the normal
predicate, every floor intact). `_shape_ok` is `_`-metadata, dropped by `sanitise_extractions` → OFF inert.

## Files
`engine.py` (`_shape_ok` surface by `:10850`), `process_docs.py` (`_corrob_licensed_keyword`,
`_deskew_corrob_autofile_ok`, the skip in `_deskew_retry_apply_holds`), `handler.js` (`_reconcileEnv` bridge),
pin `python_backend/tests/test_deskew_corrob_autofile.py` (12 cases, all green).

## Verification tonight
- 12 unit pins GREEN: rescue (was-empty / was-skeleton-False), HOLD on {was-credible-differs, OFF,
  single-family, no-keyword-witness, a disagree, now-skeleton-False, now-no-skeleton, emptied, pre-existing
  note, pre-existing corrected_to}.
- Engine `_shape_ok` addition byte-identical/safe: import smoke 14/14, no crash, statuses unchanged.
- OFF byte-identical on the exhibit (0 value diffs, arc inert).

## ⚠ Census finding (load-bearing for the FLIP gate)
The arc could NOT be reproduced end-to-end on the exhibit tonight: reprocessing doc 806 (both the working
copy and the ORIGINAL scan) at 200 DPI reads it **clean** — because Pelican is now well-learned (166
confirmed), so the straighten retry never fires (no review-bound first read). The empty-first-read the owner
saw was the **WARMING phase** (before Pelican's template was solid). **Implication:** the arc's value is
concentrated in early/warming imports (a fresh customer's first docs from a supplier), and the enumerated-
heals census CANNOT be produced by reprocessing now-warm docs — it needs the cold/point-in-time import state
(reprocess the original scans against a cold template state, or observe the arc during live cold imports).

## Oracle's FLIP gate (owner-machine, morning — NOT done)
Before any flip: realdoc arm (arc-ON vs deskew-retry-only baseline) with **reads byte-identical** (assert —
the arc writes only notes/corrected_to); the auto-file set differs ONLY by an **enumerated** list of
straighten-changed corroborated heals; a **human verifies every `now`** in that list is correct; **M=0** new
wrong auto-files; and **no disputed-class doc** (role field whose raw read was skeleton-credible and differs)
silently files. Reproduce the review-bound state per the census finding above.
